import { describe, expect, it } from 'vitest';
import { recommend, recommendTargetedPractice, type TargetedPracticeOption } from '@/core/personalization';
import type { ConfusionSummary, RepeatedConfusion } from '@/shared/confusion';
import { seedLessons } from './fixtures/content';
import { reviewPolicy } from '@/core/assignment';

const pattern = (overrides: Partial<RepeatedConfusion> = {}): RepeatedConfusion => ({ kind: 'misconception', key: 'add-denominators', label: '분모끼리 더하기',
  note: '', description: '', status: 'repeated', evidenceIds: ['p1', 'p2'], improvementEvidenceIds: [], lastSeenAt: '2026-09-29T01:00:00.000Z', ...overrides });
const summary = (...repeated: RepeatedConfusion[]): ConfusionSummary => ({ version: 1, latestAt: null, concepts: [], evidence: [], repeated });
const option = (overrides: Partial<TargetedPracticeOption> = {}): TargetedPracticeOption => ({ key: 'add-denominators', problemCount: 4, recipientId: null, completedAt: null, ...overrides });

describe('focused practice recommendations', () => {
  it('offers an actionable set with its distinct-question evidence', () => {
    const result = recommendTargetedPractice(summary(pattern()), [option()]);
    expect(result).toMatchObject({ misconception: 'add-denominators', problemCount: 4, evidenceIds: ['p1', 'p2'], recipientId: null });
    expect(result?.reason).toContain('서로 다른 2문제');
  });
  it.each([
    { status: 'improving' as const }, { kind: 'misreading' as const }, { evidenceIds: ['p1'] },
  ])('does not turn ineligible evidence into a recommendation: %j', changes => {
    expect(recommendTargetedPractice(summary(pattern(changes)), [option()])).toBeNull();
  });
  it('skips unavailable pools and chooses the most recent available pattern deterministically', () => {
    const old = pattern({ key: 'old', lastSeenAt: '2026-09-28T01:00:00.000Z' });
    const recent = pattern({ key: 'recent' });
    const unavailable = pattern({ key: 'empty', lastSeenAt: '2026-09-30T01:00:00.000Z' });
    expect(recommendTargetedPractice(summary(old, unavailable, recent), [option({ key: 'old' }), option({ key: 'recent' }), option({ key: 'empty', problemCount: 0 })])?.misconception).toBe('recent');
    expect(recommendTargetedPractice(summary(pattern()), [])).toBeNull();
  });
  it('resumes existing work and pauses after completion until a new occurrence', () => {
    const completedAt = '2026-09-29T02:00:00.000Z';
    expect(recommendTargetedPractice(summary(pattern()), [option({ completedAt })])).toBeNull();
    expect(recommendTargetedPractice(summary(pattern({ lastSeenAt: completedAt })), [option({ completedAt })])).toBeNull();
    expect(recommendTargetedPractice(summary(pattern({ lastSeenAt: '2026-09-29T03:00:00.000Z' })), [option({ completedAt })])).not.toBeNull();
    expect(recommendTargetedPractice(summary(pattern()), [option({ completedAt, recipientId: 'open' })])).toMatchObject({ recipientId: 'open', reason: expect.stringContaining('시작한 모아 풀기') });
  });
  it('preserves lesson choice and due review while adding an automatic practice option', () => {
    const lessons = seedLessons.map(lesson => ({ ...lesson.public, courseKey: 'fractions' }));
    const input = { lessons, enrollments: [], assignments: [], readiness: [], dailyMinutes: 10, targetCourseKey: null, now: new Date('2026-09-29T03:00:00.000Z'),
      targetedPractice: recommendTargetedPractice(summary(pattern()), [option()]) };
    expect(recommend(input).plan.targetedPractice).toEqual(input.targetedPractice);
    expect(recommend(input).recommendations).toEqual(recommend({ ...input, targetedPractice: null }).recommendations);
    expect(recommend({ ...input, preferredLessonKey: lessons[0].lessonKey }).plan.targetedPractice).toBeNull();
    const due = recommend({ ...input, assignments: [{ recipientId: 'review', recommendedAt: '2026-09-28T01:00:00.000Z', status: 'assigned', policy: reviewPolicy }] });
    expect(due.plan.review?.recipientId).toBe('review');
    expect(due.plan.targetedPractice).not.toBeNull();
  });
});
