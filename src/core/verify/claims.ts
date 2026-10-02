import { z } from 'zod';
import { derivative, integrate, type FunctionDef } from './calculus';
import { evaluate, newMeter, type Meter, type Scope } from './evaluate';
import { parseEquation, parseExpression, parseRelation, type Node } from './expr';
import { add as addNum, approx, exact, fail, int, isReal, mul as mulNum, q, same, sub, weakest, type Num, type Strength } from './numbers';
import { bounds, integersIn, solveInequality, solveSystem, type Interval } from './solve';

/**
 * What a problem computes, declared beside the problem: the thing the answer key has to agree with.
 *
 * A claim is not the answer. It is the computation the prompt asks for, written so the server can
 * do it — and the answer key, each option and each expected wrong answer are then checked against
 * what the server got. The kinds are the shapes of question school and university mathematics asks:
 * a value, the solution of equations, the solutions of an inequality, a definite integral, or which
 * of several statements is true.
 */
const expression = z.string().trim().min(1).max(400);
const symbol = z.string().regex(/^([A-Za-z]|[α-ω])(_[A-Za-z0-9]+)?$/, 'A variable is one letter, optionally with a subscript like x_1.');
const list = <T extends z.ZodType>(item: T, max: number) => z.union([item, z.array(item).min(1).max(max)]).transform((v) => (Array.isArray(v) ? v : [v]) as z.output<T>[]);
const common = {
  /** Values of named constants: `{ "a": "3" }`. */
  given: z.record(symbol, expression).optional(),
  /** Functions the problem defines: `{ "f(x)": "x^2 + 1" }`. */
  define: z.record(z.string().regex(/^[A-Za-z]\(\s*[A-Za-zα-ω](\s*,\s*[A-Za-zα-ω])*\s*\)$/, 'A function is written f(x) or f(x, y).'), expression).optional(),
};

const alias = (from: string, to: string) => (raw: unknown) =>
  raw && typeof raw === 'object' && from in raw && !(to in raw) ? { ...Object.fromEntries(Object.entries(raw).filter(([k]) => k !== from)), [to]: (raw as Record<string, unknown>)[from] } : raw;

export const claimSchema = z.preprocess((raw) => alias('unknown', 'unknowns')(alias('equation', 'equations')(raw)), z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('value'), expression, ...common }).strict(),
  z.object({
    kind: z.literal('solve'),
    equations: list(expression, 4),
    unknowns: list(symbol, 4),
    /** A condition on a single unknown: `0 <= x < 2pi`, `x > 0`. Needed when the equation has a sine or an exponential of the unknown. */
    where: expression.optional(),
    domain: z.enum(['real', 'complex']).default('real'),
    /**
     * Which solution the problem asks about. `unique` insists there is exactly one. `sum` and
     * `product` count a repeated root as many times as it repeats, as the relation between roots and
     * coefficients does; `count` counts distinct solutions.
     */
    select: z.enum(['unique', 'all', 'largest', 'smallest', 'positive', 'negative', 'sum', 'product', 'count']).default('unique'),
    /** What to compute from the solution, when it is not the unknown itself: `x + y`, `a*b`. */
    ask: expression.optional(),
    ...common,
  }).strict(),
  z.object({
    kind: z.literal('inequality'),
    inequality: expression,
    variable: symbol,
    select: z.enum(['set', 'count', 'sum', 'max', 'min']).default('set'),
    among: z.enum(['integers', 'naturals']).default('integers'),
    ...common,
  }).strict(),
  z.object({
    kind: z.literal('integral'),
    integrand: expression,
    variable: symbol,
    from: expression,
    to: expression,
    /** An antiderivative, which makes the value exact: it is differentiated back and compared with the integrand. */
    antiderivative: expression.optional(),
    ...common,
  }).strict(),
  z.object({ kind: z.literal('choose'), which: z.enum(['true', 'false']), ...common }).strict(),
  /**
   * An expression in variables, for options that are expressions: `3(x-2)` matches the option equal
   * to it for every x, so `3x-6` would match too and `3x-2` would not.
   */
  z.object({ kind: z.literal('expression'), expression, variables: list(symbol, 4), ...common }).strict(),
]));
export type Claim = z.infer<typeof claimSchema>;

