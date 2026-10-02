import { mentions, substitute, type Node } from './expr';
import { fail, q, type Q } from './numbers';

/**
 * Calculus for checking, not for solving. A derivative is computed symbolically because it is
 * mechanical and exact; an integral and a limit are computed numerically, and a claim that needs an
 * exact one brings an antiderivative to be differentiated back — checking is the easy direction.
 */
/**
 * How many nodes one derivative may build. The chain rule shares subtrees, but repeated
 * differentiation of a deep composition still multiplies them; past this it is refused rather than
 * left to exhaust memory.
 */
const maxBuilt = 50_000;
let built: { nodes: number } | null = null;
const make = (n: Node): Node => {
  if (built && ++built.nodes > maxBuilt) fail('bounded', 'The derivative grows too large to compute.');
  return n;
};
const num = (v: bigint): Node => ({ k: 'num', q: q(v) });
const rational = (v: Q): Node => ({ k: 'num', q: v });
const isNum = (n: Node, v: bigint) => n.k === 'num' && n.q.d === 1n && n.q.n === v;
const both = (a: Node, b: Node): [Q, Q] | null => (a.k === 'num' && b.k === 'num' ? [a.q, b.q] : null);
// Two numbers combine into one, so the power rule's exponent (2 − 1) − 1 folds to 0 and x⁰ to 1,
// rather than leaving 0^((2−1)−1) to be evaluated at x = 0.
const Neg = (a: Node): Node => (isNum(a, 0n) ? a : a.k === 'num' ? rational(q(-a.q.n, a.q.d)) : a.k === 'neg' ? a.a : make({ k: 'neg', a }));
const Add = (a: Node, b: Node): Node => {
  const n = both(a, b);
  if (n) return rational(q(n[0].n * n[1].d + n[1].n * n[0].d, n[0].d * n[1].d));
  return isNum(a, 0n) ? b : isNum(b, 0n) ? a : make({ k: 'add', a, b });
};
const Sub = (a: Node, b: Node): Node => {
  const n = both(a, b);
  if (n) return rational(q(n[0].n * n[1].d - n[1].n * n[0].d, n[0].d * n[1].d));
  return isNum(b, 0n) ? a : isNum(a, 0n) ? Neg(b) : make({ k: 'sub', a, b });
};
const Mul = (a: Node, b: Node): Node => {
  const n = both(a, b);
  if (n) return rational(q(n[0].n * n[1].n, n[0].d * n[1].d));
  return isNum(a, 0n) || isNum(b, 0n) ? num(0n) : isNum(a, 1n) ? b : isNum(b, 1n) ? a : make({ k: 'mul', a, b });
};
const Div = (a: Node, b: Node): Node => {
  const n = both(a, b);
  if (n && n[1].n !== 0n) return rational(q(n[0].n * n[1].d, n[0].d * n[1].n));
  return isNum(a, 0n) ? num(0n) : isNum(b, 1n) ? a : make({ k: 'div', a, b });
};
const Pow = (a: Node, b: Node): Node => (isNum(b, 1n) ? a : isNum(b, 0n) ? num(1n) : make({ k: 'pow', a, b }));
const Call = (name: string, ...args: Node[]): Node => make({ k: 'call', name, args });
const two = num(2n);
/** Node builders that fold numbers together and drop the obvious zeros and ones, so derived expressions stay small. */
export const build = { num, Neg, Add, Sub, Mul, Div, Pow, Call };

export type FunctionDef = { params: string[]; body: Node };

/** d/dv of an expression, as an expression. User-defined functions are expanded where they are called. */
export function derivative(n: Node, v: string, functions: ReadonlyMap<string, FunctionDef> = new Map()): Node {
  const outer = built;
  if (!outer) built = { nodes: 0 };
  try { return differentiate(n, v, functions, 0); }
  finally { if (!outer) built = null; }
}

