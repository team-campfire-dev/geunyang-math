import { evaluate, type Meter, type Scope } from './evaluate';
import { mentions, type Node } from './expr';
import {
  add, approx, asInteger, compare, div, exact, fail, isReal, isZero, mul, nearRational, neg, ONE, q, sqrt, sub, ZERO,
  type Num,
} from './numbers';

/** Coefficients from the constant term up: [c₀, c₁, …]. */
export type Poly = Num[];
/** p/q, the shape every expression built from +, −, ×, ÷ and integer powers of one variable has. */
export type RationalFunction = { num: Poly; den: Poly };

const maxDegree = 40;
const exactPoly = (p: Poly) => p.every((c) => !!c.q);

export function trim(p: Poly): Poly {
  const size = Math.max(0, ...p.map((c) => Math.hypot(c.re, c.im)));
  let end = p.length;
  while (end > 0 && (p[end - 1].q ? p[end - 1].q!.n === 0n : Math.hypot(p[end - 1].re, p[end - 1].im) <= 1e-13 * Math.max(1, size))) end--;
  return p.slice(0, end);
}
export const degree = (p: Poly) => trim(p).length - 1;
function combine(a: Poly, b: Poly, op: (x: Num, y: Num) => Num): Poly {
  return Array.from({ length: Math.max(a.length, b.length) }, (_, i) => op(a[i] ?? ZERO, b[i] ?? ZERO));
}
export const padd = (a: Poly, b: Poly) => trim(combine(a, b, add));
export const psub = (a: Poly, b: Poly) => trim(combine(a, b, sub));
export function pmul(a: Poly, b: Poly): Poly {
  if (!a.length || !b.length) return [];
  const out: Poly = Array.from({ length: a.length + b.length - 1 }, () => ZERO);
  a.forEach((x, i) => b.forEach((y, j) => { out[i + j] = add(out[i + j], mul(x, y)); }));
  return trim(out);
}
export const pscale = (a: Poly, c: Num) => trim(a.map((x) => mul(x, c)));
export const pderiv = (p: Poly) => trim(p.slice(1).map((c, i) => mul(c, exact(q(BigInt(i + 1))))));
export function peval(p: Poly, x: Num): Num {
  let value = ZERO;
  for (let i = p.length - 1; i >= 0; i--) value = add(mul(value, x), p[i]);
  return value;
}
/** Exact or floating long division: p = quotient·d + remainder. */
export function pdivmod(p: Poly, d: Poly): { quotient: Poly; remainder: Poly } {
  const divisor = trim(d);
  if (!divisor.length) return fail('domain', 'Division by the zero polynomial.');
  let remainder = trim(p);
  const quotient: Poly = Array.from({ length: Math.max(0, remainder.length - divisor.length + 1) }, () => ZERO);
  const lead = divisor[divisor.length - 1];
  while (remainder.length >= divisor.length) {
    const shift = remainder.length - divisor.length, factor = div(remainder[remainder.length - 1], lead);
    quotient[shift] = factor;
    const next = remainder.slice();
    divisor.forEach((c, i) => { next[i + shift] = sub(next[i + shift], mul(c, factor)); });
    next.pop();
    remainder = trim(next);
  }
  return { quotient: trim(quotient), remainder };
}
function monic(p: Poly): Poly { const t = trim(p); return t.length ? pscale(t, div(ONE, t[t.length - 1])) : t; }
export function pgcd(a: Poly, b: Poly): Poly {
  let x = trim(a), y = trim(b);
  while (y.length) [x, y] = [y, pdivmod(x, y).remainder];
  return monic(x);
}

/**
 * An expression in `v` as p(v)/q(v), or null when it is not one — a sine, a root or a variable
 * exponent of v. Other symbols must have values in the scope; they become coefficients.
 */
