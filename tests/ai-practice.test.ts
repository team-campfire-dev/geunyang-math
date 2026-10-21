import { describe, expect, it } from 'vitest';
import { plannerRequest, settlePlan, warmingFirstWrite, type Profile, type RawPlan } from '@/server/ai-practice';
import type { ProblemModel } from '@/server/problem-generation';
import { checkHypothesis, coursesLabel, scopeEvidence, scopeKey, parseScopeKey, type PracticeScope } from '@/shared/ai-practice';
import type { ConfusionEvidence, ConfusionSummary } from '@/shared/confusion';

const evidence = (id: string, conceptKeys: string[], status: 'correct' | 'incorrect', lessonKey: string | null, signal: ConfusionEvidence['first']['signal'] = null): ConfusionEvidence => ({
  problemVersionId: id, conceptKeys, promptContent: [{ blockId: `${id}:prompt`, kind: 'core.rich_text', typeVersion: 3, required: true, payload: { text: `${id} 지문`, definitions: [] } }],
  responseSpec: { kind: 'rational' },
  first: { id: `a-${id}`, answer: '5/13', status, hintUsed: false, createdAt: `2026-10-1${id.length}T00:00:00.000Z`,
    source: { kind: 'lesson', id: 'e1', title: '수업', lessonKey }, signal },
  corrections: [],
});
const lessons = [
  { lessonKey: 'add', courseKey: 'fractions', conceptKeys: ['fraction-addition'] },
  { lessonKey: 'meaning', courseKey: 'fractions', conceptKeys: ['fraction-meaning'] },
  { lessonKey: 'prime', courseKey: 'factors', conceptKeys: ['prime-number'] },
];
const summary: ConfusionSummary = { version: 1, latestAt: null, concepts: [], repeated: [], evidence: [
  evidence('p1', ['fraction-addition'], 'incorrect', 'add', { kind: 'misconception', key: 'add-denominators', label: '분모끼리 더하기', note: '' }),
  evidence('p2', ['fraction-addition'], 'incorrect', 'add'),
  evidence('p3', ['fraction-meaning'], 'correct', 'meaning'),
  // Answered in another lesson, about a concept the addition lesson teaches.
  evidence('p4', ['fraction-addition'], 'correct', null),
  evidence('p5', ['prime-number'], 'incorrect', 'prime'),
] };

describe('what falls inside a range', () => {
  it('reads everything, a course, or a lesson and what it teaches', () => {
    expect(scopeEvidence(summary, { kind: 'all' }, lessons)).toHaveLength(5);
    expect(scopeEvidence(summary, { kind: 'course', key: 'fractions' }, lessons).map((e) => e.problemVersionId)).toEqual(['p1', 'p2', 'p3', 'p4']);
    expect(scopeEvidence(summary, { kind: 'lesson', key: 'add' }, lessons).map((e) => e.problemVersionId)).toEqual(['p1', 'p2', 'p4']);
    for (const scope of [{ kind: 'all' } as const, { kind: 'course', key: 'fractions' } as const, { kind: 'lesson', key: 'add' } as const]) {
      expect(parseScopeKey(scopeKey(scope))).toEqual(scope);
    }
  });

  it('reads several courses as one range, the same range however they were listed', () => {
    const exam: PracticeScope = { kind: 'courses', keys: ['factors', 'fractions'] };
    expect(scopeEvidence(summary, exam, lessons).map((e) => e.problemVersionId)).toEqual(['p1', 'p2', 'p3', 'p4', 'p5']);
    expect(scopeEvidence(summary, { kind: 'courses', keys: ['factors'] }, lessons).map((e) => e.problemVersionId)).toEqual(['p5']);
    expect(scopeKey(exam)).toBe('courses:factors,fractions');
    expect(scopeKey({ kind: 'courses', keys: ['fractions', 'factors', 'fractions'] })).toBe('courses:factors,fractions');
    expect(parseScopeKey('courses:factors,fractions')).toEqual(exam);
    expect(coursesLabel(['도형의 닮음', '피타고라스 정리', '확률'])).toBe('도형의 닮음 · 피타고라스 정리 · 확률');
    expect(coursesLabel(['가', '나', '다', '라'])).toBe('가 외 3개 과정');
  });
});

