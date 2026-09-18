import { describe, expect, it } from 'vitest';
import { definitionBlockSchema, storedLessonOf, validateLesson, validateProblemSet, type LessonRecord } from '@/core/content';
/** Publishing validates the frozen half of a lesson: its steps, not the questions its sets hold. */
const checkLesson = (record: unknown) => validateLesson(storedLessonOf(record as LessonRecord));
import {
  changeFor, createSceneItem, cssColor, emptyScene, isSceneColor, itemBounds, moveItem, nameItem, pathPattern,
  placeInZone, placementOffset, removeFromZone, reorderItem, resizeItem, sceneItemKinds, setChange, taskComplete,
  sceneColorLabels, sceneColors, zoneAt, type SceneItem, type SceneZone,
} from '@/shared/scene';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { SceneShapes } from '@/features/learning/content-blocks';
import { seedLessons, setsOf } from './fixtures/content';

const sceneBlock = (items: unknown[], extra: Record<string, unknown> = {}) => ({
  blockId: 'fraction-meaning:explanation:scene:v2', kind: 'core.scene', typeVersion: 1, required: true,
  payload: { alt: '조각을 나란히 놓은 그림', width: 320, height: 200, items, ...extra },
});
const withScene = (items: unknown[], extra?: Record<string, unknown>) => {
  const record = structuredClone(seedLessons[0]);
  record.sections[0].contentBlocks.push(sceneBlock(items, extra) as never);
  return record;
};

describe('a drawing given as data', () => {
  it('accepts every shape the editor can place', () => {
    const scene = emptyScene();
    const items = sceneItemKinds.map((kind) => createSceneItem(kind, scene));
    expect(items.map((item) => item.kind)).toEqual(sceneItemKinds);
    expect(() => checkLesson(withScene(items))).not.toThrow();
  });

  it('draws a fraction bar as one shape, so the bar-only blocks are no longer needed', () => {
    expect(sceneItemKinds).toContain('strip');
    expect(() => checkLesson(withScene([{ kind: 'strip', x: 10, y: 10, width: 200, height: 40, parts: 4, filled: 3 }]))).not.toThrow();
    expect(() => checkLesson(withScene([{ kind: 'strip', x: 10, y: 10, width: 200, height: 40, parts: 4, filled: 5 }]))).toThrow(/filled must not exceed parts/);
  });

  it('refuses anything in path data that is not a command or a number', () => {
    expect(pathPattern.test('M 0 0 L 10 10 Z')).toBe(true);
    expect(pathPattern.test('M0 0 url(#x)')).toBe(false);
    expect(() => checkLesson(withScene([{ kind: 'path', d: 'M0 0 L10 10' }]))).not.toThrow();
    expect(() => checkLesson(withScene([{ kind: 'path', d: 'M0 0 <script>' }]))).toThrow(/Invalid payload/);
  });

  it('takes palette names and plain hex, and nothing else, as a colour', () => {
    expect(isSceneColor('green')).toBe(true);
    expect(isSceneColor('#8daa69')).toBe(true);
    expect(isSceneColor('url(https://example.test/x.png)')).toBe(false);
    expect(isSceneColor('red; background: url(x)')).toBe(false);
    expect(cssColor('green')).toBe('var(--green)');
    expect(cssColor('#abc')).toBe('#abc');
    // An unknown colour draws nothing rather than being passed through to the document.
    expect(cssColor('javascript:alert(1)')).toBe('none');
    expect(() => checkLesson(withScene([{ kind: 'rect', x: 0, y: 0, width: 10, height: 10, fill: 'expression(x)' }]))).toThrow(/Unknown colour/);
  });

  it('names the drawing in plain words and keeps math for the caption', () => {
    expect(() => checkLesson(withScene([], { caption: '$\\frac{3}{4}$만큼' }))).not.toThrow();
    expect(() => checkLesson(withScene([], { alt: '$\\frac{3}{4}$ 그림' }))).toThrow(/math markup/);
  });

  it('rejects a shape the renderer does not know and an unlisted field', () => {
    expect(() => checkLesson(withScene([{ kind: 'spiral', x: 0, y: 0 }]))).toThrow(/Invalid payload/);
    expect(() => checkLesson(withScene([{ kind: 'rect', x: 0, y: 0, width: 10, height: 10, onClick: 'boom' }]))).toThrow(/Invalid payload/);
  });
});

