import { build } from './calculus';
import { evaluate, type Meter, type Scope } from './evaluate';
import { mentions, substitute, type Node, type RelOp, type Relation } from './expr';
import {
  add, approx, asInteger, CheckFailure, compare, div, exact, fail, int, isReal, isZero, q, realPart, same, sub, weakest,
  type Num, type Strength,
} from './numbers';
import { linearForm, peval, rationalFunction, rationalZeros, solveLinear, type RationalFunction, type Root } from './polynomial';

/**
 * Solving, done so that nothing is lost: every method here produces a set of candidates that holds
 * all the solutions — the zeros of a numerator, both branches of an absolute value, the squared form
 * of a radical equation — and the candidates are then put back into the original equation. A
 * candidate that does not satisfy it (a zero of a denominator, an extraneous root of squaring) is
 * dropped there, so the result is the solution set and not a superset of it.
 */
const { num, Neg, Add, Sub, Mul, Div, Pow } = build;

function find(n: Node, test: (m: Node) => boolean): Node | null {
  if (test(n)) return n;
  switch (n.k) {
    case 'num': case 'sym': return null;
    case 'neg': case 'fact': case 'deg': return find(n.a, test);
    case 'call': for (const arg of n.args) { const hit = find(arg, test); if (hit) return hit; } return null;
    default: return find(n.a, test) ?? find(n.b, test);
  }
}
/** Replaces one node, found by identity, everywhere it occurs. */
function replace(n: Node, target: Node, by: Node): Node {
  if (n === target) return by;
  switch (n.k) {
    case 'num': case 'sym': return n;
    case 'neg': case 'fact': case 'deg': return { ...n, a: replace(n.a, target, by) };
    case 'call': return { ...n, args: n.args.map((arg) => replace(arg, target, by)) };
    default: return { ...n, a: replace(n.a, target, by), b: replace(n.b, target, by) };
  }
}
const isSquareRoot = (m: Node) =>
  (m.k === 'call' && (m.name === 'sqrt' || (m.name === 'root' && m.args[1]?.k === 'num' && m.args[1].q.n === 2n && m.args[1].q.d === 1n)))
  || (m.k === 'pow' && m.b.k === 'num' && m.b.q.n === 1n && m.b.q.d === 2n);
const radicand = (m: Node) => (m.k === 'call' ? m.args[0] : (m as { a: Node }).a);

/** The coefficients of n as a polynomial in the symbol s, as expressions, or null. */
function polynomialIn(n: Node, s: string, scope: Scope, meter: Meter): Node[] | null {
  if (!mentions(n, s)) return [n];
  switch (n.k) {
    case 'sym': return [num(0n), num(1n)];
    case 'neg': { const a = polynomialIn(n.a, s, scope, meter); return a && a.map(Neg); }
    case 'add': case 'sub': {
      const a = polynomialIn(n.a, s, scope, meter), b = polynomialIn(n.b, s, scope, meter);
      if (!a || !b) return null;
      return Array.from({ length: Math.max(a.length, b.length) }, (_, i) => (n.k === 'add' ? Add : Sub)(a[i] ?? num(0n), b[i] ?? num(0n)));
    }
    case 'mul': {
      const a = polynomialIn(n.a, s, scope, meter), b = polynomialIn(n.b, s, scope, meter);
      if (!a || !b) return null;
      const out: Node[] = Array.from({ length: a.length + b.length - 1 }, () => num(0n));
      a.forEach((x, i) => b.forEach((y, j) => { out[i + j] = Add(out[i + j], Mul(x, y)); }));
      return out;
    }
    case 'div': {
      if (mentions(n.b, s)) return null;
      const a = polynomialIn(n.a, s, scope, meter);
      return a && a.map((c) => Div(c, n.b));
    }
    case 'pow': {
      if (mentions(n.b, s)) return null;
      const exponent = asInteger(evaluate(n.b, scope, meter));
      if (exponent === null || exponent < 0n || exponent > 12n) return null;
      const base = polynomialIn(n.a, s, scope, meter);
      if (!base) return null;
      let out: Node[] = [num(1n)];
      for (let k = 0n; k < exponent; k++) {
        const next: Node[] = Array.from({ length: out.length + base.length - 1 }, () => num(0n));
        out.forEach((x, i) => base.forEach((y, j) => { next[i + j] = Add(next[i + j], Mul(x, y)); }));
        out = next;
      }
      return out;
    }
    default: return null;
  }
}

