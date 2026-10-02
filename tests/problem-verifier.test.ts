import { readdirSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { parseContentBundle } from '@/core/content-bundle';
import { claimSchema, evaluateClaim, type ClaimResult } from '@/core/verify/claims';
import { emptyScope } from '@/core/verify/evaluate';
import { parseRelation } from '@/core/verify/expr';
import { latexToClaim } from '@/core/verify/latex';
import { CheckFailure, show } from '@/core/verify/numbers';
import { showSet } from '@/core/verify/solve';
import { readOption, statementSet, statementTruth, statementValues } from '@/core/verify/statement';
import { verifyProblem, type CheckInput } from '@/core/verify/verify';

const run = (claim: unknown): ClaimResult => evaluateClaim(claimSchema.parse(claim));
const value = (expression: string, extra: object = {}) => {
  const r = run({ kind: 'value', expression, ...extra });
  if (r.type !== 'value') throw new Error('not a value');
  return r;
};
const shown = (r: ClaimResult) => (r.type === 'value' ? show(r.value) : r.type === 'values' ? r.values.map(show).sort().join(', ') : r.type === 'set' ? showSet(r.set) : r.type);
const failure = (claim: unknown) => {
  try { run(claim); } catch (reason) { if (reason instanceof CheckFailure) return reason.code; throw reason; }
  return null;
};

describe('the claim language', () => {
  it('reads school notation: implicit products, powers before signs, factorials and degrees', () => {
    expect(show(value('2x(x+1)', { given: { x: '3' } }).value)).toBe('24');
    expect(show(value('-2^2').value)).toBe('-4');
    expect(show(value('(-2)^2').value)).toBe('4');
    expect(show(value('2^3^2').value)).toBe('512');
    expect(show(value('5! / 3!').value)).toBe('20');
    expect(show(value('2sqrt(9)').value)).toBe('6');
    expect(show(value('|3 - 7| + |2|').value)).toBe('6');
    expect(value('sin(30°)').value.re).toBeCloseTo(0.5, 12);
  });

  it('refuses what it cannot read instead of guessing', () => {
    expect(failure({ kind: 'value', expression: 'sin x' })).toBe('syntax');
    expect(failure({ kind: 'value', expression: 'x 2' })).toBe('syntax');
    expect(failure({ kind: 'value', expression: 'y + 1' })).toBe('unbound');
    expect(failure({ kind: 'value', expression: '1/0' })).toBe('domain');
    expect(failure({ kind: 'value', expression: '0^0' })).toBe('domain');
    expect(() => parseRelation('1+'.repeat(250) + '1')).toThrow(CheckFailure);
  });

  it('keeps a variable named after a constant when the claim binds it', () => {
    expect(show(value('sum(i^2, i, 1, 3)').value)).toBe('14');
    expect(show(value('e + 1', { given: { e: '2' } }).value)).toBe('3');
  });
});

describe('exact and numeric arithmetic', () => {
  it('stays exact through rational arithmetic, even where floats drift', () => {
    expect(value('0.1 + 0.2')).toMatchObject({ strength: 'exact' });
    expect(show(value('0.1 + 0.2').value)).toBe('3/10');
    expect(show(value('3/4 + 2/9').value)).toBe('35/36');
    expect(show(value('nCr(52, 5)').value)).toBe('2598960');
    expect(show(value('30!').value)).toBe('265252859812191058636308480000000');
    expect(show(value('(-1)^100001 + 1^100000').value)).toBe('0');
    expect(failure({ kind: 'value', expression: '2^100000' })).toBe('bounded');
  });

  it('follows the school conventions for roots and logarithms', () => {
    expect(show(value('(-8)^(1/3)').value)).toBe('-2');
    expect(show(value('cbrt(-27)').value)).toBe('-3');
    expect(show(value('sqrt(-4)').value)).toBe('2i');
    // √(−2)·√(−3) is −√6, which is why the rule is taught.
    expect(value('sqrt(-2)*sqrt(-3)').value.re).toBeCloseTo(-Math.sqrt(6), 12);
    expect(show(value('log(2, 8)').value)).toBe('3');
    expect(show(value('log(4, 2)').value)).toBe('1/2');
    expect(show(value('log(1000)').value)).toBe('3');
    expect(failure({ kind: 'value', expression: 'log(-1)' })).toBe('domain');
  });

  it('computes complex numbers, statistics and counting', () => {
    expect(show(value('(2+3i)(1-i)').value)).toBe('5+i');
    expect(show(value('i^2').value)).toBe('-1');
    expect(show(value('var(2, 4, 4, 4, 5, 5, 7, 9)').value)).toBe('4');
    expect(show(value('sd(2, 4, 4, 4, 5, 5, 7, 9)').value)).toBe('2');
    expect(show(value('svar(1, 2, 3, 4)').value)).toBe('5/3');
    expect(show(value('median(2, 6, 8, 12)').value)).toBe('7');
    expect(show(value('nPr(5, 3) + nHr(3, 2)').value)).toBe('66');
    expect(show(value('gcd(12, 18) + lcm(4, 6) + mod(-7, 3)').value)).toBe('20');
  });

  it('will not round a float that sits on an integer boundary', () => {
    expect(show(value('floor(7/2) + ceil(7/2) + round(-5/2)').value)).toBe('4');
    expect(failure({ kind: 'value', expression: 'floor(sqrt(2)^2)' })).toBe('unstable');
  });
});

describe('equations', () => {
  const solve = (equation: string, extra: object = {}) => shown(run({ kind: 'solve', equation, unknown: 'x', select: 'all', ...extra }));

  it('solves polynomials exactly, keeping multiplicity for sums and products', () => {
    expect(solve('3x - 6 = x + 10')).toBe('8');
    expect(solve('x^2 - 5x + 6 = 0')).toBe('2, 3');
    expect(solve('x^3 - 6x^2 + 11x - 6 = 0')).toBe('1, 2, 3');
    expect(shown(run({ kind: 'solve', equation: 'x^2 - 4x + 4 = 0', unknown: 'x', select: 'sum' }))).toBe('4');
    expect(shown(run({ kind: 'solve', equation: 'x^2 - 4x + 4 = 0', unknown: 'x', select: 'count' }))).toBe('1');
    expect(shown(run({ kind: 'solve', equation: '3x^2 - 12x + 6 = 0', unknown: 'x', select: 'product' }))).toBe('2');
  });

  it('drops what squaring, branching and denominators add', () => {
    // x = 2 makes the denominator zero; x = −1 squares into a root of x+2 = x² but is not one of √(x+2) = x.
    expect(solve('(x+1)/(x-2) = 3/(x-2)')).toBe('');
    expect(solve('sqrt(x + 2) = x')).toBe('2');
    expect(solve('|x - 1| = 3')).toBe('-2, 4');
    expect(solve('|2x - 1| = x + 4')).toBe('-1, 5');
    expect(solve('x + 1/x = 2')).toBe('1');
  });

  it('keeps complex roots out of a real problem and in a complex one', () => {
    expect(solve('x^2 + 1 = 0')).toBe('');
    expect(solve('x^2 + 1 = 0', { domain: 'complex' })).toBe('-i, i');
    expect(solve('x^2 - 2x + 5 = 0', { domain: 'complex' })).toBe('1+2i, 1-2i');
  });

  it('solves equations of sines and exponentials only inside a stated interval', () => {
    expect(failure({ kind: 'solve', equation: 'sin(x) = 1/2', unknown: 'x' })).toBe('unsupported');
    const roots = run({ kind: 'solve', equation: 'sin(x) = 1/2', unknown: 'x', where: '0 <= x < 2pi', select: 'all' });
    expect(roots.type === 'values' && roots.values.map((v) => v.re)).toEqual([expect.closeTo(Math.PI / 6, 9), expect.closeTo((5 * Math.PI) / 6, 9)]);
    expect(roots).toMatchObject({ strength: 'estimated' });
    expect(shown(run({ kind: 'solve', equation: '2^(x+1) = 16', unknown: 'x', where: '-10 <= x <= 10' }))).toBe('3');
    expect(shown(run({ kind: 'solve', equation: 'log(2, x) + log(2, x - 2) = 3', unknown: 'x', where: '0 < x <= 100', select: 'all' }))).toBe('4');
  });

  it('solves systems: linear exactly, others by substituting an unknown that one equation gives', () => {
    expect(shown(run({ kind: 'solve', equations: ['x + y = 5', 'x - y = 1'], unknowns: ['x', 'y'], ask: 'x*y' }))).toBe('6');
    expect(shown(run({ kind: 'solve', equations: ['x + y + z = 6', 'x - y = 1', 'x + z = 5'], unknowns: ['x', 'y', 'z'], ask: 'z' }))).toBe('3');
    expect(shown(run({ kind: 'solve', equations: ['x + y = 5', 'x^2 + y^2 = 13'], unknowns: ['x', 'y'], ask: 'x', select: 'all' }))).toBe('2, 3');
  });

  it('calls a problem ill-posed when "the solution" is not one solution', () => {
    expect(failure({ kind: 'solve', equation: 'x^2 = 4', unknown: 'x' })).toBe('ill-posed');
    expect(failure({ kind: 'solve', equation: 'x^2 = -4', unknown: 'x' })).toBe('ill-posed');
    expect(failure({ kind: 'solve', equation: '2(x + 1) = 2x + 2', unknown: 'x' })).toBe('ill-posed');
    expect(failure({ kind: 'solve', equations: ['x + y = 1', '2x + 2y = 2'], unknowns: ['x', 'y'], ask: 'x' })).toBe('ill-posed');
    // Three equations that look independent and are not: the first two add up to the third.
    expect(failure({ kind: 'solve', equations: ['x + y + z = 6', 'x - y = 1', '2x + z = 7'], unknowns: ['x', 'y', 'z'], ask: 'z' })).toBe('ill-posed');
  });
});

describe('inequalities', () => {
  const set = (inequality: string) => shown(run({ kind: 'inequality', inequality, variable: 'x' }));
  it('solves to an exact set, with ends open or closed as written', () => {
    expect(set('x^2 - 5x + 6 < 0')).toBe('(2, 3)');
    expect(set('x^2 - 5x + 6 >= 0')).toBe('(-inf, 2] ∪ [3, inf)');
    expect(set('(x - 1)/(x + 2) <= 0')).toBe('(-2, 1]');
    expect(set('-1 <= 2x + 1 < 7')).toBe('[-1, 3)');
    expect(set('x^2 + 4 > 0')).toBe('(-inf, inf)');
    expect(set('x^2 + 4 < 0')).toBe('∅');
    expect(set('(x - 2)^2 <= 0')).toBe('{2}');
    expect(set('|x - 1| < 3')).toBe('(-2, 4)');
  });
  it('counts and adds the integers or natural numbers in it', () => {
    expect(shown(run({ kind: 'inequality', inequality: '2x - 3 < 7', variable: 'x', select: 'count', among: 'naturals' }))).toBe('4');
    expect(shown(run({ kind: 'inequality', inequality: 'k^2 - 36 < 0', variable: 'k', select: 'count' }))).toBe('11');
    expect(shown(run({ kind: 'inequality', inequality: '800x <= 5000', variable: 'x', select: 'max', among: 'naturals' }))).toBe('6');
    expect(failure({ kind: 'inequality', inequality: 'x > 1', variable: 'x', select: 'count' })).toBe('unsupported');
  });
});

describe('calculus, up to a first university course', () => {
  it('differentiates symbolically and evaluates exactly where it can', () => {
    expect(show(value('diff(x^3 - 2x, x, 2)').value)).toBe('10');
    expect(show(value('diff(x^4, x, 1, 3)').value)).toBe('24');
    expect(value('diff(sin(x)^2, x, pi/4)').value.re).toBeCloseTo(1, 12);
    expect(value('diff(x*exp(2x), x, 0)').value.re).toBeCloseTo(1, 12);
    expect(value('diff(ln(x^2 + 1), x, 1)').value.re).toBeCloseTo(1, 12);
    expect(value('diff(x^x, x, 1)').value.re).toBeCloseTo(1, 12);
    expect(show(value('diff(f(x), x, 3)', { define: { 'f(x)': 'x^2 + 1' } }).value)).toBe('6');
  });

  it('integrates numerically, or exactly from an antiderivative it has checked', () => {
    expect(value('integral(x^2, x, 0, 3)')).toMatchObject({ strength: 'estimated' });
    expect(value('integral(x^2, x, 0, 3)').value.re).toBeCloseTo(9, 9);
    expect(value('integral(ln(x), x, 0, 1)').value.re).toBeCloseTo(-1, 9);
    expect(run({ kind: 'integral', integrand: '3x^2', variable: 'x', from: '0', to: '2', antiderivative: 'x^3' })).toMatchObject({ strength: 'exact' });
    const wrong = run({ kind: 'integral', integrand: '3x^2', variable: 'x', from: '0', to: '2', antiderivative: 'x^3 + x' });
    expect(wrong.notes[0]).toMatch(/does not differentiate back/);
    expect(wrong).toMatchObject({ strength: 'estimated' });
    expect(failure({ kind: 'integral', integrand: '1/x^2', variable: 'x', from: '-1', to: '1', antiderivative: '-1/x' })).not.toBeNull();
  });

  it('estimates limits and refuses ones that do not exist', () => {
    expect(value('limit(sin(x)/x, x, 0)').value.re).toBeCloseTo(1, 9);
    expect(value('limit((1 - cos(x))/x^2, x, 0)').value.re).toBeCloseTo(0.5, 7);
    expect(value('limit((1 + 1/n)^n, n, inf)').value.re).toBeCloseTo(Math.E, 7);
    expect(value('limit(sqrt(x^2 + x) - x, x, inf)').value.re).toBeCloseTo(0.5, 7);
    expect(value('limit(abs(x)/x, x, 0, 1)').value.re).toBeCloseTo(1, 9);
    expect(failure({ kind: 'value', expression: 'limit(abs(x)/x, x, 0)' })).toBe('diverges');
    expect(failure({ kind: 'value', expression: 'limit(1/x, x, 0, 1)' })).toBe('diverges');
  });

  it('sums finitely and exactly', () => {
    expect(show(value('sum(k^2, k, 1, 10)').value)).toBe('385');
    expect(show(value('sum(1/(k(k+1)), k, 1, 99)').value)).toBe('99/100');
    expect(show(value('prod(1 - 1/k^2, k, 2, 10)').value)).toBe('11/20');
  });
});

describe('reading options', () => {
  const values = (text: string) => { const st = readOption(text); return st && statementValues(st, emptyScope)?.map(show).sort(); };
  const set = (text: string) => { const st = readOption(text); return st && statementSet(st, 'x', emptyScope); };
  const truth = (text: string) => { const st = readOption(text); return st && statementTruth(st, emptyScope)?.truth; };

  it('translates the LaTeX a prompt is written in', () => {
    expect(latexToClaim('\\frac{3}{4}+\\frac{2}{9}')).toBe('((3)/(4))+((2)/(9))');
    expect(latexToClaim('\\sin 30^\\circ')).toBe('sin(30°)');
    expect(latexToClaim('\\log_{2} 8')).toBe('log((2),(8))');
    expect(latexToClaim('\\sqrt[3]{-8}')).toBe('root((-8),(3))');
    expect(latexToClaim('x \\le -4')).toBe('x <= -4');
  });

  it('reads values, solution lists and roots with ±', () => {
    expect(values('$\\frac{5}{13}$')).toEqual(['5/13']);
    expect(values('$x=-3$')).toEqual(['-3']);
    expect(values('$x = 2$ 또는 $x = 3$')).toEqual(['2', '3']);
    expect(values('$3$개')).toEqual(['3']);
    expect(values('12 cm')).toEqual(['12']);
    expect(values('$25\\%$')).toEqual(['25']);
    expect(values('$x=1\\pm\\sqrt{2}$')).toEqual(['-0.41421356237', '2.4142135624']);
    expect(values('$\\frac{1}{2}\\text{m}$')).toEqual(['1/2']);
  });

  it('reads solution sets, including the ones written in words', () => {
    expect(showSet(set('$x \\le -4$ 또는 $x \\ge -1$')!)).toBe('(-inf, -4] ∪ [-1, inf)');
    expect(showSet(set('$-4 \\le x \\le -1$')!)).toBe('[-4, -1]');
    expect(showSet(set('$2 \\leq x$')!)).toBe('[2, inf)');
    expect(showSet(set('해가 없다')!)).toBe('∅');
    expect(showSet(set('모든 실수')!)).toBe('(-inf, inf)');
  });

  it('decides statements: arithmetic, identities and steps of working', () => {
    expect(truth('$\\frac{1}{2}+\\frac{1}{3}=\\frac{5}{6}$')).toBe(true);
    expect(truth('$\\frac{1}{2}+\\frac{1}{3}=\\frac{2}{5}$')).toBe(false);
    expect(truth('$\\sin 30^\\circ = \\frac{1}{2}$')).toBe(true);
    expect(truth('$(a+b)^2 = a^2 + b^2$')).toBe(false);
    expect(truth('$(a+b)^2 = a^2 + 2ab + b^2$')).toBe(true);
    expect(truth('$x+3=7 \\Rightarrow x=7-3$')).toBe(true);
    expect(truth('$x+3=7 \\Rightarrow x=7+3$')).toBe(false);
    expect(truth('$2x+3 < 9 \\Rightarrow x < 3$')).toBe(true);
  });

  it('does not read prose it does not understand', () => {
    expect(readOption('기울기가 같다')).toBeNull();
    expect(readOption('$x$의 값이 가장 크다')).toBeNull();
    expect(readOption('$\\dots$')).toBeNull();
  });
});

/** Problems as three chat models wrote them for the same request (2026-10-01), with the claim each implies. */
describe('checking generated problems', () => {
  const check = (input: Partial<CheckInput> & Pick<CheckInput, 'answer' | 'solves'>) => verifyProblem(input as CheckInput);
  const codes = (input: Parameters<typeof check>[0]) => check(input).issues.map((i) => i.code);

  it('rejects an answer key that names an option nothing computes to (GPT, case B, #5)', () => {
    const result = check({
      prompt: '$\\frac{3}{4}+\\frac{2}{9}$를 바르게 계산한 것을 골라요.',
      answer: { kind: 'choice', correct: 'b', options: [
        { id: 'a', text: '$\\frac{5}{13}$' }, { id: 'b', text: '$\\frac{29}{36}$' }, { id: 'c', text: '$\\frac{5}{36}$' }, { id: 'd', text: '$\\frac{11}{18}$' }] },
      misreadings: [{ answer: 'a', misconception: 'add-denominators', expression: '(3+2)/(4+9)' }],
      solves: { kind: 'value', expression: '3/4 + 2/9' },
    });
    expect(result.verdict).toBe('rejected');
    expect(result.computed).toBe('35/36');
    expect(result.issues.map((i) => i.code)).toEqual(['choice-no-match']);
  });

  it('rejects an expected wrong answer the answer box would refuse (Sonnet 5.5, case B, #6)', () => {
    const result = check({
      prompt: '$\\frac{3}{7}+\\frac{4}{7}$는 얼마인가요? 정수로 써 주세요.',
      answer: { kind: 'integer', value: 1 },
      misreadings: [{ answer: '1/2', misconception: 'add-denominators', expression: '(3+4)/(7+7)' }],
      solves: { kind: 'value', expression: '3/7 + 4/7' },
    });
    expect(result.verdict).toBe('rejected');
    expect(result.issues.map((i) => i.code)).toContain('misreading-unrecordable');
  });

  it('verifies a problem whose key, wrong answer and wrong computation all agree (Sonnet 5.5, case A, #2)', () => {
    expect(check({
      prompt: '$6 - x = 15$일 때, $x$의 값을 구해요.',
      answer: { kind: 'integer', value: -9 },
      misreadings: [{ answer: '-21', misconception: 'move-without-sign', expression: '-(15 + 6)' }],
      solves: { kind: 'solve', equation: '6 - x = 15', unknown: 'x' },
    })).toMatchObject({ verdict: 'verified', strength: 'exact', computed: '-9', issues: [] });
  });

  it('reads options written as solutions and catches a key on the wrong one (GPT, case A, #6)', () => {
    const problem = {
      prompt: '$-2x+5=11$의 해는 어느 것인가요?',
      answer: { kind: 'choice' as const, correct: 'c', options: [
        { id: 'a', text: '$x=-8$' }, { id: 'b', text: '$x=3$' }, { id: 'c', text: '$x=-3$' }, { id: 'd', text: '$x=8$' }] },
      misreadings: [{ answer: 'a', misconception: 'move-without-sign', expression: '(11 + 5)/(-2)' }],
      solves: { kind: 'solve', equation: '-2x + 5 = 11', unknown: 'x' },
    };
    expect(check(problem)).toMatchObject({ verdict: 'verified', strength: 'exact' });
    expect(codes({ ...problem, answer: { ...problem.answer, correct: 'b' } })).toContain('choice-wrong-key');
  });

  it('checks a "which is right" question statement by statement (Gemini, case B, #4)', () => {
    const answer = { kind: 'choice' as const, correct: 'c', options: [
      { id: 'a', text: '$\\frac{1}{5} + \\frac{2}{5} = \\frac{3}{10}$' }, { id: 'b', text: '$\\frac{1}{4} + \\frac{1}{3} = \\frac{2}{7}$' },
      { id: 'c', text: '$\\frac{1}{4} + \\frac{1}{3} = \\frac{7}{12}$' }, { id: 'd', text: '$\\frac{2}{7} + \\frac{3}{7} = \\frac{5}{14}$' }] };
    expect(check({ answer, solves: { kind: 'choose', which: 'true' } })).toMatchObject({ verdict: 'verified' });
    expect(codes({ answer, solves: { kind: 'choose', which: 'false' } })).toContain('choice-ambiguous');
  });

  it('checks a step of working the way 「이항을 바르게 한 것」 means it', () => {
    const result = check({
      answer: { kind: 'choice', correct: 'b', options: [
        { id: 'a', text: '$x+3=7 \\Rightarrow x=7+3$' }, { id: 'b', text: '$x+3=7 \\Rightarrow x=7-3$' },
        { id: 'c', text: '$x-4=10 \\Rightarrow x=10-4$' }, { id: 'd', text: '$3x=x+6 \\Rightarrow 3x+x=6$' }] },
      // A wrong option that is a statement has no value, so its computation is noted, not compared.
      misreadings: [{ answer: 'a', misconception: 'move-without-sign', expression: '7 + 3' }],
      solves: { kind: 'choose', which: 'true' },
    });
    expect(result).toMatchObject({ verdict: 'verified', issues: [{ code: 'misreading-unchecked', level: 'warning' }] });
  });

  it('rejects a key that is not what the claim computes, and a key the grader would not accept', () => {
    expect(codes({ answer: { kind: 'integer', value: 7 }, solves: { kind: 'solve', equation: '4x - 7 = x + 8', unknown: 'x' } })).toEqual(['answer-mismatch']);
    expect(codes({ answer: { kind: 'rational', numerator: 6, denominator: 9, requiredForm: 'reduced_fraction' }, solves: { kind: 'value', expression: '2/9 + 4/9' } })).toEqual(['answer-unaccepted']);
    expect(codes({ answer: { kind: 'expression', expression: '3+2sqrt(2)' }, solves: { kind: 'value', expression: '(1 + sqrt(2))^2' } })).toEqual([]);
  });

  it('rejects an expected wrong answer that is right, that another name shadows, or that its computation does not give', () => {
    const answer = { kind: 'rational' as const, numerator: 5, denominator: 6 };
    const solves = { kind: 'value', expression: '1/2 + 1/3' };
    expect(codes({ answer, solves, misreadings: [{ answer: '10/12', misconception: 'add-denominators' }] })).toContain('misreading-correct');
    expect(codes({ answer, solves, misreadings: [{ answer: '2/5', misconception: 'add-denominators', expression: '(1+1)/(2+3)' }] })).toEqual([]);
    expect(codes({ answer, solves, misreadings: [{ answer: '2/6', misconception: 'add-denominators', expression: '(1+1)/(2+3)' }] })).toContain('misreading-derivation');
  });

  it('rejects an ill-posed problem, and leaves undecidable ones unverified rather than passed', () => {
    expect(check({ answer: { kind: 'integer', value: 2 }, solves: { kind: 'solve', equation: 'x^2 = 4', unknown: 'x' } }).verdict).toBe('rejected');
    expect(check({ answer: { kind: 'integer', value: 2 }, solves: { kind: 'magic' } }).verdict).toBe('unverified');
    expect(check({ answer: { kind: 'integer', value: 2 }, solves: { kind: 'solve', equation: 'sin(x) = 1', unknown: 'x' } }).verdict).toBe('unverified');
    const unreadable = check({
      answer: { kind: 'choice', correct: 'a', options: [{ id: 'a', text: '$\\frac{1}{2}$' }, { id: 'b', text: '절반보다 크다' }] },
      solves: { kind: 'value', expression: '1/2' },
    });
    expect(unreadable).toMatchObject({ verdict: 'unverified', issues: [{ code: 'option-unreadable', option: 'b' }] });
  });

  it('matches options that are expressions by identity', () => {
    const answer = { kind: 'choice' as const, correct: 'b', options: [
      { id: 'a', text: '$3x - 2$' }, { id: 'b', text: '$3(x-2)$' }, { id: 'c', text: '$3x + 2$' }, { id: 'd', text: '$x - 6$' }] };
    expect(check({ answer, solves: { kind: 'expression', expression: '3(x - 2)', variables: ['x'] } })).toMatchObject({ verdict: 'verified', strength: 'sampled' });
  });

  it('warns when the claim computes with numbers the prompt never mentions', () => {
    const result = check({
      prompt: '리본 $\\frac{1}{3}$m와 $\\frac{3}{5}$m를 이어 붙였어요. 모두 몇 m인가요?',
      answer: { kind: 'rational', numerator: 14, denominator: 15 },
      solves: { kind: 'value', expression: '1/3 + 3/5' },
    });
    expect(result).toMatchObject({ verdict: 'verified', issues: [] });
    const unrelated = check({ prompt: '리본 $\\frac{1}{3}$m와 $\\frac{3}{5}$m를 이어 붙였어요.', answer: { kind: 'integer', value: 40 }, solves: { kind: 'value', expression: '17 + 23' } });
    expect(unrelated.issues).toEqual([expect.objectContaining({ code: 'prompt-numbers', level: 'warning' })]);
  });
});

/**
 * Published questions, with the claim a writer would declare for each. Every one must verify: a
 * checker that rejects correct content is a checker nobody can use.
 */
describe('published questions verify against their claims', () => {
  const problems = new Map(readdirSync('prisma/seed').filter((f) => f.endsWith('.json'))
    .flatMap((f) => parseContentBundle(JSON.parse(readFileSync(`prisma/seed/${f}`, 'utf8'))).problemSets.flatMap((s) => s.problems))
    .map((p) => [p.problemVersionId, p]));
  const claims: [string, object][] = [
    ['complex-numbers:drill-18:v1', { kind: 'solve', equation: '3x^2 - 12x + 6 = 0', unknown: 'x', select: 'sum' }],
    ['complex-numbers:drill-12:v1', { kind: 'solve', equation: '(2 - i)(1 + i) = a + i', unknown: 'a', domain: 'complex' }],
    ['coordinate-geometry:drill-6:v1', { kind: 'value', expression: 'sqrt((2 - (-1))^2 + (3 - (-1))^2)' }],
    ['coordinate-geometry:drill-20:v1', { kind: 'value', expression: 'sqrt((2/2)^2 + (-4/2)^2 + 4)' }],
    ['counting:drill-13:v1', { kind: 'value', expression: '6!' }],
    ['counting:drill-12:v1', { kind: 'value', expression: 'nPr(5, 3)' }],
    ['factorization:drill-16:v1', { kind: 'solve', equation: 'x^2 + 9x + 20 = (x + 4)(x + a)', unknown: 'a', given: { x: '1' } }],
    ['functions:drill-9:v1', { kind: 'value', expression: 'f(2)', define: { 'f(x)': '4x - 3' } }],
    ['functions:drill-15:v1', { kind: 'value', expression: '(10 - 4)/(3 - 1)' }],
    ['inequalities:drill-19:v1', { kind: 'inequality', inequality: '800x <= 5000', variable: 'x', select: 'max', among: 'naturals' }],
    ['inequalities:drill-20:v1', { kind: 'inequality', inequality: 'x >= 2', variable: 'x' }],
    ['integers:drill-12:v1', { kind: 'value', expression: '-7 - (-3)' }],
    ['ncs-applied:drill2-16:v2', { kind: 'value', expression: '100 + 100 * 5/100 * 3' }],
    ['ncs-applied:drill2-5:v1', { kind: 'value', expression: '(50000 - 40000)/50000 * 100' }],
    ['polynomial-theorems:drill-14:v1', { kind: 'value', expression: 'f(1)', define: { 'f(x)': 'x^3 - x' } }],
    ['probability:drill-16:v1', { kind: 'value', expression: '1 - 1/6' }],
    ['pythagoras:drill-19:v1', { kind: 'value', expression: 'sqrt(1^2 + 4^2 + 8^2)' }],
    ['quadratic-equations:drill-12:v1', { kind: 'solve', equation: '(x - 5)^2 = 16', unknown: 'x', select: 'largest' }],
    ['quadratic-equations:drill-5:v1', { kind: 'solve', equation: '(x - 4)^2 = 0', unknown: 'x' }],
    ['quadratic-equations:drill-3:v1', { kind: 'solve', equation: 'x^2 = 7x', unknown: 'x', where: 'x != 0' }],
    ['quadratic-inequalities:drill-5:v1', { kind: 'inequality', inequality: 'x^2 + 5x + 4 >= 0', variable: 'x' }],
    ['quadratic-inequalities:drill-19:v1', { kind: 'inequality', inequality: 'k^2 - 4*9 < 0', variable: 'k', select: 'count' }],
    ['rational-functions:drill-7:v1', { kind: 'solve', equation: '2x + 1 = 9', unknown: 'x' }],
    ['rational-functions:drill-19:v1', { kind: 'value', expression: 'sqrt(3*12)' }],
    ['ratios:drill-4:v1', { kind: 'value', expression: '8/20' }],
    ['real-numbers:drill-20:v1', { kind: 'value', expression: 'sqrt(3)/sqrt(12)' }],
    ['real-numbers:drill-13:v1', { kind: 'value', expression: 'round(sqrt(17))' }],
    ['sets-logic:drill-12:v1', { kind: 'value', expression: '22 + 18 - 10' }],
    ['statistics-spread:drill-5:v1', { kind: 'value', expression: 'median(2, 6, 8, 12)' }],
    ['statistics-spread:drill-10:v1', { kind: 'value', expression: 'var(7, 7, 7)' }],
    ['systems:drill-11:v1', { kind: 'solve', equations: ['x = 4y', 'x + y = 15'], unknowns: ['x', 'y'], ask: 'y' }],
    ['systems:drill-13:v1', { kind: 'expression', expression: '3(x - 2)', variables: ['x'] }],
    ['trigonometry:drill-18:v1', { kind: 'value', expression: '1/2 * 6 * 8 * sin(30°)' }],
    ['equations:drill-16:v1', { kind: 'solve', equation: '4x - 7 = x + 8', unknown: 'x' }],
    ['equations:drill-19:v1', { kind: 'solve', equation: '2x + 1 = 4', unknown: 'x' }],
    ['fractions:drill-14:v1', { kind: 'value', expression: '1/2 + 1/3' }],
  ];
  it.each(claims)('%s', (id, solves) => {
    const problem = problems.get(id);
    if (!problem) throw new Error(`Missing question ${id}`);
    const prompt = problem.promptContent.map((b) => (b.payload as { text?: string }).text ?? '').join(' ');
    const result = verifyProblem({ prompt, answer: problem.gradingSpec, misreadings: problem.misreadings, solves });
    expect(result.issues.filter((i) => i.level !== 'warning'), JSON.stringify(result)).toEqual([]);
    expect(result.verdict).toBe('verified');
  });
});