describe('arranging shapes on the canvas', () => {
  const rect: SceneItem = { kind: 'rect', x: 10, y: 20, width: 40, height: 30 };

  it('moves every kind of shape by the same gesture', () => {
    expect(moveItem(rect, 5, -5)).toMatchObject({ x: 15, y: 15 });
    expect(moveItem({ kind: 'ellipse', cx: 50, cy: 50, rx: 10, ry: 10 }, 10, 0)).toMatchObject({ cx: 60, cy: 50 });
    expect(moveItem({ kind: 'line', x1: 0, y1: 0, x2: 10, y2: 10 }, 2, 3)).toMatchObject({ x1: 2, y1: 3, x2: 12, y2: 13 });
    expect(moveItem({ kind: 'polygon', points: [[0, 0], [10, 0]] }, 1, 1)).toMatchObject({ points: [[1, 1], [11, 1]] });
    expect(moveItem({ kind: 'path', d: 'M 0 0 L 10 10' }, 5, 5)).toMatchObject({ d: 'M 5 5 L 15 15' });
  });

  it('resizes from the shape it already is, keeping its top-left corner', () => {
    expect(resizeItem(rect, 80, 60)).toMatchObject({ x: 10, y: 20, width: 80, height: 60 });
    const circle = resizeItem({ kind: 'ellipse', cx: 50, cy: 50, rx: 10, ry: 10 }, 40, 40);
    expect(itemBounds(circle)).toMatchObject({ x: 40, y: 40, width: 40, height: 40 });
    const triangle = resizeItem({ kind: 'polygon', points: [[0, 0], [10, 0], [10, 10]] }, 20, 20);
    expect(itemBounds(triangle)).toMatchObject({ width: 20, height: 20 });
    // A drag never collapses a shape into nothing.
    expect(resizeItem(rect, -50, -50)).toMatchObject({ width: 1, height: 1 });
  });

  it('orders shapes back to front and refuses to move past either end', () => {
    const items: SceneItem[] = [rect, { kind: 'text', x: 0, y: 0, text: '앞' }];
    expect(reorderItem(items, 0, 1).map((item) => item.kind)).toEqual(['text', 'rect']);
    expect(reorderItem(items, 1, 1)).toBe(items);
    expect(reorderItem(items, 0, -1)).toBe(items);
  });
});

describe('a label that carries a formula', () => {
  const label = (text: string, extra: Partial<SceneItem> = {}): SceneItem =>
    ({ kind: 'text', x: 100, y: 50, text, size: 14, ...extra } as SceneItem);

  it('measures a fraction by what it draws, not by how it is written', () => {
    // "\\frac{3}{4}" is eleven characters and draws about one wide; the box must not follow the source.
    const written = itemBounds(label('$\\frac{3}{4}$'));
    const literal = itemBounds(label('\\frac{3}{4}'));
    expect(written.width).toBeLessThan(literal.width / 3);
    // A stacked fraction asks for a second row, and resizing hands that row back rather than
    // reading the taller box as a bigger font.
    expect(written.height).toBe(14 * 1.25 * 2);
    expect(resizeItem(label('$\\frac{3}{4}$'), 60, 35)).toMatchObject({ size: 17.5 });
    expect(resizeItem(label('넷 중 셋'), 60, 35)).toMatchObject({ size: 35 });
  });

  it('measures prose around the formula too', () => {
    expect(itemBounds(label('전체의 $\\frac{3}{4}$')).width)
      .toBeGreaterThan(itemBounds(label('$\\frac{3}{4}$')).width);
  });

  it('draws the formula as KaTeX and escapes everything around it', () => {
    const html = renderToStaticMarkup(createElement(SceneShapes, { items: [label('<b>전체</b>의 $\\frac{3}{4}$')] }));
    expect(html).toContain('<foreignObject');
    expect(html).toContain('katex');
    // The prose half never becomes markup, however it was written.
    expect(html).toContain('&lt;b&gt;');
    expect(html).not.toContain('<b>');
  });

  it('leaves a label without a formula as plain SVG text', () => {
    const html = renderToStaticMarkup(createElement(SceneShapes, { items: [label('전체를 넷으로')] }));
    expect(html).toContain('<text');
    expect(html).not.toContain('foreignObject');
  });
});