function differentiate(n: Node, v: string, functions: ReadonlyMap<string, FunctionDef>, depth: number): Node {
  const d = (m: Node) => differentiate(m, v, functions, depth);
  if (!mentions(n, v)) return num(0n);
  switch (n.k) {
    case 'num': return num(0n);
    case 'sym': return n.name === v ? num(1n) : num(0n);
    case 'neg': return Neg(d(n.a));
    case 'add': return Add(d(n.a), d(n.b));
    case 'sub': return Sub(d(n.a), d(n.b));
    case 'mul': return Add(Mul(d(n.a), n.b), Mul(n.a, d(n.b)));
    case 'div': return Div(Sub(Mul(d(n.a), n.b), Mul(n.a, d(n.b))), Pow(n.b, two));
    case 'pow': {
      if (!mentions(n.b, v)) {
        // A numeric exponent folds now: x³ → 3x², x¹ → 1. A symbolic one (xⁿ with a given n) is left to
        // dpow, which knows that the derivative of x⁰ is 0 and of x¹ at 0 is 1.
        if (n.b.k === 'num') return Mul(Mul(n.b, Pow(n.a, Sub(n.b, num(1n)))), d(n.a));
        return Mul(Call('dpow', n.a, n.b), d(n.a));
      }
      if (!mentions(n.a, v)) return Mul(Mul(n, Call('ln', n.a)), d(n.b));
      return Mul(n, Add(Mul(d(n.b), Call('ln', n.a)), Div(Mul(n.b, d(n.a)), n.a)));
    }
    case 'deg': return Mul(Div({ k: 'sym', name: 'pi' }, num(180n)), d(n.a));
    case 'fact': return fail('unsupported', 'A factorial of the variable cannot be differentiated.');
    case 'call': {
      const user = functions.get(n.name);
      if (user) {
        if (user.params.length !== n.args.length) fail('syntax', `${n.name} takes ${user.params.length} argument(s).`);
        // A function that calls itself has no closed form to differentiate; stop as evaluation does.
        if (depth >= 20) fail('bounded', 'Functions call each other too deeply to differentiate.');
        return differentiate(substitute(user.body, new Map(user.params.map((p, i) => [p, n.args[i]]))), v, functions, depth + 1);
      }
      const [u] = n.args, du = d(u);
      switch (n.name) {
        case 'sin': return Mul(Call('cos', u), du);
        case 'cos': return Neg(Mul(Call('sin', u), du));
        case 'tan': return Div(du, Pow(Call('cos', u), two));
        case 'sec': return Mul(Mul(Call('sec', u), Call('tan', u)), du);
        case 'csc': return Neg(Mul(Mul(Call('csc', u), Call('cot', u)), du));
        case 'cot': return Neg(Div(du, Pow(Call('sin', u), two)));
        case 'asin': case 'arcsin': return Div(du, Call('sqrt', Sub(num(1n), Pow(u, two))));
        case 'acos': case 'arccos': return Neg(Div(du, Call('sqrt', Sub(num(1n), Pow(u, two)))));
        case 'atan': case 'arctan': return Div(du, Add(num(1n), Pow(u, two)));
        case 'sinh': return Mul(Call('cosh', u), du);
        case 'cosh': return Mul(Call('sinh', u), du);
        case 'tanh': return Div(du, Pow(Call('cosh', u), two));
        case 'exp': return Mul(n, du);
        case 'ln': return Div(du, u);
        case 'log': {
          if (n.args.length === 1) return Div(du, Mul(u, Call('ln', num(10n))));
          const [base, x] = n.args;
          return d(Div(Call('ln', x), Call('ln', base)));
        }
        case 'sqrt': return Div(du, Mul(two, n));
        case 'cbrt': return Div(du, Mul(num(3n), Pow(n, two)));
        case 'root': {
          if (mentions(n.args[1], v)) return fail('unsupported', 'A root whose index depends on the variable cannot be differentiated.');
          return Div(Mul(n, du), Mul(n.args[1], u));
        }
        case 'abs': return Mul(Div(u, n), du);
        case 'dpow': {
          if (mentions(n.args[1], v)) break;
          return Mul(Mul(n.args[1], Call('dpow', u, Sub(n.args[1], num(1n)))), du);
        }
        case 'sum': {
          const [body, index, from, to] = n.args;
          if (index?.k !== 'sym' || index.name === v || mentions(from, v) || mentions(to, v)) break;
          return Call('sum', d(body), index, from, to);
        }
      }
      return fail('unsupported', `${n.name}(…) of the variable cannot be differentiated here.`);
    }
  }
}

// Gauss–Kronrod 7/15 abscissae and weights on [−1, 1].
const xgk = [0.991455371120812639206854697526329, 0.949107912342758524526189684047851, 0.864864423359769072789712788640926,
  0.741531185599394439863864773280788, 0.586087235467691130294144845693013, 0.405845151377397166906606412076961,
  0.207784955007898467600689403773245, 0];
const wgk = [0.02293532201052922496373200805897, 0.063092092629978553290700663189204, 0.104790010322250183839876322541518,
  0.140653259715525918745189590510238, 0.16900472663926790282658342659855, 0.190350578064785409913256402421014,
  0.204432940075298892414161999234649, 0.209482141084727828012999174891714];
const wg = [0.129484966168869693270611432679082, 0.27970539148927666790146777142378, 0.381830050505118944950369775488975,
  0.417959183673469387755102040816327];

function kronrod(f: (x: number) => number, a: number, b: number) {
  const c = (a + b) / 2, h = (b - a) / 2;
  let k = 0, g = 0;
  for (let j = 0; j < 8; j++) {
    if (j === 7) { const fc = f(c); k += wgk[7] * fc; g += wg[3] * fc; continue; }
    const sum = f(c - h * xgk[j]) + f(c + h * xgk[j]);
    k += wgk[j] * sum;
    if (j % 2 === 1) g += wg[(j - 1) / 2] * sum;
  }
  return { a, b, value: k * h, error: Math.abs((k - g) * h) };
}

