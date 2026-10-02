import 'server-only';
import { gradeAnswer } from '@/core/grading';
import { answerText, choiceIssue, misreadingsIssue, normalizeAnswer, type AnswerSpec, type ExpectedMisreading } from '@/shared/answer';
import { readMathExpression } from '@/shared/math-expression';
import { misconceptionOf } from '@/shared/misconception';
import { claimSchema, claimScope, evaluateClaim, type ClaimResult } from './claims';
import { evaluate, newMeter } from './evaluate';
import { literals, parseExpression } from './expr';
import { latexToClaim } from './latex';
import { approx, CheckFailure, exact, int, q, same, show, weakest, type Num, type Strength } from './numbers';
import { sameSet, showSet } from './solve';
import { forAll, readOption, sameValues, statementForm, statementSet, statementTruth, statementValues } from './statement';

/**
 * Checks one problem against the computation it declares (its claim).
 *
 * A model writing a problem writes three things that must agree — the prompt, the answer key, and
 * the options and expected wrong answers — and nothing used to make them. Here the server does the
 * computation the claim declares and holds the rest to it: the key must be what was computed, exactly
 * one option may be it, and each expected wrong answer must be a wrong answer the grader will accept
 * as written and record under its name.
 *
 * The verdict leans one way on purpose. `verified` needs every check to pass; `rejected` needs a
 * check to fail for certain; anything the checker cannot decide is `unverified`, never a pass. What
 * this does not see is whether the prompt asks what the claim computes — that is a separate check.
 */
export type IssueLevel = 'error' | 'unverified' | 'warning';
export type IssueCode =
  | 'claim-invalid' | 'claim-failed' | 'claim-ill-posed' | 'claim-shape'
  | 'answer-mismatch' | 'answer-unaccepted'
  | 'choice-invalid' | 'choice-no-match' | 'choice-ambiguous' | 'choice-wrong-key' | 'option-unreadable'
  | 'misreading-invalid' | 'misreading-correct' | 'misreading-unrecordable' | 'misreading-shadowed' | 'misreading-derivation' | 'misreading-unchecked'
  | 'prompt-numbers' | 'claim-note';
export type Issue = { code: IssueCode; level: IssueLevel; message: string; option?: string; answer?: string };
export type Report = { verdict: 'verified' | 'rejected' | 'unverified'; strength?: Strength; computed?: string; issues: Issue[] };

export type CheckInput = {
  /** The prompt as shown, prose with `$…$`. Used only to warn when the claim's numbers are not in it. */
  prompt?: string;
  answer: AnswerSpec;
  /** Expected wrong answers; `expression` is the wrong computation that is said to produce each. */
  misreadings?: (ExpectedMisreading & { expression?: string })[];
  /** The claim, as received: it is validated here. */
  solves: unknown;
};

/** The value a written answer key holds, read the way the grader reads it. */
function keyValue(spec: Exclude<AnswerSpec, { kind: 'choice' }>): Num | null {
  if (spec.kind === 'integer') return int(spec.value);
  if (spec.kind === 'rational') return exact(q(BigInt(spec.numerator), BigInt(spec.denominator)));
  const read = readMathExpression(spec.expression);
  if (!read.value) return null;
  let rational = exact(q(0n)), irrational = 0;
  for (const [radicand, c] of read.value) {
    if (radicand === 1n) rational = exact(q(c.n, c.d));
    else irrational += (Number(c.n) / Number(c.d)) * Math.sqrt(Number(radicand));
  }
  return irrational ? approx(rational.re + irrational) : rational;
}

/** Every number written in the prompt, prose and math alike, including the value of each fraction. */
function promptNumbers(prompt: string): Num[] {
  const out: Num[] = [];
  const add = (text: string) => {
    for (const m of text.matchAll(/\d+(?:\.\d+)?/g)) { try { out.push(evaluate(parseExpression(m[0]), { vars: new Map(), functions: new Map() })); } catch { /* skip */ } }
    for (const m of text.matchAll(/\(\((\d+(?:\.\d+)?)\)\/\((\d+(?:\.\d+)?)\)\)/g)) { try { out.push(evaluate(parseExpression(`${m[1]}/${m[2]}`), { vars: new Map(), functions: new Map() })); } catch { /* skip */ } }
  };
  prompt.split('$').forEach((piece, k) => {
    if (k % 2 === 0) { add(piece.replace(/(\d),(?=\d{3}\b)/g, '$1')); return; }
    try { add(latexToClaim(piece)); } catch { add(piece); }
  });
  return out;
}
/** Small whole numbers and the constants of angles and percentages appear in claims without being in prompts. */
const ordinary = (n: Num) => !!n.q && n.q.d === 1n && ((n.q.n >= -12n && n.q.n <= 12n) || [100n, 180n, 360n, 1000n].includes(n.q.n));

