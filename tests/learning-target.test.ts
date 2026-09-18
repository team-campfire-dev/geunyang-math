import { readFileSync, readdirSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { conceptGraph, placementScope } from '@/core/concept-graph';
import { placement, type PlacementProblem } from '@/core/placement';
import { conceptReadiness, recommend } from '@/core/personalization';
import { parseContentBundle } from '@/core/content-bundle';
import type { StoredLesson } from '@/core/content';
import type { PublicLesson } from '@/shared/api';

/**
 * What naming a course does, on the catalogue that is actually installed.
 *
 * Before there was a target there were three goals — 생활 속 수학, 기초부터 다시, 대수학 준비 — and none
 * of them could say where a placement should stop or where a recommendation should head. Those were
 * written for adults relearning the basics; a comprehensive catalogue needs a destination instead.
 */
const seeds = readdirSync('prisma/seed').filter((name) => name.endsWith('.json')).sort()
  .map((name) => parseContentBundle(JSON.parse(readFileSync(`prisma/seed/${name}`, 'utf8'))));
// A seeded lesson does not name its course — the course names its lessons, and the server joins them.
const owner = new Map(seeds.flatMap((seed) => seed.courses).flatMap((course) => course.lessons.map((lesson) => [lesson.key, course.key])));
const inCatalogueOrder = seeds.flatMap((seed) => seed.courses).flatMap((course) => course.lessons.map((lesson) => lesson.key));
const lessons: PublicLesson[] = seeds.flatMap((seed) => (seed.lessons as StoredLesson[]).map((lesson) => ({ ...lesson.public, courseKey: owner.get(lesson.public.lessonKey)! })))
  .sort((a, b) => inCatalogueOrder.indexOf(a.lessonKey) - inCatalogueOrder.indexOf(b.lessonKey));
const labels = Object.fromEntries(seeds.flatMap((seed) => seed.concepts).map((concept) => [concept.key, concept.label]));
const graph = conceptGraph(lessons);
// Only courses somebody could be sent to. The placement's own course holds the question bank and
// no lessons, which is what keeps it out of the catalogue and out of this list.
const courses = seeds.flatMap((seed) => seed.courses).filter((course) => course.lessons.length).map((course) => course.key);
const scopeFor = (courseKey: string | null) =>
  placementScope(graph, lessons.filter((lesson) => lesson.courseKey === courseKey).flatMap((lesson) => lesson.conceptKeys));
const advise = (targetCourseKey: string | null) => recommend({
  lessons, enrollments: [], assignments: [], dailyMinutes: 10, targetCourseKey, now: new Date(),
  readiness: conceptReadiness(labels, null, []),
}).recommendations[0];

const definition = seeds.flatMap((seed) => seed.diagnostics).at(-1)!;
const bank: PlacementProblem[] = seeds.flatMap((seed) => seed.problemSets)
  .find((set) => set.versionId === definition.problemSet.problemSetVersionId)!
  .problems.filter((problem) => definition.problemSet.problemVersionIds.includes(problem.problemVersionId))
  .map((problem) => ({ problemVersionId: problem.problemVersionId, conceptKeys: problem.conceptKeys }));

describe('naming the course someone came for', () => {
  it('is not offered a course with no lessons, which is where the question bank lives', () => {
    const empty = seeds.flatMap((seed) => seed.courses).filter((course) => !course.lessons.length);
    expect(empty.map((course) => course.key)).toEqual(['placement']);
    expect(courses).not.toContain('placement');
  });

  it('bounds the placement to what that course stands on', () => {
    const everything = scopeFor(null);
    expect(courses.length).toBeGreaterThan(1);
    for (const course of courses) {
      const scope = scopeFor(course);
      expect(scope.length, `${course}의 범위`).toBeGreaterThan(0);
      expect(scope.length, `${course}가 카탈로그 전체를 확인한다`).toBeLessThan(everything.length);
      // Everything the course teaches is in it, and so is everything that comes before.
      for (const lesson of lessons.filter((item) => item.courseKey === course)) {
        for (const key of lesson.conceptKeys) expect(scope, `${course}가 ${key}를 빼놓았다`).toContain(key);
      }
    }
  });

  it('never asks about a concept that course does not stand on', () => {
    // Fractions come before everything here, so the reverse is what has to be checked: the concepts
    // of the later courses are outside the fraction learner's placement and are never settled.
    const scope = scopeFor('fractions');
    const later = lessons.filter((lesson) => lesson.courseKey !== 'fractions').flatMap((lesson) => lesson.conceptKeys);
    for (const key of new Set(later)) expect(scope, key).not.toContain(key);
    let answers: { problemVersionId: string; status: 'correct' }[] = [];
    for (;;) {
      const { state, next } = placement(graph, scope, bank, answers);
      if (!next) { expect(Object.keys(state.placed).every((key) => scope.includes(key))).toBe(true); break; }
      answers = [...answers, { problemVersionId: next.problemVersionId, status: 'correct' }];
    }
  });

  it('starts someone in the course they came for when it has a lesson they can begin', () => {
    // With no records the catalogue's own first lesson is the fractions one, and it also lies on the
    // way to integers — so ordering by the catalogue alone would send an integers learner there.
    expect(advise(null)!.lessonKey).toBe('fraction-meaning');
    expect(advise('integers')!.lessonKey).toBe('negative-number');
    expect(lessons.find((lesson) => lesson.lessonKey === 'negative-number')!.prerequisiteConceptKeys).toEqual([]);
  });

  it('sends someone to a prerequisite course when their own has nothing to begin with', () => {
    // Every ratios lesson stands on fractions, so there is nothing in it to open yet.
    const offered = advise('ratios')!;
    expect(lessons.find((lesson) => lesson.lessonKey === offered.lessonKey)!.courseKey).toBe('fractions');
    expect(offered.reason, '왜 다른 과정을 먼저 여는지 말하지 않는다').toMatch(/배우려는 과정이 딛고 선/);
  });
});
