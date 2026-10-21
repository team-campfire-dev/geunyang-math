/**
 * Gemini writes a lesson's prose again — explanation, worked example, summary — around the questions
 * it already asks, and the result goes into the seed as the lesson's next version.
 *
 *   npm run lessons:rewrite -- write --run <name> --courses similarity,pythagoras,probability [--lessons a,b] [--again]
 *   npm run lessons:rewrite -- apply --run <name> [--lessons a,b]
 *
 * `write` keeps every lesson in comparisons/<name>/lessons/<lessonKey>.json: the request, each answer,
 * what was wrong with it, and the lesson assembled from the last one. An answer the checks refuse is
 * sent back with the reasons, twice at most; a lesson that still fails stays marked and is not applied.
 * Running it again only writes the lessons that are missing or failed; --again writes them all anew.
 *
 * `apply` puts the passing lessons into prisma/seed/<course>.json in place of the current version.
 * Run `npm run content:lock` after it.
 */
import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { StoredLesson } from '../src/core/content';
import { callGemini, type GeminiTurn } from '../src/server/explainers';
import { assembleLesson, lessonIssues, lessonRequest, lessonWriterSystem, readDraft, type LessonDraft } from '../src/server/lesson-writer';
import { answerText, type AnswerSpec } from '../src/shared/answer';
import type { CourseStage } from '../src/shared/api';

type Block = { blockId: string; kind: string; payload: { text?: string } & Record<string, unknown> };
type Seed = {
  courses: { key: string; title: string; stage?: CourseStage | null }[];
  lessons: StoredLesson[];
  problemSets: { versionId: string; problems: { problemVersionId: string; promptContent: Block[]; gradingSpec: AnswerSpec }[] }[];
};
type Attempt = { text: string; issues: string[]; ms: number; usage: { input: number; output: number; thinking?: number } };
type Written = { lessonKey: string; courseKey: string; writer: string; system: string; request: string; attempts: Attempt[];
  draft: LessonDraft | null; lesson: StoredLesson | null; issues: string[]; status: 'ok' | 'issues' | 'error'; error?: string };

const args = process.argv.slice(2);
const command = args[0];
const flag = (name: string) => { const at = args.indexOf(`--${name}`); return at >= 0 ? args[at + 1] : undefined; };
const list = (name: string) => (flag(name) ?? '').split(',').map((value) => value.trim()).filter(Boolean);
const runName = flag('run');
if (!command || !runName || !/^[a-z0-9-]+$/.test(runName)) {
  console.error('Usage: npm run lessons:rewrite -- <write|apply> --run <name> [--courses a,b] [--lessons a,b]');
  process.exit(2);
}
const dir = join('comparisons', runName, 'lessons');
const seedPath = (courseKey: string) => join('prisma', 'seed', `${courseKey}.json`);
const readJson = <T>(path: string): T => JSON.parse(readFileSync(path, 'utf8')) as T;
function writeJson(path: string, value: unknown) {
  writeFileSync(`${path}.tmp`, `${JSON.stringify(value, null, 2)}\n`);
  renameSync(`${path}.tmp`, path);
}
const textOf = (blocks: Block[]) => blocks.map((block) => block.payload.text ?? '').join(' ').replace(/\s+/g, ' ').trim();

/** Every concept with a shared definition, under the name its latest bundle gives it. */
function concepts() {
  const files = readdirSync('content').filter((name) => /^glossary-v\d+\.json$/.test(name))
    .sort((a, b) => Number(/\d+/.exec(a)![0]) - Number(/\d+/.exec(b)![0]));
  const labels = new Map<string, string>();
  for (const file of files) for (const definition of readJson<{ definitions?: { conceptKey: string; label?: string; scopeKind?: string }[] }>(join('content', file)).definitions ?? []) {
    if ((definition.scopeKind ?? 'global') === 'global' && definition.label) labels.set(definition.conceptKey, definition.label);
  }
  return [...labels].map(([key, label]) => ({ key, label })).sort((a, b) => a.key.localeCompare(b.key));
}

/** What a lesson's steps and review pool ask, answers included, for the writer to lead towards. */
function problemsOf(seed: Seed, lesson: StoredLesson) {
  const versions = new Set<string>();
  for (const section of lesson.sections) for (const block of section.contentBlocks) {
    if (block.kind === 'core.problem_set') versions.add((block.payload as { problemSetVersionId: string }).problemSetVersionId);
  }
  if (lesson.review) versions.add(lesson.review.problemSetVersionId);
  return seed.problemSets.filter((set) => versions.has(set.versionId)).flatMap((set) => set.problems).map((problem) => {
    const spec = problem.gradingSpec;
    return { prompt: textOf(problem.promptContent),
      answer: spec.kind === 'choice' ? `「${spec.options.find((option) => option.id === spec.correct)?.text}」` : answerText(spec) };
  });
}