export type ClaimResult =
  | { type: 'value'; value: Num; strength: Strength; notes: string[] }
  | { type: 'values'; values: Num[]; strength: Strength; notes: string[] }
  | { type: 'set'; set: Interval[]; strength: Strength; notes: string[] }
  | { type: 'choose'; which: 'true' | 'false'; scope: Scope; notes: string[] }
  | { type: 'form'; node: Node; variables: string[]; scope: Scope; strength: Strength; notes: string[] };

/** The scope a claim's `given` and `define` set up. */
export function claimScope(claim: Pick<Claim, 'given' | 'define'>, meter: Meter): Scope {
  const functions = new Map<string, FunctionDef>();
  const names = new Set(Object.keys(claim.define ?? {}).map((key) => key[0]));
  for (const [key, body] of Object.entries(claim.define ?? {})) {
    const params = key.slice(2, -1).split(',').map((p) => p.trim());
    functions.set(key[0], { params, body: parseExpression(body, { functions: names }) });
  }
  const vars = new Map<string, Num>();
  for (const [name, value] of Object.entries(claim.given ?? {})) {
    vars.set(name, evaluate(parseExpression(value, { functions: names }), { vars, functions }, meter));
  }
  return { vars, functions };
}

const strengthOf = (value: Num, meter: Meter): Strength => (meter.estimated ? 'estimated' : value.q ? 'exact' : 'numeric');