describe('settling what the planner asked for', () => {
  const items = summary.evidence.slice(0, 4).map((item, index) => ({ number: index + 1, evidence: item, problem: undefined, predicted: [] }));
  const profile: Profile = {
    scope: { kind: 'course', key: 'fractions' }, scopeLabel: '분수', evidence: summary.evidence.slice(0, 4),
    concepts: [
      { key: 'fraction-addition', label: '분수의 덧셈', state: 'practicing', right: 1, wrong: 2 },
      { key: 'fraction-meaning', label: '분수의 의미', state: 'independent', right: 1, wrong: 0 },
    ],
    repeated: [{ kind: 'misconception', key: 'add-denominators', label: '분모끼리 더하기', status: 'repeated', problems: 2 }],
    items,
    past: [{ key: 'hypothesis:1', name: '분자끼리만 더하기', how: '', confidence: 'low', misconception: '', evidence: ['p0'], conceptKeys: ['fraction-addition'],
      at: '2026-10-14T00:00:00.000Z', check: { asked: 3, answered: 2, predicted: 0, correct: 2, other: 0 } }],
    stages: ['middle-2'],
  };
  const guess = (over: Partial<RawPlan['hypotheses'][number]> = {}): RawPlan['hypotheses'][number] =>
    ({ name: '통분하고 분자는 그대로 두기', how: '분모만 공통분모로 바꾼다.', evidence: [1, 2], confidence: 'medium', misconception: '', ...over });

  it('keeps only guesses with grounds, names them for the set, and takes the catalogue name only when it is real', () => {
    const plan = settlePlan({ diagnosis: '  분모만 맞춘 답이 두 번 나왔어요.  ', hypotheses: [
      guess(),
      guess({ name: '근거 없는 추측', evidence: [9] }),
      guess({ name: '분모끼리 더하기', evidence: [1], misconception: 'add-denominators', confidence: 'low' }),
      guess({ name: '지어낸 이름표', evidence: [2], misconception: 'not-a-mistake' }),
    ], targets: [
      { conceptKey: 'fraction-addition', focus: 'confused', hypothesis: 1, reason: '분모만 맞춘 답이 있었어요.', count: 4 },
      { conceptKey: 'fraction-addition', focus: 'confused', hypothesis: 3, reason: '분모끼리 더한 답이 있었어요.', count: 2 },
      { conceptKey: 'fraction-meaning', focus: 'confused', hypothesis: 2, reason: '추측이 없어진 것', count: 2 },
      { conceptKey: 'prime-number', focus: 'weak', hypothesis: 0, reason: '범위 밖', count: 3 },
    ] }, profile);
    expect(plan.diagnosis).toBe('분모만 맞춘 답이 두 번 나왔어요.');
    // The guess with no question behind it is gone; the others are renumbered, and one with no target is not kept.
    expect(plan.hypotheses.map((h) => [h.key, h.name, h.misconception])).toEqual([
      ['hypothesis:1', '통분하고 분자는 그대로 두기', ''], ['hypothesis:2', '분모끼리 더하기', 'add-denominators']]);
    expect(plan.hypotheses[0].evidence).toEqual(['p1', 'p2']);
    expect(plan.hypotheses[0].conceptKeys).toEqual(['fraction-addition']);
    // Aiming at a guess that did not survive is practice on the concept instead.
    expect(plan.targets.map((t) => [t.conceptKey, t.focus, t.hypothesis])).toEqual([
      ['fraction-addition', 'confused', 'hypothesis:1'], ['fraction-addition', 'confused', 'hypothesis:2'], ['fraction-meaning', 'weak', '']]);
    expect(plan.targets.reduce((n, t) => n + t.count, 0)).toBe(8);
    expect(plan.targets.every((t) => t.count >= 1)).toBe(true);
  });

  it('falls back on the record when nothing the planner said can be used', () => {
    const plan = settlePlan({ diagnosis: '', hypotheses: [], targets: [{ conceptKey: 'made-up', focus: 'weak', hypothesis: 0, reason: '', count: 8 }] }, profile);
    expect(plan.targets.map((t) => t.conceptKey)).toEqual(['fraction-addition']);
    expect(plan.targets[0].count).toBe(8);
    expect(plan.hypotheses).toEqual([]);
    expect(plan.diagnosis).toContain('분수');
  });

  it('sets out what the learner did, the clues as clues, and what earlier guesses found', () => {
    const text = plannerRequest(profile);
    expect(text).toContain('분수의 덧셈 [fraction-addition]: 연습하는 중, 첫 답 맞음 1 · 틀림 2');
    expect(text).toContain('#1 [분수의 덧셈] 수업 「수업」');
    // What the learner has not learned is said before anything is diagnosed.
    expect(text).toContain('학년 범위(중2): 제곱근 기호(√)와 무리수는 중3에서 배운다.');
    expect(text).toContain('첫 답: 5/13 — 틀림, 힌트 없이');
    expect(text).toContain('앱이 답에서 읽은 단서: 분모끼리 더하기 [add-denominators]');
    expect(text).toContain('분모끼리 더하기 [add-denominators]: 2문제, 아직 되풀이됨');
    expect(text).toContain('「분자끼리만 더하기」 (10. 14., 확신 낮음): 확인 문제 3개 중 2개를 풂 — 예측한 오답 0번, 맞힘 2번, 다른 오답 0번');
  });
});

