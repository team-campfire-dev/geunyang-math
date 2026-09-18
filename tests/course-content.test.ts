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
