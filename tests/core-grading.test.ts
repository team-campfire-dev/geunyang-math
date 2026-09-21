import { describe, expect, it } from 'vitest';
import { gradeAnswer } from '@/core/grading';
import { seedLessons, writtenAnswer } from './fixtures/content';

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

  it('grades a picked answer by which option it names, not by what the option says', () => {
    const options = [{ id: 'a', text: '$2x$' }, { id: 'b', text: '$2x$' }, { id: 'c', text: '$x^2$' }];
    const spec = { kind: 'choice' as const, options, correct: 'b' };
    // Two options read alike here on purpose: only the name decides, so the first is still wrong.
    expect(gradeAnswer('b', spec).status).toBe('correct');
    expect(gradeAnswer('a', spec).status).toBe('incorrect');
    expect(gradeAnswer(' b ', spec).status, '앞뒤 공백').toBe('correct');
    // Anything that is not an option is not an answer to this question at all.
    for (const written of ['d', '', '2x', '1']) expect(gradeAnswer(written, spec).status, written).toBe('invalid');
    expect(gradeAnswer('b', spec, true)).toMatchObject({ status: 'correct', assisted: true });
  });

  it('says where a wrong answer looks like it went wrong', () => {
    const say = (answer: string, spec: Parameters<typeof gradeAnswer>[1]) => gradeAnswer(answer, spec).message;
    // The size is right and the sign is not.
    expect(say('5', { kind: 'integer', value: -5 })).toContain('부호');
    expect(say('1/2', { kind: 'rational', numerator: -1, denominator: 2 })).toContain('부호');
    // Upside down, which is only said about an answer that is a fraction to begin with.
    expect(say('4/3', { kind: 'rational', numerator: 3, denominator: 4 })).toContain('분자와 분모');
    expect(say('0.25', { kind: 'integer', value: 4 })).not.toContain('분자와 분모');
    // Right digits, wrong place. A hundred apart is the one worth naming for what it usually is.
    expect(say('25', { kind: 'rational', numerator: 1, denominator: 4 })).toContain('백 배');
    expect(say('0.0025', { kind: 'rational', numerator: 1, denominator: 4 })).toContain('백 배');
    expect(say('240', { kind: 'integer', value: 24 })).toContain('열 배');
    expect(say('2.4', { kind: 'rational', numerator: 24, denominator: 1 })).toContain('열 배');
    // A question that wants a whole number refuses a decimal before any of this, and says so.
    expect(say('2.4', { kind: 'integer', value: 24 })).toContain('정수로 답해 주세요');
    // One too many or one too few, and only between whole numbers.
    expect(say('7', { kind: 'integer', value: 6 })).toContain('셈이');
    expect(say('1/3', { kind: 'rational', numerator: 1, denominator: 2 })).not.toContain('셈이');
    // Anything it cannot read stays the sentence it always was.
    expect(say('7', { kind: 'integer', value: 31 })).toContain('아직 답이 맞지 않아요');
  });

  it('never reads a wrong answer as a slip it is not', () => {
    // Zero has no reciprocal; cross-multiplying against one would otherwise match every answer.
    const zero = { kind: 'rational' as const, numerator: 0, denominator: 2 };
    expect(gradeAnswer('7/9', zero).message).toContain('아직 답이 맞지 않아요');
    // Sign is read before the rest, so -6 against 6 is one thing and not a miscount of twelve.
    expect(gradeAnswer('-6', { kind: 'integer', value: 6 }).message).toContain('부호');
    // A value that is right in a form that is not is still the form message, not a misreading.
    expect(gradeAnswer('2/4', { ...half, requiredForm: 'reduced_fraction' as const }).message).toContain('값은 맞아요');
    // And none of this turns a wrong answer into a right one, or marks it as helped.
    expect(gradeAnswer('5', { kind: 'integer', value: -5 })).toMatchObject({ status: 'incorrect', assisted: false });
  });

  it('says the mistake the question was built to catch, ahead of any shape it could guess', () => {
    const named = [{ answer: '2/8', misconception: 'add-denominators' }];
    const twoThirds = { kind: 'rational' as const, numerator: 2, denominator: 3 };
    const told = gradeAnswer('2/8', twoThirds, false, named);
    expect(told).toMatchObject({ status: 'incorrect', misconception: 'add-denominators' });
    expect(told.message).toBe('분모가 조각의 크기라는 것을 지나치고 위아래를 따로 더해요.');
    // Value, not spelling: the same wrong answer written as a decimal is the same mistake.
    expect(gradeAnswer('0.25', twoThirds, false, named).misconception).toBe('add-denominators');
    // A wrong answer nobody named falls back to exactly what it said before.
    expect(gradeAnswer('7/9', twoThirds, false, named).misconception).toBeUndefined();
    // The author beats the general rule, and the guess is not also recorded beside it.
    const tenfold = gradeAnswer('3', { kind: 'integer', value: 30 }, false, [{ answer: '3', misconception: 'percent-place-value' }]);
    expect(tenfold).toMatchObject({ misconception: 'percent-place-value' });
    expect(tenfold.misreading).toBeUndefined();
    expect(gradeAnswer('3', { kind: 'integer', value: 30 })).toMatchObject({ misreading: 'tenfold' });
  });

  it('names a picked answer too, and never names the right one', () => {
    const spec = { kind: 'choice' as const, correct: 'b',
      options: [{ id: 'a', text: '$\\frac{2}{5}$' }, { id: 'b', text: '$\\frac{5}{6}$' }, { id: 'c', text: '$\\frac{1}{5}$' }] };
    const named = [{ answer: 'a', misconception: 'add-denominators' }];
    expect(gradeAnswer('a', spec, false, named)).toMatchObject({ status: 'incorrect', misconception: 'add-denominators' });
    // An option nobody named is still only wrong, and the right one is still right.
    expect(gradeAnswer('c', spec, false, named).misconception).toBeUndefined();
    expect(gradeAnswer('c', spec, false, named).message).toContain('보기를 하나씩');
    expect(gradeAnswer('b', spec, false, named)).toMatchObject({ status: 'correct' });
  });

  it('ignores a name it does not know rather than showing the learner a key', () => {
    const result = gradeAnswer('5', { kind: 'integer', value: 6 }, false, [{ answer: '5', misconception: 'no-such-thing' }]);
    expect(result.misconception).toBeUndefined();
    // Publication refuses an unknown key; a record written before one was renamed still marks.
    expect(result.status).toBe('incorrect');
    expect(result.message).toContain('셈이');
  });

  it('can grade the canonical answer for every published sample question', () => {
    for (const record of seedLessons) for (const problem of record.problems) {
      expect(gradeAnswer(writtenAnswer(problem), problem.gradingSpec).status, problem.problemVersionId).toBe('correct');
    }
  });
});
