import { describe, expect, it } from 'vitest';
import { insertMathStructure, mathSlots, replaceAnswerSelection, moveMathSelection, enclosingMathStructure, unwrapMathStructure, deleteMathSelection, MathEditHistory } from '@/features/learning/answer-editing';
import { parseMathExpression } from '@/shared/math-expression';

describe('editing written answers without changing their form', () => {
  it('replaces only the selected portion and keeps unreduced fractions', () => {
    const slots = mathSlots(parseMathExpression('12/24')!);
    expect(replaceAnswerSelection('12/24', slots[1], '36'))
      .toEqual({ value: '12/36', start: 5, end: 5 });
    expect(insertMathStructure('12', { start: 2, end: 2 }, 'fraction')).toEqual({ value: '(12)/(□)', start: 6, end: 7 });
    const nested = 'sqrt(8)/(2^3)';
    expect(mathSlots(parseMathExpression(nested)!).map(slot => nested.slice(slot.start, slot.end))).toEqual(['8', '2', '3']);
  });
  it('clamps stale selections and keeps the server answer length limit', () => {
    expect(replaceAnswerSelection('1', { start: 5, end: 8 }, '2')).toEqual({ value: '12', start: 2, end: 2 });
    const full = '1'.repeat(80);
    expect(replaceAnswerSelection(full, { start: 80, end: 80 }, '2').value).toBe(full);
    expect(replaceAnswerSelection(full, { start: 0, end: 80 }, '3')).toEqual({ value: '3', start: 1, end: 1 });
  });
});

describe('structured cursor navigation and reversible editing', () => {
  it('visits the end of a nested root before leaving its numerator', () => {
    const value = '(sqrt(9))/(2)';
    expect(moveMathSelection(value, { start: 7, end: 7 }, 1)).toEqual({ start: 8, end: 8 });
    expect(replaceAnswerSelection(value, { start: 8, end: 8 }, '+1').value).toBe('(sqrt(9)+1)/(2)');
    expect(moveMathSelection(value, { start: 8, end: 8 }, 1)).toEqual({ start: 11, end: 11 });
    expect(moveMathSelection(value, { start: 13, end: 13 }, -1)).toEqual({ start: 12, end: 12 });
  });
  it('removes a root while retaining the grouped inner value and neighboring operations', () => {
    const value = '2*sqrt(3+4)';
    const node = enclosingMathStructure(value, { start: 7, end: 8 })!;
    expect(node.kind).toBe('root');
    expect(unwrapMathStructure(value, node).value).toBe('2*(3+4)');
  });
  it('retains the explicitly chosen fraction part and keeps the other draft in undo history', () => {
    const value = '(12)/(34)', selection = { start: 6, end: 8 };
    const node = enclosingMathStructure(value, selection)!;
    const next = unwrapMathStructure(value, node, 'right');
    expect(next.value).toBe('34');
    const history = new MathEditHistory();
    history.record({ value, ...selection }, next);
    expect(history.undo(next)).toEqual({ value, ...selection });
    expect(history.redo({ value, ...selection })).toEqual(next);
    history.undo(next);
    history.record({ value, ...selection }, { value: '2', start: 1, end: 1 });
    expect(history.canRedo).toBe(false);
  });
  it('preserves structural delimiters with backspace and forward deletion', () => {
    expect(deleteMathSelection('sqrt(9)', { start: 7, end: 7 })).toMatchObject({ value: 'sqrt(9)', start: 5, end: 6 });
    expect(deleteMathSelection('sqrt(9)', { start: 0, end: 0 }, true)).toMatchObject({ value: 'sqrt(9)', start: 5, end: 6 });
  });
});
