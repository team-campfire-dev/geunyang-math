import { describe, expect, it } from 'vitest';
import { recommend, reviewSelection, conceptReadiness, type Evidence } from '@/core/personalization';
import { diagnosticProblems } from './fixtures/content';
import { seedLessons, conceptLabels } from './fixtures/content';
import { gradeAnswer } from '@/core/grading';
import type { DiagnosticAnswer, Goal } from '@/shared/api';

const lessons = seedLessons.map(c => ({ ...c.public, courseKey: 'fractions' }));
const answers = ['4/9', '12', '10', '3/4', '7/11', '5/12'];
const bank = diagnosticProblems;
const diagnostic = (responses: (string | null)[]) => ({ problems: bank, answers: bank.map((p, i) => ({ problemVersionId: p.problemVersionId, answer: responses[i], status: responses[i] === null ? 'skipped' : gradeAnswer(responses[i]!, p.gradingSpec, false).status })) as DiagnosticAnswer[] });
const now = new Date('2026-09-14T12:00:00Z');
const evidence = (status: 'correct' | 'incorrect' | 'invalid', overrides: Partial<Evidence> = {}): Evidence => ({
  problemVersionId: 'new-check', conceptKeys: ['fraction.meaning'], result: { status, assisted: false, message: 'fixture' }, date: now, check: true, ...overrides,
});
function plan(responses: (string | null)[], goal: Goal = 'foundation-recovery') {
  return recommend({ lessons, enrollments: [], assignments: [], readiness: conceptReadiness(conceptLabels, diagnostic(responses), []), dailyMinutes: 10, goal, now });
}

describe('placement and prerequisite recommendations', () => {
  it('has separate diagnostic questions and a checked answer key', () => {
    expect(bank).toHaveLength(6);
    expect(bank.map((p, i) => gradeAnswer(answers[i], p.gradingSpec, false).status)).toEqual(Array(6).fill('correct'));
    const existing = seedLessons.flatMap(c => c.problems.map(p => p.problemVersionId));
    expect(bank.some(p => existing.includes(p.problemVersionId))).toBe(false);
  });
  it('distinguishes skipping from wrong answers and starts unknown learners at foundations', () => {
    const unknown = plan(Array(6).fill(null));
    expect(unknown.plan.readiness.every(s => s.readiness === 'unknown')).toBe(true);
    expect(unknown.recommendations[0].lessonKey).toBe('fraction-meaning');
    expect(plan(['0', null, null, null, null, null]).plan.readiness[0].readiness).toBe('needs-practice');
  });
  it('recommends a later lesson after two independent placement answers confirm each prerequisite', () => {
    expect(plan([...answers.slice(0, 2), null, null, null, null]).recommendations[0].lessonKey).toBe('fraction-equivalence');
    expect(plan([...answers.slice(0, 4), '0', null]).recommendations[0].lessonKey).toBe('fraction-addition');
    expect(plan([answers[0], null, ...answers.slice(2)]).recommendations[0].lessonKey).toBe('fraction-meaning');
  });
  it('uses goals for consolidation without bypassing missing prerequisites', () => {
    expect(plan(answers, 'daily-math').recommendations[0].lessonKey).toBe('fraction-meaning');
    expect(plan(answers, 'algebra-ready').recommendations[0].lessonKey).toBe('fraction-addition');
    expect(plan(['0', ...answers.slice(1)], 'algebra-ready').recommendations[0].lessonKey).toBe('fraction-meaning');
  });
  it('prioritizes subsequent learning over provisional placement and does not treat assistance as readiness', () => {
    expect(conceptReadiness(conceptLabels, diagnostic(answers), [evidence('incorrect')])[0]).toMatchObject({ source: 'learning', readiness: 'needs-practice' });
    expect(conceptReadiness(conceptLabels, diagnostic(answers), [evidence('correct', { result: { status: 'correct', assisted: true, message: '' } })])[0].readiness).toBe('needs-practice');
    expect(conceptReadiness(conceptLabels, diagnostic(answers), [evidence('invalid')])[0].source).toBe('diagnostic');
    expect(conceptReadiness(conceptLabels, diagnostic(Array(6).fill(null)), [evidence('correct')])[0].readiness).toBe('ready');
  });
  it('requires all first answers in the latest submitted assessment for readiness', () => {
    const earlier = evidence('correct', { date: new Date(now.getTime() - 1000), assessmentId: 'lesson' });
    const incorrect = evidence('incorrect', { assessmentId: 'homework' });
    const correct = evidence('correct', { date: new Date(now.getTime() + 1000), assessmentId: 'homework', problemVersionId: 'another-item' });
    expect(conceptReadiness(conceptLabels, null, [earlier, incorrect, correct])[0].readiness).toBe('needs-practice');
  });
  it('offers a prerequisite without preventing a learner from continuing a chosen lesson', () => {
    const output = recommend({ lessons, enrollments: [{ lessonKey: 'fraction-addition', status: 'active' }], assignments: [],
      readiness: conceptReadiness(conceptLabels, null, []), dailyMinutes: 5, goal: 'foundation-recovery', now });
    expect(output.recommendations[0]).toMatchObject({ lessonKey: 'fraction-meaning', suggestedMinutes: 5 });
    expect(output.recommendations[0].reason).toContain('직접 선택');
  });
  it('honors an explicit lesson choice and returns to prerequisite rules when cleared', () => {
    const input = { lessons, enrollments: [], assignments: [], readiness: conceptReadiness(conceptLabels, null, []), dailyMinutes: 10, goal: 'foundation-recovery' as const, now };
    const chosen = recommend({ ...input, preferredLessonKey: 'fraction-addition' });
    expect(chosen.recommendations[0].lessonKey).toBe('fraction-addition');
    expect(chosen.recommendations[0].reason).toContain('선수 개념');
    expect(recommend({ ...input, preferredLessonKey: null }).recommendations[0].lessonKey).toBe('fraction-meaning');
  });
  it('prioritizes only due unfinished reviews without treating future or missing work as wrong', () => {
    const output = recommend({ lessons, enrollments: [], readiness: conceptReadiness(conceptLabels, null, []), dailyMinutes: 10, goal: 'foundation-recovery', now,
      assignments: [{ recipientId: 'future', status: 'assigned', recommendedAt: '2026-09-17T12:00:00Z' }, { recipientId: 'done', status: 'submitted', recommendedAt: '2026-09-10T12:00:00Z' }, { recipientId: 'due', status: 'assigned', recommendedAt: now.toISOString() }] });
    expect(output.plan.review?.recipientId).toBe('due');
    expect(output.plan.readiness.every(s => s.readiness === 'unknown')).toBe(true);
  });
});

