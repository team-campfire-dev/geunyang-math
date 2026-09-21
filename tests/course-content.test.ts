import { readFileSync, readdirSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { parseContentBundle } from '@/core/content-bundle';
import type { StoredLesson } from '@/core/content';
import { gradeAnswer } from '@/core/grading';
import { writtenAnswer } from './fixtures/content';

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

type Box = { id?: string; x: number; y: number; width: number; height: number; rotate: number };
/** The four corners a tile actually covers, turned about its own centre the way both the
 *  renderer's `rotate` and a frame's `rotate` turn it. */
const corners = (box: Box) => {
  const [cx, cy] = [box.x + box.width / 2, box.y + box.height / 2];
  const radians = (box.rotate * Math.PI) / 180, [cos, sin] = [Math.cos(radians), Math.sin(radians)];
  return [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([sx, sy]) => {
    const [dx, dy] = [(sx * box.width) / 2, (sy * box.height) / 2];
    return [cx + dx * cos - dy * sin, cy + dx * sin + dy * cos] as const;
  });
};
/** Two tiles miss when some edge of one of them separates them. Tiles that merely touch — which
 *  is how a square is built out of four — leave no gap and are not an overlap. */
const overlapping = (one: Box, two: Box) => {
  for (const box of [one, two]) {
    const [first, second, , fourth] = corners(box);
    for (const edge of [[second[0] - first[0], second[1] - first[1]], [fourth[0] - first[0], fourth[1] - first[1]]]) {
      const length = Math.hypot(edge[0], edge[1]) || 1;
      const [nx, ny] = [edge[0] / length, edge[1] / length];
      const span = (item: Box) => corners(item).map(([x, y]) => x * nx + y * ny);
      const [a, b] = [span(one), span(two)];
      if (Math.max(...a) <= Math.min(...b) + 1e-6 || Math.max(...b) <= Math.min(...a) + 1e-6) return false;
    }
  }
  return true;
};

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

  it('keeps a drawing\'s shapes apart and on the page in every scene it plays', () => {
    // A frame that moves a tile too far, or not far enough, draws something the caption does not
    // describe — tiles sitting on top of each other, or a gap where the words say「나란히 붙이면」.
    // Three of these shipped before anyone played the scenes through on a phone.
    const published = new Set(['signed-addition']);  // An arrow that enters from off the page, already published.
    for (const lesson of lessons) {
      for (const block of scenes(lesson)) {
        const items = block.payload.items as Record<string, number | string | boolean>[];
        const width = Number(block.payload.width), height = Number(block.payload.height);
        for (const [index, frame] of ((block.payload.frames ?? []) as { changes: Record<string, number | boolean>[] }[]).entries()) {
          const changes = new Map(frame.changes.map((change) => [String(change.id), change]));
          const shown = (item: typeof items[number]) => {
            const change = changes.get(String(item.id));
            if (change?.hidden || change?.opacity === 0) return false;
            return change?.opacity !== undefined || item.opacity !== 0;
          };
          const boxes: Box[] = items.filter((item) => item.kind === 'rect' && shown(item)).map((item) => ({
            id: String(item.id ?? ''), x: Number(item.x) + Number(changes.get(String(item.id))?.dx ?? 0),
            y: Number(item.y) + Number(changes.get(String(item.id))?.dy ?? 0),
            width: Number(item.width), height: Number(item.height),
            rotate: Number(changes.get(String(item.id))?.rotate ?? item.rotate ?? 0),
          }));
          for (let a = 0; a < boxes.length; a += 1) for (let b = a + 1; b < boxes.length; b += 1) {
            const [one, two] = [boxes[a], boxes[b]];
            expect(overlapping(one, two), `${lesson.public.lessonKey} 장면 ${index + 1}에서 ${one.id}와 ${two.id}가 겹친다`).toBe(false);
          }
          if (published.has(lesson.public.lessonKey)) continue;
          for (const item of items) {
            const change = changes.get(String(item.id));
            for (const [key, shift] of [['x', 'dx'], ['x1', 'dx'], ['x2', 'dx'], ['cx', 'dx']] as const) {
              if (typeof item[key] !== 'number') continue;
              const at = item[key] + Number(change?.[shift] ?? 0);
              expect(at >= -6 && at <= width + 6, `${lesson.public.lessonKey} 장면 ${index + 1}: ${item.id} ${key}=${at}`).toBe(true);
            }
            for (const [key, shift] of [['y', 'dy'], ['y1', 'dy'], ['y2', 'dy'], ['cy', 'dy']] as const) {
              if (typeof item[key] !== 'number') continue;
              const at = item[key] + Number(change?.[shift] ?? 0);
              expect(at >= -6 && at <= height + 6, `${lesson.public.lessonKey} 장면 ${index + 1}: ${item.id} ${key}=${at}`).toBe(true);
            }
          }
        }
      }
    }
  });

  it('reads a turned tile by where it lands, not by the width it was written with', () => {
    // A quarter turn makes a tile as wide as it was tall. Before this, a strip written as 24 by 76
    // and laid flat under a square was still read as standing 76 tall, so the one honest way to
    // draw 완전제곱식 — cut the strip in two and turn one half onto the other side — was refused.
    const square = { id: 'sq', x: 84, y: 44, width: 76, height: 76, rotate: 0 };
    const strip = { id: 'strip', x: 110, y: 94, width: 24, height: 76, rotate: 90 };
    expect(overlapping(square, { ...strip, rotate: 0 }), '돌리지 않으면 정사각형을 뚫고 지나간다').toBe(true);
    expect(overlapping(square, strip), '돌려서 아래에 누우면 맞닿기만 한다').toBe(false);
    // And touching is still not overlapping, which is how four tiles make one square.
    expect(overlapping(square, { id: 'next', x: 160, y: 44, width: 24, height: 76, rotate: 0 })).toBe(false);
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

  it('keeps a step\'s name readable too, for the same reason', () => {
    // The outline and the sheet both draw a step's title as plain text, so `$...$` in one shows its
    // dollars instead of its formula. Written before anything caught it: a title with math in it
    // read「$25 \\times 32 \\times 4$를 어떻게 10초에 푸나」in the step list.
    for (const lesson of lessons) {
      for (const section of lesson.sections) {
        expect(section.title, `${lesson.public.lessonKey}의 ${section.sectionId}`).not.toMatch(/\$/);
      }
    }
  });

  it('writes emphasis in words, since the renderer draws prose and math and nothing else', () => {
    // `**굵게**` shipped its asterisks to the learner four times before anyone looked: the renderer
    // splits prose on `$...$` and leaves everything else as a text node, markdown included.
    for (const seed of seeds) {
      for (const lesson of seed.bundle.lessons as StoredLesson[]) {
        for (const block of blocksOf(lesson)) {
          const written = typeof block.payload.text === 'string' ? block.payload.text : '';
          expect(written, `${lesson.public.lessonKey}의 ${block.blockId}`).not.toMatch(/\*\*/);
        }
      }
      for (const set of seed.bundle.problemSets) {
        for (const problem of set.problems) {
          for (const block of [...problem.promptContent, ...problem.hints, ...problem.solution]) {
            const written = typeof block.payload.text === 'string' ? block.payload.text : '';
            expect(written, problem.problemVersionId).not.toMatch(/\*\*/);
          }
        }
      }
    }
  });

  it('gives every course a big set of its own that no lesson shows', () => {
    // Somebody who wants to solve rather than be taught picks one of these. It belongs to the
    // course, not to a lesson, so nothing in the lessons has to change for it to exist.
    for (const seed of seeds) {
      for (const course of seed.bundle.courses) {
        if (!course.lessons.length) continue;
        // The newest version of it: a published set cannot be edited, so when a course grows a
        // lesson its drill grows by a new version and the old one stays behind, still 20 questions
        // about the concepts the course had then.
        const drill = seed.bundle.problemSets.filter((set) => set.problemSetId === `${course.key}:drill`).at(-1);
        expect(drill, `${course.key}에 모아 푸는 문제집이 없다`).toBeDefined();
        expect(drill!.problems.length, course.key).toBe(20);
        expect(drill!.name, course.key).toBeTruthy();
        // No step and no review pool names it, which is what makes it a set of its own.
        const shown = (seed.bundle.lessons as StoredLesson[]).flatMap((lesson) =>
          [...blocksOf(lesson).filter((block) => block.kind === 'core.problem_set').map((block) => String(block.payload.problemSetId)),
            ...(lesson.review ? [lesson.review.problemSetId] : [])]);
        expect(shown, course.key).not.toContain(drill!.problemSetId);
        // It practises the course, so it asks about what the course teaches and nothing else.
        const taught = new Set((seed.bundle.lessons as StoredLesson[]).flatMap((lesson) => lesson.public.conceptKeys));
        const asked = new Set(drill!.problems.flatMap((problem) => problem.conceptKeys));
        expect([...asked].filter((key) => !taught.has(key)), course.key).toEqual([]);
        expect([...taught].filter((key) => !asked.has(key)), `${course.key}에서 묻지 않는 개념`).toEqual([]);
      }
    }
  });

  it('marks its own answer key correct on every question a course keeps', () => {
    for (const seed of seeds) {
      for (const set of seed.bundle.problemSets) {
        for (const problem of set.problems) {
          expect(gradeAnswer(writtenAnswer(problem), problem.gradingSpec).status, problem.problemVersionId).toBe('correct');
        }
      }
    }
  });

  it('never sends the answer to a question that is answered by picking', () => {
    const picked = seeds.flatMap((seed) => seed.bundle.problemSets).flatMap((set) => set.problems)
      .filter((problem) => problem.gradingSpec.kind === 'choice');
    expect(picked.length, '객관식 문항이 하나도 없다').toBeGreaterThan(20);
    for (const problem of picked) {
      const spec = problem.gradingSpec as { kind: 'choice'; options: { id: string; text: string }[]; correct: string };
      // The learner's copy offers the same options and says nothing about which one is right.
      expect(problem.responseSpec.options, problem.problemVersionId).toEqual(spec.options);
      expect(JSON.stringify(problem.responseSpec), problem.problemVersionId).not.toContain('correct');
      expect(gradeAnswer(spec.options.find((option) => option.id !== spec.correct)!.id, spec).status, problem.problemVersionId).toBe('incorrect');
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