/**
 * A set of numbers that contains every zero of h, or null when no method here applies.
 *
 * `rational` is the p/q the zeros came from, when they did: then multiplicity means something (a
 * repeated root of a polynomial) and the size of its terms says how much rounding to expect. Zeros
 * gathered from the branches of |u| or from squaring a root are a list of distinct values, each
 * counted once — a root two branches share is still one root.
 */
export type Candidates = { roots: Root[]; rational: RationalFunction | null; exact: boolean };
const distinct = (roots: Root[]): Root[] =>
  roots.filter((r, i) => roots.findIndex((o) => same(o.value, r.value).equal) === i).map((r) => ({ value: r.value, multiplicity: 1 }));

export function zeroCandidates(h: Node, v: string, scope: Scope, meter: Meter, domain: 'real' | 'complex' = 'real', depth = 0): Candidates | null {
  if (depth > 6) return null;
  const rational = rationalFunction(h, v, scope, meter);
  if (rational) return { roots: rationalZeros(rational), rational, exact: [...rational.num, ...rational.den].every((c) => !!c.q) };
  // |u| = u or −u, and every zero of h is a zero of one of the two branches — when u is real.
  const absolute = find(h, (m) => m.k === 'call' && m.name === 'abs' && mentions(m, v));
  if (absolute && absolute.k === 'call') {
    if (domain === 'complex') return fail('unsupported', 'An absolute value of a complex unknown cannot be split into ±; its solutions are not checked here.');
    const out: Root[] = [];
    let exactly = true;
    for (const branch of [absolute.args[0], Neg(absolute.args[0])]) {
      const zeros = zeroCandidates(replace(h, absolute, branch), v, scope, meter, domain, depth + 1);
      if (!zeros) return null;
      out.push(...zeros.roots);
      exactly &&= zeros.exact;
    }
    return { roots: distinct(out), rational: null, exact: exactly };
  }
  // With s = √u, h is A + B·s once s² is written as u, and every zero satisfies A² = B²·u.
  const root = find(h, (m) => isSquareRoot(m) && mentions(m, v));
  if (root) {
    const u = radicand(root), s = '\u0000s';
    const coefficients = polynomialIn(replace(h, root, { k: 'sym', name: s }), s, scope, meter);
    if (!coefficients) return null;
    let a: Node = num(0n), b: Node = num(0n);
    coefficients.forEach((c, k) => {
      const term = Mul(c, Pow(u, num(BigInt(Math.floor(k / 2)))));
      if (k % 2) b = Add(b, term); else a = Add(a, term);
    });
    const zeros = zeroCandidates(Sub(Pow(a, num(2n)), Mul(Pow(b, num(2n)), u)), v, scope, meter, domain, depth + 1);
    return zeros && { roots: distinct(zeros.roots), rational: null, exact: zeros.exact };
  }
  return null;
}

