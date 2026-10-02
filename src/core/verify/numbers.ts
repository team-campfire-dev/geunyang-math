/**
 * The numbers a claim is computed in.
 *
 * Every value carries a floating complex approximation, and an exact rational as well for as long as
 * the arithmetic stays rational. School arithmetic — fractions, powers, counting — stays exact end to
 * end, so a wrong answer key is caught by an exact comparison. Anything that leaves the rationals (a
 * square root that is not a square, π, a sine, a logarithm, an imaginary unit) continues in floating
 * point and is compared with a tolerance far tighter than any answer a learner types.
 */
export type Q = { n: bigint; d: bigint };
export type Num = { q: Q | null; re: number; im: number };

export type FailureCode = 'syntax' | 'unsupported' | 'domain' | 'bounded' | 'unbound' | 'unstable' | 'diverges' | 'ill-posed';
/**
 * Why a claim could not be computed. Only `ill-posed` is a verdict about the problem — "the
 * solution" of an equation with two solutions, or with none; every other code says the checker could
 * not tell.
 */
export class CheckFailure extends Error {
  constructor(readonly code: FailureCode, message: string) { super(message); }
}
export const fail = (code: FailureCode, message: string): never => { throw new CheckFailure(code, message); };

/** Large enough for 300! and for a sum of a few thousand fractions; small enough to stay fast. */
const maxBits = 4096;
const bits = (v: bigint) => (v < 0n ? -v : v).toString(2).length;
const bounded = (v: bigint) => (bits(v) > maxBits ? fail('bounded', 'A number in the claim grew too large to compute exactly.') : v);

export const gcd = (a: bigint, b: bigint): bigint => {
  a = a < 0n ? -a : a; b = b < 0n ? -b : b;
  while (b) [a, b] = [b, a % b];
  return a;
};
export function q(n: bigint, d = 1n): Q {
  if (d === 0n) fail('domain', 'Division by zero.');
  bounded(n); bounded(d);
  if (d < 0n) { n = -n; d = -d; }
  const g = gcd(n, d) || 1n;
  return { n: n / g, d: d / g };
}
const qAdd = (a: Q, b: Q) => q(a.n * b.d + b.n * a.d, a.d * b.d);
const qMul = (a: Q, b: Q) => q(a.n * b.n, a.d * b.d);
const qDiv = (a: Q, b: Q) => (b.n === 0n ? fail('domain', 'Division by zero.') : q(a.n * b.d, a.d * b.n));

/** A rational as a float, without overflowing when numerator and denominator are both huge. */
export function qToNumber(v: Q): number {
  let { n, d } = v;
  const excess = Math.max(bits(n), bits(d)) - 1000;
  if (excess > 0) { n >>= BigInt(excess); d >>= BigInt(excess); if (d === 0n) return n < 0n ? -Infinity : Infinity; }
  return Number(n) / Number(d);
}

export const exact = (v: Q): Num => ({ q: v, re: qToNumber(v), im: 0 });
export const int = (v: number | bigint): Num => exact(q(BigInt(v)));
export const approx = (re: number, im = 0): Num => {
  if (!Number.isFinite(re) || !Number.isFinite(im)) fail('domain', 'The value is not a finite number here.');
  return { q: null, re, im: Object.is(im, -0) ? 0 : im };
};
export const ZERO = int(0), ONE = int(1);

/** Reads a decimal literal exactly: `0.1` is one tenth, not the float nearest to it. */
export function decimal(text: string): Num {
  const [whole, fraction = ''] = text.split('.');
  return exact(q(BigInt(`${whole || '0'}${fraction}`), 10n ** BigInt(fraction.length)));
}

const scale = (a: Num) => Math.max(1, Math.hypot(a.re, a.im));
export const isZero = (a: Num) => (a.q ? a.q.n === 0n : Math.hypot(a.re, a.im) <= 1e-12);
export const isReal = (a: Num) => !!a.q || Math.abs(a.im) <= 1e-12 * scale(a);
export const realPart = (a: Num): Num => (a.q || a.im === 0 ? a : approx(a.re));
export function requireReal(a: Num, what: string): Num {
  return isReal(a) ? realPart(a) : fail('domain', `${what} needs a real number.`);
}

