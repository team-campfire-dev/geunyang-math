import { describe, expect, it } from 'vitest';
import { recommend, reviewSelection, conceptReadiness, type Evidence } from '@/core/personalization';
import { practicePolicy, reviewPolicy } from '@/core/assignment';
import { diagnosticProblems } from './fixtures/content';
import { seedLessons, conceptLabels } from './fixtures/content';
import { gradeAnswer } from '@/core/grading';
import { playPlacement } from './fixtures/placement';

const lessons = seedLessons.map(c => ({ ...c.public, courseKey: 'fractions' }));
const answers = ['4/9', '12', '10', '3/4', '7/11', '5/12'];
const bank = diagnosticProblems;
/** What the learner would answer to each question, whichever order the placement puts them in. */
const diagnostic = (responses: (string | null)[]) => {
  const intended = new Map(bank.map((problem, index) => [problem.problemVersionId, responses[index]]));
  return playPlacement(lessons, bank, (id) => {
    const response = intended.get(id) ?? null;
    if (response === null) return 'skipped';
    // These fixtures are readable answers; an unreadable one never reaches a placement in any case.
    return gradeAnswer(response, bank.find(p => p.problemVersionId === id)!.gradingSpec, false).status === 'correct' ? 'correct' : 'incorrect';
  }).state;
};
const now = new Date('2026-09-14T12:00:00Z');
const evidence = (status: 'correct' | 'incorrect' | 'invalid', overrides: Partial<Evidence> = {}): Evidence => ({
  problemVersionId: 'new-check', conceptKeys: ['fraction.meaning'], result: { status, assisted: false, message: 'fixture' }, date: now, check: true, ...overrides,
});
function plan(responses: (string | null)[], targetCourseKey: string | null = null) {
  return recommend({ lessons, enrollments: [], assignments: [], readiness: conceptReadiness(conceptLabels, diagnostic(responses), []), dailyMinutes: 10, targetCourseKey, now });
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
  it('carries a right answer to a prerequisite it never asked about, right or wrong for this learner', () => {
    // The saving and the risk are the same thing. Someone who can find an equivalent fraction is
    // taken to know what a fraction is, so the two questions about meaning are never put to them —
    // even to someone who would have got them wrong. Their own work overrides it as soon as there is
    // any, which is why a placement is provisional and not a score.
    const placed = diagnostic([null, null, ...answers.slice(2, 4), null, null]);
    expect(placed.placed['fraction.equivalence']).toBe('ready');
    expect(placed.placed['fraction.meaning']).toBe('ready');
    expect(placed.source['fraction.meaning']).toBe('inferred');
    expect(placed.source['fraction.equivalence']).toBe('asked');
  });
  it('opens the course someone came for without bypassing missing prerequisites', () => {
    // This fixture holds one course, so what a target changes here is what the screen says. That it
    // changes which lesson is offered needs a catalogue with somewhere else to go.
    expect(plan(answers, null).recommendations[0].reason).toMatch(/일상의 예제/);
    expect(plan(answers, 'fractions').recommendations[0].reason).toMatch(/배우려던 과정/);
    expect(plan(answers, 'fractions').recommendations[0].lessonKey).toBe('fraction-meaning');
    // Wrong on what the placement actually asks about, not on a question it never reaches.
    expect(plan([null, null, '0', '0', ...answers.slice(4)], 'fractions').recommendations[0].lessonKey).toBe('fraction-meaning');
  });
  it('prioritizes subsequent learning over provisional placement and does not treat assistance as readiness', () => {
    expect(conceptReadiness(conceptLabels, diagnostic(answers), [evidence('incorrect')])[0]).toMatchObject({ source: 'learning', readiness: 'needs-practice' });
    expect(conceptReadiness(conceptLabels, diagnostic(answers), [evidence('correct', { result: { status: 'correct', assisted: true, message: '' } })])[0].readiness).toBe('needs-practice');
    // An unreadable attempt is no evidence, so the placement still speaks — here by inference,
    // because answering equivalence carried meaning without ever asking about it.
    expect(conceptReadiness(conceptLabels, diagnostic(answers), [evidence('invalid')])[0]).toMatchObject({ source: 'inferred', readiness: 'ready' });
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
      readiness: conceptReadiness(conceptLabels, null, []), dailyMinutes: 5, targetCourseKey: null, now });
    expect(output.recommendations[0]).toMatchObject({ lessonKey: 'fraction-meaning', suggestedMinutes: 5 });
    expect(output.recommendations[0].reason).toContain('직접 선택');
  });
  it('honors an explicit lesson choice and returns to prerequisite rules when cleared', () => {
    const input = { lessons, enrollments: [], assignments: [], readiness: conceptReadiness(conceptLabels, null, []), dailyMinutes: 10, targetCourseKey: null as string | null, now };
    const chosen = recommend({ ...input, preferredLessonKey: 'fraction-addition' });
    expect(chosen.recommendations[0].lessonKey).toBe('fraction-addition');
    expect(chosen.recommendations[0].reason).toContain('선수 개념');
    expect(recommend({ ...input, preferredLessonKey: null }).recommendations[0].lessonKey).toBe('fraction-meaning');
  });
  it('prioritizes only due unfinished reviews without treating future or missing work as wrong', () => {
    const output = recommend({ lessons, enrollments: [], readiness: conceptReadiness(conceptLabels, null, []), dailyMinutes: 10, targetCourseKey: null, now,
      assignments: [{ recipientId: 'future', status: 'assigned', recommendedAt: '2026-09-17T12:00:00Z', policy: reviewPolicy },
        { recipientId: 'done', status: 'submitted', recommendedAt: '2026-09-10T12:00:00Z', policy: reviewPolicy },
        { recipientId: 'due', status: 'assigned', recommendedAt: now.toISOString(), policy: reviewPolicy }] });
    expect(output.plan.review?.recipientId).toBe('due');
    expect(output.plan.readiness.every(s => s.readiness === 'unknown')).toBe(true);
  });

  it('never reminds a learner about a problem set they opened themselves', () => {
    // A set somebody picked is already where they left it. Calling it a due review would turn their
    // own choice into an obligation, and would push an actual review off the home screen.
    const output = recommend({ lessons, enrollments: [], readiness: conceptReadiness(conceptLabels, null, []), dailyMinutes: 10, targetCourseKey: null, now,
      assignments: [{ recipientId: 'mine', status: 'assigned', recommendedAt: '2026-09-10T12:00:00Z', policy: practicePolicy }] });
    expect(output.plan.review).toBeNull();
    const withReview = recommend({ lessons, enrollments: [], readiness: conceptReadiness(conceptLabels, null, []), dailyMinutes: 10, targetCourseKey: null, now,
      assignments: [{ recipientId: 'mine', status: 'assigned', recommendedAt: '2026-09-10T12:00:00Z', policy: practicePolicy },
        { recipientId: 'review', status: 'assigned', recommendedAt: '2026-09-11T12:00:00Z', policy: reviewPolicy }] });
    expect(withReview.plan.review?.recipientId).toBe('review');
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
