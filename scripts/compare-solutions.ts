/**
 * Two models write the 해설 of the same published questions, somebody picks between them without
 * knowing which wrote which, and what they picked goes into the seed. Nothing is thrown away: the
 * losing explanation stays in the run, and the run says which model won and on what.
 *
 *   npm run compare:solutions -- generate --run <name> --courses similarity,pythagoras,probability [--limit N]
 *   npm run compare:solutions -- blind --run <name>
 *   npm run compare:solutions -- apply --run <name> [--replace]
 *   npm run compare:solutions -- recheck --run <name>    (the checks again, after changing one)
 *
 * A run lives in comparisons/<name>/: candidates.json (every request and both answers, written as
 * each arrives, so a stopped run carries on), blind.json (what the chooser sees: A and B, shuffled
 * per question, no names) and key.json (which letter is which). The chooser's picks come back as
 * picks.json — { "<problemVersionId>": { "pick": "a" | "b" | "neither", "note"?: string } }.
 * `apply` writes the picked 해설 into prisma/seed/<course>.json for questions that have none (or all
 * of them with --replace), and result.json with the tally.
 */
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import katex from 'katex';
import { checkSolution, solutionRequest, solutionSystem, type Explainer, type ProblemForExplanation, type SolutionIssue } from '../src/server/explanation';
import { claudeExplainer, geminiExplainer } from '../src/server/explainers';
import type { AnswerSpec } from '../src/shared/answer';
import type { CourseStage } from '../src/shared/api';

type Block = { blockId: string; kind: string; typeVersion: number; required: boolean; payload: { text?: string } & Record<string, unknown> };
type SeedProblem = { problemVersionId: string; conceptKeys: string[]; promptContent: Block[]; gradingSpec: AnswerSpec; hints?: Block[];
  solution: Block[]; misreadings?: { answer: string; misconception?: string }[] };
type Seed = {
  courses: { key: string; title: string; stage?: CourseStage | null }[];
  concepts?: { key: string; label: string }[];
  lessons: { public: { lessonKey: string; title: string; conceptKeys: string[] }; sections: { role: string; contentBlocks: Block[] }[];
    review?: { problemSetVersionId: string } | null }[];
  problemSets: { problemSetId: string; versionId: string; problems: SeedProblem[] }[];
};
type Output = { solution: string; served: string; usage: { input: number; output: number; thinking?: number }; ms: number; issues: SolutionIssue[] } | { error: string };
type Item = { id: string; courseKey: string; lessonKey: string | null; problem: ProblemForExplanation; request: string; outputs: Record<string, Output> };
type Run = { name: string; task: 'solution'; createdAt: string; courses: string[]; writers: string[]; system: string; items: Item[] };
/** A note can be saved before anything is picked, so an unpicked question is a pick of null. */
type Pick = { pick: 'a' | 'b' | 'neither' | null; note?: string };

const args = process.argv.slice(2);
const command = args[0];
const flag = (name: string) => { const at = args.indexOf(`--${name}`); return at >= 0 ? args[at + 1] : undefined; };
const runName = flag('run');
if (!command || !runName || !/^[a-z0-9-]+$/.test(runName)) {
  console.error('Usage: npm run compare:solutions -- <generate|blind|apply|recheck> --run <name> [--courses a,b] [--limit N] [--replace]');
  process.exit(2);
}
const dir = join('comparisons', runName);
const seedPath = (courseKey: string) => join('prisma', 'seed', `${courseKey}.json`);
const readJson = <T>(path: string): T => JSON.parse(readFileSync(path, 'utf8')) as T;
/** Written beside and moved into place, so a run stopped mid-write never leaves half a file. */
function writeJson(path: string, value: unknown) {
  writeFileSync(`${path}.tmp`, `${JSON.stringify(value, null, 2)}\n`);
  renameSync(`${path}.tmp`, path);
}
const textOf = (blocks: Block[] = []) => blocks.map((block) => block.payload.text ?? '').filter(Boolean).join(' ').replace(/\s*\n+\s*/g, ' ').trim();