async function writeOne(seed: Seed, courseKey: string, lesson: StoredLesson, known: ReturnType<typeof concepts>): Promise<Written> {
  const course = seed.courses.find((item) => item.key === courseKey) ?? seed.courses[0];
  const stage = course.stage ?? null;
  const request = lessonRequest({ lesson, course: { title: course.title, stage }, concepts: known, problems: problemsOf(seed, lesson) });
  const written: Written = { lessonKey: lesson.public.lessonKey, courseKey, writer: 'gemini-4-argon', system: lessonWriterSystem, request,
    attempts: [], draft: null, lesson: null, issues: [], status: 'error' };
  const turns: GeminiTurn[] = [{ role: 'user', text: request }];
  for (let round = 0; round < 3; round++) {
    const started = Date.now();
    let reply;
    try { reply = await callGemini(lessonWriterSystem, turns); }
    catch (reason) {
      written.error = reason instanceof Error ? reason.message : String(reason);
      await new Promise((resolve) => setTimeout(resolve, 8000));
      continue;
    }
    const draft = readDraft(reply.text);
    const assembled = typeof draft === 'string' ? null : assembleLesson(lesson, draft);
    const issues = typeof draft === 'string' ? [draft] : lessonIssues(assembled!, stage);
    written.attempts.push({ text: reply.text, issues, ms: Date.now() - started, usage: reply.usage });
    if (typeof draft !== 'string') { written.draft = draft; written.lesson = assembled; }
    written.issues = issues;
    written.status = issues.length ? 'issues' : 'ok';
    delete written.error;
    if (!issues.length) break;
    // The same conversation goes on: the answer, then what was wrong with it, and a request for all of it again.
    turns.push({ role: 'model', text: reply.text },
      { role: 'user', text: `검사에서 걸린 것이 있어요. 고쳐서 JSON 전체를 다시 주세요.\n${issues.map((issue) => `- ${issue}`).join('\n')}` });
  }
  return written;
}

async function write() {
  const courses = list('courses');
  const only = new Set(list('lessons'));
  mkdirSync(dir, { recursive: true });
  const known = concepts();
  const todo: { seed: Seed; courseKey: string; lesson: StoredLesson }[] = [];
  for (const courseKey of courses) {
    const seed = readJson<Seed>(seedPath(courseKey));
    for (const lesson of seed.lessons) {
      if (only.size && !only.has(lesson.public.lessonKey)) continue;
      const path = join(dir, `${lesson.public.lessonKey}.json`);
      if (existsSync(path) && readJson<Written>(path).status === 'ok' && !args.includes('--again')) continue;
      todo.push({ seed, courseKey, lesson });
    }
  }
  console.log(`${todo.length} lessons to write.`);
  const lanes = Array.from({ length: Math.min(3, todo.length) }, async () => {
    for (let next = todo.shift(); next; next = todo.shift()) {
      const written = await writeOne(next.seed, next.courseKey, next.lesson, known);
      writeJson(join(dir, `${written.lessonKey}.json`), written);
      const spent = written.attempts.reduce((sum, attempt) => sum + attempt.usage.output + (attempt.usage.thinking ?? 0), 0);
      console.log(`${written.lessonKey}: ${written.status} after ${written.attempts.length} answer(s), ${spent} output tokens${written.issues.length ? `\n  ${written.issues.join('\n  ')}` : ''}${written.error ? `\n  error: ${written.error}` : ''}`);
    }
  });
  await Promise.all(lanes);
}

function apply() {
  const only = new Set(list('lessons'));
  const written = readdirSync(dir).filter((name) => name.endsWith('.json')).map((name) => readJson<Written>(join(dir, name)))
    .filter((entry) => entry.status === 'ok' && entry.lesson && (!only.size || only.has(entry.lessonKey)));
  const byCourse = new Map<string, Written[]>();
  for (const entry of written) byCourse.set(entry.courseKey, [...(byCourse.get(entry.courseKey) ?? []), entry]);
  for (const [courseKey, entries] of byCourse) {
    const path = seedPath(courseKey);
    const seed = readJson<Seed>(path);
    for (const entry of entries) {
      const at = seed.lessons.findIndex((lesson) => lesson.public.lessonKey === entry.lessonKey);
      if (at < 0) continue;
      if (seed.lessons[at].public.versionId === entry.lesson!.public.versionId) continue;
      seed.lessons[at] = entry.lesson!;
    }
    writeFileSync(path, `${JSON.stringify(seed, null, 2)}\n`);
  }
  console.log(`Put ${written.length} lessons into the seed. Run npm run content:lock next.`);
}

const commands: Record<string, () => unknown> = { write, apply };
if (!commands[command]) { console.error(`Unknown command: ${command}`); process.exit(2); }
Promise.resolve(commands[command]()).catch((reason) => { console.error(reason); process.exit(1); });
