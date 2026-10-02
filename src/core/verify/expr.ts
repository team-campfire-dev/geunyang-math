import { decimal, fail, type Q } from './numbers';

/**
 * The language a claim is written in: what a problem computes, spelled the way a calculator would
 * take it — `3/4 + 2/9`, `2(x+3) = 14`, `nCr(10, 3)`, `diff(x^3 - 2x, x, 1)`. It is a grammar, not
 * code: nothing in it is ever executed, and its size and depth are bounded, because the text comes
 * from a model and is read on the server.
 */
export type Node =
  | { k: 'num'; q: Q }
  /** A variable, or one of the constants pi, e, i, inf — which it is, is decided when it is evaluated. */
  | { k: 'sym'; name: string }
  | { k: 'neg'; a: Node }
  | { k: 'add' | 'sub' | 'mul' | 'div' | 'pow'; a: Node; b: Node }
  | { k: 'call'; name: string; args: Node[] }
  | { k: 'fact'; a: Node }
  /** An angle in degrees, `30°`. */
  | { k: 'deg'; a: Node };
export type RelOp = '=' | '<' | '<=' | '>' | '>=' | '!=';
/** `a op b op c …` — a single expression when there is no operator, an equation, or an inequality chain. */
export type Relation = { terms: Node[]; ops: RelOp[] };

export const limits = { length: 400, depth: 60, nodes: 1000 } as const;

/** Names that are functions. Every one of them must be called with parentheses. */
export const builtins = new Set([
  'sin', 'cos', 'tan', 'sec', 'csc', 'cot', 'asin', 'acos', 'atan', 'arcsin', 'arccos', 'arctan', 'sinh', 'cosh', 'tanh',
  'exp', 'ln', 'log', 'sqrt', 'cbrt', 'root', 'abs', 'floor', 'ceil', 'round', 'sign', 'min', 'max', 'gcd', 'lcm', 'mod',
  'nCr', 'nPr', 'nHr', 'factorial', 'sum', 'prod', 'diff', 'integral', 'limit', 'mean', 'median', 'var', 'sd', 'svar', 'ssd',
]);
const constants = ['pi', 'inf'];
/** Longest first, so `arcsin` is not read as `a·r·c·sin`. */
const names = [...builtins, ...constants].sort((a, b) => b.length - a.length);

type Token =
  | { t: 'num'; text: string; at: number }
  | { t: 'id'; text: string; at: number }
  | { t: 'op'; text: string; at: number };

const normalize = (source: string) => source
  .replace(/[−–]/g, '-').replace(/[×·]/g, '*').replace(/÷/g, '/').replace(/≤/g, '<=').replace(/≥/g, '>=').replace(/≠/g, '!=')
  .replace(/π/g, ' pi ').replace(/∞/g, ' inf ').replace(/√/g, ' sqrt ');

function tokenize(source: string): Token[] {
  const tokens: Token[] = [];
  let at = 0;
  while (at < source.length) {
    const c = source[at];
    if (/\s/.test(c)) { at++; continue; }
    const number = /^(?:\d+(?:\.\d+)?|\.\d+)/.exec(source.slice(at));
    if (number) { tokens.push({ t: 'num', text: number[0], at }); at += number[0].length; continue; }
    if (/[A-Za-zα-ω]/.test(c)) {
      // A run of letters is a known name, or single-letter variables multiplied together: `xy` is x·y.
      const run = /^[A-Za-zα-ω]+/.exec(source.slice(at))![0];
      let p = 0;
      while (p < run.length) {
        const name = names.find((n) => run.startsWith(n, p));
        if (name) { tokens.push({ t: 'id', text: name, at: at + p }); p += name.length; continue; }
        let variable = run[p];
        // A subscript belongs to its letter: `x_1`, `a_n`.
        if (p === run.length - 1) {
          const subscript = /^_[A-Za-z0-9]+/.exec(source.slice(at + run.length));
          if (subscript) { variable += subscript[0]; at += subscript[0].length; }
        }
        tokens.push({ t: 'id', text: variable, at: at + p }); p++;
      }
      at += run.length;
      continue;
    }
    const two = source.slice(at, at + 2);
    if (two === '<=' || two === '>=' || two === '!=' || two === '=>' || two === '==') {
      tokens.push({ t: 'op', text: two === '==' ? '=' : two, at }); at += 2; continue;
    }
    if ('+-*/^()=<>,!|°'.includes(c)) { tokens.push({ t: 'op', text: c, at }); at++; continue; }
    fail('syntax', `Unexpected character "${c}" at ${at}.`);
  }
  return tokens;
}

