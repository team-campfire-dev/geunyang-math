import type { ConceptReadiness, PublicLesson } from './api';

/**
 * Which lessons the home screen puts in front of someone. It used to be the first three of the
 * catalogue, which meant that as courses were added everyone kept seeing the same three — a person
 * who had finished fractions was still shown fractions, and nine of twelve lessons never appeared.
 *
 * The order is the order of nearness to where a person actually is: what they are in the middle of,
 * then what they could start now, then what they are not ready for, and last what they have already
 * finished. Nothing is hidden — the catalogue is one click away — this only decides what is nearest.
 *
 * With no records at all (a visitor who has not signed in) every lesson is unstarted, so what floats
 * up is whatever a course opens with. That is the right first sight of a catalogue, too.
 */
export function nearbyLessons(input: {
  lessons: PublicLesson[];
  enrollments: { lessonKey: string; status: string }[];
  readiness: ConceptReadiness[];
  /** The lesson the screen is already showing elsewhere, so it is not offered twice. */
  exclude?: string | null;
  limit?: number;
}): PublicLesson[] {
  const { lessons, enrollments, readiness, exclude = null, limit = 3 } = input;
  const enrolled = new Map(enrollments.map((entry) => [entry.lessonKey, entry.status]));
  const ready = (key: string) => readiness.some((item) => item.key === key && item.readiness === 'ready');
  const nearness = (lesson: PublicLesson) => {
    const status = enrolled.get(lesson.lessonKey);
    if (status === 'active') return 0;
    if (status === 'completed') return 3;
    return lesson.prerequisiteConceptKeys.every(ready) ? 1 : 2;
  };
  const ranked = lessons
    .map((lesson, order) => ({ lesson, order, nearness: nearness(lesson) }))
    // Within the same nearness the catalogue's own order decides, so a course stays in its order.
    .sort((a, b) => a.nearness - b.nearness || a.order - b.order);
  const withoutHero = ranked.filter((entry) => entry.lesson.lessonKey !== exclude);
  // Leaving the hero's lesson out is a courtesy, not a rule. On a catalogue of one it would leave an
  // empty shelf, and an empty shelf reads as something broken rather than as nothing to add.
  return (withoutHero.length ? withoutHero : ranked).slice(0, limit).map((entry) => entry.lesson);
}
