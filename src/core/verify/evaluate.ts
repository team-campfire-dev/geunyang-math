import { derivative, integrate, limit, type FunctionDef } from './calculus';
import type { Node } from './expr';
import {
  abs, add, approx, asInteger, compare, div, exact, exp, fail, int, isReal, isZero, ln, log, mul, neg, ONE, pow, q,
  realPart, requireReal, sqrt, sub, ZERO, type Num,
} from './numbers';

/**
 * `real` asks for real arithmetic throughout: a square root of a negative number is then undefined
 * rather than imaginary. Solving over the reals uses it, so √x·√(x−5) = −6 has no solution at x = −4
 * even though 2i·3i is −6.
 */
export type Scope = {
  vars: ReadonlyMap<string, Num>; functions: ReadonlyMap<string, FunctionDef>; real?: boolean;
  /**
   * `snap` reads a radicand within rounding of zero as zero. At x = √2 the radicand x² − 2 comes out
   * as ±4e-16, whose root is 2e-8 or undefined; checking a candidate root or the end of a domain asks
   * about the exact point, where it is 0.
   */
  snap?: boolean;
};
const snapped = (x: Num, scope: Scope) => (scope.snap && !x.q && isReal(x) && Math.abs(x.re) <= 1e-12 ? ZERO : x);
/** How much work a claim may cost, and whether anything in it was only estimated. */
export type Meter = { work: number; depth: number; estimated: boolean };
export const newMeter = (): Meter => ({ work: 0, depth: 0, estimated: false });
export const emptyScope: Scope = { vars: new Map(), functions: new Map() };
const maxWork = 3_000_000;

const realNumber = (n: Num, what: string) => requireReal(n, what).re;
function wholeNumber(n: Num, what: string, max = 100_000n): bigint {
  const value = asInteger(n);
  if (value === null || value < 0n) return fail('domain', `${what} must be a whole number.`);
  if (value > max) return fail('bounded', `${what} is too large.`);
  return value;
}
/** n(n−1)…(n−count+1), charged to the meter one multiplication at a time. */
function falling(n: bigint, count: bigint, meter: Meter): bigint {
  let r = 1n;
  for (let k = 0n; k < count; k++) {
    if (++meter.work > maxWork) fail('bounded', 'The claim takes too much work to compute.');
    r *= n - k;
    if (r.toString(2).length > 4096) fail('bounded', 'A number in the claim grew too large to compute exactly.');
  }
  return r;
}
const factorial = (n: bigint, meter: Meter) => falling(n, n, meter);
function choose(n: bigint, r: bigint, meter: Meter): bigint {
  if (r < 0n || r > n) return 0n;
  if (r > n - r) r = n - r;
  let result = 1n;
  for (let k = 1n; k <= r; k++) {
    if (++meter.work > maxWork) fail('bounded', 'The claim takes too much work to compute.');
    result = (result * (n - r + k)) / k;
    if (result.toString(2).length > 4096) fail('bounded', 'A number in the claim grew too large to compute exactly.');
  }
  return result;
}

const complexSin = (a: Num) => approx(Math.sin(a.re) * Math.cosh(a.im), Math.cos(a.re) * Math.sinh(a.im));
const complexCos = (a: Num) => approx(Math.cos(a.re) * Math.cosh(a.im), -Math.sin(a.re) * Math.sinh(a.im));
const nonzero = (v: Num, name: string) => (Math.hypot(v.re, v.im) < 1e-12 ? fail('domain', `${name} is undefined here.`) : v);

/** A float that is about to be rounded to an integer must not be sitting on the boundary. */
function settled(v: number, what: string) {
  if (Math.abs(v - Math.round(v)) < 1e-9 * Math.max(1, Math.abs(v))) fail('unstable', `${what} of a value this close to an integer cannot be decided numerically.`);
  return v;
}

/** Reads a limit point, which unlike any other value may be ±inf. */
function limitPoint(n: Node, scope: Scope, meter: Meter): number {
  if (n.k === 'sym' && n.name === 'inf' && !scope.vars.has('inf')) return Infinity;
  if (n.k === 'neg' && n.a.k === 'sym' && n.a.name === 'inf') return -Infinity;
  return realNumber(evaluate(n, scope, meter), 'A limit point');
}

