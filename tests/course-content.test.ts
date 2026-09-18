import { readFileSync, readdirSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { parseContentBundle } from '@/core/content-bundle';
import type { StoredLesson } from '@/core/content';

/**
 * What the installed courses are made of. The renderer grew scenes that move and drawings a learner
 * arranges, and for a while **no lesson used either** — the blocks shipped and the writing did not
 * follow. These tests hold the catalogue to what the app can actually draw.
 */
const seeds = readdirSync('prisma/seed').filter((name) => name.endsWith('.json')).sort()
  .map((name) => ({ name, bundle: parseContentBundle(JSON.parse(readFileSync(`prisma/seed/${name}`, 'utf8'))) }));
const lessons = seeds.flatMap((seed) => seed.bundle.lessons as StoredLesson[]);
const blocksOf = (lesson: StoredLesson) => lesson.sections.flatMap((section) => section.contentBlocks);
const scenes = (lesson: StoredLesson) => blocksOf(lesson).filter((block) => block.kind === 'core.scene');
const moving = lessons.flatMap(scenes).filter((block) => Array.isArray(block.payload.frames) && block.payload.frames.length > 1);
const arranged = lessons.flatMap(scenes).filter((block) => Array.isArray(block.payload.zones) && block.payload.zones.length > 0);

describe('the installed courses', () => {
  it('has more than one course, each with lessons in order', () => {
    const courses = seeds.flatMap((seed) => seed.bundle.courses);
    expect(courses.length).toBeGreaterThan(1);
    for (const course of courses) {
      expect(course.lessons.map((lesson) => lesson.order), course.key).toEqual(course.lessons.map((_, index) => index + 1));
    }
  });

  it('puts the courses in an order nothing has to be learned out of', () => {
    // Somebody who has chosen nothing is recommended by the catalogue's order alone, so a course
    // that stands on another has to come after it. Install order used to decide this, which meant a
    // database seeded today and one that grew over weeks disagreed.
    const courses = seeds.flatMap((seed) => seed.bundle.courses);
    const places = courses.map((course) => course.order);
    expect(places.every((place) => typeof place === 'number'), '자리를 적지 않은 과정이 있다').toBe(true);
    expect(new Set(places).size, '같은 자리를 쓰는 과정이 있다').toBe(courses.length);
    const courseOf = new Map(courses.flatMap((course) => course.lessons.map((lesson) => [lesson.key, course])));
    const teaches = new Map<string, typeof courses>();
    for (const lesson of lessons) {
      const course = courseOf.get(lesson.public.lessonKey)!;
      for (const key of lesson.public.conceptKeys) teaches.set(key, [...(teaches.get(key) ?? []), course]);
    }
    for (const lesson of lessons) {
      const course = courseOf.get(lesson.public.lessonKey)!;
      for (const key of lesson.public.prerequisiteConceptKeys) {
        // A concept taught in the same course is fine; the lessons inside it are already in order.
        const elsewhere = (teaches.get(key) ?? []).filter((home) => home.key !== course.key);
        if (!elsewhere.length) continue;
        expect(Math.min(...elsewhere.map((home) => home.order!)), `${course.key}이(가) ${key}을(를) 가르치는 과정보다 앞에 있다`)
          .toBeLessThan(course.order!);
      }
    }
  });

  it('gives every lesson something to read, something to see and something to answer', () => {
    for (const lesson of lessons) {
      const kinds = new Set(blocksOf(lesson).map((block) => block.kind));
      const where = lesson.public.lessonKey;
      expect(kinds.has('core.rich_text'), `${where}에 글이 없다`).toBe(true);
      expect(kinds.has('core.scene'), `${where}에 그림이 없다`).toBe(true);
      expect(kinds.has('core.problem_set'), `${where}에 문항이 없다`).toBe(true);
    }
  });

  it('uses the drawings the renderer can make, not only the still ones', () => {
    expect(moving.length, '장면으로 움직이는 그림이 하나도 없다').toBeGreaterThan(0);
    expect(arranged.length, '학습자가 놓아 보는 그림이 하나도 없다').toBeGreaterThan(0);
  });

  it('gives every lesson something that moves or something to arrange', () => {
    // Reached 12 of 12 once; a lesson added without either is a lesson that only talks.
    for (const lesson of lessons) {
      const drawings = scenes(lesson);
      const alive = drawings.some((block) => Array.isArray(block.payload.frames) && block.payload.frames.length > 1)
        || drawings.some((block) => Array.isArray(block.payload.zones) && block.payload.zones.length > 0);
      expect(alive, `${lesson.public.lessonKey}에 움직이거나 놓아 보는 그림이 없다`).toBe(true);
    }
  });

  it('keeps a drawing\'s numbers short enough to survive being stored', () => {
    // MySQL hands a JSON double back a bit different from the one it was given, and the seed then
    // reads a published lesson as changed and refuses to install it again — on every deployment.
    // Two decimals round-trip, and nothing in a drawing needs more. One coordinate predates the
    // rule and is published, so it cannot be shortened; it is named rather than exempted quietly.
    const published = new Set([23.19999999999999]);
    const numbers = (value: unknown): number[] =>
      typeof value === 'number' ? [value]
        : Array.isArray(value) ? value.flatMap(numbers)
        : value && typeof value === 'object' ? Object.values(value).flatMap(numbers) : [];
    for (const lesson of lessons) {
      for (const block of scenes(lesson)) {
        for (const value of numbers(block.payload)) {
          if (published.has(value)) continue;
          expect(Math.round(value * 100) / 100, `${block.blockId}의 좌표 ${value}`).toBe(value);
        }
      }
    }
  });

  it('never asks a learner to arrange a drawing that is also moving on its own', () => {
    for (const block of arranged) {
      expect(block.payload.frames, block.blockId).toBeUndefined();
      // Somewhere to put things, and a task that says what for.
      expect(block.payload.task, block.blockId).toBeTruthy();
    }
  });

  it('keeps a lesson card readable, since a summary is drawn as plain text', () => {
    for (const lesson of lessons) {
      expect(lesson.public.summary, lesson.public.lessonKey).not.toMatch(/\$/);
      expect(lesson.public.title, lesson.public.lessonKey).not.toMatch(/\$/);
    }
  });

  it('only lets a question claim a concept its lesson teaches', () => {
    for (const seed of seeds) {
      const sets = new Map(seed.bundle.problemSets.map((set) => [set.versionId, set]));
      for (const lesson of seed.bundle.lessons as StoredLesson[]) {
        const taught = new Set(lesson.public.conceptKeys);
        const referenced = blocksOf(lesson).filter((block) => block.kind === 'core.problem_set')
          .map((block) => String(block.payload.problemSetVersionId));
        for (const versionId of referenced) {
          for (const problem of sets.get(versionId)?.problems ?? []) {
            for (const key of problem.conceptKeys) {
              expect(taught.has(key), `${problem.problemVersionId}가 ${lesson.public.lessonKey} 밖 개념을 말한다: ${key}`).toBe(true);
            }
          }
        }
      }
    }
  });
});