export function rationalFunction(n: Node, v: string, scope: Scope, meter: Meter): RationalFunction | null {
  const constant = (value: Num): RationalFunction => ({ num: trim([value]), den: [ONE] });
  const walk = (m: Node): RationalFunction | null => {
    if (!mentions(m, v)) return constant(evaluate(m, scope, meter));
    switch (m.k) {
      case 'sym': return { num: [ZERO, ONE], den: [ONE] };
      case 'neg': { const a = walk(m.a); return a && { num: a.num.map(neg), den: a.den }; }
      case 'add': case 'sub': {
        const a = walk(m.a), b = walk(m.b);
        if (!a || !b) return null;
        const left = pmul(a.num, b.den), right = pmul(b.num, a.den);
        return bounded({ num: m.k === 'add' ? padd(left, right) : psub(left, right), den: pmul(a.den, b.den) });
      }
      case 'mul': {
        const a = walk(m.a), b = walk(m.b);
        return a && b && bounded({ num: pmul(a.num, b.num), den: pmul(a.den, b.den) });
      }
      case 'div': {
        const a = walk(m.a), b = walk(m.b);
        if (!a || !b) return null;
        if (!trim(b.num).length) return fail('domain', 'Division by zero.');
        return bounded({ num: pmul(a.num, b.den), den: pmul(a.den, b.num) });
      }
      case 'pow': {
        if (mentions(m.b, v)) return null;
        const exponent = asInteger(evaluate(m.b, scope, meter));
        if (exponent === null || exponent > 30n || exponent < -30n) return null;
        const base = walk(m.a);
        if (!base) return null;
        let out: RationalFunction = { num: [ONE], den: [ONE] };
        for (let k = 0n; k < (exponent < 0n ? -exponent : exponent); k++) out = bounded({ num: pmul(out.num, base.num), den: pmul(out.den, base.den) });
        return exponent < 0n ? { num: out.den, den: out.num } : out;
      }
      default: return null;
    }
  };
  const bounded = (r: RationalFunction) => (degree(r.num) > maxDegree || degree(r.den) > maxDegree ? fail('bounded', 'The equation has too high a degree.') : r);
  return walk(n);
}

/** Yun's square-free decomposition over the rationals: p = ∏ factors[i]^(i+1). */
function squareFree(p: Poly): Poly[] {
  const out: Poly[] = [];
  let a = pgcd(p, pderiv(p));
  let b = pdivmod(p, a).quotient, c = pdivmod(pderiv(p), a).quotient, d = psub(c, pderiv(b));
  while (degree(b) > 0) {
    a = pgcd(b, d);
    out.push(a);
    b = pdivmod(b, a).quotient;
    c = pdivmod(d, a).quotient;
    d = psub(c, pderiv(b));
  }
  return out;
}

