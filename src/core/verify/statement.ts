import { evaluate, newMeter, type Meter, type Scope } from './evaluate';
import { freeSymbols, parseRelation, type Node, type ParseOptions, type Relation } from './expr';
import { joinThousands, latexToClaim, UNIT, UNREADABLE, words } from './latex';
import { CheckFailure, compare, exact, fail, q, same, type Num, type Strength } from './numbers';
import { holds, sameSet, solveInequality, solveSystem, type Interval } from './solve';

/**
 * What a multiple-choice option says, read the way the option is written: a number, `x = 3`,
 * `x = 2 또는 x = 3`, `x = 1 ± √2`, `-1 ≤ x < 3`, `\frac12 + \frac13 = \frac56`, or a step of working
 * `x + 3 = 7 ⇒ x = 7 − 3`. An option this cannot read is reported as unreadable, never guessed at.
 */
export type Statement =
  | { kind: 'relation'; relation: Relation }
  | { kind: 'any'; parts: Statement[] }
  | { kind: 'all'; parts: Statement[] }
  | { kind: 'implies'; from: Statement; to: Statement }
  | { kind: 'empty' }
  | { kind: 'everything' };

/** Splits at a separator outside parentheses; a word separator must stand as a whole word. */
function split(text: string, separator: string, word = false): string[] {
  const parts: string[] = [];
  const letter = (c: string | undefined) => !!c && /[A-Za-z0-9_]/.test(c);
  let depth = 0, start = 0;
  for (let i = 0; i < text.length; i++) {
    if (text[i] === '(') depth++;
    else if (text[i] === ')') depth--;
    else if (depth === 0 && text.startsWith(separator, i) && (!word || (!letter(text[i - 1]) && !letter(text[i + separator.length])))) {
      parts.push(text.slice(start, i));
      i += separator.length - 1;
      start = i + 1;
    }
  }
  parts.push(text.slice(start));
  return parts.map((p) => p.trim()).filter((p) => p.length);
}

export function parseStatement(text: string, options: ParseOptions = {}): Statement {
  if (text.includes(UNREADABLE)) fail('unsupported', 'The text contains words that cannot be read as mathematics.');
  const implication = split(text, '=>');
  if (implication.length === 2) return { kind: 'implies', from: parseStatement(implication[0], options), to: parseStatement(implication[1], options) };
  if (implication.length > 2) fail('unsupported', 'Only one implication per option is supported.');
  const alternatives = split(text, 'or', true);
  if (alternatives.length > 1) return { kind: 'any', parts: alternatives.map((p) => parseStatement(p, options)) };
  const both = split(text, 'and', true);
  if (both.length > 1) return { kind: 'all', parts: both.map((p) => parseStatement(p, options)) };
  const list = split(text, ',');
  if (list.length > 1) return { kind: 'any', parts: list.map((p) => parseStatement(p, options)) };
  const pm = text.search(/[±∓]/);
  if (pm >= 0) {
    const upper = text[pm] === '±' ? '+' : '-', lower = upper === '+' ? '-' : '+';
    return { kind: 'any', parts: [upper, lower].map((sign) => parseStatement(text.slice(0, pm) + sign + text.slice(pm + 1), options)) };
  }
  return { kind: 'relation', relation: parseRelation(text, options) };
}

const counter = /^([+\-−]?\d+(?:\.\d+)?)\s*([^\d\s$]*)$/;

/** Whether a statement only names values — `3`, `x = 3`, `x = 2 또는 x = 3` — rather than relating things. */
function onlyValues(st: Statement): boolean {
  if (st.kind === 'any') return st.parts.every(onlyValues);
  if (st.kind !== 'relation') return false;
  const { terms, ops } = st.relation;
  return !ops.length || (ops.length === 1 && ops[0] === '=' && (terms[0].k === 'sym' || terms[1].k === 'sym'));
}

/**
 * Reads an option's text, with the unit written after its value (`cm`, `cm^2`, `%`), or returns null
 * when it cannot be read.
 *
 * A unit is set aside only from a value: `12 cm` is 12. In anything that relates quantities a unit
 * changes the meaning — `1 m = 100 cm` is true and 1 = 100 is not — so such an option is unreadable.
 */
