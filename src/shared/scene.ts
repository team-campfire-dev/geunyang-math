// A drawing described as data rather than as markup. The publishing validator, the learner's
// renderer and the editor's canvas all read these rules, so a picture that saves is a picture that
// draws. Nothing here becomes markup: every value lands in an attribute of an element we create,
// which is what lets an authoring tool — or later a generator — emit a drawing safely.

export const sceneLimits = {
  minSize: 20, maxSize: 2000, defaultWidth: 320, defaultHeight: 200,
  maxItems: 120, maxPoints: 60, maxPath: 2_000, maxText: 120,
  minStroke: 0.25, maxStroke: 20, minFontSize: 4, maxFontSize: 96,
} as const;

/** Palette names keep a drawing in the app's own colours, in both themes. A hex value is allowed
 *  for the cases a name cannot express; both are validated, neither is free-form markup. */
export const scenePalette = {
  ink: 'var(--ink)', muted: 'var(--muted)', line: 'var(--line)', paper: 'var(--paper)', white: 'var(--white)',
  green: 'var(--green)', 'deep-green': 'var(--deep-green)', 'light-green': 'var(--light-green)', orange: 'var(--orange)',
  // The strip's own greens, so a scene can match a fraction figure beside it.
  fill: '#8daa69', 'fill-soft': '#e5ecd7', sand: '#f0e3cd', sky: '#d4e0e6', none: 'none',
} as const;
export type SceneColor = keyof typeof scenePalette;
export const sceneColors = Object.keys(scenePalette) as SceneColor[];
const hex = /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/;
export const isSceneColor = (value: unknown): value is string =>
  typeof value === 'string' && (value in scenePalette || hex.test(value));
/** Resolves to a CSS colour. An unknown name draws nothing rather than guessing a colour. */
export const cssColor = (value: string | undefined, fallback = 'none') =>
  value === undefined ? fallback : value in scenePalette ? scenePalette[value as SceneColor] : hex.test(value) ? value : fallback;

/** Only path data: commands and numbers. No markup, no references, no expressions. */
export const pathPattern = /^[MmLlHhVvCcSsQqTtAaZz0-9,.\-+eE\s]+$/;

export type ScenePoint = [number, number];
// `id` exists so a frame can name the shape it moves. Only animated drawings need one.
type Shared = { id?: string; fill?: string; stroke?: string; strokeWidth?: number; dash?: boolean; opacity?: number; rotate?: number };
export type SceneItem =
  | ({ kind: 'rect'; x: number; y: number; width: number; height: number; radius?: number } & Shared)
  | ({ kind: 'ellipse'; cx: number; cy: number; rx: number; ry: number } & Shared)
  | ({ kind: 'line'; x1: number; y1: number; x2: number; y2: number; arrow?: 'none' | 'end' | 'both' } & Shared)
  | ({ kind: 'polygon'; points: ScenePoint[]; closed?: boolean } & Shared)
  | ({ kind: 'path'; d: string } & Shared)
  | ({ kind: 'text'; x: number; y: number; text: string; size?: number; anchor?: 'start' | 'middle' | 'end'; weight?: 'regular' | 'bold' } & Shared)
  // A fraction bar as one shape. It was its own block before; inside a drawing it can sit beside
  // anything else, which is why the blocks that could only ever draw a bar were retired.
  | ({ kind: 'strip'; x: number; y: number; width: number; height: number; parts: number; filled: number } & Shared);
export type SceneItemKind = SceneItem['kind'];
/** What one frame does to one shape. A change is a difference from the drawing, never a new shape,
 *  so an animation cannot smuggle in anything the still drawing was not allowed to contain. */
export type SceneChange = { id: string; dx?: number; dy?: number; opacity?: number; rotate?: number; fill?: string; hidden?: boolean };
export type SceneFrame = { caption?: string; changes: SceneChange[] };
export type Scene = { width: number; height: number; items: SceneItem[]; frames?: SceneFrame[] };
export const itemIdPattern = /^[A-Za-z0-9_-]{1,40}$/;

export const sceneItemKinds: SceneItemKind[] = ['rect', 'ellipse', 'line', 'polygon', 'path', 'text', 'strip'];
export const sceneItemLabels: Record<SceneItemKind, string> = {
  rect: '사각형', ellipse: '원', line: '선', polygon: '다각형', path: '자유 곡선', text: '글자', strip: '분수 막대',
};
export const stripLimits = { minParts: 1, maxParts: 100 } as const;

