import 'server-only';
import { z } from 'zod';
import { verifyProblem } from '@/core/verify/verify';
import { answerSpec, choiceLimits, misreadingLimits, type AnswerSpec } from '@/shared/answer';
import type { ContentBlock } from '@/shared/api';
import type { DraftProblem } from '@/shared/authoring';
import { generationLimits, type GeneratedProblem, type GenerationIssue, type GenerationRequest, type GenerationResult } from '@/shared/generation';
import { misconceptionLabel } from '@/shared/misconception';
import { solverSystem, writerSystem } from './problem-prompts';

/**
 * Writes questions with a model and checks them before an author sees them.
 *
 * Three steps, each by a different hand. The writer returns each question with the computation it
 * asks (its claim). A second request, shown only the prompt and the options, answers it. The server
 * then does the claim's computation and holds the key, the options, the expected wrong answers and
 * the second answer to it. The writer cannot pass its own work: a key that agrees with a claim the
 * prompt never asked for is caught by the solver who only read the prompt.
 *
 * Nothing is saved. What comes back is a list the author takes questions from.
 */

/** What the writer returns, as the response format constrains it. Lengths are checked per question afterwards. */
export const writtenSchema = z.object({
  problems: z.array(z.object({
    prompt: z.string(),
    form: z.enum(['choice', 'written']),
    options: z.array(z.object({ id: z.string(), text: z.string() })),
    answer: z.string(),
    reducedFraction: z.boolean(),
    misreadings: z.array(z.object({ answer: z.string(), misconception: z.string(), expression: z.string() })),
    solves: z.string(),
    hints: z.array(z.string()),
    solution: z.string(),
  })),
});
export type WrittenProblem = z.infer<typeof writtenSchema>['problems'][number];
export const solvedSchema = z.object({ answer: z.string() });

/** The model behind both requests. The server's is Claude; tests give their own. */
export type ProblemModel = {
  name: string;
  write(system: string, user: string): Promise<WrittenProblem[]>;
  solve(system: string, user: string): Promise<string>;
};

/** What the writer is told about the lesson, beyond what the author asked. */
export type GenerationContext = { courseTitle: string | null; lessonTitle: string; concepts: { key: string; label: string }[] };

/** A question as it is about to be judged, before it has a verdict. */
type Candidate = { problem: DraftProblem; spec: AnswerSpec; written: WrittenProblem; issues: GenerationIssue[] };

const lengths = { prompt: 2000, option: choiceLimits.maxText, answer: 80, hint: 600, solution: 4000, hints: 3, claim: 2000 } as const;
const placeholder = (index: number) => `generated-${index + 1}`;
const paragraph = (blockId: string, text: string): ContentBlock =>
  ({ blockId, kind: 'core.rich_text', typeVersion: 3, required: true, payload: { text, definitions: [] } });

export function writerRequest(request: GenerationRequest, context: GenerationContext): string {
  const lines = [
    `과정: ${context.courseTitle ?? '(정하지 않음)'}`,
    `수업: ${context.lessonTitle}`,
    `개념: ${context.concepts.map((concept) => concept.label).join(', ') || '(수업의 개념)'}`,
    `문제 수: ${request.count}`,
    `문제 형식: ${request.form === 'choice' ? '모두 객관식' : request.form === 'written' ? '모두 답을 써서 내는 문제' : '객관식과 답을 써서 내는 문제를 섞어서'}`,
  ];
  if (request.misconceptions.length) {
    lines.push(`겨냥할 실수(오답 보기와 예상 오답을 이 실수에서 만든다): ${request.misconceptions.map((key) => `${key}(${misconceptionLabel(key)})`).join(', ')}`);
  }
  if (request.note.trim()) lines.push('', '작성자의 요청:', request.note.trim());
  if (request.existing.length) {
    lines.push('', '이 활동에 이미 있는 문제다. 같은 문제를 다시 쓰지 말고, 정답도 이 문제들과 겹치지 않게 한다.');
    request.existing.forEach((item, index) => lines.push(`${index + 1}. ${item.prompt} → ${item.answer}`));
  }
  return lines.join('\n');
}

export function solverRequest(written: Pick<WrittenProblem, 'prompt' | 'form' | 'options'>): string {
  if (written.form !== 'choice') return written.prompt;
  return [written.prompt, '', '보기:', ...written.options.map((option) => `${option.id}) ${option.text}`)].join('\n');
}

/**
 * The writer's question in the editor's shape, or the reason it cannot be one. A question that does
 * not fit is reported rather than dropped, so an author can see what was asked for and not given.
 */