/** All complex roots of a polynomial with simple roots, by the Aberth–Ehrlich iteration. */
function aberth(p: Poly): Num[] {
  const coefficients = trim(p).map((c) => ({ re: c.re, im: c.im }));
  const n = coefficients.length - 1;
  if (n < 1) return [];
  const lead = coefficients[n];
  const mag = (z: { re: number; im: number }) => Math.hypot(z.re, z.im);
  const cmul = (a: { re: number; im: number }, b: { re: number; im: number }) => ({ re: a.re * b.re - a.im * b.im, im: a.re * b.im + a.im * b.re });
  const cdiv = (a: { re: number; im: number }, b: { re: number; im: number }) => { const m = b.re * b.re + b.im * b.im; return { re: (a.re * b.re + a.im * b.im) / m, im: (a.im * b.re - a.re * b.im) / m }; };
  const radius = 1 + Math.max(...coefficients.slice(0, n).map((c) => mag(c) / mag(lead)));
  let z = Array.from({ length: n }, (_, k) => ({ re: radius * Math.cos((2 * Math.PI * k) / n + 0.4), im: radius * Math.sin((2 * Math.PI * k) / n + 0.4) }));
  const evalAt = (x: { re: number; im: number }) => {
    let value = { re: 0, im: 0 }, slope = { re: 0, im: 0 };
    for (let i = n; i >= 0; i--) { slope = { re: cmul(slope, x).re + value.re, im: cmul(slope, x).im + value.im }; value = { re: cmul(value, x).re + coefficients[i].re, im: cmul(value, x).im + coefficients[i].im }; }
    return { value, slope };
  };
  for (let iteration = 0; iteration < 600; iteration++) {
    let moved = 0;
    z = z.map((zk, k) => {
      const { value, slope } = evalAt(zk);
      if (mag(value) === 0) return zk;
      const w = cdiv(value, slope);
      let s = { re: 0, im: 0 };
      z.forEach((zj, j) => { if (j !== k) { const r = cdiv({ re: 1, im: 0 }, { re: zk.re - zj.re, im: zk.im - zj.im }); s = { re: s.re + r.re, im: s.im + r.im }; } });
      const ws = cmul(w, s);
      const step = cdiv(w, { re: 1 - ws.re, im: -ws.im });
      moved = Math.max(moved, mag(step) / Math.max(1, mag(zk)));
      return { re: zk.re - step.re, im: zk.im - step.im };
    });
    if (moved < 1e-15) break;
  }
  return z.map((r) => {
    // A few Newton steps against the polynomial itself tighten each root.
    let x = r;
    for (let k = 0; k < 4; k++) { const { value, slope } = evalAt(x); if (mag(slope) === 0) break; const step = cdiv(value, slope); x = { re: x.re - step.re, im: x.im - step.im }; }
    return Math.abs(x.im) <= 1e-10 * Math.max(1, Math.abs(x.re)) ? approx(x.re) : approx(x.re, x.im);
  });
}

/** Roots of a square-free factor, exact when they are rational (or when a quadratic's discriminant is a square). */
function simpleRoots(p: Poly): Num[] {
  const t = trim(p), n = t.length - 1;
  if (n < 1) return [];
  if (n === 1) return [div(neg(t[0]), t[1])];
  if (n === 2) {
    const [c, b, a] = t, disc = sqrt(sub(mul(b, b), mul(exact(q(4n)), mul(a, c))));
    const twoA = mul(exact(q(2n)), a);
    return [div(add(neg(b), disc), twoA), div(sub(neg(b), disc), twoA)];
  }
  const roots = aberth(t);
  if (!exactPoly(t)) return roots;
  // A floating root that is a small fraction is tried exactly, and deflated out so the rest stay accurate.
  const found: Num[] = [];
  let rest = t;
  for (const r of roots) {
    if (!isReal(r)) continue;
    const candidate = nearRational(r.re, 1_000_000);
    if (candidate && isZero(peval(rest, exact(candidate))) && peval(rest, exact(candidate)).q) {
      found.push(exact(candidate));
      rest = pdivmod(rest, [exact(q(-candidate.n, candidate.d)), ONE]).quotient;
    }
  }
  return found.length ? [...found, ...(degree(rest) > 0 ? aberth(rest) : [])] : roots;
}

export type Root = { value: Num; multiplicity: number };
/** Every complex root with its multiplicity. */
export function roots(p: Poly): Root[] {
  const t = trim(p);
  if (degree(t) < 1) return [];
  if (exactPoly(t)) return squareFree(t).flatMap((factor, i) => simpleRoots(factor).map((value) => ({ value, multiplicity: i + 1 })));
  // Floating coefficients: no exact gcd, so equal roots are grouped by distance instead.
  const out: Root[] = [];
  for (const value of aberth(t)) {
    const twin = out.find((r) => Math.hypot(r.value.re - value.re, r.value.im - value.im) <= 1e-6 * Math.max(1, Math.hypot(value.re, value.im)));
    if (twin) twin.multiplicity++; else out.push({ value, multiplicity: 1 });
  }
  return out;
}

/** The real zeros of p/q that are in its domain, with multiplicity. */
export function rationalZeros(r: RationalFunction): Root[] {
  if (!trim(r.num).length) return fail('unsupported', 'The equation holds for every value of the variable.');
  return roots(r.num).filter((root) => !isZero(peval(r.den, root.value)));
}