describe('a drawing that moves', () => {
  const named = (id: string): SceneItem => ({ kind: 'rect', id, x: 10, y: 10, width: 40, height: 20 });

  it('animates the shapes that are already there, and refuses to name one that is not', () => {
    const frames = [{ changes: [] }, { changes: [{ id: 'a', dx: 40, opacity: 0.5 }] }];
    expect(() => checkLesson(withScene([named('a')], { frames }))).not.toThrow();
    expect(() => checkLesson(withScene([named('b')], { frames }))).toThrow(/changes a shape that is not in the drawing/);
    expect(() => checkLesson(withScene([named('a'), named('a')], { frames }))).toThrow(/share one name/);
  });

  it('asks for at least a pair of frames and bounds how fast they pass', () => {
    expect(() => checkLesson(withScene([named('a')], { frames: [{ changes: [] }] }))).toThrow(/Invalid payload/);
    expect(() => checkLesson(withScene([named('a')], { frames: [{ changes: [] }, { changes: [] }], frameMs: 50 }))).toThrow(/Invalid payload/);
    expect(() => checkLesson(withScene([named('a')], { frames: [{ changes: [] }, { changes: [] }], frameMs: 1200, loop: true, autoplay: true }))).not.toThrow();
  });

  it('carries the same colour rule into a frame, so movement cannot repaint freely', () => {
    const frames = [{ changes: [] }, { changes: [{ id: 'a', fill: 'url(#x)' }] }];
    expect(() => checkLesson(withScene([named('a')], { frames }))).toThrow(/Unknown colour/);
  });

  it('names a shape only when a frame needs it, and keeps the name unique', () => {
    const items: SceneItem[] = [named('a'), { kind: 'ellipse', cx: 10, cy: 10, rx: 5, ry: 5 }];
    expect(nameItem(items, 0)).toMatchObject({ id: 'a' });
    const second = nameItem(items, 1);
    expect(second.id).toBe('s2');
    expect(second.items[1].id).toBe('s2');
  });

  it('records a move into one frame and forgets it when the shape returns home', () => {
    const frames = [{ changes: [] }, { changes: [] }];
    const moved = setChange(frames, 1, 'a', { dx: 20, dy: -4 });
    expect(moved[1].changes).toEqual([{ id: 'a', dx: 20, dy: -4 }]);
    expect(moved[0].changes).toEqual([]);
    expect(changeFor(moved[1], named('a'))).toMatchObject({ dx: 20 });
    expect(setChange(moved, 1, 'a', { dx: 0, dy: 0 })[1].changes).toEqual([]);
  });
});

