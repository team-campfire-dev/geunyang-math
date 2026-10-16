import { describe, expect, it } from 'vitest';
import { plannerRequest, settlePlan, type Profile } from '@/server/ai-practice';
import { scopeEvidence, scopeKey, parseScopeKey } from '@/shared/ai-practice';
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
});

describe('settling what the planner asked for', () => {
  const profile: Profile = {
    scope: { kind: 'course', key: 'fractions' }, scopeLabel: '분수', evidence: summary.evidence.slice(0, 4),
    concepts: [
      { key: 'fraction-addition', label: '분수의 덧셈', state: 'practicing', right: 1, wrong: 2 },
      { key: 'fraction-meaning', label: '분수의 의미', state: 'independent', right: 1, wrong: 0 },
    ],
    repeated: [{ kind: 'misconception', key: 'add-denominators', label: '분모끼리 더하기', status: 'repeated', problems: 2 }],
    wrong: summary.evidence.slice(0, 2).map((item) => ({ evidence: item, problem: undefined })),
  };

  it('keeps only concepts the record names and mistakes the catalogue knows, and makes the counts add up', () => {
    const plan = settlePlan({ diagnosis: '  분모끼리 더한 답이 두 번 나왔어요.  ', targets: [
      { conceptKey: 'fraction-addition', focus: 'confused', misconception: 'add-denominators', reason: '분모끼리 더한 답이 있었어요.', count: 5 },
      { conceptKey: 'prime-number', focus: 'weak', misconception: '', reason: '범위 밖', count: 3 },
      { conceptKey: 'fraction-meaning', focus: 'reinforce', misconception: 'not-a-mistake', reason: '다시 확인해요.', count: 1 },
      { conceptKey: 'fraction-addition', focus: 'confused', misconception: 'add-denominators', reason: '같은 것', count: 2 },
    ] }, profile);
    expect(plan.diagnosis).toBe('분모끼리 더한 답이 두 번 나왔어요.');
    expect(plan.targets.map((t) => [t.conceptKey, t.misconception])).toEqual([['fraction-addition', 'add-denominators'], ['fraction-meaning', '']]);
    expect(plan.targets.reduce((n, t) => n + t.count, 0)).toBe(8);
    expect(plan.targets.every((t) => t.count >= 1)).toBe(true);
  });

  it('falls back on the record when nothing the planner said can be used', () => {
    const plan = settlePlan({ diagnosis: '', targets: [{ conceptKey: 'made-up', focus: 'weak', misconception: '', reason: '', count: 8 }] }, profile);
    expect(plan.targets.map((t) => t.conceptKey)).toEqual(['fraction-addition']);
    expect(plan.targets[0].count).toBe(8);
    expect(plan.diagnosis).toContain('분수');
  });

  it('tells the planner the keys it may name, the states, and what was written', () => {
    const text = plannerRequest(profile);
    expect(text).toContain('분수의 덧셈 [fraction-addition]: 연습하는 중, 첫 답 맞음 1 · 틀림 2');
    expect(text).toContain('분모끼리 더하기 [add-denominators]: 2문제, 아직 되풀이됨');
    expect(text).toContain('학습자: 5/13');
    expect(text).toContain('읽힌 실수: 분모끼리 더하기');
  });
});