export function add(a: Num, b: Num): Num { return a.q && b.q ? exact(qAdd(a.q, b.q)) : approx(a.re + b.re, a.im + b.im); }
export function neg(a: Num): Num { return a.q ? exact(q(-a.q.n, a.q.d)) : approx(-a.re, -a.im); }
export function sub(a: Num, b: Num): Num { return add(a, neg(b)); }
export function mul(a: Num, b: Num): Num {
  if (a.q && b.q) return exact(qMul(a.q, b.q));
  // An exact zero stays exact whatever it multiplies, so `0·π` is 0 and not a float near it.
  if ((a.q && a.q.n === 0n) || (b.q && b.q.n === 0n)) return ZERO;
  return approx(a.re * b.re - a.im * b.im, a.re * b.im + a.im * b.re);
}
export function div(a: Num, b: Num): Num {
  if (b.q) return a.q ? exact(qDiv(a.q, b.q)) : (b.q.n === 0n ? fail('domain', 'Division by zero.') : approx(a.re / b.re, a.im / b.re));
  const m = b.re * b.re + b.im * b.im;
  if (m <= 1e-300) fail('domain', 'Division by zero.');
  if (a.q && a.q.n === 0n) return ZERO;
  return approx((a.re * b.re + a.im * b.im) / m, (a.im * b.re - a.re * b.im) / m);
}

/** The exact integer a value is, or null. */
export function asInteger(a: Num): bigint | null {
  return a.q && a.q.d === 1n ? a.q.n : null;
}

/** Exact r-th root of a non-negative rational, or null when it is not a perfect power. */
function exactRoot(v: Q, r: bigint): Q | null {
  const root = (x: bigint): bigint | null => {
    if (x < 2n) return x;
    let low = 0n, high = 1n << BigInt(Math.ceil(bits(x) / Number(r)) + 1);
    while (high - low > 1n) { const mid = (low + high) >> 1n; if (mid ** r <= x) low = mid; else high = mid; }
    return low ** r === x ? low : null;
  };
  const n = root(v.n), d = root(v.d);
  return n === null || d === null ? null : q(n, d);
}

const cLog = (a: Num) => ({ re: Math.log(Math.hypot(a.re, a.im)), im: Math.atan2(a.im, a.re) });
const cExp = (re: number, im: number) => approx(Math.exp(re) * Math.cos(im), Math.exp(re) * Math.sin(im));

/**
 * Powers, by the convention a school uses: integer powers are exact, a rational power of a perfect
 * power is exact, and an odd root of a negative number is the negative real root — (−8)^(1/3) is −2,
 * as a textbook says, not the principal complex value. Everything else is the principal value.
 */
export function pow(base: Num, exponent: Num): Num {
  if (isZero(base)) {
    if (isZero(exponent)) fail('domain', '0^0 is undefined.');
    if (!isReal(exponent) || exponent.re < 0) fail('domain', 'Division by zero.');
    return ZERO;
  }
  const e = exponent.q;
  if (e && base.q) {
    if (e.d === 1n) {
      if (base.q.d === 1n && (base.q.n === 1n || base.q.n === -1n)) return int(base.q.n === 1n || e.n % 2n === 0n ? 1 : -1);
      if ((e.n < 0n ? -e.n : e.n) * BigInt(bits(base.q.n) + bits(base.q.d)) > BigInt(maxBits)) fail('bounded', 'A power in the claim is too large.');
      const p = e.n < 0n ? -e.n : e.n;
      const raised = q(base.q.n ** p, base.q.d ** p);
      return exact(e.n < 0n ? qDiv(q(1n), raised) : raised);
    }
    if (e.d <= 64n) {
      const negative = base.q.n < 0n;
      if (!negative || e.d % 2n === 1n) {
        const root = exactRoot(q(negative ? -base.q.n : base.q.n, base.q.d), e.d);
        if (root) return pow(exact(negative ? q(-root.n, root.d) : root), exact(q(e.n)));
        if (negative) {
          const magnitude = Math.pow(-qToNumber(base.q), qToNumber(e));
          return approx(e.n % 2n === 0n ? magnitude : -magnitude);
        }
      }
    }
  }
  if (isReal(base) && isReal(exponent) && base.re > 0) return approx(Math.pow(base.re, exponent.re));
  const ln = cLog(base);
  const re = exponent.re * ln.re - exponent.im * ln.im, im = exponent.re * ln.im + exponent.im * ln.re;
  return cExp(re, im);
}

/** Principal square root; the square root of −4 is 2i, which is how √(−a) is taught. */
export function sqrt(a: Num): Num {
  if (a.q) {
    if (a.q.n >= 0n) { const root = exactRoot(a.q, 2n); if (root) return exact(root); return approx(Math.sqrt(qToNumber(a.q))); }
    const root = exactRoot(q(-a.q.n, a.q.d), 2n);
    return approx(0, root ? qToNumber(root) : Math.sqrt(-qToNumber(a.q)));
  }
  if (isReal(a)) return a.re >= 0 ? approx(Math.sqrt(a.re)) : approx(0, Math.sqrt(-a.re));
  const m = Math.hypot(a.re, a.im);
  const re = Math.sqrt((m + a.re) / 2), im = Math.sign(a.im) * Math.sqrt((m - a.re) / 2);
  return approx(re, im);
}

