import { describe, expect, it } from 'vitest';
import { parseMathExpression, readMathExpression, sameMathValue, rationalMathValue, mathValueKey } from '@/shared/math-expression';
import { answerSpec, answerText, misreadingsIssue, matchMisreading } from '@/shared/answer';
import { gradeAnswer } from '@/core/grading';

const read = (text: string) => { const result = readMathExpression(text); expect(result.issue, text).toBeUndefined(); return result.value!; };
describe('bounded exact real arithmetic', () => {
  it.each([
    ['sqrt(8)', '2sqrt(2)'], ['sqrt(1/2)', 'sqrt(2)/2'], ['1/(sqrt(2)+sqrt(3))', 'sqrt(3)-sqrt(2)'],
    ['(sqrt(2)+sqrt(3))^2', '5+2sqrt(6)'], ['(1+sqrt(2))/(1-sqrt(2))', '-3-2sqrt(2)'],
    ['2^3^2', '512'], ['-2^2', '-4'], ['(-2)^2', '4'], ['2^-3', '1/8'], ['sqrt(sqrt(16))', '2'],
    ['0.1+0.2', '0.3'], ['√18/√2', '3'], ['2(3+4)', '14'], ['sqrt(2)*sqrt(8)', '4'],
    ['1/(1+sqrt(2)+sqrt(3)+sqrt(6))', '(1-sqrt(2))*(1-sqrt(3))/2'],
  ])('recognizes %s = %s without a tolerance', (a, b) => {
    expect(sameMathValue(read(a), read(b))).toBe(true);
  });
  it('does not turn near answers into equal answers', () => {
    expect(sameMathValue(read('sqrt(2)'), read('1.4142135623730951'))).toBe(false);
    expect(rationalMathValue(read('sqrt(2)'))).toBeNull();
    expect(rationalMathValue(read('(sqrt(2))^2'))).toEqual({ numerator: 2n, denominator: 1n });
  });
  it.each(['1/0', '0/0', '1/(sqrt(2)-sqrt(2))', 'sqrt(-1)', '0^0', '2^100000000', '2^(1/2)', 'sqrt(1+sqrt(2))',
    'process.exit()', 'globalThis', '1;2', 'Math.sqrt(4)', 'NaN', 'Infinity', '□/2', 'sqrt()', '2**3', '('.repeat(40)+'1'+')'.repeat(40), '9'.repeat(81)])('rejects invalid or unbounded input: %s', value => {
    expect(readMathExpression(value).value).toBeUndefined();
  });
  it('keeps editable holes out of the grader', () => {
    expect(parseMathExpression('sqrt(□)/(2^□)', true)).not.toBeNull();
    expect(parseMathExpression('sqrt(□)/(2^□)')).toBeNull();
  });
  it('groups equivalent radical answers and applies named misconceptions by exact value', () => {
    const spec = { kind: 'expression' as const, expression: 'sqrt(2)' };
    const entries = [{ answer: 'sqrt(8)', misconception: 'example' }];
    expect(mathValueKey(read('1+sqrt(8)'))).toBe(mathValueKey(read('2sqrt(2)+1')));
    expect(matchMisreading('2sqrt(2)', spec, entries)).toBe('example');
    expect(misreadingsIssue(spec, entries, () => true)).toBeNull();
    expect(misreadingsIssue(spec, [...entries, { ...entries[0], answer: '2sqrt(2)' }], () => true)).toMatch(/같은 값/);
    expect(misreadingsIssue(spec, [{ ...entries[0], answer: 'sqrt(8)/2' }], () => true)).toMatch(/맞는 답/);
  });
  it('authors and grades expressions and preserves existing explicit form requirements', () => {
    const spec = answerSpec('sqrt(8)')!;
    expect(spec).toEqual({ kind: 'expression', expression: 'sqrt(8)' });
    expect(answerText(spec)).toBe('sqrt(8)');
    expect(gradeAnswer('2sqrt(2)', spec).status).toBe('correct');
    expect(gradeAnswer('1.414', spec).status).toBe('incorrect');
    expect(gradeAnswer('sqrt(4)/4', { kind: 'rational', numerator: 1, denominator: 2 }).status).toBe('correct');
    expect(gradeAnswer('sqrt(4)/4', { kind: 'rational', numerator: 1, denominator: 2, requiredForm: 'reduced_fraction' }).status).toBe('incorrect');
    expect(gradeAnswer('6/2', { kind: 'integer', value: 3 }).status).toBe('invalid');
  });
});