export function readOptionDetailed(text: string, options: ParseOptions = {}): { statement: Statement; unit: string } | null {
  const t = joinThousands(text.trim());
  if (/해(가|는)\s*없/.test(t)) return { statement: { kind: 'empty' }, unit: '' };
  if (/^모든\s*실수/.test(t)) return { statement: { kind: 'everything' }, unit: '' };
  try {
    let ascii: string;
    if (t.includes('$')) {
      const pieces = t.split('$');
      if (pieces.length % 2 === 0) return null;
      ascii = pieces.map((piece, k) => (k % 2 ? latexToClaim(piece) : words(piece))).join(' ');
    } else {
      const plain = counter.exec(t);
      if (plain && !words(plain[2] || ' ').includes(UNREADABLE)) ascii = `${plain[1]} ${words(plain[2] || ' ')}`;
      else if (/[가-힣]/.test(t)) return null;
      else ascii = latexToClaim(t);
    }
    ascii = joinThousands(ascii);
    // A unit carries the power written after it, even across a $: `$4$ cm$^2$` is 4 with unit cm².
    const units: string[] = [];
    ascii = ascii.replace(new RegExp(`${UNIT}([^${UNIT}]*)${UNIT}(\\s*\\^\\s*(\\(\\s*\\d+\\s*\\)|\\d))?`, 'g'), (_, unit: string, power?: string) => {
      units.push(`${unit.trim()}${power ? `^${power.replace(/[\s^()]/g, '')}` : ''}`);
      return ' ';
    });
    if (ascii.includes('%')) { units.push('%'); ascii = ascii.replace(/%/g, ' '); }
    const statement = parseStatement(ascii, options);
    if (units.length && !onlyValues(statement)) return null;
    return { statement, unit: [...new Set(units)].join(' ') };
  } catch (reason) {
    if (reason instanceof CheckFailure) return null;
    throw reason;
  }
}

/** Reads an option's text, or returns null when it cannot be read. */
export function readOption(text: string, options: ParseOptions = {}): Statement | null {
  return readOptionDetailed(text, options)?.statement ?? null;
}

/** The symbols in the terms that are neither bound in the scope nor constants. */
const unbound = (terms: Node[], scope: Scope) =>
  [...new Set(terms.flatMap((t) => [...freeSymbols(t)]))].filter((s) => !scope.vars.has(s) && !['pi', 'e', 'i'].includes(s));

/** The numbers an option names, or null when it is not a list of values. */
export function statementValues(st: Statement, scope: Scope, meter: Meter = newMeter()): Num[] | null {
  if (st.kind === 'any') {
    const all = st.parts.map((p) => statementValues(p, scope, meter));
    return all.every((v) => v) ? all.flat() as Num[] : null;
  }
  if (st.kind !== 'relation') return null;
  const { terms, ops } = st.relation;
  try {
    if (!ops.length) return unbound(terms, scope).length ? null : [evaluate(terms[0], scope, meter)];
    // `x = 3` names 3; so does `3 = x`.
    if (ops.length === 1 && ops[0] === '=') {
      const [left, right] = terms;
      if (left.k === 'sym' && !scope.vars.has(left.name)) return [evaluate(right, scope, meter)];
      if (right.k === 'sym' && !scope.vars.has(right.name)) return [evaluate(left, scope, meter)];
    }
  } catch (reason) {
    if (reason instanceof CheckFailure) return null;
    throw reason;
  }
  return null;
}

/** The solution set an option describes, in the variable v, or null when it does not describe one. */
export function statementSet(st: Statement, v: string, scope: Scope, meter: Meter = newMeter()): Interval[] | null {
  try {
    switch (st.kind) {
      case 'empty': return [];
      case 'everything': return [{ lo: { value: null, closed: false }, hi: { value: null, closed: false } }];
      case 'any': {
        const parts = st.parts.map((p) => statementSet(p, v, scope, meter));
        return parts.every((p) => p) ? union((parts as Interval[][]).flat()) : null;
      }
      case 'relation': {
        const { terms, ops } = st.relation;
        if (ops.length === 1 && ops[0] === '=') {
          const values = statementValues(st, scope, meter);
          return values && values.map((value) => ({ lo: { value, closed: true }, hi: { value, closed: true } }));
        }
        if (!ops.length || ops.includes('=') || ops.includes('!=')) return null;
        if (unbound(terms, scope).some((s) => s !== v)) return null;
        return solveInequality(st.relation, v, scope, meter).set;
      }
      default: return null;
    }
  } catch (reason) {
    if (reason instanceof CheckFailure) return null;
    throw reason;
  }
}

function union(pieces: Interval[]): Interval[] {
  const key = (i: Interval) => i.lo.value;
  const sorted = [...pieces].sort((a, b) => {
    const x = key(a), y = key(b);
    if (!x) return -1; if (!y) return 1;
    return compare(x, y);
  });
  const out: Interval[] = [];
  for (const piece of sorted) {
    const last = out[out.length - 1];
    if (last && (last.hi.value === null || (piece.lo.value && compare(piece.lo.value, last.hi.value) < 0)
      || (piece.lo.value && compare(piece.lo.value, last.hi.value) === 0 && (piece.lo.closed || last.hi.closed)))) {
      if (last.hi.value !== null && (piece.hi.value === null || compare(piece.hi.value, last.hi.value) > 0)) last.hi = piece.hi;
      else if (last.hi.value !== null && piece.hi.value && compare(piece.hi.value, last.hi.value) === 0) last.hi = { value: last.hi.value, closed: last.hi.closed || piece.hi.closed };
    } else out.push({ lo: { ...piece.lo }, hi: { ...piece.hi } });
  }
  return out;
}