export function abs(a: Num): Num {
  if (a.q) return exact(q(a.q.n < 0n ? -a.q.n : a.q.n, a.q.d));
  return approx(Math.hypot(a.re, a.im));
}

/** e^a for any complex a. */
export function exp(a: Num): Num { return isZero(a) ? ONE : cExp(a.re, a.im); }

/** Natural logarithm, real only: a school logarithm of a non-positive number is undefined. */
export function ln(a: Num): Num {
  const real = requireReal(a, 'A logarithm');
  if (real.re <= 0) fail('domain', 'A logarithm needs a positive number.');
  if (real.q && real.q.n === real.q.d) return ZERO;
  return approx(Math.log(real.re));
}

/** log_b(x), exact when x is an exact rational power of an exact base: log₂8 is 3, log₄2 is 1/2. */
export function log(base: Num, x: Num): Num {
  const b = requireReal(base, 'A logarithm base'), v = requireReal(x, 'A logarithm');
  if (b.re <= 0 || (b.q ? b.q.n === b.q.d : Math.abs(b.re - 1) < 1e-15)) fail('domain', 'A logarithm base must be positive and not 1.');
  if (v.re <= 0) fail('domain', 'A logarithm needs a positive number.');
  if (b.q && v.q) {
    const guess = Math.log(v.re) / Math.log(b.re);
    // Try the small rational nearest the float; a power that lands exactly is the exact logarithm.
    const candidate = nearRational(guess, 64);
    if (candidate) { try { const p = pow(b, exact(candidate)); if (p.q && p.q.n === v.q.n && p.q.d === v.q.d) return exact(candidate); } catch { /* not exact */ } }
  }
  return approx(Math.log(v.re) / Math.log(b.re));
}

/** The simplest fraction with denominator at most `limit` within 1e-12 of x, by continued fractions. */
export function nearRational(x: number, limit: number): Q | null {
  if (!Number.isFinite(x)) return null;
  let h0 = 0, h1 = 1, k0 = 1, k1 = 0, value = x;
  for (let step = 0; step < 40; step++) {
    const a = Math.floor(value);
    const h2 = a * h1 + h0, k2 = a * k1 + k0;
    if (k2 > limit) break;
    [h0, h1, k0, k1] = [h1, h2, k1, k2];
    if (Math.abs(x - h1 / k1) <= 1e-12 * Math.max(1, Math.abs(x))) return q(BigInt(h1), BigInt(k1));
    const rest = value - a;
    if (rest < 1e-15) break;
    value = 1 / rest;
  }
  return null;
}

export type Strength = 'exact' | 'sampled' | 'numeric' | 'estimated';
const rank: Record<Strength, number> = { exact: 3, sampled: 2, numeric: 1, estimated: 0 };
export const weakest = (...all: (Strength | undefined)[]): Strength =>
  all.filter((s): s is Strength => !!s).reduce((a, b) => (rank[a] <= rank[b] ? a : b), 'exact' as Strength);

/**
 * Whether two values are the same number. Exact when both are exact; otherwise within one part in a
 * billion, which no two distinct answers a learner could be asked for ever are. An estimated value
 * (an integral or a limit computed numerically) is held to one part in a million instead.
 */
export function same(a: Num, b: Num, estimated = false): { equal: boolean; strength: Strength } {
  if (a.q && b.q) return { equal: a.q.n === b.q.n && a.q.d === b.q.d, strength: 'exact' };
  const tolerance = (estimated ? 1e-6 : 1e-9) * Math.max(1, Math.hypot(a.re, a.im), Math.hypot(b.re, b.im));
  return { equal: Math.hypot(a.re - b.re, a.im - b.im) <= tolerance, strength: estimated ? 'estimated' : 'numeric' };
}

/** Real comparison for ordering roots and interval ends. */
export function compare(a: Num, b: Num): number {
  if (a.q && b.q) { const d = a.q.n * b.q.d - b.q.n * a.q.d; return d < 0n ? -1 : d > 0n ? 1 : 0; }
  const d = a.re - b.re;
  return Math.abs(d) <= 1e-9 * Math.max(1, Math.abs(a.re), Math.abs(b.re)) ? 0 : d < 0 ? -1 : 1;
}

/** How a value reads in a report: `35/36`, `-4`, `1.4142135624`, `2+3i`. */
export function show(a: Num): string {
  if (a.q) return a.q.d === 1n ? `${a.q.n}` : `${a.q.n}/${a.q.d}`;
  const round = (v: number) => `${Number(v.toPrecision(11))}`;
  if (isReal(a)) return round(a.re);
  const im = Math.abs(a.im);
  return `${Math.abs(a.re) > 1e-12 * im ? round(a.re) : ''}${a.im < 0 ? '-' : Math.abs(a.re) > 1e-12 * im ? '+' : ''}${im === 1 ? '' : round(im)}i`;
}
