/**
 * Answer syntax, shared by grading and the editor. An author writes a question's answer the way a
 * learner will type it, so one parser decides both what is stored and what is accepted. Nothing
 * here grades: it reads a written number, and `gradeAnswer` alone compares one to an expectation.
 */
export type AnswerSpec =
  | { kind: 'integer'; value: number }
  | { kind: 'rational'; numerator: number; denominator: number; requiredForm?: 'reduced_fraction' };
export type ParsedAnswer = { numerator: bigint; denominator: bigint; fraction: boolean; reduced: boolean };

function gcd(a: bigint, b: bigint): bigint {
  a = a < 0n ? -a : a;
  b = b < 0n ? -b : b;
  while (b !== 0n) [a, b] = [b, a % b];
  return a;
}

/**
 * Accepts a fixed LaTeX subset so an equation editor can post its own output unchanged.
 * Purely syntactic rewriting: `\frac{1+1}{2}` keeps its backslashes, fails the checks below,
 * and is reported as invalid. No expression is ever evaluated.
 */
function stripLatex(input: string): string {
  let text = input;
  for (const [open, close] of [['$$', '$$'], ['\\[', '\\]'], ['\\(', '\\)'], ['$', '$']]) {
    if (text.length > open.length + close.length && text.startsWith(open) && text.endsWith(close)) {
      text = text.slice(open.length, -close.length).trim();
      break;
    }
  }
  text = text.replace(/\\[,;:!]|\\ |~/g, '');
  return text.replace(/^\\[dt]?frac\s*\{\s*([+-]?\d+)\s*\}\s*\{\s*([+-]?\d+)\s*\}$/, '$1/$2').trim();
}

/** Canonical plain form shared by parsing and the integer-only check. */
export function normalizeAnswer(answer: string): string | null {
  if (typeof answer !== 'string' || answer.length > 80) return null;
  return stripLatex(answer.trim()).replaceAll('−', '-').replaceAll('⁄', '/');
}

/** True when the writer chose a whole number rather than a fraction or a decimal. */
export const writtenAsInteger = (answer: string) => /^[+-]?\d+$/.test(normalizeAnswer(answer) ?? '');

export function parseAnswer(answer: string): ParsedAnswer | null {
  const input = normalizeAnswer(answer);
  if (input === null) return null;
  const fraction = /^([+-]?\d+)\s*\/\s*([+-]?\d+)$/.exec(input);
  if (fraction) {
    let numerator = BigInt(fraction[1]);
    let denominator = BigInt(fraction[2]);
    if (denominator === 0n) return null;
    const divisor = gcd(numerator, denominator);
    const reduced = denominator > 0n && divisor === 1n;
    if (denominator < 0n) { numerator = -numerator; denominator = -denominator; }
    return { numerator: numerator / divisor, denominator: denominator / divisor, fraction: true, reduced };
  }
  if (!/^[+-]?(?:\d+(?:\.\d+)?|\.\d+)$/.test(input)) return null;
  const negative = input.startsWith('-');
  const [whole, decimal = ''] = input.replace(/^[+-]/, '').split('.');
  const numerator = BigInt(`${whole || '0'}${decimal}`) * (negative ? -1n : 1n);
  const denominator = 10n ** BigInt(decimal.length);
  const divisor = gcd(numerator, denominator);
  return { numerator: numerator / divisor, denominator: denominator / divisor, fraction: false, reduced: true };
}

const safe = (value: bigint) => Number.isSafeInteger(Number(value));

/**
 * Reads what an author wrote into the expectation a question stores. The written form chooses the
 * response kind: a whole number asks for a whole number, while a fraction or a decimal accepts any
 * equivalent value. A form requirement belongs to fractions, so a whole number drops it.
 */
export function answerSpec(input: string, requiredForm?: 'reduced_fraction' | null): AnswerSpec | null {
  const parsed = parseAnswer(input);
  if (!parsed || !safe(parsed.numerator) || !safe(parsed.denominator)) return null;
  if (writtenAsInteger(input)) return { kind: 'integer', value: Number(parsed.numerator) };
  return { kind: 'rational', numerator: Number(parsed.numerator), denominator: Number(parsed.denominator),
    ...(requiredForm ? { requiredForm } : {}) };
}

/** The written form of a stored expectation, so opening a question shows what was answered. */
export function answerText(spec: { kind: 'integer' | 'rational'; value?: number; numerator?: number; denominator?: number }): string {
  if (spec.kind === 'integer') return Number.isFinite(spec.value) ? String(spec.value) : '';
  return Number.isFinite(spec.numerator) && Number.isFinite(spec.denominator) ? `${spec.numerator}/${spec.denominator}` : '';
}