/** Real zeros of f on [lo, hi] by sampling, bisection at sign changes, and refinement at touching minima. */
function scanZeros(f: (x: number) => number | null, lo: number, hi: number): number[] {
  const count = 4000, xs: number[] = [], ys: (number | null)[] = [];
  for (let i = 0; i <= count; i++) { const x = lo + ((hi - lo) * i) / count; xs.push(x); ys.push(f(x)); }
  const found: number[] = [];
  const bisect = (a: number, b: number, fa: number) => {
    for (let k = 0; k < 200; k++) {
      const m = (a + b) / 2, fm = f(m);
      if (fm === null) return null;
      if (fm === 0 || b - a <= 1e-15 * Math.max(1, Math.abs(m))) return m;
      if (Math.sign(fm) === Math.sign(fa)) { a = m; fa = fm; } else b = m;
    }
    return (a + b) / 2;
  };
  const golden = (a: number, b: number) => {
    const ratio = (Math.sqrt(5) - 1) / 2, g = (x: number) => Math.abs(f(x) ?? Infinity);
    for (let k = 0; k < 200 && b - a > 1e-15 * Math.max(1, Math.abs(a)); k++) {
      const c = b - ratio * (b - a), d = a + ratio * (b - a);
      if (g(c) < g(d)) b = d; else a = c;
    }
    return (a + b) / 2;
  };
  // An end of the interval is a candidate whatever its sign: sin(2π) is −2.4e-16, not 0, and there is
  // no sample beyond it to change sign against. The equation itself decides whether it is a root.
  if (ys[0] !== null) found.push(lo);
  if (ys[count] !== null) found.push(hi);
  for (let i = 0; i <= count; i++) {
    const y = ys[i];
    if (y === null) continue;
    if (y === 0) { found.push(xs[i]); continue; }
    const next = ys[i + 1];
    if (next !== null && next !== undefined && next !== 0 && Math.sign(next) !== Math.sign(y)) {
      const r = bisect(xs[i], xs[i + 1], y);
      if (r !== null) found.push(r);
    }
    const before = ys[i - 1];
    if (i > 0 && i < count && before !== null && before !== undefined && next !== null && next !== undefined
      && Math.abs(y) < Math.abs(before) && Math.abs(y) < Math.abs(next) && Math.sign(before) === Math.sign(y) && Math.sign(next) === Math.sign(y)) {
      found.push(golden(xs[i - 1], xs[i + 1]));
    }
  }
  return found;
}

export type Solution = ReadonlyMap<string, Num>;
export type SolveResult = { solutions: { values: Solution; multiplicity: number }[]; strength: Strength };
type Bounds = { lo: Num | null; hi: Num | null; test: (x: Num) => boolean };

/** The interval a `where` condition like `0 <= x < 2pi` describes, and a membership test for it. */
export function bounds(where: Relation | undefined, v: string, scope: Scope, meter: Meter): Bounds {
  if (!where) return { lo: null, hi: null, test: () => true };
  const test = (x: Num) => holds(where, new Map([[v, x]]), scope, meter);
  let lo: Num | null = null, hi: Num | null = null;
  for (let i = 0; i < where.terms.length; i++) {
    const t = where.terms[i];
    if (t.k !== 'sym' || t.name !== v) continue;
    const left = where.ops[i - 1], right = where.ops[i];
    if (left === '<' || left === '<=') lo = evaluate(where.terms[i - 1], scope, meter);
    if (left === '>' || left === '>=') hi = evaluate(where.terms[i - 1], scope, meter);
    if (right === '<' || right === '<=') hi = evaluate(where.terms[i + 1], scope, meter);
    if (right === '>' || right === '>=') lo = evaluate(where.terms[i + 1], scope, meter);
  }
  return { lo, hi, test };
}

/** Whether a relation chain holds at the given values. Domain failures count as not holding. */
export function holds(relation: Relation, values: Solution, scope: Scope, meter: Meter): boolean {
  const vars = new Map(scope.vars);
  values.forEach((v, k) => vars.set(k, v));
  const inner = { ...scope, vars };
  try {
    const sides = relation.terms.map((t) => evaluate(t, inner, meter));
    return relation.ops.every((op, i) => compareOp(sides[i], op, sides[i + 1]));
  } catch (reason) {
    if (reason instanceof CheckFailure && (reason.code === 'domain' || reason.code === 'unstable')) return false;
    throw reason;
  }
}
function compareOp(a: Num, op: RelOp, b: Num): boolean {
  if (op === '=' || op === '!=') return same(a, b).equal === (op === '=');
  if (!isReal(a) || !isReal(b)) return false;
  const c = compare(realPart(a), realPart(b));
  return op === '<' ? c < 0 : op === '<=' ? c <= 0 : op === '>' ? c > 0 : c >= 0;
}

