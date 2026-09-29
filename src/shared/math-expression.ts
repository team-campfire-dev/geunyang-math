/** Bounded arithmetic grammar shared by the editor and server. Never executes source code. */
export const mathLimits = { length: 80, depth: 16, nodes: 96, terms: 32, exponent: 32, bits: 2048, work: 20000 } as const;
export type MathNode = { start: number; end: number } & (
  | { kind: 'number'; text: string }
  | { kind: 'hole' }
  | { kind: 'negate'; child: MathNode }
  | { kind: 'positive'; child: MathNode }
  | { kind: 'group'; child: MathNode }
  | { kind: 'root'; child: MathNode }
  | { kind: 'binary'; op: '+' | '-' | '*' | '/' | '^'; left: MathNode; right: MathNode }
);
class MathIssue extends Error {}
const invalid = () => { throw new MathIssue('빈 칸과 괄호를 확인해 주세요. 숫자, 사칙연산, 정수 지수, 제곱근을 쓸 수 있어요.'); };
const bounded = () => { throw new MathIssue('수식이 너무 커요. 일부를 계산해서 더 간단하게 써 주세요.'); };

export function parseMathExpression(source: string, holes = false): MathNode | null {
  if (source.length > mathLimits.length) return null;
  let at = 0, count = 0;
  const space = () => { while (/\s/.test(source[at] ?? '') && at < source.length) at++; };
  const node = (n: MathNode): MathNode => { if (++count > mathLimits.nodes) bounded(); return n; };
  const binary = (op: '+' | '-' | '*' | '/' | '^', left: MathNode, right: MathNode): MathNode => node({ kind: 'binary', op, left, right, start: left.start, end: right.end });
  function primary(depth: number): MathNode {
    if (depth > mathLimits.depth) bounded();
    space(); const start = at;
    const number = /^(?:\d+(?:\.\d*)?|\.\d+)/.exec(source.slice(at));
    if (number) { at += number[0].length; return node({ kind: 'number', text: number[0], start, end: at }); }
    if (source.startsWith('sqrt', at) || source[at] === '√') {
      at += source[at] === '√' ? 1 : 4;
      const child = primary(depth + 1);
      return node({ kind: 'root', child, start, end: child.end });
    }
    if (source[at] === '(') {
      at++; const child = sum(depth + 1); space();
      if (source[at++] !== ')') invalid();
      return node({ kind: 'group', child, start, end: at });
    }
    if (holes && source[at] === '□') { at++; return node({ kind: 'hole', start, end: at }); }
    if (holes && (at === source.length || source[at] === ')' || source[at] === '/')) return node({ kind: 'hole', start, end: at });
    return invalid();
  }
  function power(depth: number): MathNode {
    let left = primary(depth); space();
    if (source[at] === '^') { at++; left = binary('^', left, unary(depth + 1)); }
    return left;
  }
  function unary(depth: number): MathNode {
    if (depth > mathLimits.depth) bounded();
    space(); const start = at;
    if (source[at] === '+' || source[at] === '-' || source[at] === '−') {
      const sign = source[at++]; space(); if (source[at] === '+' || source[at] === '-' || source[at] === '−') invalid(); const child = unary(depth + 1);
      return node({ kind: sign === '+' ? 'positive' : 'negate', child, start, end: child.end });
    }
    return power(depth);
  }
  function product(depth: number): MathNode {
    let left = unary(depth);
    while (true) {
      space(); const token = source[at];
      if (token === '*' || token === '×' || token === '/' || token === '÷' || token === '⁄') {
        at++; left = binary(token === '*' || token === '×' ? '*' : '/', left, unary(depth));
      } else if (token === '(' || token === '√' || source.startsWith('sqrt', at)) left = binary('*', left, unary(depth));
      else break;
    }
    return left;
  }
  function sum(depth: number): MathNode {
    let left = product(depth);
    while (true) {
      space(); const token = source[at];
      if (token !== '+' && token !== '-' && token !== '−') break;
      at++; left = binary(token === '+' ? '+' : '-', left, product(depth));
    }
    return left;
  }
  try { const result = sum(0); space(); return at === source.length ? result : null; } catch { return null; }
}