/** A real function of one bound variable, for integrating and taking limits numerically. */
function realFunction(body: Node, variable: string, scope: Scope, meter: Meter) {
  return (x: number) => {
    const vars = new Map(scope.vars); vars.set(variable, approx(x));
    const value = evaluate(body, { ...scope, vars }, meter);
    return realNumber(value, 'An integrand or a limit');
  };
}

function bound(n: Node | undefined, what: string): string {
  if (n?.k !== 'sym') return fail('syntax', `${what} needs a variable name as its second argument.`);
  return n.name;
}

function statistic(name: string, values: Num[]): Num {
  const real = values.map((v) => requireReal(v, 'A statistic'));
  if (!real.length) return fail('syntax', `${name} needs at least one value.`);
  const total = real.reduce(add, ZERO);
  const mean = div(total, int(real.length));
  if (name === 'mean') return mean;
  if (name === 'median') {
    const sorted = [...real].sort(compare), middle = Math.floor(sorted.length / 2);
    return sorted.length % 2 ? sorted[middle] : div(add(sorted[middle - 1], sorted[middle]), int(2));
  }
  const squares = real.reduce((s, v) => add(s, mul(sub(v, mean), sub(v, mean))), ZERO);
  const sample = name === 'svar' || name === 'ssd';
  if (sample && real.length < 2) fail('domain', 'A sample variance needs at least two values.');
  const variance = div(squares, int(sample ? real.length - 1 : real.length));
  return name === 'var' || name === 'svar' ? variance : sqrt(variance);
}

/**
 * The value of an expression. Symbols are the scope's variables first and the constants pi, e and i
 * after, so a sum may run over i or a problem may name a length e without either being misread.
 */
export function evaluate(n: Node, scope: Scope, meter: Meter = newMeter()): Num {
  const value = compute(n, scope, meter);
  if (scope.real && !isReal(value)) fail('domain', 'The value is not a real number here.');
  return value;
}

function compute(n: Node, scope: Scope, meter: Meter): Num {
  if (++meter.work > maxWork) fail('bounded', 'The claim takes too much work to compute.');
  const ev = (m: Node) => evaluate(m, scope, meter);
  switch (n.k) {
    case 'num': return exact(n.q);
    case 'sym': {
      const bound = scope.vars.get(n.name);
      if (bound) return bound;
      if (n.name === 'pi') return approx(Math.PI);
      if (n.name === 'e') return approx(Math.E);
      if (n.name === 'i') return approx(0, 1);
      if (n.name === 'inf') return fail('unsupported', 'inf can only be a limit point.');
      return fail('unbound', `Unknown symbol "${n.name}". Give it a value or declare it as an unknown.`);
    }
    case 'neg': return neg(ev(n.a));
    case 'add': return add(ev(n.a), ev(n.b));
    case 'sub': return sub(ev(n.a), ev(n.b));
    case 'mul': return mul(ev(n.a), ev(n.b));
    case 'div': return div(ev(n.a), ev(n.b));
    case 'pow': {
      const exponent = ev(n.b);
      const base = exponent.q && exponent.q.d !== 1n ? snapped(ev(n.a), scope) : ev(n.a);
      return pow(base, exponent);
    }
    case 'fact': return exact(q(factorial(wholeNumber(ev(n.a), 'A factorial', 1000n), meter)));
    case 'deg': return mul(ev(n.a), approx(Math.PI / 180));
    case 'call': return call(n.name, n.args, scope, meter);
  }
}