describe('immutable adaptive review decisions', () => {
  const record = seedLessons[1];
  const candidates = record.review!.problemVersionIds.map(id => record.problems.find(p => p.problemVersionId === id)!);
  it('uses one question at five minutes and at most the available pool for longer sessions', () => {
    expect(reviewSelection(candidates, [], 5).items).toHaveLength(1);
    expect(reviewSelection(candidates, [], 10).items).toHaveLength(2);
    expect(reviewSelection(candidates, [], 20).items).toHaveLength(2);
    expect(reviewSelection(candidates.slice(0, 1), [], 20).items).toHaveLength(1);
  });
  it('selects the response form that needs practice and never mutates the published pool', () => {
    const before = structuredClone(candidates);
    const wrong = evidence('incorrect', { conceptKeys: ['fraction.equivalence'], responseKind: 'rational' });
    expect(reviewSelection(candidates, [wrong], 5).items[0].problemVersionId).toBe(record.review!.problemVersionIds[1]);
    expect(reviewSelection(candidates, [], 5).items[0].problemVersionId).toBe(record.review!.problemVersionIds[0]);
    expect(candidates).toEqual(before);
  });
  it('uses three days only after independent first-attempt success; errors, hints and unknown evidence use one', () => {
    expect(reviewSelection(candidates, [evidence('correct')], 10).intervalDays).toBe(3);
    for (const observations of [[], [evidence('incorrect')], [evidence('invalid')], [evidence('correct', { check: false })], [evidence('correct', { result: { status: 'correct', assisted: true, message: '' } })]]) {
      expect(reviewSelection(candidates, observations, 10).intervalDays).toBe(1);
    }
  });
});
