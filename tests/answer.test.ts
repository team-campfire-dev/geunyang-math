import { describe, expect, it } from 'vitest';
import { answerSpec, answerText, parseAnswer } from '@/shared/answer';
import { gradeAnswer } from '@/core/grading';

describe('reading the answer an author wrote', () => {
  it('lets the written form decide what the question expects', () => {
    // A whole number asks for a whole number; a fraction or a decimal accepts an equivalent value.
    expect(answerSpec('3')).toEqual({ kind: 'integer', value: 3 });
    expect(answerSpec('-7')).toEqual({ kind: 'integer', value: -7 });
    expect(answerSpec('1/2')).toEqual({ kind: 'rational', numerator: 1, denominator: 2 });
    expect(answerSpec('2/4')).toEqual({ kind: 'rational', numerator: 1, denominator: 2 });
    expect(answerSpec('0.5')).toEqual({ kind: 'rational', numerator: 1, denominator: 2 });
    expect(answerSpec('3/-4')).toEqual({ kind: 'rational', numerator: -3, denominator: 4 });
  });

  it('carries a form requirement only where a form exists', () => {
    expect(answerSpec('1/2', 'reduced_fraction')).toEqual({ kind: 'rational', numerator: 1, denominator: 2, requiredForm: 'reduced_fraction' });
    // A whole number has no fraction to reduce, so the requirement is dropped rather than stored.
    expect(answerSpec('3', 'reduced_fraction')).toEqual({ kind: 'integer', value: 3 });
  });

  it('refuses what it cannot read rather than guessing', () => {
    for (const input of ['', ' ', '1/0', 'x', '1 + 1', '\\frac{1+1}{2}', '1/2/3']) {
      expect(answerSpec(input), input).toBeNull();
    }
  });

  it('writes back what it read, so opening a question shows the answer it holds', () => {
    for (const written of ['3', '-7', '1/2', '5/4']) expect(answerText(answerSpec(written)!)).toBe(written);
    // What an author typed is stored in its smallest equal form, and reads back that way.
    expect(answerText(answerSpec('2/4')!)).toBe('1/2');
  });

  it('accepts the answer its author wrote, in the forms a learner may write it', () => {
    const spec = answerSpec('2/4')!;
    for (const answer of ['1/2', '2/4', '0.5', '$\\frac{1}{2}$']) {
      expect(gradeAnswer(answer, spec).status, answer).toBe('correct');
    }
    const reduced = answerSpec('2/4', 'reduced_fraction')!;
    expect(gradeAnswer('2/4', reduced).status).toBe('incorrect');
    expect(gradeAnswer('1/2', reduced).status).toBe('correct');
    // A question written with a whole number turns down an equal fraction, which is the point of it.
    expect(gradeAnswer('6/2', answerSpec('3')!).status).toBe('invalid');
  });

  it('reads the same string the grader reads', () => {
    expect(parseAnswer('$\\frac{3}{4}$')).toMatchObject({ numerator: 3n, denominator: 4n, fraction: true, reduced: true });
    expect(parseAnswer('−3')).toMatchObject({ numerator: -3n, denominator: 1n });
  });
});