/** A new shape lands in the middle of the canvas at a size that is visible without editing. */
export function createSceneItem(kind: SceneItemKind, scene: Scene): SceneItem {
  const cx = Math.round(scene.width / 2);
  const cy = Math.round(scene.height / 2);
  const unit = Math.max(8, Math.round(Math.min(scene.width, scene.height) / 5));
  switch (kind) {
    case 'rect': return { kind, x: cx - unit, y: cy - unit / 2, width: unit * 2, height: unit, fill: 'fill-soft', stroke: 'fill', strokeWidth: 1, radius: 2 };
    case 'ellipse': return { kind, cx, cy, rx: unit, ry: unit, fill: 'fill-soft', stroke: 'fill', strokeWidth: 1 };
    case 'line': return { kind, x1: cx - unit, y1: cy, x2: cx + unit, y2: cy, stroke: 'ink', strokeWidth: 1.5, arrow: 'end' };
    case 'polygon': return { kind, points: [[cx, cy - unit], [cx + unit, cy + unit], [cx - unit, cy + unit]], closed: true, fill: 'sand', stroke: 'ink', strokeWidth: 1 };
    case 'path': return { kind, d: `M ${cx - unit} ${cy} Q ${cx} ${cy - unit} ${cx + unit} ${cy}`, fill: 'none', stroke: 'ink', strokeWidth: 1.5 };
    case 'text': return { kind, x: cx, y: cy, text: '설명', size: 14, anchor: 'middle', fill: 'ink' };
    case 'strip': return { kind, x: cx - unit * 2, y: cy - unit / 2, width: unit * 4, height: unit, parts: 4, filled: 3, fill: 'fill', stroke: 'fill-soft', strokeWidth: 1 };
  }
}

export const emptyScene = (): Scene => ({ width: sceneLimits.defaultWidth, height: sceneLimits.defaultHeight, items: [] });

/** A shape only needs a name once something refers to it, so ids are handed out on first use. */
export function nameItem(items: SceneItem[], index: number): { items: SceneItem[]; id: string } {
  const existing = items[index]?.id;
  if (existing) return { items, id: existing };
  const taken = new Set(items.map((item) => item.id).filter(Boolean));
  let id = `s${index + 1}`;
  for (let suffix = 2; taken.has(id); suffix++) id = `s${index + 1}-${suffix}`;
  return { items: items.map((item, position) => (position === index ? { ...item, id } : item)), id };
}

export const changeFor = (frame: SceneFrame | undefined, item: SceneItem) =>
  item.id ? frame?.changes.find((change) => change.id === item.id) : undefined;

/** Writes one shape's change into one frame, replacing whatever that frame said about it. */
export function setChange(frames: SceneFrame[], frameIndex: number, id: string, patch: Partial<Omit<SceneChange, 'id'>>): SceneFrame[] {
  return frames.map((frame, position) => {
    if (position !== frameIndex) return frame;
    const current = frame.changes.find((change) => change.id === id) ?? { id };
    const next = { ...current, ...patch };
    const rest = frame.changes.filter((change) => change.id !== id);
    // A change back to the drawing's own state is no change at all, so it stops being stored.
    const meaningful = next.dx || next.dy || next.opacity !== undefined || next.rotate !== undefined || next.fill !== undefined || next.hidden;
    return { ...frame, changes: meaningful ? [...rest, next] : rest };
  });
}

export const emptyFrames = (): SceneFrame[] => [{ changes: [] }, { changes: [] }];
export const snap = (value: number, step = 1) => Math.round(value / step) * step;
const round = (value: number) => Math.round(value * 100) / 100;

/** The box a shape occupies, used for selection outlines and for keeping a drag on the canvas. */
export function itemBounds(item: SceneItem): { x: number; y: number; width: number; height: number } {
  switch (item.kind) {
    case 'rect': case 'strip': return { x: item.x, y: item.y, width: item.width, height: item.height };
    case 'ellipse': return { x: item.cx - item.rx, y: item.cy - item.ry, width: item.rx * 2, height: item.ry * 2 };
    case 'line': return { x: Math.min(item.x1, item.x2), y: Math.min(item.y1, item.y2), width: Math.abs(item.x2 - item.x1), height: Math.abs(item.y2 - item.y1) };
    case 'polygon': {
      const xs = item.points.map(([x]) => x), ys = item.points.map(([, y]) => y);
      return { x: Math.min(...xs), y: Math.min(...ys), width: Math.max(...xs) - Math.min(...xs), height: Math.max(...ys) - Math.min(...ys) };
    }
    case 'path': {
      const numbers = item.d.match(/-?\d+(?:\.\d+)?/g)?.map(Number) ?? [];
      const xs = numbers.filter((_, index) => index % 2 === 0), ys = numbers.filter((_, index) => index % 2 === 1);
      if (!xs.length || !ys.length) return { x: 0, y: 0, width: 0, height: 0 };
      return { x: Math.min(...xs), y: Math.min(...ys), width: Math.max(...xs) - Math.min(...xs), height: Math.max(...ys) - Math.min(...ys) };
    }
    case 'text': {
      const size = item.size ?? 14;
      const width = item.text.length * size * 0.62;
      const left = item.anchor === 'middle' ? item.x - width / 2 : item.anchor === 'end' ? item.x - width : item.x;
      return { x: left, y: item.y - size, width, height: size * 1.25 };
    }
  }
}