/** a·x + b·y + … + c with constant coefficients, or null when the expression is not linear in the unknowns. */
export type LinearForm = { coefficients: Num[]; constant: Num };
export function linearForm(n: Node, unknowns: string[], scope: Scope, meter: Meter): LinearForm | null {
  const size = unknowns.length;
  const constant = (value: Num): LinearForm => ({ coefficients: Array.from({ length: size }, () => ZERO), constant: value });
  const isConstant = (f: LinearForm) => f.coefficients.every(isZero);
  const scale = (f: LinearForm, c: Num): LinearForm => ({ coefficients: f.coefficients.map((x) => mul(x, c)), constant: mul(f.constant, c) });
  const walk = (m: Node): LinearForm | null => {
    if (!unknowns.some((u) => mentions(m, u))) return constant(evaluate(m, scope, meter));
    switch (m.k) {
      case 'sym': { const f = constant(ZERO); f.coefficients[unknowns.indexOf(m.name)] = ONE; return f; }
      case 'neg': { const a = walk(m.a); return a && scale(a, exact(q(-1n))); }
      case 'add': case 'sub': {
        const a = walk(m.a), b = walk(m.b);
        if (!a || !b) return null;
        const op = m.k === 'add' ? add : sub;
        return { coefficients: a.coefficients.map((c, i) => op(c, b.coefficients[i])), constant: op(a.constant, b.constant) };
      }
      case 'mul': {
        const a = walk(m.a), b = walk(m.b);
        if (!a || !b) return null;
        if (isConstant(a)) return scale(b, a.constant);
        if (isConstant(b)) return scale(a, b.constant);
        return null;
      }
      case 'div': {
        const a = walk(m.a), b = walk(m.b);
        if (!a || !b || !isConstant(b)) return null;
        return scale(a, div(ONE, b.constant));
      }
      case 'pow': {
        const exponent = unknowns.some((u) => mentions(m.b, u)) ? null : asInteger(evaluate(m.b, scope, meter));
        if (exponent === 1n) return walk(m.a);
        return null;
      }
      default: return null;
    }
  };
  return walk(n);
}

/** Solves a square or overdetermined linear system exactly when its coefficients are exact. */
export function solveLinear(rows: LinearForm[], size: number): { kind: 'unique'; values: Num[] } | { kind: 'none' } | { kind: 'infinite' } {
  const m = rows.map((r) => [...r.coefficients, neg(r.constant)]);
  let rank = 0;
  const pivots: number[] = [];
  for (let col = 0; col < size && rank < m.length; col++) {
    let pivot = -1, best = 0;
    for (let row = rank; row < m.length; row++) {
      const c = m[row][col];
      if (isZero(c)) continue;
      // Prefer an exact pivot; among floating ones, the largest.
      const weight = c.q ? Infinity : Math.hypot(c.re, c.im);
      if (weight > best) { best = weight; pivot = row; }
    }
    if (pivot < 0) continue;
    [m[rank], m[pivot]] = [m[pivot], m[rank]];
    const lead = m[rank][col];
    m[rank] = m[rank].map((x) => div(x, lead));
    for (let row = 0; row < m.length; row++) {
      if (row === rank || isZero(m[row][col])) continue;
      const factor = m[row][col];
      m[row] = m[row].map((x, j) => sub(x, mul(factor, m[rank][j])));
    }
    pivots.push(col);
    rank++;
  }
  for (let row = rank; row < m.length; row++) if (!isZero(m[row][size])) return { kind: 'none' };
  if (rank < size) return { kind: 'infinite' };
  const values = Array.from({ length: size }, () => ZERO);
  pivots.forEach((col, row) => { values[col] = m[row][size]; });
  return { kind: 'unique', values };
}

export const sortReal = (values: Num[]) => [...values].sort(compare);