export function mathLatex(node: MathNode): string {
  const inner = (n: MathNode) => mathLatex(n.kind === 'group' ? n.child : n);
  switch (node.kind) {
    case 'hole': return '\\square';
    case 'number': return node.text;
    case 'group': return `\\left(${mathLatex(node.child)}\\right)`;
    case 'root': return `\\sqrt{${inner(node.child)}}`;
    case 'positive': return `+${mathLatex(node.child)}`;
    case 'negate': return `-${mathLatex(node.child)}`;
    case 'binary': {
      if (node.op === '/') return `\\frac{${inner(node.left)}}{${inner(node.right)}}`;
      if (node.op === '^') return `{${mathLatex(node.left)}}^{${inner(node.right)}}`;
      return `${mathLatex(node.left)}${node.op === '*' ? '\\cdot ' : node.op}${mathLatex(node.right)}`;
    }
  }
}

type Rational = { n: bigint; d: bigint };
/** Sum of rational coefficients times square roots of distinct square-free positive integers. */
export type ExactMathValue = Map<bigint, Rational>;
const gcd = (a: bigint, b: bigint): bigint => { a = a < 0n ? -a : a; b = b < 0n ? -b : b; while (b) [a, b] = [b, a % b]; return a; };
const check = (v: bigint) => { if (v.toString(2).length > mathLimits.bits) bounded(); return v; };
const rational = (n: bigint, d = 1n): Rational => {
  if (!d) throw new MathIssue('0으로 나눌 수 없어요. 분모를 확인해 주세요.');
  check(n); check(d);
  const g = gcd(n, d); if (d < 0n) { n = -n; d = -d; }
  return { n: n / g, d: d / g };
};
const plus = (a: Rational, b: Rational) => rational(a.n * b.d + b.n * a.d, a.d * b.d);
const times = (a: Rational, b: Rational) => rational(a.n * b.n, a.d * b.d);
const scalar = (n: bigint, d = 1n): ExactMathValue => n ? new Map([[1n, rational(n, d)]]) : new Map();