/** Every question a course's seed holds, with the lesson that shows it when one does. */
function questionsOf(courseKey: string): Item[] {
  const seed = readJson<Seed>(seedPath(courseKey));
  const course = seed.courses.find((item) => item.key === courseKey) ?? seed.courses[0];
  const labels = new Map((seed.concepts ?? []).map((concept) => [concept.key, concept.label]));
  const lessonOfSet = new Map<string, Seed['lessons'][number]>();
  for (const lesson of seed.lessons) {
    for (const section of lesson.sections) for (const block of section.contentBlocks) {
      const versionId = block.kind === 'core.problem_set' ? (block.payload as { problemSetVersionId?: string }).problemSetVersionId : undefined;
      if (versionId) lessonOfSet.set(versionId, lesson);
    }
    if (lesson.review?.problemSetVersionId) lessonOfSet.set(lesson.review.problemSetVersionId, lesson);
  }
  const seen = new Set<string>();
  return seed.problemSets.flatMap((set) => set.problems.flatMap((problem): Item[] => {
    if (seen.has(problem.problemVersionId)) return [];
    seen.add(problem.problemVersionId);
    const lesson = lessonOfSet.get(set.versionId);
    const asked: ProblemForExplanation = {
      problemVersionId: problem.problemVersionId,
      prompt: textOf(problem.promptContent),
      options: problem.gradingSpec.kind === 'choice' ? problem.gradingSpec.options.map((option) => option.text) : [],
      spec: problem.gradingSpec,
      hints: (problem.hints ?? []).map((hint) => textOf([hint])),
      misreadings: (problem.misreadings ?? []).map((item) => ({
        answer: problem.gradingSpec.kind === 'choice' ? `「${problem.gradingSpec.options.find((option) => option.id === item.answer)?.text ?? item.answer}」` : item.answer,
        misconception: item.misconception ?? null })),
      course: { title: course.title, stage: course.stage ?? null },
      lesson: lesson ? { title: lesson.public.title, concepts: lesson.public.conceptKeys.map((key) => labels.get(key) ?? key),
        summary: textOf(lesson.sections.find((section) => section.role === 'summary')?.contentBlocks) } : null,
    };
    return [{ id: problem.problemVersionId, courseKey, lessonKey: lesson?.public.lessonKey ?? null, problem: asked, request: solutionRequest(asked), outputs: {} }];
  }));
}

/** Tries a request a few times: a model that is busy now is usually not busy in a minute. */
async function attempt(writer: Explainer, item: Item): Promise<Output> {
  let last = '';
  for (let round = 0; round < 3; round++) {
    const started = Date.now();
    try {
      const written = await writer.explain(solutionSystem, item.request);
      return { ...written, ms: Date.now() - started, issues: checkSolution(written.solution, item.problem) };
    } catch (reason) {
      last = reason instanceof Error ? reason.message : String(reason);
      await new Promise((resolve) => setTimeout(resolve, 5000 * (round + 1)));
    }
  }
  return { error: last };
}

async function generate() {
  const courses = (flag('courses') ?? '').split(',').map((key) => key.trim()).filter(Boolean);
  const writers = [claudeExplainer(), geminiExplainer()];
  mkdirSync(dir, { recursive: true });
  const path = join(dir, 'candidates.json');
  const run: Run = existsSync(path) ? readJson<Run>(path)
    : { name: runName!, task: 'solution', createdAt: new Date().toISOString(), courses, writers: writers.map((writer) => writer.name), system: solutionSystem, items: [] };
  if (run.system !== solutionSystem) console.warn('The instructions changed since this run started; new answers are written under the new ones.');
  for (const courseKey of courses.length ? courses : run.courses) {
    for (const item of questionsOf(courseKey)) if (!run.items.some((held) => held.id === item.id)) run.items.push(item);
  }
  const limit = Number(flag('limit') ?? run.items.length);
  const todo = run.items.slice(0, limit).flatMap((item) => writers.filter((writer) => {
    const held = item.outputs[writer.name];
    return !held || 'error' in held;
  }).map((writer) => ({ item, writer })));
  console.log(`${run.items.length} questions; ${todo.length} answers to write with ${writers.map((writer) => writer.name).join(' and ')}.`);
  let done = 0;
  const lanes = Array.from({ length: Math.min(6, todo.length) }, async () => {
    for (let next = todo.shift(); next; next = todo.shift()) {
      next.item.outputs[next.writer.name] = await attempt(next.writer, next.item);
      writeJson(path, run);
      done += 1;
      const output = next.item.outputs[next.writer.name];
      console.log(`${done} ${next.writer.name} ${next.item.id} ${'error' in output ? `failed: ${output.error}` : `${output.ms}ms${output.issues.length ? ` · ${output.issues.map((issue) => issue.code).join(',')}` : ''}`}`);
    }
  });
  await Promise.all(lanes);
  const spent = run.writers.map((name) => {
    const outputs = run.items.map((item) => item.outputs[name]).filter((output): output is Exclude<Output, { error: string }> => !!output && !('error' in output));
    return `${name}: ${outputs.length} written, in ${outputs.reduce((sum, output) => sum + output.usage.input, 0)} / out ${outputs.reduce((sum, output) => sum + output.usage.output + (output.usage.thinking ?? 0), 0)} tokens, `
      + `${outputs.filter((output) => output.issues.length).length} with issues`;
  });
  console.log(spent.join('\n'));
}

const escapeHtml = (text: string) => text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
/**
 * The page cannot load KaTeX's fonts, so the math is turned into MathML here, which a browser draws
 * on its own. Paragraphs are blank lines, as the lesson screen reads them.
 */
const rich = (text: string) => text.split(/\n\s*\n/).map((paragraph) => `<p>${paragraph.split(/(\$[^$]+\$)/).map((piece) => (
  piece.startsWith('$') && piece.endsWith('$') && piece.length > 1
    ? (() => { try { return katex.renderToString(piece.slice(1, -1), { output: 'mathml', throwOnError: true }); } catch { return `<code>${escapeHtml(piece)}</code>`; } })()
    : escapeHtml(piece).replace(/\n/g, '<br>'))).join('')}</p>`).join('');

