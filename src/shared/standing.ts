import type { PublicCourse, PublicLesson } from './api';

/**
 * Where a concept lives: the first course, in the catalogue's order, whose lessons teach it.
 *
 * A concept can be taught in more than one place — a term introduced in 분수 is used again in
 * 비와 비율 — and for saying where somebody is, the place it is introduced is the one that matters.
 * Reading it off the lessons rather than declaring it anywhere means nothing has to be kept in step
 * by hand, which is the same bargain `conceptGraph` makes for the same reason.
 */
function homeCourse(lessons: PublicLesson[]) {
  const home = new Map<string, string>();
  for (const lesson of lessons) {
    for (const key of lesson.conceptKeys) if (!home.has(key)) home.set(key, lesson.courseKey);
  }
  return home;
}

/**
 * The concepts of a list, gathered into the courses that teach them.
 *
 * 「지금 어디쯤인가」 has no answer in a list of a hundred and sixty-six concepts: a list that long
 * is not a place, and reading it is work. The courses that teach them are a handful of names a
 * learner already recognises, in an order they already understand, and every count a screen wants
 * to draw is a count over one of these groups.
 *
 * Courses come back in the catalogue's own order and hold their concepts in the order their lessons
 * teach them. A course none of the concepts belong to is left out rather than shown empty, and a
 * concept no lesson teaches belongs to no course and is dropped — it is a term the glossary carries,
 * not a step on anybody's way.
 */
export function conceptsByCourse(input: {
  lessons: PublicLesson[]; courses: PublicCourse[]; conceptKeys: string[];
}): { course: PublicCourse; conceptKeys: string[] }[] {
  const { lessons, courses, conceptKeys } = input;
  const home = homeCourse(lessons);
  const wanted = new Set(conceptKeys);
  const held = new Map<string, string[]>();
  // Walked by lesson rather than by concept, so the concepts of a course come out in the order its
  // lessons teach them instead of the order the caller happened to hand them over in.
  for (const lesson of lessons) {
    for (const key of lesson.conceptKeys) {
      if (!wanted.has(key) || home.get(key) !== lesson.courseKey) continue;
      const list = held.get(lesson.courseKey);
      if (!list) held.set(lesson.courseKey, [key]);
      else if (!list.includes(key)) list.push(key);
    }
  }
  return courses.flatMap((course) => {
    const keys = held.get(course.key);
    return keys?.length ? [{ course, conceptKeys: keys }] : [];
  });
}
