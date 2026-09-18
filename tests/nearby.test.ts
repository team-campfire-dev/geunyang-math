import { describe, expect, it } from 'vitest';
import { nearbyAssignments, nearbyLessons } from '@/shared/nearby';
import type { AssignmentView, ConceptReadiness, PublicLesson } from '@/shared/api';

const lesson = (lessonKey: string, courseKey: string, prerequisiteConceptKeys: string[] = []): PublicLesson => ({
  lessonKey, courseKey, versionId: `${lessonKey}:v1`, title: lessonKey, summary: '',
  estimatedMinutes: 10, conceptKeys: [lessonKey], prerequisiteConceptKeys, sectionCount: 5,
});
/** A catalogue in the order the server gives it: course by course, lesson by lesson. */
const catalogue = [
  lesson('fraction-meaning', 'fractions'),
  lesson('fraction-equivalence', 'fractions', ['fraction-meaning']),
  lesson('fraction-addition', 'fractions', ['fraction-equivalence']),
  lesson('decimal-meaning', 'decimals', ['fraction-meaning']),
  lesson('decimal-addition', 'decimals', ['decimal-meaning']),
  lesson('negative-number', 'integers'),
];
const ready = (...keys: string[]): ConceptReadiness[] =>
  keys.map((key) => ({ key, label: key, readiness: 'ready', source: 'learning' }));
const keys = (lessons: PublicLesson[]) => lessons.map((item) => item.lessonKey);

describe('the lessons the home screen puts nearest', () => {
  it('opens each course for someone with no records at all', () => {
    // Everything is unstarted, so what floats up is whatever a course opens with.
    expect(keys(nearbyLessons({ lessons: catalogue, enrollments: [], readiness: [] })))
      .toEqual(['fraction-meaning', 'negative-number', 'fraction-equivalence']);
  });

  it('puts what someone is in the middle of first', () => {
    const near = nearbyLessons({
      lessons: catalogue, readiness: ready('fraction-meaning'),
      enrollments: [{ lessonKey: 'decimal-meaning', status: 'active' }, { lessonKey: 'fraction-meaning', status: 'completed' }],
    });
    expect(near[0].lessonKey).toBe('decimal-meaning');
    // And what is finished is not offered again while anything else is left.
    expect(keys(near)).not.toContain('fraction-meaning');
  });

  it('prefers a lesson whose prerequisites are met over one that is out of reach', () => {
    const near = nearbyLessons({
      lessons: catalogue, enrollments: [{ lessonKey: 'fraction-meaning', status: 'completed' }],
      readiness: ready('fraction-meaning'), limit: 2,
    });
    // fraction-equivalence and decimal-meaning both rest on fraction-meaning, which is shown.
    expect(keys(near)).toEqual(['fraction-equivalence', 'decimal-meaning']);
  });

  it('never offers the lesson the hero is already offering', () => {
    const near = nearbyLessons({ lessons: catalogue, enrollments: [], readiness: [], exclude: 'fraction-meaning' });
    expect(keys(near)).not.toContain('fraction-meaning');
    expect(near).toHaveLength(3);
  });

  it('keeps the hero\'s lesson rather than showing an empty shelf', () => {
    const only = [lesson('fraction-meaning', 'fractions')];
    // Leaving it out is a courtesy, not a rule: on a catalogue of one there is nothing else to say.
    expect(keys(nearbyLessons({ lessons: only, enrollments: [], readiness: [], exclude: 'fraction-meaning' })))
      .toEqual(['fraction-meaning']);
  });

  it('falls back to finished lessons only when nothing is left to start', () => {
    const everything = catalogue.map((item) => ({ lessonKey: item.lessonKey, status: 'completed' }));
    const near = nearbyLessons({ lessons: catalogue, enrollments: everything, readiness: ready(...catalogue.map((c) => c.lessonKey)) });
    // Someone who has done it all is offered what they did, to read again — not an empty shelf.
    expect(near).toHaveLength(3);
    expect(keys(near)).toEqual(['fraction-meaning', 'fraction-equivalence', 'fraction-addition']);
  });

  it('keeps a course in its own order', () => {
    const near = nearbyLessons({ lessons: catalogue, enrollments: [], readiness: ready('fraction-meaning', 'fraction-equivalence', 'decimal-meaning'), limit: 6 });
    const fractions = keys(near).filter((key) => key.startsWith('fraction-'));
    expect(fractions).toEqual(['fraction-meaning', 'fraction-equivalence', 'fraction-addition']);
  });
});

const now = new Date('2026-10-10T09:00:00.000Z');
const day = (offset: number) => new Date(now.getTime() + offset * 86400000).toISOString();
const assignment = (recipientId: string, dates: Partial<Pick<AssignmentView, 'recommendedAt' | 'opensAt' | 'dueAt' | 'status'>>): AssignmentView => ({
  id: recipientId, recipientId, title: recipientId, lessonKey: null,
  recommendedAt: day(-1), opensAt: null, dueAt: null, status: 'assigned',
  policy: { kind: 'review', hints: true, results: 'per-item', solutions: 'never' },
  items: [], submissionId: `s-${recipientId}`, glossary: [], ...dates,
});
const ids = (items: AssignmentView[]) => items.map((item) => item.recipientId);

describe('the assignments the home screen puts nearest', () => {
  it('puts a deadline above a review that has waited longer', () => {
    const near = nearbyAssignments({ now, assignments: [
      assignment('old-review', { recommendedAt: day(-7) }),
      assignment('homework', { recommendedAt: day(-1), dueAt: day(2) }),
    ] });
    // Missing a deadline costs something; a late review does not.
    expect(ids(near)).toEqual(['homework', 'old-review']);
  });

  it('sorts deadlines by which comes first', () => {
    const near = nearbyAssignments({ now, assignments: [
      assignment('later', { dueAt: day(5) }), assignment('sooner', { dueAt: day(1) }),
    ] });
    expect(ids(near)).toEqual(['sooner', 'later']);
  });

  it('leaves one that has not opened yet for last', () => {
    const near = nearbyAssignments({ now, assignments: [
      assignment('not-open', { opensAt: day(3), dueAt: day(4) }),
      assignment('waiting', { recommendedAt: day(-2) }),
    ] });
    expect(ids(near)).toEqual(['waiting', 'not-open']);
  });

  it('prefers a review whose time has come over one still ahead', () => {
    const near = nearbyAssignments({ now, assignments: [
      assignment('tomorrow', { recommendedAt: day(1) }), assignment('due-now', { recommendedAt: day(-1) }),
    ] });
    expect(ids(near)).toEqual(['due-now', 'tomorrow']);
  });

  it('does not offer the one the review callout is already offering', () => {
    const near = nearbyAssignments({ now, exclude: 'first', assignments: [
      assignment('first', { recommendedAt: day(-3) }), assignment('second', { recommendedAt: day(-2) }),
    ] });
    expect(ids(near)).toEqual(['second']);
  });

  it('keeps that one rather than showing an empty shelf', () => {
    const near = nearbyAssignments({ now, exclude: 'only', assignments: [assignment('only', {})] });
    expect(ids(near)).toEqual(['only']);
  });

  it('never offers one that is already submitted', () => {
    const near = nearbyAssignments({ now, assignments: [
      assignment('done', { status: 'submitted' }), assignment('open', {}),
    ] });
    expect(ids(near)).toEqual(['open']);
  });
});