/** Σ|cᵢ||x|ⁱ over the numerator, divided by |q(x)|: the size of the terms whose rounding the residual carries. */
function magnitude(r: RationalFunction, x: Num): number {
  const size = Math.hypot(x.re, x.im);
  const terms = r.num.reduce((sum, c, i) => sum + Math.hypot(c.re, c.im) * size ** i, 0);
  const den = peval(r.den, x);
  return terms / Math.max(1e-300, Math.hypot(den.re, den.im));
}

/** Every solution of one equation in one unknown, kept to the domain and the `where` condition. */
function solveOne(left: Node, right: Node, v: string, domain: 'real' | 'complex', where: Bounds, scope: Scope, meter: Meter): SolveResult {
  const h = Sub(left, right);
  // Over the reals every step must be real: √x·√(x−5) = −6 is not solved by x = −4, although 2i·3i is −6.
  const inScope: Scope = domain === 'real' ? { ...scope, real: true } : scope;
  let candidates: Candidates | null;
  try { candidates = zeroCandidates(h, v, scope, meter, domain); }
  catch (reason) {
    if (reason instanceof CheckFailure && reason.message.startsWith('The equation holds for every value')) return fail('ill-posed', 'The equation holds for every value of the unknown.');
    throw reason;
  }
  let strength: Strength = 'exact';
  let scanned = false;
  if (!candidates) {
    // Nothing exact applies — a sine, an exponential, a logarithm of the unknown. Search a stated interval.
    if (!where.lo || !where.hi) return fail('unsupported', `Solving this equation needs a bounded "where" interval for ${v}, like "0 <= ${v} < 2pi".`);
    const lo = where.lo.re, hi = where.hi.re;
    const f = (x: number) => {
      try {
        const vars = new Map(scope.vars); vars.set(v, approx(x));
        const value = evaluate(h, { ...inScope, vars }, meter);
        return isReal(value) ? value.re : null;
      } catch (reason) { if (reason instanceof CheckFailure && reason.code !== 'bounded') return null; throw reason; }
    };
    candidates = { roots: scanZeros(f, lo, hi).map((x) => ({ value: approx(x), multiplicity: 1 })), rational: null, exact: false };
    strength = 'estimated';
    scanned = true;
  }
  if (!candidates.exact) strength = weakest(strength, 'numeric');
  const kept: { values: Solution; multiplicity: number }[] = [];
  for (const candidate of candidates.roots) {
    const value = isReal(candidate.value) ? realPart(candidate.value) : candidate.value;
    if (domain === 'real' && !isReal(value)) continue;
    if (!where.test(value)) continue;
    const slack = candidates.rational ? magnitude(candidates.rational, value) : 0;
    const check = satisfies([[left, right]], new Map([[v, value]]), inScope, meter, false, slack);
    if (!check) {
      // A zero of the numerator that is not a zero of the denominator is a root; if it does not
      // check, the arithmetic is what failed, and dropping it would shrink the solution set unseen.
      if (candidates.rational) return fail('unstable', `A root near ${value.re} could not be confirmed numerically.`);
      continue;
    }
    strength = weakest(strength, check, value.q ? 'exact' : 'numeric');
    const twin = kept.find((k) => same(k.values.get(v)!, value).equal);
    if (twin) twin.multiplicity = Math.max(twin.multiplicity, candidate.multiplicity);
    else kept.push({ values: new Map([[v, value]]), multiplicity: candidate.multiplicity });
  }
  return { solutions: kept, strength: scanned ? 'estimated' : strength };
}

/** The strength with which every equation holds at the values, or null when one does not. */
export function satisfies(equations: [Node, Node][], values: Solution, scope: Scope, meter: Meter, estimated = false, slack = 0): Strength | null {
  const vars = new Map(scope.vars);
  values.forEach((v, k) => vars.set(k, v));
  let strength: Strength = 'exact';
  for (const [left, right] of equations) {
    try {
      const a = evaluate(left, { ...scope, vars }, meter), b = evaluate(right, { ...scope, vars }, meter);
      const result = same(a, b, estimated, slack);
      if (!result.equal) return null;
      strength = weakest(strength, result.strength);
    } catch (reason) {
      if (reason instanceof CheckFailure && (reason.code === 'domain' || reason.code === 'unstable')) return null;
      throw reason;
    }
  }
  return strength;
}

