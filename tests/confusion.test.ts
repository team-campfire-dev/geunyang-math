import { describe, expect, it } from 'vitest';
import { summarizeConfusion, type ConfusionObservation } from '@/core/confusion';
import type { StoredProblem } from '@/core/content';
import type { PublicLesson } from '@/shared/api';

const concepts = [{ key: 'fractions', label: '분수' }, { key: 'integers', label: '정수' }];
const lessons: PublicLesson[] = [{ lessonKey: 'fractions-lesson', versionId: 'v1', title: '분수', summary: '',
  estimatedMinutes: 5, conceptKeys: ['fractions'], prerequisiteConceptKeys: [], sectionCount: 2, courseKey: 'fractions' }];
const question = (id: string, named = false): StoredProblem => ({
  problemVersionId: id, conceptKeys: ['fractions'], promptContent: [{ blockId: id, kind: 'core.rich_text', typeVersion: 1, required: true, payload: { text: '1/2 + 1/3은 얼마인가요?' } }],
  responseSpec: { kind: 'rational' }, gradingSpec: { kind: 'rational', numerator: 5, denominator: 6 },
  hintAvailable: true, hints: [], solution: [], ...(named ? { misreadings: [{ answer: '2/5', misconception: 'add-denominators' }] } : {}),
});
const row = (id: string, day: number, answer = '2/5', changes: Partial<ConfusionObservation> = {}): ConfusionObservation => ({
  id: `${id}-${day}`, answer, result: { status: answer === '5/6' ? 'correct' : 'incorrect', message: '', assisted: false },
  hintUsed: false, createdAt: new Date(Date.UTC(2026, 8, day)), problem: question(id, true),
  source: { kind: 'lesson', id: 'enrollment', title: '분수의 의미', lessonKey: 'fractions-lesson' }, check: true, delayed: false, ...changes,
});
const summary = (...rows: ConfusionObservation[]) => summarizeConfusion(rows, concepts, lessons);

