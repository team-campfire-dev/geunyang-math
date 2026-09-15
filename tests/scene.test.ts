import { describe, expect, it } from 'vitest';
import { validateClass } from '@/core/content';
import {
  createSceneItem, cssColor, emptyScene, isSceneColor, itemBounds, moveItem, pathPattern, reorderItem, resizeItem,
  sceneItemKinds, type SceneItem,
} from '@/shared/scene';
import { seedClasses } from './fixtures/content';

const sceneBlock = (items: unknown[], extra: Record<string, unknown> = {}) => ({
  blockId: 'fraction-meaning:explanation:scene:v2', kind: 'core.scene', typeVersion: 1, required: true,
  payload: { alt: '조각을 나란히 놓은 그림', width: 320, height: 200, items, ...extra },
});
const withScene = (items: unknown[], extra?: Record<string, unknown>) => {
  const record = structuredClone(seedClasses[0]);
  record.sections[0].contentBlocks.push(sceneBlock(items, extra) as never);
  return record;
};

describe('a drawing given as data', () => {
  it('accepts every shape the editor can place', () => {
    const scene = emptyScene();
    const items = sceneItemKinds.map((kind) => createSceneItem(kind, scene));
    expect(items.map((item) => item.kind)).toEqual(sceneItemKinds);
    expect(() => validateClass(withScene(items))).not.toThrow();
  });

  it('refuses anything in path data that is not a command or a number', () => {
    expect(pathPattern.test('M 0 0 L 10 10 Z')).toBe(true);
    expect(pathPattern.test('M0 0 url(#x)')).toBe(false);
    expect(() => validateClass(withScene([{ kind: 'path', d: 'M0 0 L10 10' }]))).not.toThrow();
    expect(() => validateClass(withScene([{ kind: 'path', d: 'M0 0 <script>' }]))).toThrow(/Invalid payload/);
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
    expect(() => validateClass(withScene([{ kind: 'rect', x: 0, y: 0, width: 10, height: 10, fill: 'expression(x)' }]))).toThrow(/Unknown colour/);
  });

  it('names the drawing in plain words and keeps math for the caption', () => {
    expect(() => validateClass(withScene([], { caption: '$\\frac{3}{4}$만큼' }))).not.toThrow();
    expect(() => validateClass(withScene([], { alt: '$\\frac{3}{4}$ 그림' }))).toThrow(/math markup/);
  });

  it('rejects a shape the renderer does not know and an unlisted field', () => {
    expect(() => validateClass(withScene([{ kind: 'spiral', x: 0, y: 0 }]))).toThrow(/Invalid payload/);
    expect(() => validateClass(withScene([{ kind: 'rect', x: 0, y: 0, width: 10, height: 10, onClick: 'boom' }]))).toThrow(/Invalid payload/);
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
