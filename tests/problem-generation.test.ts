import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { generateProblems, solverRequest, writerRequest, type ProblemModel, type WrittenProblem } from '@/server/problem-generation';
import { writerSystem } from '@/server/problem-prompts';
import { writingGuide } from '@/server/writing-guide';
import { guidelinesOf } from '@/server/writing-guide-source';
import { gradeAnswer } from '@/core/grading';
import { takeGenerated, type GenerationRequest } from '@/shared/generation';

const request: GenerationRequest = { conceptKeys: ['fraction-addition'], misconceptions: ['add-denominators'], count: 2, form: 'mixed', note: '', existing: [] };
const context = { courseTitle: '분수', lessonTitle: '분모가 다른 분수의 덧셈', concepts: [{ key: 'fraction-addition', label: '분수의 덧셈' }] };

/** The question from the comparison that motivated the checker, written correctly. */
const addition = (change: Partial<WrittenProblem> = {}): WrittenProblem => ({
  prompt: '$\\frac{3}{4}+\\frac{2}{9}$를 계산한 값을 골라 주세요.',
  form: 'choice',
  options: [{ id: 'a', text: '$\\frac{5}{13}$' }, { id: 'b', text: '$\\frac{35}{36}$' }, { id: 'c', text: '$\\frac{5}{36}$' }, { id: 'd', text: '$\\frac{29}{36}$' }],
  answer: 'b', reducedFraction: false,
  misreadings: [{ answer: 'a', misconception: 'add-denominators', expression: '(3+2)/(4+9)' }],
  solves: JSON.stringify({ kind: 'value', expression: '3/4 + 2/9' }),
  hints: ['두 분모 4와 9로 모두 나누어떨어지는 수를 찾아요.'],
  solution: '공통분모 36으로 바꾸면 27/36+8/36=35/36이에요.',
  ...change,
});
const root = (change: Partial<WrittenProblem> = {}): WrittenProblem => ({
  prompt: '$\\sqrt{12}$를 $a\\sqrt{b}$ 꼴로 간단히 한 수를 써 주세요.',
  form: 'written', options: [], answer: '2sqrt(3)', reducedFraction: false, misreadings: [],
  solves: JSON.stringify({ kind: 'value', expression: 'sqrt(12)' }),
  hints: ['12를 4×3으로 나누어 봐요.'], solution: '$\\sqrt{12}=\\sqrt{4}\\sqrt{3}=2\\sqrt{3}$이에요.',
  ...change,
});

/** A model that writes what it is handed and answers each prompt from a table. */
function fake(written: WrittenProblem[], answers: (prompt: string) => string | Promise<string>) {
  const solved: string[] = [];
  const model: ProblemModel = {
    name: 'fake',
    write: async () => written,
    solve: async (_system, user) => { solved.push(user); return answers(user); },
  };
  return { model, solved };
}