/**
 * Every solution of a system. A linear system is eliminated exactly; otherwise an unknown that one
 * equation gives linearly, with a constant coefficient, is substituted away — which loses nothing,
 * because that equation determines it — until one equation in one unknown is left.
 */
export function solveSystem(equations: [Node, Node][], unknowns: string[], domain: 'real' | 'complex', where: Bounds, scope: Scope, meter: Meter): SolveResult {
  if (unknowns.length === 1) {
    const [first, ...rest] = equations;
    const result = solveOne(first[0], first[1], unknowns[0], domain, where, scope, meter);
    if (!rest.length) return result;
    const kept = result.solutions.filter((s) => satisfies(rest, s.values, scope, meter, result.strength === 'estimated'));
    return { solutions: kept, strength: result.strength };
  }
  const forms = equations.map(([l, r]) => linearForm(Sub(l, r), unknowns, scope, meter));
  if (forms.every((f) => f !== null)) {
    const solved = solveLinear(forms as NonNullable<(typeof forms)[number]>[], unknowns.length);
    if (solved.kind === 'infinite') return fail('ill-posed', 'The system has infinitely many solutions.');
    if (solved.kind === 'none') return { solutions: [], strength: 'exact' };
    const values = new Map(unknowns.map((u, i) => [u, solved.values[i]]));
    const strength = satisfies(equations, values, scope, meter);
    if (!strength) return fail('unstable', 'The linear system could not be solved accurately.');
    return { solutions: [{ values, multiplicity: 1 }], strength: weakest(strength, ...solved.values.map((v) => (v.q ? 'exact' : 'numeric') as Strength)) };
  }
  for (const [index, [l, r]] of equations.entries()) {
    for (const u of unknowns) {
      const others = unknowns.filter((o) => o !== u);
      let coefficients: Node[] | null;
      try { coefficients = polynomialIn(Sub(l, r), u, scope, meter); }
      catch (reason) { if (reason instanceof CheckFailure) continue; throw reason; }
      if (!coefficients || coefficients.length !== 2) continue;
      const [constantPart, slope] = coefficients;
      // A coefficient that mentions another unknown could vanish at a solution, and dividing by it
      // would lose that solution; only a constant, nonzero coefficient is safe to divide by.
      if (others.some((o) => mentions(slope, o))) continue;
      let lead: Num;
      try { lead = evaluate(slope, scope, meter); } catch (reason) { if (reason instanceof CheckFailure) continue; throw reason; }
      if (isZero(lead)) continue;
      const solvedFor = Neg(Div(constantPart, slope));
      const rest = equations.filter((_, i) => i !== index).map(([a, b]) => [substitute(a, new Map([[u, solvedFor]])), substitute(b, new Map([[u, solvedFor]]))] as [Node, Node]);
      if (!rest.length) return fail('unsupported', 'The system has fewer equations than unknowns.');
      const reduced = solveSystem(rest, others, domain, where, scope, meter);
      const solutions: SolveResult['solutions'] = [];
      let strength = reduced.strength;
      for (const s of reduced.solutions) {
        const vars = new Map(scope.vars); s.values.forEach((value, k) => vars.set(k, value));
        const value = evaluate(solvedFor, { ...scope, vars }, meter);
        if (domain === 'real' && !isReal(value)) continue;
        const full = new Map(s.values); full.set(u, isReal(value) ? realPart(value) : value);
        const check = satisfies(equations, full, scope, meter, strength === 'estimated');
        if (!check) continue;
        strength = weakest(strength, check);
        solutions.push({ values: full, multiplicity: 1 });
      }
      return { solutions, strength };
    }
  }
  return fail('unsupported', 'This system is not linear and no equation gives an unknown linearly; it cannot be solved here yet.');
}

