import { parseMathExpression, type MathNode } from '@/shared/math-expression';
/** Editing preserves the written answer (and therefore the grader's form requirements). */
export type AnswerSelection = { start: number; end: number };
export function replaceAnswerSelection(value: string, selection: AnswerSelection, inserted: string) {
  const start = Math.max(0, Math.min(selection.start, value.length));
  const end = Math.max(start, Math.min(selection.end, value.length));
  const next = value.slice(0, start) + inserted + value.slice(end);
  return next.length > 80 ? { value, ...selection } : { value: next, start: start + inserted.length, end: start + inserted.length };
}
export function insertMathStructure(value: string, selection: AnswerSelection, kind: 'fraction' | 'power' | 'root' | 'group') {
  let start = Math.max(0, Math.min(selection.start, value.length));
  let end = Math.max(start, Math.min(selection.end, value.length));
  const tree = parseMathExpression(value, true);
  const leaves = tree ? mathSlots(tree) : [];
  if (start === end) {
    const leaf = leaves.find(node => start >= node.start && start <= node.end);
    if (leaf) { start = leaf.start; end = leaf.end; }
  }
  const selected = value.slice(start, end).replace(/^□$/, '');
  let text: string, target: number, width: number;
  if (kind === 'fraction' || kind === 'power') {
    text = `(${selected || '□'})${kind === 'fraction' ? '/' : '^'}(□)`;
    target = selected ? text.lastIndexOf('□') : 1; width = 1;
  } else {
    const prefix = kind === 'root' ? 'sqrt(' : '(';
    text = `${prefix}${selected || '□'})`; target = prefix.length; width = (selected || '□').length;
  }
  const next = value.slice(0, start) + text + value.slice(end);
  return next.length > 80 ? null : { value: next, start: start + target, end: start + target + width };
}

export function mathSlots(node: MathNode): MathNode[] {
  if (node.kind === 'hole' || node.kind === 'number') return [node];
  return node.kind === 'binary' ? [...mathSlots(node.left), ...mathSlots(node.right)] : mathSlots(node.child);
}

export type MathEdit = AnswerSelection & { value: string };
const ungroup = (node: MathNode): MathNode => node.kind === 'group' ? node.child : node;
const children = (node: MathNode): MathNode[] => node.kind === 'binary' ? [node.left, node.right]
  : 'child' in node ? [node.child] : [];

/** Visible boundaries, not the letters of sqrt or the editor's hidden parentheses. */
export function mathCursorStops(node: MathNode): number[] {
  const points = new Set<number>();
  function visit(current: MathNode) {
    points.add(current.start); points.add(current.end);
    if (current.kind === 'number') for (let i = current.start; i <= current.end; i++) points.add(i);
    else if (current.kind === 'root') visit(ungroup(current.child));
    else if (current.kind === 'binary' && (current.op === '/' || current.op === '^')) {
      visit(current.op === '/' ? ungroup(current.left) : current.left); visit(ungroup(current.right));
    } else children(current).forEach(visit);
  }
  visit(node); return [...points].sort((a, b) => a - b);
}
export function moveMathSelection(value: string, range: AnswerSelection, direction: -1 | 1): AnswerSelection {
  if (range.start !== range.end) { const point = direction < 0 ? range.start : range.end; return { start: point, end: point }; }
  const tree = parseMathExpression(value, true);
  const points = tree ? mathCursorStops(tree) : Array.from({ length: value.length + 1 }, (_, i) => i);
  const point = direction < 0 ? [...points].reverse().find(at => at < range.start) : points.find(at => at > range.end);
  if (point === undefined) return range;
  const hole = tree && mathSlots(tree).find(node => node.kind === 'hole' && node.start === point);
  return hole || { start: point, end: point };
}

/** Prefer the semantic structure over parentheses inserted to serialize its slots. */
export function enclosingMathStructure(value: string, range: AnswerSelection): MathNode | null {
  const tree = parseMathExpression(value, true);
  if (!tree) return null;
  function find(node: MathNode): MathNode | null {
    if (range.start < node.start || range.end > node.end) return null;
    const nested = node.kind === 'root' ? [ungroup(node.child)]
      : node.kind === 'binary' && (node.op === '/' || node.op === '^') ? [ungroup(node.left), ungroup(node.right)] : children(node);
    for (const child of nested) { const found = find(child); if (found) return found; }
    return node.kind === 'root' || node.kind === 'group' || (node.kind === 'binary' && (node.op === '/' || node.op === '^')) ? node : null;
  }
  return find(tree);
}
export function unwrapMathStructure(value: string, node: MathNode, side: 'left' | 'right' = 'left'): MathEdit {
  const child = ungroup(node.kind === 'binary' ? node[side] : 'child' in node ? node.child : node);
  const content = value.slice(child.start, child.end);
  // Keep sums grouped when removing an outer root or fraction, so adjoining operations retain scope.
  const kept = child.kind === 'binary' && node.kind !== 'group' ? `(${content})` : content;
  const next = value.slice(0, node.start) + kept + value.slice(node.end);
  return { value: next, start: node.start, end: node.start + kept.length };
}
export function deleteMathSelection(value: string, range: AnswerSelection, forward = false): MathEdit {
  const tree = parseMathExpression(value, true);
  const slots = tree ? mathSlots(tree) : [];
  if (range.start === range.end && tree) {
    const inside = slots.find(node => node.kind === 'number' && (forward ? range.start >= node.start && range.start < node.end : range.start > node.start && range.start <= node.end));
    const adjacent = value[range.start + (forward ? 0 : -1)];
    // Delete ordinary digits/operators; stepping across a bracket instead moves to its contents.
    if (!inside && adjacent && !/[+\-*×÷]/.test(adjacent)) {
      const candidates = slots.filter(node => node.start !== range.start || node.end !== range.end);
      const target = forward ? candidates.find(node => node.start >= range.start) : [...candidates].reverse().find(node => node.end <= range.start);
      return { value, ...(target ?? range) };
    }
  }
  return replaceAnswerSelection(value, range.start !== range.end ? range : {
    start: forward ? range.start : Math.max(0, range.start - 1),
    end: forward ? Math.min(value.length, range.end + 1) : range.end,
  }, '');
}

/** History is local to one answer; both the value and selected slot travel together. */
export class MathEditHistory {
  private past: MathEdit[] = [];
  private future: MathEdit[] = [];
  get canUndo() { return this.past.length > 0; }
  get canRedo() { return this.future.length > 0; }
  record(before: MathEdit, after: MathEdit) {
    if (before.value === after.value) return;
    this.past.push({ ...before }); this.past = this.past.slice(-100); this.future = [];
  }
  undo(current: MathEdit): MathEdit | null {
    const previous = this.past.pop(); if (!previous) return null;
    this.future.push({ ...current }); return previous;
  }
  redo(current: MathEdit): MathEdit | null {
    const next = this.future.pop(); if (!next) return null;
    this.past.push({ ...current }); return next;
  }
}