describe('a drawing the learner arranges', () => {
  const piece = (id: string): SceneItem => ({ kind: 'rect', id, label: `${id} 조각`, draggable: true, x: 10, y: 150, width: 40, height: 30 });
  const zone = (id: string, accepts?: string[]): SceneZone => ({ id, x: 100, y: 20, width: 60, height: 40, label: `${id} 자리`, accepts });
  const task = { prompt: '조각을 자리에 놓아 보세요.' };

  it('needs a task, a place to put something, and something to put there', () => {
    expect(() => checkLesson(withScene([piece('a')], { zones: [zone('z1')], task }))).not.toThrow();
    expect(() => checkLesson(withScene([piece('a')], { zones: [zone('z1')] }))).toThrow(/needs a task/);
    expect(() => checkLesson(withScene([piece('a')], { task }))).toThrow(/needs at least one zone/);
    expect(() => checkLesson(withScene([{ kind: 'rect', x: 0, y: 0, width: 10, height: 10 }], { zones: [zone('z1')], task })))
      .toThrow(/needs a shape the learner can move/);
    expect(() => checkLesson(withScene([piece('a')], {}))).toThrow(/needs somewhere to be put/);
  });

  it('makes a movable shape say its own name', () => {
    const unnamed: SceneItem = { kind: 'rect', id: 'a', draggable: true, x: 0, y: 0, width: 10, height: 10 };
    expect(() => checkLesson(withScene([unnamed], { zones: [zone('z1')], task }))).toThrow(/spoken label/);
  });

  it('refuses a zone that waits for a shape nobody can move, and two zones with one name', () => {
    expect(() => checkLesson(withScene([piece('a')], { zones: [zone('z1', ['ghost'])], task }))).toThrow(/accepts a shape that cannot be moved/);
    expect(() => checkLesson(withScene([piece('a')], { zones: [zone('z1'), zone('z1')], task }))).toThrow(/Two zones share one name/);
  });

  it('keeps a drawing either playing or being played with, never both', () => {
    const frames = [{ changes: [] }, { changes: [] }];
    expect(() => checkLesson(withScene([piece('a')], { zones: [zone('z1')], task, frames })))
      .toThrow(/move on its own or be arranged by hand, not both/);
  });

  it('puts one shape in a zone at a time and sends the displaced one home', () => {
    const z1 = zone('z1');
    let placement = placeInZone({}, 'a', z1);
    expect(placement).toEqual({ a: 'z1' });
    placement = placeInZone(placement, 'b', z1);
    expect(placement).toEqual({ b: 'z1' });
    expect(removeFromZone(placement, 'b')).toEqual({});
    // A zone that does not accept the shape simply does not take it.
    expect(placeInZone({}, 'c', zone('z2', ['a']))).toEqual({});
  });

  it('counts the task done only when every zone holds something it accepts', () => {
    const zones = [zone('z1', ['a']), zone('z2', ['b'])];
    expect(taskComplete(zones, { a: 'z1' })).toBe(false);
    expect(taskComplete(zones, { a: 'z1', b: 'z2' })).toBe(true);
    expect(taskComplete([], {})).toBe(false);
  });

  it('carries a dropped shape to the middle of the zone it landed in', () => {
    const dropped = zoneAt([zone('z1', ['a'])], { x: 120, y: 40 }, 'a');
    expect(dropped?.id).toBe('z1');
    expect(zoneAt([zone('z1', ['a'])], { x: 120, y: 40 }, 'b')).toBeUndefined();
    expect(zoneAt([zone('z1')], { x: 5, y: 5 }, 'a')).toBeUndefined();
    expect(placementOffset(piece('a'), zone('z1'))).toEqual({ dx: 100, dy: -125 });
  });

  it('keeps a drawing to arrange out of anything that is marked', () => {
    const block = {
      blockId: 'draft:scene:v1', kind: 'core.scene', typeVersion: 1, required: true,
      payload: { alt: '조각을 놓는 그림', width: 320, height: 200, items: [piece('a')], zones: [zone('z1')], task },
    };
    // Questions are a problem set's, so it is the set that refuses a drawing to arrange inside one.
    const [set] = setsOf(structuredClone(seedLessons[0]));
    set.problems[0].promptContent.push(block as never);
    expect(() => validateProblemSet(set)).toThrow(/drawing to arrange is not allowed inside a problem/);
    expect(() => definitionBlockSchema.parse(block)).toThrow(/drawing to arrange/);
    // The same drawing without zones is just a picture, and a picture may go anywhere.
    const still = { ...block, payload: { ...block.payload, zones: undefined, task: undefined, items: [{ kind: 'rect', x: 0, y: 0, width: 10, height: 10 }] } };
    const [illustrated] = setsOf(structuredClone(seedLessons[0]));
    illustrated.problems[0].promptContent.push(still as never);
    expect(() => validateProblemSet(illustrated)).not.toThrow();
  });
});

describe('naming a colour for whoever is drawing', () => {
  it('has a word for every colour the palette offers, and none for one it does not', () => {
    for (const name of sceneColors) {
      expect(sceneColorLabels[name], name).toBeTruthy();
      // The key names the colour for the renderer; the label has to say something else.
      expect(sceneColorLabels[name], name).not.toBe(name);
    }
    expect(Object.keys(sceneColorLabels).sort()).toEqual([...sceneColors].sort());
  });
});

describe('general math drawing templates', () => {
  it('renders as supported content at multiple canvas sizes without a new schema', async () => {
    const { sceneTemplates, templateItems } = await import('@/shared/scene-templates');
    for (const size of [{width:320,height:200},{width:640,height:480}]) {
      for (const template of sceneTemplates) {
        const items = templateItems(template.key, size);
        expect(items.length).toBeGreaterThan(0);
        expect(() => checkLesson(withScene(items, size))).not.toThrow();
        for (const item of items) {
          const bounds = itemBounds(item);
          expect(bounds.x).toBeGreaterThanOrEqual(0);
          expect(bounds.y).toBeGreaterThanOrEqual(0);
          expect(bounds.x + bounds.width).toBeLessThanOrEqual(size.width);
          expect(bounds.y + bounds.height).toBeLessThanOrEqual(size.height);
        }
      }
    }
  });
});