function claimLiterals(raw: unknown): Num[] {
  const texts: string[] = [];
  const walk = (v: unknown) => { if (typeof v === 'string') texts.push(v); else if (v && typeof v === 'object') Object.values(v).forEach(walk); };
  if (raw && typeof raw === 'object') Object.entries(raw).forEach(([k, v]) => { if (k !== 'kind' && k !== 'select' && k !== 'domain' && k !== 'which' && k !== 'among') walk(v); });
  return texts.flatMap((t) => {
    try { return t.split(/<=|>=|!=|=|<|>/).flatMap((side) => literals(parseExpression(side))).map((v) => exact(v)); }
    catch { return []; }
  });
}

/** Which options agree with what the claim computed, as decided per option, or null for one that cannot be read. */
function optionMatches(result: ClaimResult, options: { id: string; text: string }[], functionNames: Set<string>, variable: string): Map<string, { match: boolean; strength: Strength } | null> {
  const out = new Map<string, { match: boolean; strength: Strength } | null>();
  const scope = result.type === 'choose' || result.type === 'form' ? result.scope : { vars: new Map(), functions: new Map() };
  for (const option of options) {
    const statement = readOption(option.text, { functions: functionNames });
    if (!statement) { out.set(option.id, null); continue; }
    const meter = newMeter();
    if (result.type === 'choose') {
      const truth = statementTruth(statement, scope, meter);
      out.set(option.id, truth && { match: truth.truth === (result.which === 'true'), strength: truth.strength });
    } else if (result.type === 'form') {
      const form = statementForm(statement, result.variables);
      if (!form) { out.set(option.id, null); continue; }
      try {
        const identical = forAll({ terms: [form, result.node], ops: ['='] }, result.variables, scope, meter);
        out.set(option.id, { match: identical.truth, strength: identical.strength });
      } catch (reason) { if (!(reason instanceof CheckFailure)) throw reason; out.set(option.id, null); }
    } else if (result.type === 'value') {
      const values = statementValues(statement, scope, meter);
      if (!values) { out.set(option.id, null); continue; }
      const each = values.map((v) => same(v, result.value, result.strength === 'estimated'));
      out.set(option.id, { match: values.length === 1 && each[0].equal, strength: weakest(...each.map((e) => e.strength)) });
    } else if (result.type === 'values') {
      const values = statementValues(statement, scope, meter);
      out.set(option.id, values && { match: sameValues(values, result.values), strength: result.strength });
    } else {
      const set = statementSet(statement, variable, scope, meter);
      out.set(option.id, set && { match: sameSet(set, result.set), strength: result.strength });
    }
  }
  return out;
}