/**
 * ∫ₐᵇ f, adaptively: the piece with the largest error estimate is halved until the total is below
 * one part in ten billion. The rule never evaluates the ends, so ∫₀¹ ln x works; an integrand that is
 * undefined somewhere inside the interval stops the computation instead of being smoothed over.
 */
export function integrate(f: (x: number) => number, a: number, b: number): number {
  if (!Number.isFinite(a) || !Number.isFinite(b)) fail('unsupported', 'Integrals over an infinite interval are not supported yet.');
  if (a === b) return 0;
  // Sixteen panels before any is trusted: one rule over [0, 10000] puts its nearest node at 42 and
  // sees e^(−x) as zero everywhere, with an error estimate of zero to match.
  const pieces = Array.from({ length: 16 }, (_, k) => kronrod(f, a + ((b - a) * k) / 16, a + ((b - a) * (k + 1)) / 16));
  for (let step = 0; step < 2000; step++) {
    const total = pieces.reduce((s, p) => s + p.value, 0), error = pieces.reduce((s, p) => s + p.error, 0);
    if (error <= Math.max(1e-13, 1e-10 * Math.abs(total))) return total;
    let worst = 0;
    pieces.forEach((p, i) => { if (p.error > pieces[worst].error) worst = i; });
    const { a: lo, b: hi } = pieces[worst], mid = (lo + hi) / 2;
    if (!(mid > lo && mid < hi)) break;
    pieces.splice(worst, 1, kronrod(f, lo, mid), kronrod(f, mid, hi));
  }
  return fail('unstable', 'The integral did not converge numerically.');
}

/**
 * The value g(h) approaches as h → 0⁺, by Richardson extrapolation over a geometric grid of h.
 *
 * Two things fool a naive version, and both were found by trying: a grid of powers of two lands
 * exactly on the zeros of sin(π/x), so an oscillation reads as a limit; and floating cancellation
 * eventually turns g into a constant (cos x² is exactly 1.0 once x² < 1e-8), so the last rows agree
 * perfectly about a wrong value. So the grid is scaled by an irrational factor, rows computed from
 * samples that stopped changing are not trusted, and an estimate must hold over three consecutive
 * rows.
 */
function towardZero(g: (h: number) => number, scale: number): number {
  const rows: number[][] = [];
  const estimates: number[] = [];
  let previous = NaN, repeats = 0;
  for (let k = 0; k < 26; k++) {
    const value = g((0.125 * scale) / 2 ** k);
    if (!Number.isFinite(value)) fail('diverges', 'The function grows without bound near the limit point.');
    repeats = value === previous ? repeats + 1 : 0;
    previous = value;
    // Samples that no longer change at all mean the function is now rounding to a constant; the
    // extrapolation has nothing more to learn, unless it has been that constant from the start.
    if (repeats >= 2 && k > 3 && rows[0][0] !== value) break;
    const row = [value];
    for (let j = 1; j <= Math.min(k, 8); j++) row[j] = row[j - 1] + (row[j - 1] - rows[k - 1][j - 1]) / (2 ** j - 1);
    rows.push(row);
    estimates.push(row[row.length - 1]);
  }
  let best = NaN, spread = Infinity;
  for (let k = 3; k < estimates.length; k++) {
    const window = estimates.slice(k - 2, k + 1);
    const gap = Math.max(...window) - Math.min(...window);
    if (gap < spread) { spread = gap; best = estimates[k]; }
  }
  if (!(spread <= 1e-7 * Math.max(1, Math.abs(best)))) fail('diverges', 'The limit does not settle to a number.');
  return Math.abs(best) < 1e-11 ? 0 : best;
}

/** The limit along two unrelated irrational grids, which must agree: no oscillation lines up with both. */
function settled(g: (h: number) => number): number {
  const a = towardZero(g, Math.SQRT1_2), b = towardZero(g, 1 / Math.sqrt(3));
  if (Math.abs(a - b) > 1e-6 * Math.max(1, Math.abs(a), Math.abs(b))) fail('diverges', 'The limit does not settle to a number.');
  return (a + b) / 2;
}

/** lim f(x) as x → at, from the right (side 1), the left (−1) or both (0); `at` may be ±Infinity. */
export function limit(f: (x: number) => number, at: number, side: -1 | 0 | 1): number {
  if (!Number.isFinite(at)) return settled((h) => f((at > 0 ? 1 : -1) / h));
  if (side !== 0) return settled((h) => f(at + side * h));
  const right = settled((h) => f(at + h)), left = settled((h) => f(at - h));
  if (Math.abs(right - left) > 1e-6 * Math.max(1, Math.abs(right), Math.abs(left))) fail('diverges', 'The left and right limits differ.');
  return (right + left) / 2;
}