function call(name: string, args: Node[], scope: Scope, meter: Meter): Num {
  const ev = (m: Node) => evaluate(m, scope, meter);
  const arity = (count: number | [number, number]) => {
    const [low, high] = typeof count === 'number' ? [count, count] : count;
    if (args.length < low || args.length > high) fail('syntax', `${name} takes ${low === high ? low : `${low}–${high}`} argument(s).`);
  };
  const user = scope.functions.get(name);
  if (user) {
    arity(user.params.length);
    if (++meter.depth > 20) fail('bounded', 'Functions call each other too deeply.');
    const vars = new Map(scope.vars);
    user.params.forEach((p, i) => vars.set(p, ev(args[i])));
    const value = evaluate(user.body, { ...scope, vars }, meter);
    meter.depth--;
    return value;
  }
  switch (name) {
    case 'sum': case 'prod': {
      arity(4);
      const variable = bound(args[1], name);
      const from = asInteger(ev(args[2])), to = asInteger(ev(args[3]));
      if (from === null || to === null) return fail('domain', `${name} needs whole-number bounds.`);
      if (to - from > 100_000n) return fail('bounded', `${name} runs over too many terms.`);
      let total = name === 'sum' ? ZERO : ONE;
      for (let k = from; k <= to; k++) {
        const vars = new Map(scope.vars); vars.set(variable, exact(q(k)));
        const term = evaluate(args[0], { ...scope, vars }, meter);
        total = name === 'sum' ? add(total, term) : mul(total, term);
      }
      return total;
    }
    case 'diff': {
      arity([3, 4]);
      const variable = bound(args[1], 'diff');
      const order = args[3] ? asInteger(ev(args[3])) : 1n;
      if (order === null || order < 1n || order > 6n) return fail('domain', 'A derivative order must be 1 to 6.');
      let d = args[0];
      for (let k = 0n; k < order; k++) d = derivative(d, variable, scope.functions);
      const vars = new Map(scope.vars); vars.set(variable, ev(args[2]));
      return evaluate(d, { ...scope, vars }, meter);
    }
    case 'integral': {
      arity(4);
      const variable = bound(args[1], 'integral');
      const a = limitPoint(args[2], scope, meter), b = limitPoint(args[3], scope, meter);
      meter.estimated = true;
      return approx(integrate(realFunction(args[0], variable, scope, meter), a, b));
    }
    case 'limit': {
      arity([3, 4]);
      const variable = bound(args[1], 'limit');
      const at = limitPoint(args[2], scope, meter);
      const side = args[3] ? asInteger(ev(args[3])) : 0n;
      if (side !== -1n && side !== 0n && side !== 1n) return fail('domain', 'A limit side must be -1, 0 or 1.');
      meter.estimated = true;
      return approx(limit(realFunction(args[0], variable, scope, meter), at, Number(side) as -1 | 0 | 1));
    }
    case 'mean': case 'median': case 'var': case 'sd': case 'svar': case 'ssd':
      return statistic(name, args.map(ev));
    case 'min': case 'max': {
      if (!args.length) fail('syntax', `${name} needs at least one value.`);
      return args.map((a) => requireReal(ev(a), name)).reduce((best, v) => (compare(v, best) * (name === 'max' ? 1 : -1) > 0 ? v : best));
    }
    case 'gcd': case 'lcm': {
      if (args.length < 2) fail('syntax', `${name} needs at least two values.`);
      const values = args.map((a) => { const v = asInteger(ev(a)); return v === null ? fail('domain', `${name} needs whole numbers.`) : v < 0n ? -v : v; });
      const g = (a: bigint, b: bigint): bigint => { while (b) [a, b] = [b, a % b]; return a; };
      return exact(q(values.reduce((acc, v) => (name === 'gcd' ? g(acc, v) : acc === 0n || v === 0n ? 0n : (acc / g(acc, v)) * v))));
    }
    case 'mod': {
      arity(2);
      const a = asInteger(ev(args[0])), m = asInteger(ev(args[1]));
      if (a === null || m === null || m <= 0n) return fail('domain', 'mod needs a whole number and a positive modulus.');
      return exact(q(((a % m) + m) % m));
    }
    case 'factorial': arity(1); return exact(q(factorial(wholeNumber(ev(args[0]), 'A factorial', 1000n), meter)));
    case 'nCr': case 'nPr': case 'nHr': {
      arity(2);
      const n = wholeNumber(ev(args[0]), name), r = wholeNumber(ev(args[1]), name);
      if (name === 'nCr') return exact(q(choose(n, r, meter)));
      if (name === 'nHr') return exact(q(n === 0n && r === 0n ? 1n : choose(n + r - 1n, r, meter)));
      return exact(q(r > n ? 0n : falling(n, r, meter)));
    }
  }
  // The rest take one value, except log and root which may take two.
  if (name === 'log') {
    arity([1, 2]);
    return args.length === 1 ? log(int(10), ev(args[0])) : log(ev(args[0]), ev(args[1]));
  }
  if (name === 'root') {
    arity(2);
    const index = asInteger(ev(args[1]));
    if (index === null || index < 2n) return fail('domain', 'A root index must be a whole number of at least 2.');
    return pow(snapped(ev(args[0]), scope), exact(q(1n, index)));
  }
  if (name === 'dpow') {
    // c·u^(c−1), the power rule's own term: it is 0 when c is 0 and 1 when u is 0 and c is 1, even
    // though 0⁰ and 0⁻¹ are undefined, because the derivative of x⁰ and of x at 0 are 0 and 1.
    arity(2);
    const u = ev(args[0]), c = ev(args[1]);
    if (isZero(c)) return ZERO;
    if (isZero(u) && c.q && c.q.n === c.q.d) return ONE;
    return mul(c, pow(u, sub(c, ONE)));
  }
  arity(1);
  const x = name === 'sqrt' ? snapped(ev(args[0]), scope) : ev(args[0]);
  const zero = isZero(x);
  switch (name) {
    case 'sqrt': return sqrt(x);
    case 'cbrt': return pow(x, exact(q(1n, 3n)));
    case 'abs': return abs(x);
    case 'exp': return exp(x);
    case 'ln': return ln(x);
    case 'sin': return zero ? ZERO : complexSin(x);
    case 'cos': return zero ? ONE : complexCos(x);
    // Where the denominator is zero in exact arithmetic it comes out as about 1e-17 in floating
    // point, so tan 90° would be a large number instead of undefined.
    case 'tan': return zero ? ZERO : div(complexSin(x), nonzero(complexCos(x), name));
    case 'sec': return div(ONE, nonzero(complexCos(x), name));
    case 'csc': return div(ONE, nonzero(complexSin(x), name));
    case 'cot': return div(complexCos(x), nonzero(complexSin(x), name));
    case 'asin': case 'arcsin': case 'acos': case 'arccos': {
      const v = realNumber(x, name);
      if (Math.abs(v) > 1 + 1e-12) fail('domain', `${name} needs a value between -1 and 1.`);
      const clamped = Math.max(-1, Math.min(1, v));
      if (zero && name.endsWith('sin')) return ZERO;
      return approx(name.endsWith('sin') ? Math.asin(clamped) : Math.acos(clamped));
    }
    case 'atan': case 'arctan': return zero ? ZERO : approx(Math.atan(realNumber(x, name)));
    case 'sinh': return zero ? ZERO : approx(Math.sinh(realNumber(x, name)));
    case 'cosh': return zero ? ONE : approx(Math.cosh(realNumber(x, name)));
    case 'tanh': return zero ? ZERO : approx(Math.tanh(realNumber(x, name)));
    case 'floor': case 'ceil': case 'round': case 'sign': {
      const real = requireReal(x, name);
      if (real.q) {
        const { n: top, d: bottom } = real.q;
        const floor = top >= 0n ? top / bottom : -((-top + bottom - 1n) / bottom);
        if (name === 'floor') return int(floor);
        if (name === 'ceil') return int(floor * bottom === top ? floor : floor + 1n);
        if (name === 'sign') return int(top > 0n ? 1 : top < 0n ? -1 : 0);
        // Half rounds away from zero, as it does at school.
        const twice = (2n * (top < 0n ? -top : top) + bottom) / (2n * bottom);
        return int(top < 0n ? -twice : twice);
      }
      if (name === 'sign') {
        // A float within rounding of zero may be exactly zero, and then its sign is 0, not ±1.
        if (Math.abs(real.re) < 1e-12) fail('unstable', 'The sign of a value this close to zero cannot be decided numerically.');
        return approx(Math.sign(real.re));
      }
      const v = name === 'round' ? settled(real.re + 0.5, 'Rounding') - 0.5 : settled(real.re, name);
      return int(name === 'ceil' ? Math.ceil(v) : name === 'floor' ? Math.floor(v) : real.re < 0 ? -Math.round(-real.re) : Math.round(real.re));
    }
  }
  return fail('unsupported', `Unknown function ${name}.`);
}

/** The value of an expression with every free symbol bound. */
export const valueOf = (n: Node, scope: Scope = emptyScope, meter?: Meter) => evaluate(n, scope, meter);
export { isReal, realPart };