/** Moving is the same gesture for every shape, so every shape moves through one function. */
export function moveItem(item: SceneItem, dx: number, dy: number): SceneItem {
  const shift = (x: number, y: number) => [round(x + dx), round(y + dy)] as const;
  switch (item.kind) {
    case 'rect': case 'strip': { const [x, y] = shift(item.x, item.y); return { ...item, x, y }; }
    case 'ellipse': { const [cx, cy] = shift(item.cx, item.cy); return { ...item, cx, cy }; }
    case 'line': { const [x1, y1] = shift(item.x1, item.y1); const [x2, y2] = shift(item.x2, item.y2); return { ...item, x1, y1, x2, y2 }; }
    case 'polygon': return { ...item, points: item.points.map(([x, y]) => [round(x + dx), round(y + dy)] as ScenePoint) };
    case 'text': { const [x, y] = shift(item.x, item.y); return { ...item, x, y }; }
    case 'path': {
      let index = -1;
      // Path numbers alternate x and y; shifting them moves the curve without reading its commands.
      const d = item.d.replace(/-?\d+(?:\.\d+)?/g, (match) => String(round(Number(match) + (++index % 2 === 0 ? dx : dy))));
      return { ...item, d };
    }
  }
}

/** Dragging the corner handle. A shape without a box of its own scales around its own bounds. */
export function resizeItem(item: SceneItem, width: number, height: number): SceneItem {
  const bounds = itemBounds(item);
  const next = { width: Math.max(1, round(width)), height: Math.max(1, round(height)) };
  switch (item.kind) {
    case 'rect': case 'strip': return { ...item, width: next.width, height: next.height };
    case 'ellipse': return { ...item, rx: round(next.width / 2), ry: round(next.height / 2), cx: round(bounds.x + next.width / 2), cy: round(bounds.y + next.height / 2) };
    case 'line': return { ...item, x2: round(item.x1 + (item.x2 >= item.x1 ? next.width : -next.width)), y2: round(item.y1 + (item.y2 >= item.y1 ? next.height : -next.height)) };
    case 'text': return { ...item, size: Math.min(sceneLimits.maxFontSize, Math.max(sceneLimits.minFontSize, round(next.height))) };
    case 'polygon': {
      const scaleX = bounds.width ? next.width / bounds.width : 1;
      const scaleY = bounds.height ? next.height / bounds.height : 1;
      return { ...item, points: item.points.map(([x, y]) => [round(bounds.x + (x - bounds.x) * scaleX), round(bounds.y + (y - bounds.y) * scaleY)] as ScenePoint) };
    }
    case 'path': {
      const scaleX = bounds.width ? next.width / bounds.width : 1;
      const scaleY = bounds.height ? next.height / bounds.height : 1;
      let index = -1;
      const d = item.d.replace(/-?\d+(?:\.\d+)?/g, (match) => {
        const value = Number(match);
        return String(++index % 2 === 0 ? round(bounds.x + (value - bounds.x) * scaleX) : round(bounds.y + (value - bounds.y) * scaleY));
      });
      return { ...item, d };
    }
  }
}

/** Later items draw on top, so ordering the list is what puts a shape in front. */
export function reorderItem(items: SceneItem[], index: number, delta: number): SceneItem[] {
  const target = index + delta;
  if (index < 0 || index >= items.length || target < 0 || target >= items.length) return items;
  const next = [...items];
  [next[index], next[target]] = [next[target], next[index]];
  return next;
}

// Frame playback. A drawing that moves is the same drawing under a sequence of changes.
export const frameLimits = { minFrames: 2, maxFrames: 12, minMs: 400, maxMs: 6000, defaultMs: 1400 } as const;
/**
 * Playback stops on the last frame unless the author asked for a loop. The caller compares the
 * result with the index it passed to notice the end, so stopping never needs a second rule.
 */
export function nextFrameIndex(index: number, total: number, loop: boolean): number {
  if (index + 1 < total) return index + 1;
  return loop ? 0 : index;
}

/** Stepping by hand never wraps: back on the first frame and forward on the last stay put. */
export function stepFrameIndex(index: number, total: number, delta: number): number {
  return Math.min(Math.max(index + delta, 0), Math.max(total - 1, 0));
}
