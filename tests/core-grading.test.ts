import { describe, expect, it } from 'vitest';
import { gradeAnswer } from '@/core/grading';
import { seedClasses } from './fixtures/content';

const half = { kind: 'rational' as const, numerator: 1, denominator: 2 };

describe('exact arithmetic grading', () => {
  it.each(['1/2', '2/4', '0.5', '.50', ' +3 / +6 ', '-2/-4', '1⁄2'])('accepts an equivalent rational answer: %s', (answer) => {
    expect(gradeAnswer(answer, half).status).toBe('correct');
  });

  it.each(['\\frac{1}{2}', '\\dfrac{1}{2}', '\\tfrac{2}{4}', '$\\frac{1}{2}$', '\\(\\frac{2}{4}\\)', '$$\\frac{1}{2}$$', '\\[\\frac{1}{2}\\]', '\\frac{-1}{-2}', ' \\frac{ 1 }{ 2 } '])('accepts the LaTeX an equation editor would emit: %s', (answer) => {
    expect(gradeAnswer(answer, half).status).toBe('correct');
  });

  it('treats LaTeX as notation only and never evaluates an expression', () => {
    for (const answer of ['\\frac{1+1}{4}', '\\frac{2}{2+2}', '\\frac{1}{2}+\\frac{0}{2}', '\\frac{\\frac{1}{2}}{1}', '\\sqrt{4}/4', '\\frac{a}{b}', '\\frac{1}{0}', '\\frac{1}{2}x']) {
      expect(gradeAnswer(answer, half).status, answer).toBe('invalid');
    }
  });

  it('applies the integer and reduced-fraction rules to LaTeX answers as well', () => {
    expect(gradeAnswer('\\frac{6}{2}', { kind: 'integer', value: 3 }).status).toBe('invalid');
    expect(gradeAnswer('$3$', { kind: 'integer', value: 3 }).status).toBe('correct');
    const reduced = { ...half, requiredForm: 'reduced_fraction' as const };
    expect(gradeAnswer('\\frac{1}{2}', reduced).status).toBe('correct');
    expect(gradeAnswer('\\frac{2}{4}', reduced).status).toBe('incorrect');
  });

  it('compares large exact rationals without JavaScript rounding', () => {
    expect(gradeAnswer('9007199254740993/18014398509481986', half).status).toBe('correct');
    expect(gradeAnswer('9007199254740992/18014398509481986', half).status).toBe('incorrect');
    expect(gradeAnswer('0.3333333333333333333333333333', { kind: 'rational', numerator: 1, denominator: 3 }).status).toBe('incorrect');
  });

  it('distinguishes equivalent values from a required reduced fraction', () => {
    const spec = { ...half, requiredForm: 'reduced_fraction' as const };
    expect(gradeAnswer('1/2', spec).status).toBe('correct');
    for (const answer of ['2/4', '0.5', '-1/-2']) {
      const result = gradeAnswer(answer, spec);
      expect(result.status).toBe('incorrect');
      expect(result.message).toContain('값은 맞아요');
    }
  });

  it('handles signs and zero while applying a positive denominator requirement', () => {
    const negative = { kind: 'rational' as const, numerator: -1, denominator: 2, requiredForm: 'reduced_fraction' as const };
    expect(gradeAnswer('−1/2', negative).status).toBe('correct');
    expect(gradeAnswer('1/-2', negative).status).toBe('incorrect');
    const zero = { kind: 'rational' as const, numerator: 0, denominator: 1, requiredForm: 'reduced_fraction' as const };
    expect(gradeAnswer('0/1', zero).status).toBe('correct');
    expect(gradeAnswer('0/2', zero).status).toBe('incorrect');
    expect(gradeAnswer('-0.0', { kind: 'integer', value: 0 }).status).toBe('invalid');
    expect(gradeAnswer('-0', { kind: 'integer', value: 0 }).status).toBe('correct');
  });

  it.each(['', '   ', '1/0', '0/0', '1/-0', '1//2', '1/2/3', '1e3', 'Infinity', 'NaN', 'Math.random()', '1 + 1', '1 1/2', '0,5', 'hello', '1'.repeat(81)])('rejects malformed input without counting it as an incorrect mathematical answer: %s', (answer) => {
    expect(gradeAnswer(answer, half).status).toBe('invalid');
  });

  it('separates a valid but wrong value from invalid integer formatting', () => {
    expect(gradeAnswer('3', { kind: 'integer', value: 4 }).status).toBe('incorrect');
    expect(gradeAnswer('4/1', { kind: 'integer', value: 4 }).status).toBe('invalid');
    expect(gradeAnswer('+004', { kind: 'integer', value: 4 }).status).toBe('correct');
  });

  it('preserves whether a hint was used for both correct and invalid attempts', () => {
    expect(gradeAnswer('1/2', half, true)).toMatchObject({ status: 'correct', assisted: true });
    expect(gradeAnswer('?', half, true)).toMatchObject({ status: 'invalid', assisted: true });
    expect(gradeAnswer('2/3', half)).toMatchObject({ status: 'incorrect', assisted: false });
  });

  it('rejects invalid private specifications instead of silently grading against NaN', () => {
    expect(() => gradeAnswer('1/2', { kind: 'rational', numerator: 1, denominator: 0 })).toThrow(/Invalid rational/);
    expect(() => gradeAnswer('1', { kind: 'integer', value: 1.2 })).toThrow(/Invalid integer/);
  });

  it('can grade the canonical answer for every published sample question', () => {
    for (const record of seedClasses) for (const problem of record.problems) {
      const spec = problem.gradingSpec;
      const answer = spec.kind === 'integer' ? String(spec.value) : `${spec.numerator}/${spec.denominator}`;
      expect(gradeAnswer(answer, spec).status, problem.problemVersionId).toBe('correct');
    }
  });
});