export function evaluateClaim(claim: Claim): ClaimResult {
  const meter = newMeter();
  const scope = claimScope(claim, meter);
  const options = { functions: new Set(scope.functions.keys()) };
  const parse = (text: string) => parseExpression(text, options);
  switch (claim.kind) {
    case 'value': {
      const value = evaluate(parse(claim.expression), scope, meter);
      return { type: 'value', value, strength: strengthOf(value, meter), notes: [] };
    }
    case 'choose': return { type: 'choose', which: claim.which, scope, notes: [] };
    case 'expression': return { type: 'form', node: parse(claim.expression), variables: claim.variables, scope, strength: 'sampled', notes: [] };
    case 'solve': {
      const equations = claim.equations.map((e) => parseEquation(e, options));
      if (claim.where && claim.unknowns.length !== 1) fail('syntax', '"where" is only supported with a single unknown.');
      const where = bounds(claim.where ? parseRelation(claim.where, options) : undefined, claim.unknowns[0], scope, meter);
      const solved = solveSystem(equations, claim.unknowns, claim.domain, where, scope, meter);
      if (claim.unknowns.length > 1 && !claim.ask) fail('syntax', 'With more than one unknown, "ask" must say what to compute from the solution.');
      const ask: Node = claim.ask ? parse(claim.ask) : { k: 'sym', name: claim.unknowns[0] };
      const entries = solved.solutions.map((s) => {
        const vars = new Map(scope.vars); s.values.forEach((value, name) => vars.set(name, value));
        return { value: evaluate(ask, { ...scope, vars }, meter), multiplicity: s.multiplicity };
      });
      const distinct = entries.filter((e, i) => entries.findIndex((f) => same(e.value, f.value).equal) === i);
      const strength = weakest(solved.strength, ...entries.map((e) => strengthOf(e.value, meter)));
      const real = (what: string) => distinct.map((e) => (isReal(e.value) ? e.value : fail('ill-posed', `${what} of non-real solutions is not defined.`)));
      const only = (list: Num[], what: string) => (list.length === 1 ? list[0] : fail('ill-posed', `The problem asks for ${what}, but there ${list.length === 0 ? 'is none' : `are ${list.length}`}.`));
      const one = (value: Num): ClaimResult => ({ type: 'value', value, strength, notes: [] });
      switch (claim.select) {
        case 'unique': return one(only(distinct.map((e) => e.value), 'the one solution'));
        case 'all': return { type: 'values', values: distinct.map((e) => e.value), strength, notes: [] };
        case 'count': return one(int(distinct.length));
        case 'largest': case 'smallest': {
          const values = real(claim.select);
          if (!values.length) fail('ill-posed', 'There is no solution to take the largest or smallest of.');
          return one(values.reduce((a, b) => ((claim.select === 'largest' ? 1 : -1) * (b.re - a.re) > 0 && !same(a, b).equal ? b : a)));
        }
        case 'positive': case 'negative': {
          const values = real(claim.select).filter((v) => (claim.select === 'positive' ? v.re > 0 : v.re < 0) && !same(v, int(0)).equal);
          return one(only(values, `the ${claim.select} solution`));
        }
        case 'sum': case 'product': {
          let total = claim.select === 'sum' ? int(0) : int(1);
          for (const e of entries) for (let k = 0; k < e.multiplicity; k++) total = claim.select === 'sum' ? addNum(total, e.value) : mulNum(total, e.value);
          if (!entries.length) fail('ill-posed', 'There are no solutions to add or multiply.');
          return one(total);
        }
      }
      break;
    }
    case 'inequality': {
      const relation = parseRelation(claim.inequality, options);
      const { set, strength } = solveInequality(relation, claim.variable, scope, meter);
      if (claim.select === 'set') return { type: 'set', set, strength, notes: [] };
      const integers = integersIn(set, claim.among === 'naturals');
      if (!integers.length && claim.select !== 'count') fail('ill-posed', `No ${claim.among} satisfy the inequality.`);
      const value = claim.select === 'count' ? BigInt(integers.length)
        : claim.select === 'sum' ? integers.reduce((a, b) => a + b, 0n)
          : claim.select === 'max' ? integers[integers.length - 1] : integers[0];
      return { type: 'value', value: exact(q(value)), strength, notes: [] };
    }
    case 'integral': {
      const variable = claim.variable;
      const f = parse(claim.integrand), a = evaluate(parse(claim.from), scope, meter), b = evaluate(parse(claim.to), scope, meter);
      if (!isReal(a) || !isReal(b)) fail('domain', 'Integral bounds must be real.');
      const at = (body: Node, x: Num) => { const vars = new Map(scope.vars); vars.set(variable, x); return evaluate(body, { ...scope, vars }, meter); };
      const numeric = approx(integrate((x) => { const v = at(f, approx(x)); return isReal(v) ? v.re : fail('domain', 'The integrand is not real here.'); }, a.re, b.re));
      if (!claim.antiderivative) return { type: 'value', value: numeric, strength: 'estimated', notes: [] };
      // The antiderivative is believed only if it differentiates back to the integrand, and only if
      // its difference agrees with the numerical integral — which catches an antiderivative used
      // across a point where the integrand is undefined.
      const F = parse(claim.antiderivative), dF = derivative(F, variable, scope.functions);
      for (let k = 1; k <= 7; k++) {
        const x = approx(a.re + ((b.re - a.re) * k) / 8);
        if (!same(at(dF, x), at(f, x)).equal) {
          return { type: 'value', value: numeric, strength: 'estimated', notes: ['The antiderivative does not differentiate back to the integrand; the numerical value was used instead.'] };
        }
      }
      const value = sub(at(F, b), at(F, a));
      if (!same(value, numeric, true).equal) fail('ill-posed', 'The antiderivative differs from the numerical integral; the integrand may be undefined inside the interval.');
      return { type: 'value', value, strength: value.q ? 'exact' : 'numeric', notes: [] };
    }
  }
  return fail('syntax', 'Unknown claim kind.');
}