export function verifyProblem(input: CheckInput): Report {
  const issues: Issue[] = [];
  const report = (computed?: string, strength?: Strength): Report => {
    const verdict = issues.some((i) => i.level === 'error') ? 'rejected' : issues.some((i) => i.level === 'unverified') ? 'unverified' : 'verified';
    return { verdict, ...(verdict === 'verified' ? { strength } : {}), ...(computed !== undefined ? { computed } : {}), issues };
  };
  const parsed = claimSchema.safeParse(input.solves);
  if (!parsed.success) {
    issues.push({ code: 'claim-invalid', level: 'unverified', message: parsed.error.issues.map((i) => `${i.path.join('.') || 'claim'}: ${i.message}`).join('; ') });
    return report();
  }
  const claim = parsed.data;
  let result: ClaimResult;
  try { result = evaluateClaim(claim); }
  catch (reason) {
    if (!(reason instanceof CheckFailure)) throw reason;
    issues.push(reason.code === 'ill-posed'
      ? { code: 'claim-ill-posed', level: 'error', message: reason.message }
      : { code: 'claim-failed', level: 'unverified', message: `${reason.code}: ${reason.message}` });
    return report();
  }
  result.notes.forEach((message) => issues.push({ code: 'claim-note', level: 'warning', message }));
  const computed = result.type === 'value' ? show(result.value) : result.type === 'values' ? result.values.map(show).join(', ')
    : result.type === 'set' ? showSet(result.set) : result.type === 'form' ? (input.solves as { expression: string }).expression : `the ${result.which} statement`;
  let strength: Strength = result.type === 'choose' ? 'exact' : result.strength;

  const spec = input.answer;
  if (spec.kind === 'choice') {
    const structural = choiceIssue(spec);
    if (structural) issues.push({ code: 'choice-invalid', level: 'error', message: structural });
    const functionNames = new Set(Object.keys(claim.define ?? {}).map((k) => k[0]));
    const matches = optionMatches(result, spec.options, functionNames, claim.kind === 'inequality' ? claim.variable : 'x');
    const matching = [...matches].filter(([, m]) => m?.match).map(([id]) => id);
    const unreadable = [...matches].filter(([, m]) => !m).map(([id]) => id);
    unreadable.forEach((id) => issues.push({ code: 'option-unreadable', level: 'unverified', option: id, message: `Option ${id} could not be read, so it cannot be ruled out.` }));
    if (matching.length > 1) issues.push({ code: 'choice-ambiguous', level: 'error', message: `More than one option agrees with ${computed}: ${matching.join(', ')}.` });
    else if (matching.length === 1 && matching[0] !== spec.correct) issues.push({ code: 'choice-wrong-key', level: 'error', option: matching[0], message: `Option ${matching[0]} agrees with ${computed}, but the key is ${spec.correct}.` });
    else if (matching.length === 0 && !unreadable.length) issues.push({ code: 'choice-no-match', level: 'error', message: `No option agrees with ${computed}.` });
    for (const [, m] of matches) if (m) strength = weakest(strength, m.strength);
  } else {
    if (result.type !== 'value') {
      issues.push({ code: 'claim-shape', level: 'unverified', message: 'A written answer needs a claim that computes one value.' });
      return report(computed);
    }
    const key = keyValue(spec);
    const comparison = key && same(key, result.value, result.strength === 'estimated');
    if (!key || !comparison) issues.push({ code: 'answer-unaccepted', level: 'error', message: 'The answer key cannot be read.' });
    else if (!comparison.equal) issues.push({ code: 'answer-mismatch', level: 'error', message: `The answer key is ${show(key)}, but the claim computes ${computed}.` });
    else strength = weakest(strength, comparison.strength);
    const graded = gradeAnswer(answerText(spec), spec);
    if (graded.status !== 'correct') issues.push({ code: 'answer-unaccepted', level: 'error', message: `The grader does not accept the key as written (${graded.status}): ${graded.message}` });
  }

  if (input.misreadings?.length) {
    const entries = input.misreadings.map(({ answer, misconception }) => ({ answer, misconception }));
    const structural = misreadingsIssue(spec, entries, (key) => !!misconceptionOf(key));
    if (structural) issues.push({ code: 'misreading-invalid', level: 'error', message: structural });
    const scope = (() => { try { return claimScope(claim, newMeter()); } catch { return { vars: new Map(), functions: new Map() }; } })();
    const functionNames = new Set(scope.functions.keys());
    for (const m of input.misreadings) {
      const graded = gradeAnswer(m.answer, spec, false, entries);
      if (graded.status === 'invalid') issues.push({ code: 'misreading-unrecordable', level: 'error', answer: m.answer, message: `The answer box refuses "${m.answer}" (${graded.message}), so this mistake can never be recorded.` });
      else if (graded.status === 'correct') issues.push({ code: 'misreading-correct', level: 'error', answer: m.answer, message: `"${m.answer}" is graded correct.` });
      else if (graded.misconception !== m.misconception) issues.push({ code: 'misreading-shadowed', level: 'error', answer: m.answer, message: `"${m.answer}" is recorded as ${graded.misconception ?? 'no named mistake'}, not ${m.misconception}.` });
      if (!m.expression) continue;
      // The wrong computation, done: it has to land on the wrong answer it is said to produce.
      try {
        const wrong = evaluate(parseExpression(m.expression, { functions: functionNames }), scope);
        let stated: Num | null = null;
        if (spec.kind === 'choice') {
          const option = spec.options.find((o) => o.id === m.answer);
          const statement = option && readOption(option.text, { functions: functionNames });
          const values = statement && statementValues(statement, scope);
          // An option that is a statement — a step of working, an equation — has no value to compare.
          if (statement && !values) {
            issues.push({ code: 'misreading-unchecked', level: 'warning', answer: m.answer, message: `Option ${m.answer} is a statement, not a value, so its wrong computation is not compared.` });
            continue;
          }
          stated = values?.length === 1 ? values[0] : null;
        } else if (readMathExpression(normalizeAnswer(m.answer) ?? '').value) {
          stated = keyValue({ kind: 'expression', expression: normalizeAnswer(m.answer)! });
        }
        if (!stated) issues.push({ code: 'misreading-unchecked', level: 'unverified', answer: m.answer, message: `"${m.answer}" could not be read as a value to compare with its computation.` });
        else if (!same(stated, wrong).equal) issues.push({ code: 'misreading-derivation', level: 'error', answer: m.answer, message: `The stated wrong computation gives ${show(wrong)}, not ${m.answer}.` });
      } catch (reason) {
        if (!(reason instanceof CheckFailure)) throw reason;
        issues.push({ code: 'misreading-unchecked', level: 'unverified', answer: m.answer, message: `The wrong computation for "${m.answer}" could not be computed: ${reason.message}` });
      }
    }
  }

  if (input.prompt) {
    const inPrompt = promptNumbers(input.prompt);
    const missing = claimLiterals(input.solves).filter((n) => !ordinary(n) && !inPrompt.some((p) => same(p, n).equal));
    const distinct = missing.filter((n, i) => missing.findIndex((m) => same(m, n).equal) === i);
    if (distinct.length) issues.push({ code: 'prompt-numbers', level: 'warning', message: `The claim uses numbers that are not in the prompt: ${distinct.map(show).join(', ')}.` });
  }
  return report(computed, strength);
}
