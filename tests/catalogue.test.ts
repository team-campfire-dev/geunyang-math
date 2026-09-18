import { describe, expect, it } from 'vitest';
import { nearbyLessons } from '@/shared/catalogue';
import type { ConceptReadiness, PublicLesson } from '@/shared/api';

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