export type End = { value: Num | null; closed: boolean };
/** One piece of a solution set; a missing end is infinite. A single point has equal closed ends. */
export type Interval = { lo: End; hi: End };

/** The set of real values satisfying an inequality chain in one variable. */
export function solveInequality(relation: Relation, v: string, outer: Scope, meter: Meter): { set: Interval[]; strength: Strength } {
  if (relation.ops.some((op) => op === '=' || op === '!=')) return fail('unsupported', 'An inequality claim may use only <, <=, > and >=.');
  // An inequality compares real numbers, so every step must be real.
  const scope: Scope = { ...outer, real: true };
  let set: Interval[] = [{ lo: { value: null, closed: false }, hi: { value: null, closed: false } }];
  let strength: Strength = 'exact';
  for (let i = 0; i < relation.ops.length; i++) {
    const part = solvePair(relation.terms[i], relation.ops[i], relation.terms[i + 1], v, scope, meter);
    set = intersect(set, part.set);
    strength = weakest(strength, part.strength);
  }
  return { set, strength };
}

function solvePair(left: Node, op: RelOp, right: Node, v: string, scope: Scope, meter: Meter): { set: Interval[]; strength: Strength } {
  const h = Sub(left, right);
  const breaks: Num[] = [];
  const addZeros = (m: Node) => {
    const zeros = zeroCandidates(m, v, scope, meter);
    if (!zeros) return fail('unsupported', 'This inequality cannot be solved here yet.');
    zeros.roots.forEach((z) => { if (isReal(z.value)) breaks.push(realPart(z.value)); });
  };
  addZeros(h);
  // Where h is undefined or its formula changes, the sign may change without passing through zero.
  const visit = (m: Node) => {
    if (!mentions(m, v)) return;
    if (m.k === 'div') addZeros(m.b);
    // x⁻² is 1/x² — a pole as much as a written denominator; a fractional power has a domain edge.
    if (m.k === 'pow' && !mentions(m.b, v)) {
      const exponent = evaluate(m.b, scope, meter);
      if (!exponent.q || exponent.q.d !== 1n || exponent.q.n < 0n) addZeros(m.a);
    }
    if (isSquareRoot(m) || (m.k === 'call' && (m.name === 'ln' || m.name === 'log'))) addZeros(m.k === 'call' ? m.args[m.args.length - 1] : (m as { a: Node }).a);
    switch (m.k) {
      case 'num': case 'sym': return;
      case 'neg': case 'fact': case 'deg': visit(m.a); return;
      case 'call': m.args.forEach(visit); return;
      default: visit(m.a); visit(m.b);
    }
  };
  visit(h);
  const points = breaks.sort(compare).filter((p, i, all) => i === 0 || compare(p, all[i - 1]) !== 0);
  const relation: Relation = { terms: [left, right], ops: [op] };
  const member = (x: Num) => holds(relation, new Map([[v, x]]), scope, meter);
  const two = exact(q(2n));
  const sample = (i: number): Num => {
    if (!points.length) return int(0);
    if (i === 0) return sub(points[0], add(int(1), absolute(points[0])));
    if (i === points.length) return add(points[points.length - 1], add(int(1), absolute(points[points.length - 1])));
    return div(add(points[i - 1], points[i]), two);
  };
  const regions = Array.from({ length: points.length + 1 }, (_, i) => member(sample(i)));
  const atPoints = points.map(member);
  const set: Interval[] = [];
  let open: Interval | null = null;
  const close = (hi: End) => { if (open) { open.hi = hi; set.push(open); open = null; } };
  for (let i = 0; i <= points.length; i++) {
    const lo = i === 0 ? null : points[i - 1];
    if (regions[i]) {
      if (!open) open = { lo: { value: lo, closed: lo !== null && atPoints[i - 1] }, hi: { value: null, closed: false } };
    } else close({ value: lo, closed: lo !== null && atPoints[i - 1] && !!open });
    if (i < points.length) {
      const p = points[i];
      if (atPoints[i]) { if (!open) open = { lo: { value: p, closed: true }, hi: { value: null, closed: false } }; }
      else close({ value: p, closed: false });
    }
  }
  close({ value: null, closed: false });
  const strength = weakest(...points.map((p) => (p.q ? 'exact' : 'numeric') as Strength));
  return { set, strength };
}
const absolute = (x: Num) => (compare(x, int(0)) < 0 ? sub(int(0), x) : x);