/** Magnitudes for sample points: varied, never round, so no identity holds at them by accident. */
const magnitudes = [[3n, 7n], [11n, 4n], [2n, 9n], [13n, 5n], [7n, 2n], [17n, 11n], [1n, 6n], [19n, 8n], [5n, 13n], [9n, 4n], [23n, 7n], [29n, 3n]] as const;

/**
 * Sample points for up to several variables: first every sign pattern (so an identity that fails
 * only when two variables are both negative, like √a√b = √(ab), meets that case), then one point
 * where all variables are equal, then varied points.
 */
function samplePoints(count: number): bigint[][][] {
  const points: bigint[][][] = [];
  const patterns = Math.min(2 ** count, 16);
  for (let t = 0; t < patterns; t++) {
    points.push(Array.from({ length: count }, (_, j) => { const [n, d] = magnitudes[(t + 3 * j) % magnitudes.length]; return [(t >> j) & 1 ? -n : n, d]; }));
  }
  const [n, d] = magnitudes[4];
  points.push(Array.from({ length: count }, () => [n, d]));
  for (let t = 0; t < 12; t++) {
    points.push(Array.from({ length: count }, (_, j) => { const [a, b] = magnitudes[(5 * t + 7 * j + 1) % magnitudes.length]; return [(t + j) % 3 === 0 ? -a : a, b]; }));
  }
  return points;
}

/**
 * Whether an equation with free variables holds for every value of them: an identity like
 * (a+b)² = a²+2ab+b². Checked at sample points covering every sign pattern — a polynomial identity
 * that is false fails at almost every point, so this is the standard check of a symbolic answer.
 * Only equations are decided this way: an inequality or ≠ can fail at a single point that no sample
 * lands on (x² − 2x + 1 > 0 fails only at x = 1).
 */
export function forAll(relation: Relation, free: string[], scope: Scope, meter: Meter): { truth: boolean; strength: Strength } {
  if (relation.ops.some((op) => op !== '=')) fail('unsupported', 'Only an equation can be checked for every value by sampling.');
  let tried = 0;
  for (const point of samplePoints(free.length)) {
    const values = new Map(free.map((name, j) => [name, exact(q(point[j][0], point[j][1]))] as const));
    const vars = new Map(scope.vars); values.forEach((v, k) => vars.set(k, v));
    let sides: Num[];
    try { sides = relation.terms.map((term) => evaluate(term, { ...scope, vars }, meter)); }
    catch (reason) { if (reason instanceof CheckFailure && (reason.code === 'domain' || reason.code === 'unstable')) continue; throw reason; }
    tried++;
    if (!holds(relation, values, scope, meter)) return { truth: false, strength: sides.every((s) => s.q) ? 'exact' : 'numeric' };
  }
  if (tried < 6) fail('unsupported', 'Too few sample points are in the domain to check this for every value.');
  return { truth: true, strength: 'sampled' };
}

const everything: Interval[] = [{ lo: { value: null, closed: false }, hi: { value: null, closed: false } }];
/** Whether every interval of a lies inside b. */
function subset(a: Interval[], b: Interval[]): boolean {
  const below = (x: Interval['lo'], y: Interval['lo']) => // x is at or past y as a lower end
    y.value === null || (x.value !== null && (compare(x.value, y.value) > 0 || (compare(x.value, y.value) === 0 && (y.closed || !x.closed))));
  const above = (x: Interval['hi'], y: Interval['hi']) =>
    y.value === null || (x.value !== null && (compare(x.value, y.value) < 0 || (compare(x.value, y.value) === 0 && (y.closed || !x.closed))));
  return a.every((piece) => b.some((outer) => below(piece.lo, outer.lo) && above(piece.hi, outer.hi)));
}

/** The real solution set of an equation or inequality chain in one variable. */
function solutionSet(relation: Relation, v: string, scope: Scope, meter: Meter): Interval[] {
  if (relation.ops.length === 1 && relation.ops[0] === '=') {
    const solved = solveSystem([[relation.terms[0], relation.terms[1]]], [v], 'real', { lo: null, hi: null, test: () => true }, scope, meter);
    return solved.solutions.map((s) => { const value = s.values.get(v)!; return { lo: { value, closed: true }, hi: { value, closed: true } }; });
  }
  if (relation.ops.some((op) => op === '=' || op === '!=')) return fail('unsupported', 'A chain mixing = or ≠ with inequalities is not decided here.');
  return solveInequality(relation, v, scope, meter).set;
}