export function toCandidate(written: WrittenProblem, index: number, conceptKeys: string[]): Candidate | { invalid: string } {
  const prompt = written.prompt.trim();
  if (!prompt || prompt.length > lengths.prompt) return { invalid: `prompt length ${prompt.length}` };
  let spec: AnswerSpec | null;
  if (written.form === 'choice') {
    const options = written.options.map((option) => ({ id: option.id.trim(), text: option.text.trim() }));
    if (options.length < 2 || options.length > choiceLimits.maxOptions) return { invalid: `${options.length} options` };
    if (options.some((option) => !/^[a-z]$/.test(option.id) || !option.text || option.text.length > lengths.option)) return { invalid: 'an option is unnamed, empty or too long' };
    spec = { kind: 'choice', options, correct: written.answer.trim() };
  } else {
    spec = written.answer.length <= lengths.answer ? answerSpec(written.answer, written.reducedFraction ? 'reduced_fraction' : null) : null;
    if (!spec) return { invalid: `the answer "${written.answer.slice(0, lengths.answer)}" is not one the answer box reads` };
  }
  const hints = written.hints.map((hint) => hint.trim()).filter(Boolean).slice(0, lengths.hints);
  if (hints.some((hint) => hint.length > lengths.hint) || written.solution.length > lengths.solution) return { invalid: 'a hint or the solution is too long' };
  if (written.misreadings.length > misreadingLimits.maxPerProblem) return { invalid: `${written.misreadings.length} expected wrong answers` };
  const problemVersionId = placeholder(index);
  const misreadings = written.misreadings.map(({ answer, misconception }) => ({ answer: answer.trim(), misconception: misconception.trim() }));
  const problem: DraftProblem = {
    problemVersionId, conceptKeys: [...conceptKeys],
    promptContent: [paragraph(`${problemVersionId}:prompt`, prompt)],
    gradingSpec: spec,
    hints: hints.map((hint, at) => paragraph(`${problemVersionId}:hint${at ? `-${at + 1}` : ''}`, hint)),
    solution: written.solution.trim() ? [paragraph(`${problemVersionId}:solution`, written.solution.trim())] : [],
    ...(misreadings.length ? { misreadings } : {}),
  };
  return { problem, spec, written, issues: [] };
}

/** Reads the claim the writer sent as text. What does not parse is passed on, and the checker says so. */
const claimOf = (text: string): unknown => { try { return JSON.parse(text); } catch { return text; } };

function judge(candidate: Candidate, independent: string | null): GeneratedProblem {
  const { written, spec, problem } = candidate;
  const report = verifyProblem({
    prompt: [written.prompt, ...(spec.kind === 'choice' ? spec.options.map((option) => option.text) : [])].join('\n'),
    answer: spec,
    misreadings: written.misreadings.map((m) => ({ answer: m.answer.trim(), misconception: m.misconception.trim(), ...(m.expression.trim() ? { expression: m.expression.trim() } : {}) })),
    solves: claimOf(written.solves),
    ...(independent !== null ? { independent } : {}),
  });
  const issues: GenerationIssue[] = [...report.issues];
  // A question nobody answered from its prompt alone has had half its check: the claim may compute
  // something the prompt never asked, and only the solver would have noticed.
  if (independent === null) issues.push({ code: 'independent-missing', level: 'unverified', message: 'The independent solver returned no answer.' });
  const verdict = issues.some((issue) => issue.level === 'error') ? 'rejected' : issues.some((issue) => issue.level === 'unverified') ? 'unverified' : 'verified';
  return {
    problem, verdict, claim: written.solves.slice(0, lengths.claim), issues,
    ...(verdict === 'verified' && report.strength ? { strength: report.strength } : {}),
    ...(report.computed !== undefined ? { computed: report.computed } : {}),
    ...(independent !== null ? { independent } : {}),
  };
}

/** A question the writer sent in a shape the editor cannot hold. It is shown, never taken. */
function malformed(written: WrittenProblem, index: number, reason: string, conceptKeys: string[]): GeneratedProblem {
  const problemVersionId = placeholder(index);
  return {
    problem: { problemVersionId, conceptKeys: [...conceptKeys], promptContent: written.prompt.trim() ? [paragraph(`${problemVersionId}:prompt`, written.prompt.trim().slice(0, lengths.prompt))] : [],
      gradingSpec: { kind: 'integer', value: 0 }, hints: [], solution: [] },
    verdict: 'rejected', claim: written.solves.slice(0, lengths.claim),
    issues: [{ code: 'output-invalid', level: 'error', message: reason }],
  };
}

export async function generateProblems(model: ProblemModel, request: GenerationRequest, context: GenerationContext): Promise<GenerationResult> {
  const written = (await model.write(writerSystem, writerRequest(request, context))).slice(0, generationLimits.maxCount);
  const problems = await Promise.all(written.map(async (item, index) => {
    const candidate = toCandidate(item, index, request.conceptKeys);
    if ('invalid' in candidate) return malformed(item, index, candidate.invalid, request.conceptKeys);
    // The solver is a separate request that never sees the claim, the key or the expected mistakes.
    const independent = await model.solve(solverSystem, solverRequest(item)).then((answer) => answer.trim() || null, () => null);
    return judge(candidate, independent);
  }));
  return { problems, model: model.name };
}