function endBefore(a: End, b: End, side: 'lo' | 'hi'): number {
  if (a.value === null && b.value === null) return 0;
  if (a.value === null) return side === 'lo' ? -1 : 1;
  if (b.value === null) return side === 'lo' ? 1 : -1;
  return compare(a.value, b.value);
}
function intersect(a: Interval[], b: Interval[]): Interval[] {
  const out: Interval[] = [];
  for (const x of a) for (const y of b) {
    const lo = endBefore(x.lo, y.lo, 'lo') > 0 ? x.lo : endBefore(x.lo, y.lo, 'lo') < 0 ? y.lo : { value: x.lo.value, closed: x.lo.closed && y.lo.closed };
    const hi = endBefore(x.hi, y.hi, 'hi') < 0 ? x.hi : endBefore(x.hi, y.hi, 'hi') > 0 ? y.hi : { value: x.hi.value, closed: x.hi.closed && y.hi.closed };
    if (lo.value && hi.value) {
      const c = compare(lo.value, hi.value);
      if (c > 0 || (c === 0 && !(lo.closed && hi.closed))) continue;
    }
    out.push({ lo, hi });
  }
  return out;
}

/** Whether two solution sets are the same set. */
export function sameSet(a: Interval[], b: Interval[]): boolean {
  if (a.length !== b.length) return false;
  const end = (x: End, y: End) => (x.value === null || y.value === null ? x.value === y.value : same(x.value, y.value).equal && x.closed === y.closed);
  return a.every((x, i) => end(x.lo, b[i].lo) && end(x.hi, b[i].hi));
}

/** The integers in a solution set, which must be finite. */
export function integersIn(set: Interval[], naturals: boolean): bigint[] {
  const out: bigint[] = [];
  for (const piece of set) {
    if (piece.hi.value === null || (piece.lo.value === null && !naturals)) return fail('unsupported', 'The solution set has infinitely many integers.');
    const edge = (end: End, side: 'lo' | 'hi'): bigint => {
      const value = end.value!;
      if (value.q) {
        const { n, d } = value.q;
        const floor = n >= 0n ? n / d : -((-n + d - 1n) / d);
        const integral = floor * d === n;
        if (side === 'lo') return integral ? (end.closed ? floor : floor + 1n) : floor + 1n;
        return integral ? (end.closed ? floor : floor - 1n) : floor;
      }
      const x = value.re;
      if (Math.abs(x - Math.round(x)) < 1e-9) return fail('unstable', 'An end of the solution set is too close to an integer to decide numerically.');
      return BigInt(side === 'lo' ? Math.ceil(x) : Math.floor(x));
    };
    let from = piece.lo.value === null ? 1n : edge(piece.lo, 'lo');
    const to = edge(piece.hi, 'hi');
    if (naturals && from < 1n) from = 1n;
    if (to - from > 1_000_000n) return fail('bounded', 'The solution set has too many integers to list.');
    for (let k = from; k <= to; k++) out.push(k);
  }
  return out;
}

export function showSet(set: Interval[]): string {
  if (!set.length) return '∅';
  const fmt = (n: Num) => (n.q ? (n.q.d === 1n ? `${n.q.n}` : `${n.q.n}/${n.q.d}`) : `${Number(n.re.toPrecision(10))}`);
  return set.map((i) => {
    if (i.lo.value && i.hi.value && compare(i.lo.value, i.hi.value) === 0) return `{${fmt(i.lo.value)}}`;
    return `${i.lo.closed ? '[' : '('}${i.lo.value ? fmt(i.lo.value) : '-inf'}, ${i.hi.value ? fmt(i.hi.value) : 'inf'}${i.hi.closed ? ']' : ')'}`;
  }).join(' ∪ ');
}