/** Whether an option's statement is true, or null when it cannot be decided here. */
export function statementTruth(st: Statement, scope: Scope, meter: Meter = newMeter()): { truth: boolean; strength: Strength } | null {
  try {
    if (st.kind === 'relation') {
      const free = unbound(st.relation.terms, scope);
      if (!st.relation.ops.length) return null;
      if (!free.length) {
        const sides = st.relation.terms.map((t) => evaluate(t, scope, meter));
        const truth = holds(st.relation, new Map(), scope, meter);
        return { truth, strength: sides.every((s) => s.q) ? 'exact' : 'numeric' };
      }
      if (st.relation.ops.every((op) => op === '=')) return forAll(st.relation, free, scope, meter);
      // "For every real x" of an inequality in one variable is decided exactly: its solution set must
      // be the whole line. Where the expression is undefined somewhere (√x ≥ 0) the claim's own
      // domain is ambiguous, so only a statement defined everywhere is called false.
      if (free.length === 1 && st.relation.ops.every((op) => op !== '=' && op !== '!=')) {
        const set = solveInequality(st.relation, free[0], scope, meter).set;
        if (sameSet(set, everything)) return { truth: true, strength: 'exact' };
        return definedEverywhere(st.relation) ? { truth: false, strength: 'exact' } : null;
      }
      if (free.length === 1 && st.relation.ops.length === 1 && st.relation.ops[0] === '!=') {
        const equal = solutionSet({ terms: st.relation.terms, ops: ['='] }, free[0], scope, meter);
        if (!equal.length) return { truth: true, strength: 'exact' };
        return definedEverywhere(st.relation) ? { truth: false, strength: 'exact' } : null;
      }
      return null;
    }
    if (st.kind === 'implies' && st.from.kind === 'relation' && st.to.kind === 'relation') {
      const free = unbound([...st.from.relation.terms, ...st.to.relation.terms], scope);
      if (free.length !== 1) return null;
      const [v] = free;
      const from = solutionSet(st.from.relation, v, scope, meter), to = solutionSet(st.to.relation, v, scope, meter);
      // ⇒ is read two ways at school: a step of working (the solution set is kept) and a proposition
      // (p's solutions are among q's). Equal sets are right under both, a set not inside the other is
      // wrong under both, and a set strictly inside the other is right only as a proposition.
      if (sameSet(from, to)) return { truth: true, strength: 'exact' };
      if (!subset(from, to)) return { truth: false, strength: 'exact' };
      return null;
    }
    return null;
  } catch (reason) {
    if (reason instanceof CheckFailure) return null;
    throw reason;
  }
}

/** Whether the relation involves nothing undefined for some real values: no division, root or logarithm of the variable. */
function definedEverywhere(relation: Relation): boolean {
  const ok = (n: Node): boolean => {
    switch (n.k) {
      case 'num': case 'sym': return true;
      case 'neg': case 'fact': case 'deg': return ok(n.a);
      case 'div': return n.b.k === 'num' && ok(n.a);
      case 'pow': return n.b.k === 'num' && n.b.q.d === 1n && n.b.q.n >= 0n && ok(n.a);
      case 'call': return ['abs', 'sin', 'cos', 'exp', 'atan', 'arctan', 'sinh', 'cosh', 'tanh', 'cbrt', 'floor', 'ceil', 'round', 'sign', 'min', 'max'].includes(n.name) && n.args.every(ok);
      default: return ok(n.a) && ok(n.b);
    }
  };
  return relation.terms.every(ok);
}

/** The expression an option is, `3(x-2)` or `y = 3(x-2)`, when the claim is about an expression in `variables`. */
export function statementForm(st: Statement, variables: string[]): Node | null {
  if (st.kind !== 'relation') return null;
  const { terms, ops } = st.relation;
  if (!ops.length) return terms[0];
  if (ops.length === 1 && ops[0] === '=' && terms[0].k === 'sym' && !variables.includes(terms[0].name)) return terms[1];
  return null;
}

/** Two lists of values are the same set of numbers. */
export function sameValues(a: Num[], b: Num[]): boolean {
  const distinct = (list: Num[]) => list.filter((x, i) => list.findIndex((y) => same(x, y).equal) === i);
  const x = distinct(a), y = distinct(b);
  return x.length === y.length && x.every((v) => y.some((w) => same(v, w).equal));
}