/** Which letter each writer gets for a question: fixed by the run and the question, so it never moves. */
const letters = (run: Run, id: string): [string, string] => {
  const [first, second] = run.writers;
  return createHash('sha256').update(`${run.name}:${id}`).digest()[0] % 2 ? [second, first] : [first, second];
};

function blind() {
  const run = readJson<Run>(join(dir, 'candidates.json'));
  const titles = new Map<string, string>();
  for (const courseKey of run.courses) titles.set(courseKey, readJson<Seed>(seedPath(courseKey)).courses.find((course) => course.key === courseKey)?.title ?? courseKey);
  const ready = run.items.filter((item) => run.writers.every((name) => item.outputs[name] && !('error' in item.outputs[name])));
  const key: Record<string, { a: string; b: string }> = {};
  const items = ready.map((item) => {
    const [a, b] = letters(run, item.id);
    key[item.id] = { a, b };
    const side = (name: string) => { const output = item.outputs[name] as Exclude<Output, { error: string }>; return { html: rich(output.solution), issues: output.issues.map((issue) => issue.message) }; };
    return { id: item.id, course: titles.get(item.courseKey) ?? item.courseKey, lesson: item.problem.lesson?.title ?? '모아 풀기',
      prompt: rich(item.problem.prompt), options: item.problem.options.map(rich), answer: rich(item.request.match(/^정답: (.*)$/m)?.[1] ?? ''),
      misreadings: item.problem.misreadings.map((entry) => rich(entry.answer)), hints: item.problem.hints.map(rich), a: side(a), b: side(b) };
  });
  writeJson(join(dir, 'blind.json'), { run: run.name, task: '해설', createdAt: new Date().toISOString(), items });
  writeJson(join(dir, 'key.json'), key);
  console.log(`${items.length} questions ready to compare (${run.items.length - items.length} still missing an answer).`);
}

function apply() {
  const run = readJson<Run>(join(dir, 'candidates.json'));
  const picks = readJson<Record<string, Pick>>(join(dir, 'picks.json'));
  const key = readJson<Record<string, { a: string; b: string }>>(join(dir, 'key.json'));
  const replace = args.includes('--replace');
  const tally: Record<string, number> = Object.fromEntries([...run.writers, 'neither'].map((name) => [name, 0]));
  const byCourse: Record<string, Record<string, number>> = {};
  const winners = new Map<string, string>();
  for (const [id, pick] of Object.entries(picks)) {
    const item = run.items.find((entry) => entry.id === id);
    if (!item || !key[id] || !pick.pick) continue;
    const name = pick.pick === 'neither' ? 'neither' : key[id][pick.pick];
    tally[name] += 1;
    (byCourse[item.courseKey] ??= Object.fromEntries([...run.writers, 'neither'].map((writer) => [writer, 0])))[name] += 1;
    const output = item.outputs[name];
    if (name !== 'neither' && output && !('error' in output)) winners.set(id, output.solution);
  }
  let written = 0;
  for (const courseKey of run.courses) {
    const path = seedPath(courseKey);
    const seed = readJson<Seed>(path);
    let changed = false;
    for (const set of seed.problemSets) for (const problem of set.problems) {
      const text = winners.get(problem.problemVersionId);
      if (!text || (problem.solution.length && !replace)) continue;
      problem.solution = [{ blockId: `${problem.problemVersionId}:solution`, kind: 'core.rich_text', typeVersion: 1, required: true, payload: { text } }];
      changed = true; written += 1;
    }
    if (changed) writeFileSync(path, `${JSON.stringify(seed, null, 2)}\n`);
  }
  const picked = Object.values(picks).filter((pick) => pick.pick).length;
  writeJson(join(dir, 'result.json'), { run: run.name, decidedAt: new Date().toISOString(), picked, tally, byCourse,
    notes: Object.fromEntries(Object.entries(picks).filter(([, pick]) => pick.note).map(([id, pick]) => [id,
      { ...pick, writer: pick.pick === 'a' || pick.pick === 'b' ? key[id]?.[pick.pick] ?? null : null }])) });
  console.log(`Picked ${picked}: ${Object.entries(tally).map(([name, count]) => `${name} ${count}`).join(' · ')}. Wrote ${written} 해설 into the seed.`);
}

/** Runs the checks again over what is already written, after a check itself changed. Asks no model. */
function recheck() {
  const path = join(dir, 'candidates.json');
  const run = readJson<Run>(path);
  let flagged = 0;
  for (const item of run.items) for (const output of Object.values(item.outputs)) {
    if ('error' in output) continue;
    output.issues = checkSolution(output.solution, item.problem);
    if (output.issues.length) flagged += 1;
  }
  writeJson(path, run);
  console.log(`Checked ${run.items.length} questions again; ${flagged} answers have issues.`);
}

const commands: Record<string, () => unknown> = { generate, blind, apply, recheck };
if (!commands[command]) { console.error(`Unknown command: ${command}`); process.exit(2); }
Promise.resolve(commands[command]()).catch((reason) => { console.error(reason); process.exit(1); });