describe('confusion grounded in saved answers', () => {
  it('has an explicit unknown state, without judging unanswered concepts', () => {
    const result = summary();
    expect(result).toMatchObject({ version: 1, latestAt: null, evidence: [], repeated: [] });
    expect(result.concepts.every(item => item.state === 'unknown')).toBe(true);
    expect(result.concepts[0].lessonKey).toBe('fractions-lesson');
  });

  it('counts distinct questions, keeps corrections, and does not diagnose one wrong answer', () => {
    const result = summary(row('p1', 1), row('p1', 2), row('p1', 3, '5/6'));
    expect(result.repeated).toEqual([]);
    expect(result.concepts[0]).toMatchObject({ state: 'unknown', evidenceIds: ['p1'] });
    expect(result.concepts[0].description).toContain('한 문제만으로는');
    expect(result.evidence[0].corrections).toHaveLength(2);
    expect(result.latestAt).toBe('2026-09-03T00:00:00.000Z');
  });

  it('finds repeated mistakes across contexts and orders by actual time, not loader order', () => {
    const first = row('p1', 1, '2/5', { source: { kind: 'practice', id: 'recipient', title: '모아 풀기', lessonKey: null } });
    const result = summary(row('p1', 3, '5/6'), row('p2', 2), first, first);
    expect(result.evidence[0].first.source.kind).toBe('practice');
    expect(result.evidence[0].corrections).toHaveLength(1);
    expect(result.concepts[0].state).toBe('missed');
    expect(result.repeated).toMatchObject([{ key: 'add-denominators', status: 'repeated', evidenceIds: ['p1', 'p2'] }]);
  });

  it('reads current annotations on old equivalent answers without changing saved results', () => {
    const old = row('p1', 1, '0.4', { result: { status: 'incorrect', message: 'old', assisted: false, misreading: 'sign' } });
    const unchanged = structuredClone(old.result);
    const result = summary(old, row('p2', 2, '4/10'));
    expect(result.repeated).toHaveLength(1);
    expect(result.repeated[0]).toMatchObject({ kind: 'misconception', key: 'add-denominators' });
    expect(old.result).toEqual(unchanged);
    expect(result.evidence[0].first.answer).toBe('0.4');
  });

  it('combines generic errors and authored names without double counting one answer', () => {
    const result = summary(row('p1', 1, '-5/6', { problem: question('p1') }), row('p2', 2, '-5/6', { problem: question('p2') }), row('p3', 3), row('p4', 4));
    expect(result.repeated.map(item => [item.kind, item.key, item.evidenceIds.length])).toEqual([
      ['misconception', 'add-denominators', 2], ['misreading', 'sign', 2],
    ]);
  });

  it('discards invalid and withheld attempts before finding the first real answer', () => {
    const result = summary(row('p1', 1, 'oops', { result: { status: 'invalid', message: '', assisted: false } }),
      row('p2', 2, '2/5', { result: { status: 'withheld', message: '', assisted: false } }), row('p1', 3, '5/6'));
    expect(result.evidence).toHaveLength(1);
    expect(result.evidence[0].first.createdAt).toBe('2026-09-03T00:00:00.000Z');
    expect(result.evidence[0].corrections).toEqual([]);
  });

  it('does not earn independence from hints, practice alone, or correcting the same problem', () => {
    const result = summary(row('p1', 1), row('p1', 2, '5/6'), row('p2', 3, '5/6', { hintUsed: true }), row('p3', 4, '5/6', { check: false }));
    expect(result.concepts[0].state).toBe('unknown');
    expect(summary(row('p1', 1, '5/6'), row('p2', 2, '5/6', { result: { status: 'correct', message: '', assisted: true } })).concepts[0].state).toBe('unknown');
  });

  it('keeps established independent evidence alongside a later miss and distinguishes delayed review', () => {
    const learned = [row('p1', 1, '5/6'), row('p2', 2, '5/6')];
    const result = summary(...learned, row('p3', 3), row('p4', 4));
    expect(result.concepts[0].state).toBe('independent');
    expect(result.concepts[0].description).toContain('최근 문제에서는');
    expect(summary(...learned, row('p3', 4, '5/6', { delayed: true })).concepts[0].state).toBe('retained');
  });

  it('marks recent improvement only after two new relevant unassisted first successes', () => {
    const old = [row('p1', 1), row('p2', 2)];
    expect(summary(...old, row('p1', 3, '5/6'), row('p2', 4, '5/6')).repeated[0].status).toBe('repeated');
    expect(summary(...old, row('p3', 3, '5/6')).repeated[0].status).toBe('repeated');
    expect(summary(...old, row('p3', 3, '5/6'), row('p4', 4, '5/6', { hintUsed: true })).repeated[0].status).toBe('repeated');
    const result = summary(...old, row('p3', 3, '5/6'), row('p4', 4, '5/6'));
    expect(result.repeated[0]).toMatchObject({ status: 'improving', improvementEvidenceIds: ['p3', 'p4'] });
    expect(summary(...old, row('p3', 3, '5/6'), row('p4', 4, '5/6'), row('p1', 5)).repeated[0].status).toBe('repeated');
  });

  it('cannot clear a pattern with unrelated questions or questions without that authored distractor', () => {
    const old = [row('p1', 1), row('p2', 2)];
    expect(summary(...old, row('p3', 3, '5/6', { problem: question('p3') }), row('p4', 4, '5/6', { problem: question('p4') })).repeated[0].status).toBe('repeated');
    expect(summary(...old, row('p3', 3, '5/6', { problem: { ...question('p3', true), conceptKeys: ['integers'] } }), row('p4', 4, '5/6')).repeated[0].status).toBe('repeated');
  });

  it('keeps choices legible but does not serialize grading rules, hints, solutions, or distractor maps', () => {
    const problem: StoredProblem = { ...question('choice'), responseSpec: { kind: 'choice', options: [{ id: 'a', text: '분모를 더해요' }, { id: 'b', text: '통분해요' }] },
      gradingSpec: { kind: 'choice', correct: 'b', options: [{ id: 'a', text: '분모를 더해요' }, { id: 'b', text: '통분해요' }] },
      misreadings: [{ answer: 'a', misconception: 'add-denominators' }] };
    const result = summary(row('choice', 1, 'a', { problem }));
    expect(result.evidence[0].first.signal?.key).toBe('add-denominators');
    expect(result.evidence[0].responseSpec.options?.[0].text).toBe('분모를 더해요');
    const json = JSON.stringify(result);
    for (const key of ['gradingSpec', 'misreadings', 'solution', 'hints']) expect(json).not.toContain(`"${key}"`);
  });
});