export function readMathExpression(source: string): { value: ExactMathValue; node: MathNode; issue?: never } | { value?: never; node?: never; issue: string } {
  let work = 0;
  const tick = () => { if (++work > mathLimits.work) bounded(); };
  const put = (out: ExactMathValue, key: bigint, value: Rational) => {
    const next = plus(out.get(key) ?? rational(0n), value);
    if (next.n) out.set(check(key), next); else out.delete(key);
    if (out.size > mathLimits.terms) bounded();
  };
  const add = (a: ExactMathValue, b: ExactMathValue, sign = 1n): ExactMathValue => {
    const out = new Map(a);
    for (const [key, value] of b) { tick(); put(out, key, times(value, rational(sign))); }
    return out;
  };
  const multiply = (a: ExactMathValue, b: ExactMathValue): ExactMathValue => {
    const out: ExactMathValue = new Map();
    for (const [x, v] of a) for (const [y, w] of b) {
      tick(); const shared = gcd(x, y);
      put(out, (x / shared) * (y / shared), times(times(v, w), rational(shared)));
    }
    return out;
  };
  const divide = (numerator: ExactMathValue, denominator: ExactMathValue): ExactMathValue => {
    if (!denominator.size) throw new MathIssue('0으로 나눌 수 없어요. 분모를 확인해 주세요.');
    let a = numerator, b = denominator;
    for (let step = 0; step < 32; step++) {
      tick();
      const radical = [...b.keys()].find(key => key !== 1n);
      if (radical === undefined) {
        const coefficient = b.get(1n)!;
        return multiply(a, scalar(coefficient.d, coefficient.n));
      }
      // Conjugating one prime generator removes it from the denominator exactly.
      let prime = 2n;
      while (prime * prime <= radical && radical % prime !== 0n) { tick(); prime = prime === 2n ? 3n : prime + 2n; }
      if (prime * prime > radical) prime = radical;
      const conjugate = new Map([...b].map(([key, coefficient]) => [key, key % prime === 0n ? rational(-coefficient.n, coefficient.d) : coefficient]));
      a = multiply(a, conjugate); b = multiply(b, conjugate);
    }
    return bounded();
  };
  const root = (value: ExactMathValue): ExactMathValue => {
    if (!value.size) return scalar(0n);
    if (value.size !== 1 || !value.has(1n)) throw new MathIssue('근호 안을 정수나 분수 값으로 정리해 주세요. 근호 안에 무리수가 남는 수식은 아직 지원하지 않아요.');
    const { n, d } = value.get(1n)!;
    if (n < 0n) throw new MathIssue('실수 범위에서는 음수의 제곱근을 쓸 수 없어요.');
    let radicand = check(n * d), outside = 1n, inside = 1n;
    // Perfect squares need no factorization, including large ordinary squares.
    let low = 0n, high = radicand + 1n;
    while (high - low > 1n) { tick(); const middle = (low + high) / 2n; if (middle * middle <= radicand) low = middle; else high = middle; }
    if (low * low === radicand) return scalar(low, d);
    for (let factor = 2n; factor * factor <= radicand; factor = factor === 2n ? 3n : factor + 2n) {
      tick(); let count = 0;
      while (radicand % factor === 0n) { tick(); radicand /= factor; count++; }
      outside *= factor ** BigInt(Math.floor(count / 2));
      if (count % 2) inside *= factor;
    }
    inside *= radicand;
    return new Map([[inside, rational(outside, d)]]);
  };
  function evaluate(node: MathNode, depth = 0): ExactMathValue {
    tick(); if (depth > mathLimits.depth) bounded();
    switch (node.kind) {
      case 'hole': return invalid();
      case 'number': {
        const [whole, decimal = ''] = node.text.split('.');
        return scalar(BigInt(`${whole || '0'}${decimal}`), 10n ** BigInt(decimal.length));
      }
      case 'group': case 'positive': return evaluate(node.child, depth + 1);
      case 'negate': return multiply(scalar(-1n), evaluate(node.child, depth + 1));
      case 'root': return root(evaluate(node.child, depth + 1));
      case 'binary': {
        const a = evaluate(node.left, depth + 1), b = evaluate(node.right, depth + 1);
        if (node.op === '+') return add(a, b);
        if (node.op === '-') return add(a, b, -1n);
        if (node.op === '*') return multiply(a, b);
        if (node.op === '/') return divide(a, b);
        if (b.size > 1 || (b.size && (!b.has(1n) || b.get(1n)!.d !== 1n))) throw new MathIssue('지수는 정수로 써 주세요. 제곱근은 루트 기호로 입력할 수 있어요.');
        const exponent = b.get(1n)?.n ?? 0n;
        if (exponent < -BigInt(mathLimits.exponent) || exponent > BigInt(mathLimits.exponent)) return bounded();
        if (!a.size && !exponent) throw new MathIssue('0의 0제곱은 답으로 사용할 수 없어요.');
        let result = scalar(1n), base = a, remaining = exponent < 0n ? -exponent : exponent;
        while (remaining) { tick(); if (remaining % 2n) result = multiply(result, base); remaining /= 2n; if (remaining) base = multiply(base, base); }
        return exponent < 0n ? divide(scalar(1n), result) : result;
      }
    }
  }
  try {
    const node = parseMathExpression(source); if (!node) return invalid();
    return { value: evaluate(node), node };
  } catch (reason) { return { issue: reason instanceof MathIssue ? reason.message : '수식을 읽을 수 없어요. 입력한 답을 확인해 주세요.' }; }
}

export function sameMathValue(a: ExactMathValue, b: ExactMathValue): boolean {
  return a.size === b.size && [...a].every(([key, value]) => { const other = b.get(key); return !!other && value.n === other.n && value.d === other.d; });
}
export function rationalMathValue(value: ExactMathValue): { numerator: bigint; denominator: bigint } | null {
  if (!value.size) return { numerator: 0n, denominator: 1n };
  const coefficient = value.get(1n);
  return value.size === 1 && coefficient ? { numerator: coefficient.n, denominator: coefficient.d } : null;
}

/** A stable exact key for grouping spellings of the same numeric answer. */
export function mathValueKey(value: ExactMathValue): string {
  return [...value].sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0)
    .map(([root, coefficient]) => `${root}:${coefficient.n}/${coefficient.d}`).join('|') || '0';
}
