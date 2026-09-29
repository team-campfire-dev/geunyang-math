import { describe, expect, it } from 'vitest';
import { mathInputIssue } from '@/features/learning/math-input-issue';

describe('local input validation without knowing the answer', () => {
  it.each([
    ['(2)/(□)', '□', '분모'], ['(2)^()', '', '지수'], ['sqrt(□)', '□', '근호'],
    ['1/(2-2)', '2-2', '분모'], ['sqrt(-1)', '-1', '실수'], ['2^(1/2)', '1/2', '지수'],
    ['2^33', '33', '지수'], ['sqrt(1+sqrt(2))', '1+sqrt(2)', '무리수'],
  ])('points to the offending slot in %s', (value, source, message) => {
    const issue = mathInputIssue(value)!;
    expect(issue.message).toContain(message);
    expect(value.slice(issue.range.start, issue.range.end)).toBe(source);
  });
  it('does not judge correctness, reduce a fraction, or complain about an untouched blank answer', () => {
    for (const value of ['', '999', '(2)/(4)', 'sqrt(2)', '2^3']) expect(mathInputIssue(value)).toBeNull();
  });
  it('announces integer form independently of available keyboard tools', () => {
    expect(mathInputIssue('2^3', true)?.message).toContain('정수');
    expect(mathInputIssue('(8)', true)).toBeNull();
  });
});
