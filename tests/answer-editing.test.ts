import { describe, expect, it } from 'vitest';
import { insertMathStructure, mathSlots, replaceAnswerSelection } from '@/features/learning/answer-editing';
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
