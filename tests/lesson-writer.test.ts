import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { assembleLesson, lessonIssues, readDraft, type LessonDraft } from '@/server/lesson-writer';
import type { StoredLesson } from '@/core/content';

const seed = JSON.parse(readFileSync('prisma/seed/pythagoras.json', 'utf8')) as { lessons: StoredLesson[] };
const current = seed.lessons.find((lesson) => lesson.public.lessonKey === 'pythagoras')!;
/** Whatever version the seed holds now, the rewrite is the one after it. */
const following = `:v${Number(/:v(\d+)$/.exec(current.public.versionId)![1]) + 1}`;

const moving = {
  width: 320, height: 200, alt: '직각삼각형의 세 변에 정사각형을 그리는 그림', caption: '두 넓이의 합이 큰 넓이예요',
  items: [
    { kind: 'polygon', id: 'tri', points: [[40, 170], [200, 170], [40, 40]], closed: true, fill: 'fill-soft', stroke: 'ink' },
    { kind: 'text', id: 'sum', x: 250, y: 60, text: '$9 + 16$', size: 12, anchor: 'middle', opacity: 0 },
  ],
  frames: [{ changes: [] }, { caption: '합이 나타나요', changes: [{ id: 'sum', opacity: 1 }] }],
};
const draft = (over: Partial<LessonDraft> = {}): LessonDraft => ({
  explanation: [{ type: 'text', text: '직각을 낀 두 변을 제곱해 더하면 빗변의 제곱이에요.', definitions: [{ conceptKey: 'pythagoras', surface: '빗변' }] },
    { type: 'scene', scene: moving }],
  worked_example: [{ type: 'text', text: '$6^2 + 8^2 = 100$이니 빗변은 $10$이에요.' }],
  summary: [{ type: 'text', text: '두 변을 제곱해 더하면 빗변의 제곱이에요.' }],
  ...over,
});

describe('a lesson written again', () => {
  it('is the next version of the same lesson, with its questions carried over untouched', () => {
    const next = assembleLesson(current, draft());
    expect(next.public.lessonKey).toBe('pythagoras');
    expect(next.public.versionId).toBe(`pythagoras${following}`);
    expect(next.public.conceptKeys).toEqual(current.public.conceptKeys);
    expect(next.review).toEqual(current.review);
    const asks = (lesson: StoredLesson) => lesson.sections.filter((section) => section.role === 'practice' || section.role === 'check')
      .map((section) => section.contentBlocks.map((block) => block.payload));
    expect(asks(next)).toEqual(asks(current));
    expect(next.sections.every((section) => section.sectionId.endsWith(following))).toBe(true);
    expect(next.sections.flatMap((section) => section.contentBlocks).every((block) => block.blockId.endsWith(following))).toBe(true);
    expect(lessonIssues(next, 'middle-2')).toEqual([]);
  });

  it('is sent back for what the schema refuses and for what it cannot see', () => {
    const issues = (over: Partial<LessonDraft>) => lessonIssues(assembleLesson(current, draft(over)), 'middle-2');
    // Nothing that moves in the explanation.
    expect(issues({ explanation: [{ type: 'text', text: '두 변을 제곱해 더해요.' }] }).join()).toContain('움직이는 그림');
    // A shape that leaves its canvas when it moves.
    const away = { ...moving, frames: [{ changes: [] }, { changes: [{ id: 'sum', opacity: 1, dx: 200 }] }] };
    expect(issues({ explanation: [{ type: 'scene', scene: away }] }).join()).toContain('그림 밖');
    // Words on words, once the second one appears.
    const crowded = { ...moving, items: [...moving.items, { kind: 'text', x: 250, y: 60, text: '$25$', size: 12, anchor: 'middle' }] };
    expect(issues({ explanation: [{ type: 'scene', scene: crowded }] }).join()).toContain('겹쳐요');
    // A picture in a corner of its canvas.
    const tiny = { ...moving, items: [{ kind: 'polygon', id: 'tri', points: [[10, 30], [60, 30], [10, 10]], closed: true }], frames: [{ changes: [] }, { changes: [{ id: 'tri', opacity: 0.5 }] }] };
    expect(issues({ explanation: [{ type: 'scene', scene: tiny }] }).join()).toContain('그림이 작아요');
    // The house style and the grade's range.
    expect(issues({ summary: [{ type: 'text', text: '빗변은 $\\sqrt{100}$입니다.' }] }).join()).toMatch(/습니다.*제곱근|제곱근.*습니다/s);
    // What the schema refuses comes back in its own words, with where.
    expect(issues({ explanation: [{ type: 'scene', scene: { ...moving, alt: '$a^2$의 그림' } }] }).join()).toContain('alt');
  });

  it('reads only an answer that has all three steps', () => {
    expect(readDraft('not json')).toBe('JSON으로 읽을 수 없어요.');
    expect(readDraft(JSON.stringify({ explanation: [], worked_example: [{}], summary: [{}] }))).toBe('explanation가 비었어요.');
    expect(typeof readDraft(JSON.stringify(draft()))).toBe('object');
  });
});