describe('writing questions and checking them before an author sees them', () => {
  it('passes a question whose key, options, wrong answers and independent answer all agree', async () => {
    const { model, solved } = fake([addition(), root()], (user) => (user.includes('보기') ? 'b' : '2√3'));
    const result = await generateProblems(model, request, context);
    expect(result.problems.map((p) => p.verdict)).toEqual(['verified', 'verified']);
    expect(result.problems[0].strength).toBe('exact');
    expect(result.problems[0].independent).toBe('b');
    // The question is in the editor's shape, with the wrong computation left behind.
    const [choice, written] = result.problems.map((p) => p.problem);
    expect(choice.gradingSpec).toMatchObject({ kind: 'choice', correct: 'b' });
    expect(choice.misreadings).toEqual([{ answer: 'a', misconception: 'add-denominators' }]);
    expect(choice.promptContent[0]).toMatchObject({ kind: 'core.rich_text', typeVersion: 3, payload: { definitions: [] } });
    expect(written.gradingSpec).toEqual({ kind: 'expression', expression: '2sqrt(3)' });
    expect(gradeAnswer('2√3', written.gradingSpec).status).toBe('correct');
    // The solver sees the prompt and the options, never the claim, the key or the named mistakes.
    expect(solved[0]).toContain('b) $\\frac{35}{36}$');
    for (const shown of solved) expect(shown).not.toMatch(/solves|add-denominators|3\/4 \+ 2\/9|2sqrt\(3\)/);
  });

  it('rejects a question that reaches past the learner\'s stage, and tells the writer the stage', async () => {
    const middle2 = { ...context, stage: 'middle-2' as const };
    const result = await generateProblems(fake([addition(), root()], (user) => (user.includes('보기') ? 'b' : '2√3')).model, request, middle2);
    expect(result.problems.map((p) => p.verdict)).toEqual(['verified', 'rejected']);
    expect(result.problems[1].issues.map((issue) => issue.code)).toContain('beyond-stage');
    expect(writerRequest(request, middle2)).toContain('학년 범위: 제곱근 기호(√)와 무리수는 중3에서 배운다.');
    expect(writerRequest(request, context)).not.toContain('학년 범위');
  });

  it('aims at a mistake guessed for one learner by the name it was given, and warns against giving it away', () => {
    const text = writerRequest({ ...request, hypotheses: [{ key: 'hypothesis:1', mistake: '제곱근을 씌우지 않기 — 제곱의 합을 그대로 쓴다.' }] }, context);
    expect(text).toContain('- hypothesis:1: 제곱근을 씌우지 않기 — 제곱의 합을 그대로 쓴다.');
    expect(text).toContain('미리 알려 주거나 경고하지 않는다');
  });

  it('rejects the key that names an option the answer is not among', async () => {
    // GPT's question from 2026-10-01: 35/36 is in no option and the key points at 29/36.
    const wrong = addition({ options: addition().options.map((o) => (o.id === 'b' ? { id: 'b', text: '$\\frac{29}{36}$' } : o.id === 'd' ? { id: 'd', text: '$\\frac{1}{2}$' } : o)) });
    const result = await generateProblems(fake([wrong], () => 'b').model, request, context);
    expect(result.problems[0].verdict).toBe('rejected');
    expect(result.problems[0].issues.map((i) => i.code)).toContain('choice-no-match');
  });

  it('holds a question the solver answered differently, since the prompt may ask something else', async () => {
    const result = await generateProblems(fake([addition()], () => 'd').model, request, context);
    expect(result.problems[0].verdict).toBe('unverified');
    expect(result.problems[0].issues.map((i) => i.code)).toEqual(['independent-disagrees']);
  });

  it('does not pass a question nobody solved from its prompt alone', async () => {
    const result = await generateProblems(fake([addition()], () => { throw new Error('unreachable'); }).model, request, context);
    expect(result.problems[0].verdict).toBe('unverified');
    expect(result.problems[0].issues.map((i) => i.code)).toEqual(['independent-missing']);
  });

  it('reports a question the editor cannot hold instead of dropping it', async () => {
    const result = await generateProblems(fake([root({ answer: 'x + 1' }), addition()], () => 'b').model, request, context);
    expect(result.problems.map((p) => p.verdict)).toEqual(['rejected', 'verified']);
    expect(result.problems[0].issues[0].code).toBe('output-invalid');
    expect(result.problems[0].problem.promptContent).toHaveLength(1);
  });

  it('leaves out a named wrong answer the answer box refuses instead of condemning the question', async () => {
    // From the first live run (2026-10-16): a fraction named on an equation answered with a whole number.
    const equation = root({ prompt: '일차방정식 $3x-5=10$의 해를 써 주세요.', answer: '5',
      solves: JSON.stringify({ kind: 'solve', equation: '3x - 5 = 10', unknown: 'x' }),
      misreadings: [{ answer: '5/3', misconception: 'move-without-sign', expression: '(10-5)/3' }, { answer: '15', misconception: 'move-a-factor', expression: '10+5' }] });
    const result = await generateProblems(fake([equation], () => '5').model, request, context);
    expect(result.problems[0].verdict).toBe('verified');
    expect(result.problems[0].problem.misreadings).toEqual([{ answer: '15', misconception: 'move-a-factor' }]);
    expect(result.problems[0].issues).toMatchObject([{ code: 'misreading-dropped', level: 'warning', answer: '5/3' }]);
  });

  it('leaves an unreadable claim unverified rather than trusting the key', async () => {
    const result = await generateProblems(fake([addition({ solves: '3/4 + 2/9' })], () => 'b').model, request, context);
    expect(result.problems[0].verdict).toBe('unverified');
    expect(result.problems[0].issues.map((i) => i.code)).toContain('claim-invalid');
  });

  it('keeps to the number asked for even when the writer sends more, and says when it sent fewer', async () => {
    const result = await generateProblems(fake(Array.from({ length: 9 }, () => addition()), () => 'b').model, { ...request, count: 6 }, context);
    expect(result.problems).toHaveLength(6);
    const short = await generateProblems(fake([addition()], () => 'b').model, { ...request, count: 6 }, context);
    expect(short).toMatchObject({ asked: 6, problems: [{ verdict: 'verified' }] });
  });

  it('refuses text that holds a piece of the response format', async () => {
    // A live response closed its question inside the solution and began the next one (2026-10-16).
    const broken = addition({ solution: '$x = 10$을 넣으면 26이라 14와 달라요.},{' });
    const leaked = addition({ hints: ['"solves": "3/4 + 2/9"'] });
    const result = await generateProblems(fake([broken, leaked, addition()], () => 'b').model, request, context);
    expect(result.problems.map((p) => p.verdict)).toEqual(['rejected', 'rejected', 'verified']);
    expect(result.problems[0].issues[0].code).toBe('output-invalid');
  });

  it('tells the writer the lesson, the mistakes to aim at and the questions already there', () => {
    const text = writerRequest({ ...request, note: '실생활 상황으로', existing: [{ prompt: '1/2+1/3', answer: '5/6' }] }, context);
    expect(text).toContain('분모가 다른 분수의 덧셈');
    expect(text).toContain('add-denominators(분모끼리 더하기)');
    expect(text).toContain('실생활 상황으로');
    expect(text).toContain('1. 1/2+1/3 → 5/6');
    expect(solverRequest(root())).toBe(root().prompt);
  });

  it('names a taken question the way the draft names its own, blocks and all', async () => {
    const result = await generateProblems(fake([addition()], () => 'b').model, request, context);
    const taken = takeGenerated(result.problems[0], 'fractions-add', 'practice', 'fractions-add:v2', ['fractions-add:practice-1:v1']);
    expect(taken.problemVersionId).toBe('fractions-add:practice-2:v2');
    expect([...taken.promptContent, ...taken.hints, ...taken.solution].map((b) => b.blockId))
      .toEqual(['fractions-add:practice-2:v2:prompt', 'fractions-add:practice-2:v2:hint', 'fractions-add:practice-2:v2:solution']);
    // Taking a question does not change what came back.
    expect(result.problems[0].problem.problemVersionId).toBe('generated-1');
  });
});

describe('what the writer is told', () => {
  it('is the writing guide as the document says it — run `npm run guide:sync` after editing the guide', () => {
    expect(writingGuide).toBe(guidelinesOf(readFileSync('docs/lesson-writing-guide.md', 'utf8')));
    expect(writerSystem.startsWith(writingGuide)).toBe(true);
    expect(writingGuide).not.toContain('](');
  });
});