export type ParseOptions = { functions?: ReadonlySet<string> };

/** Parses `a`, `a = b` or a chain `a < b <= c`. */
export function parseRelation(source: string, options: ParseOptions = {}): Relation {
  if (source.length > limits.length) fail('bounded', `A claim expression may be at most ${limits.length} characters.`);
  const tokens = tokenize(normalize(source));
  const functions = options.functions ?? new Set<string>();
  let at = 0, count = 0, bars = 0;
  const peek = () => tokens[at];
  const isOp = (text: string) => peek()?.t === 'op' && peek().text === text;
  const expect = (text: string) => { if (!isOp(text)) fail('syntax', `Expected "${text}"${peek() ? ` at ${peek().at}` : ' at the end'}.`); at++; };
  const node = (n: Node): Node => { if (++count > limits.nodes) fail('bounded', 'The claim expression is too large.'); return n; };
  const deep = (depth: number) => { if (depth > limits.depth) fail('bounded', 'The claim expression is nested too deeply.'); };

  function primary(depth: number): Node {
    deep(depth);
    const token = peek();
    if (!token) return fail('syntax', 'The expression ends too early.');
    if (token.t === 'num') { at++; return node({ k: 'num', q: decimal(token.text).q! }); }
    if (token.t === 'id') {
      at++;
      const called = builtins.has(token.text) || functions.has(token.text);
      if (called) {
        if (!isOp('(')) fail('syntax', `${token.text} must be written with parentheses, like ${token.text}(x).`);
        at++;
        const args: Node[] = [];
        if (!isOp(')')) { args.push(sum(depth + 1)); while (isOp(',')) { at++; args.push(sum(depth + 1)); } }
        expect(')');
        return node({ k: 'call', name: token.text, args });
      }
      return node({ k: 'sym', name: token.text });
    }
    if (token.text === '(') { at++; const inside = sum(depth + 1); expect(')'); return inside; }
    if (token.text === '|') { at++; bars++; const inside = sum(depth + 1); expect('|'); bars--; return node({ k: 'call', name: 'abs', args: [inside] }); }
    return fail('syntax', `Unexpected "${token.text}" at ${token.at}.`);
  }
  function postfix(depth: number): Node {
    let n = primary(depth);
    while (isOp('!') || isOp('°')) {
      // `!=` is read by the tokenizer as one operator, so a lone `!` here is a factorial.
      const text = peek().text; at++;
      n = node(text === '!' ? { k: 'fact', a: n } : { k: 'deg', a: n });
    }
    return n;
  }
  function power(depth: number): Node {
    const base = postfix(depth);
    if (!isOp('^')) return base;
    at++;
    return node({ k: 'pow', a: base, b: unary(depth + 1) });
  }
  function unary(depth: number): Node {
    deep(depth);
    if (isOp('-')) { at++; return node({ k: 'neg', a: unary(depth + 1) }); }
    if (isOp('+')) { at++; return unary(depth + 1); }
    return power(depth);
  }
  /** Whether the next token starts a factor that is multiplied without a sign: `2x`, `x(x+1)`, `2sqrt(3)`. */
  const implicit = () => {
    const token = peek();
    if (!token) return false;
    if (token.t === 'id') return true;
    if (token.t === 'op') return token.text === '(' || (token.text === '|' && bars === 0);
    return false;
  };
  function product(depth: number): Node {
    let left = unary(depth);
    while (true) {
      if (isOp('*') || isOp('/')) {
        const op = peek().text; at++;
        left = node({ k: op === '*' ? 'mul' : 'div', a: left, b: unary(depth + 1) });
      } else if (implicit()) {
        left = node({ k: 'mul', a: left, b: power(depth + 1) });
      } else if (peek()?.t === 'num') {
        return fail('syntax', `A number directly after a factor at ${peek().at} is ambiguous; write the multiplication with *.`);
      } else break;
    }
    return left;
  }
  function sum(depth: number): Node {
    let left = product(depth);
    while (isOp('+') || isOp('-')) {
      const op = peek().text; at++;
      left = node({ k: op === '+' ? 'add' : 'sub', a: left, b: product(depth + 1) });
    }
    return left;
  }

  const terms = [sum(0)];
  const ops: RelOp[] = [];
  while (peek()?.t === 'op' && ['=', '<', '<=', '>', '>=', '!='].includes(peek().text)) {
    ops.push(peek().text as RelOp); at++;
    terms.push(sum(0));
  }
  if (at < tokens.length) fail('syntax', `Unexpected "${peek().text}" at ${peek().at}.`);
  return { terms, ops };
}

