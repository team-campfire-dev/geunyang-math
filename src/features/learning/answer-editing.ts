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
  let { start, end } = selection;
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
