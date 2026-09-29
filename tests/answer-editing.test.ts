import { describe, expect, it } from 'vitest';
import { fractionSelection, replaceAnswerSelection } from '@/features/learning/answer-editing';

describe('editing written answers without changing their form', () => {
  it('replaces only the selected portion and keeps unreduced fractions', () => {
    expect(replaceAnswerSelection('12/24', fractionSelection('12/24', 'denominator')!, '36'))
      .toEqual({ value: '12/36', start: 5, end: 5 });
    expect(fractionSelection('-12/24', 'numerator')).toEqual({ start: 0, end: 3 });
    expect(fractionSelection('3/', 'denominator')).toEqual({ start: 2, end: 2 });
    expect(fractionSelection('0.5', 'denominator')).toBeNull();
  });
  it('clamps stale selections and keeps the server answer length limit', () => {
    expect(replaceAnswerSelection('1', { start: 5, end: 8 }, '2')).toEqual({ value: '12', start: 2, end: 2 });
    const full = '1'.repeat(80);
    expect(replaceAnswerSelection(full, { start: 80, end: 80 }, '2').value).toBe(full);
    expect(replaceAnswerSelection(full, { start: 0, end: 80 }, '3')).toEqual({ value: '3', start: 1, end: 1 });
  });
});