/** Parses an expression with no relation in it. */
export function parseExpression(source: string, options: ParseOptions = {}): Node {
  const relation = parseRelation(source, options);
  if (relation.ops.length) fail('syntax', `Expected an expression, not a relation: ${source}`);
  return relation.terms[0];
}

/** Parses exactly one equation `a = b`. */
export function parseEquation(source: string, options: ParseOptions = {}): [Node, Node] {
  const relation = parseRelation(source, options);
  if (relation.ops.length !== 1 || relation.ops[0] !== '=') fail('syntax', `Expected one equation "a = b": ${source}`);
  return [relation.terms[0], relation.terms[1]];
}

const binders = new Set(['sum', 'prod', 'diff', 'integral', 'limit']);
/**
 * The symbols an expression depends on, apart from the variable a sum, derivative, integral or limit
 * binds. Remembered per node: a derivative shares subtrees, and walking each shared subtree again
 * would make one question cost exponentially many visits.
 */
const remembered = new WeakMap<Node, ReadonlySet<string>>();
function symbolsOf(n: Node): ReadonlySet<string> {
  const known = remembered.get(n);
  if (known) return known;
  let out: ReadonlySet<string>;
  switch (n.k) {
    case 'num': out = new Set(); break;
    case 'sym': out = new Set([n.name]); break;
    case 'neg': case 'fact': case 'deg': out = symbolsOf(n.a); break;
    case 'call': {
      const bound = binders.has(n.name) && n.args[1]?.k === 'sym' ? (n.args[1] as { name: string }).name : null;
      const collected = new Set<string>();
      n.args.forEach((arg, index) => {
        if (bound !== null && index === 1) return;
        for (const name of symbolsOf(arg)) if (!(bound !== null && index === 0 && name === bound)) collected.add(name);
      });
      out = collected;
      break;
    }
    default: out = new Set([...symbolsOf(n.a), ...symbolsOf(n.b)]);
  }
  remembered.set(n, out);
  return out;
}
/** Every symbol the expression mentions, apart from the variables a sum, derivative, integral or limit binds. */
export const freeSymbols = (n: Node): Set<string> => new Set(symbolsOf(n));
/** Whether the expression depends on `name`. */
export const mentions = (n: Node, name: string) => symbolsOf(n).has(name);

/** Replaces symbols by expressions, leaving variables bound inside a sum or an integral alone. */
export function substitute(n: Node, map: ReadonlyMap<string, Node>): Node {
  switch (n.k) {
    case 'num': return n;
    case 'sym': return map.get(n.name) ?? n;
    case 'neg': case 'fact': case 'deg': return { ...n, a: substitute(n.a, map) };
    case 'call': {
      if (binders.has(n.name) && n.args[1]?.k === 'sym') {
        const inner = new Map(map); inner.delete((n.args[1] as { name: string }).name);
        return { ...n, args: n.args.map((arg, index) => (index === 1 ? arg : substitute(arg, index === 0 ? inner : map))) };
      }
      return { ...n, args: n.args.map((arg) => substitute(arg, map)) };
    }
    default: return { ...n, a: substitute(n.a, map), b: substitute(n.b, map) };
  }
}

/** Every number written in the expression, for comparing a claim against the prompt it came with. */
export function literals(n: Node, out: Q[] = []): Q[] {
  switch (n.k) {
    case 'num': out.push(n.q); return out;
    case 'sym': return out;
    case 'neg': case 'fact': case 'deg': return literals(n.a, out);
    case 'call': n.args.forEach((arg) => literals(arg, out)); return out;
    default: literals(n.a, out); return literals(n.b, out);
  }
}