describe('what the questions written for a guess found', () => {
  const spec = { kind: 'rational', numerator: 3, denominator: 4 } as const;
  it('counts first answers that were the predicted wrong one, right, or something else', () => {
    const predictions = { q1: [{ answer: '2/6', hypothesis: 'hypothesis:1' }], q2: [{ answer: '2/6', hypothesis: 'hypothesis:1' }],
      q3: [{ answer: '2/6', hypothesis: 'hypothesis:1' }], q4: [{ answer: '5', hypothesis: 'hypothesis:2' }], q5: [{ answer: '1/3', hypothesis: 'hypothesis:1' }] };
    const firsts = new Map([
      ['q1', { answer: '1/3', status: 'incorrect' as const, spec }], // the same value as predicted, written another way
      ['q2', { answer: '0.75', status: 'correct' as const, spec }],
      ['q3', { answer: '7/8', status: 'incorrect' as const, spec }],
      ['q4', { answer: '5', status: 'incorrect' as const, spec }],
    ]);
    expect(checkHypothesis('hypothesis:1', predictions, firsts)).toEqual({ asked: 4, answered: 3, predicted: 1, correct: 1, other: 1 });
  });
});

describe('writing every target from one warm cache', () => {
  it('sends the first write alone and the rest once it has returned, without holding back solving', async () => {
    const log: string[] = [];
    let release = () => {};
    const held = new Promise<void>((resolve) => { release = resolve; });
    const model: ProblemModel = { name: 'fake',
      write: async (_system, user) => { log.push(`write ${user} start`); if (user === 'a') await held; log.push(`write ${user} end`); return []; },
      solve: async (_system, user) => { log.push(`solve ${user}`); return ''; } };
    const warm = warmingFirstWrite(model);
    const all = Promise.all([warm.write('s', 'a'), warm.write('s', 'b'), warm.write('s', 'c'), warm.solve('s', 'x')]);
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(log).toEqual(['write a start', 'solve x']);
    release();
    await all;
    // Nothing else was written before the first came back.
    expect(log.slice(2, 3)).toEqual(['write a end']);
    expect(log.slice(3).sort()).toEqual(['write b end', 'write b start', 'write c end', 'write c start']);
  });

  it('lets the others go when the first write fails, and fails only the first', async () => {
    let calls = 0;
    const model: ProblemModel = { name: 'fake', solve: async () => '',
      write: async () => { calls += 1; if (calls === 1) throw new Error('down'); return []; } };
    const warm = warmingFirstWrite(model);
    const results = await Promise.allSettled([warm.write('s', 'a'), warm.write('s', 'b')]);
    expect(results.map((result) => result.status)).toEqual(['rejected', 'fulfilled']);
  });
});
