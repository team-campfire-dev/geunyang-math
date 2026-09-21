/**
 * Answer syntax, shared by grading and the editor. An author writes a question's answer the way a
 * learner will type it, so one parser decides both what is stored and what is accepted. Nothing
 * here grades: it reads a written number, and `gradeAnswer` alone compares one to an expectation.
 */
/** One of the answers a multiple-choice question offers. Its text is prose with `$...$`, like any other. */
export type AnswerOption = { id: string; text: string };
export type AnswerSpec =
  | { kind: 'integer'; value: number }
  | { kind: 'rational'; numerator: number; denominator: number; requiredForm?: 'reduced_fraction' }
  /**
   * A question answered by picking. The options are kept with the answer because they are what the
   * answer means: `correct` alone says nothing without the list it names one of. What a learner is
   * sent is this list without `correct`, which is why the two are stored apart at publication.
   */
  | { kind: 'choice'; options: AnswerOption[]; correct: string };
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
export function answerText(spec: { kind: string; value?: number; numerator?: number; denominator?: number }): string {
  // A picked answer is not written, so there is nothing to put in a box that takes writing.
  if (spec.kind === 'choice') return '';
  if (spec.kind === 'integer') return Number.isFinite(spec.value) ? String(spec.value) : '';
  return Number.isFinite(spec.numerator) && Number.isFinite(spec.denominator) ? `${spec.numerator}/${spec.denominator}` : '';
}

/**
 * What is wrong with a set of options, or null when nothing is. One reader for the editor, which
 * says it while the author types, and for publication, which refuses it.
 */
export function choiceIssue(spec: { options: AnswerOption[]; correct: string }): string | null {
  if (spec.options.length < 2) return '보기를 두 개 이상 써 주세요.';
  if (spec.options.length > choiceLimits.maxOptions) return `보기는 ${choiceLimits.maxOptions}개까지 쓸 수 있어요.`;
  if (spec.options.some((option) => !option.text.trim())) return '내용이 빈 보기가 있어요.';
  if (spec.options.some((option) => option.text.length > choiceLimits.maxText)) return `보기 하나는 ${choiceLimits.maxText}자까지 쓸 수 있어요.`;
  if (new Set(spec.options.map((option) => option.id)).size !== spec.options.length) return '보기의 이름이 겹쳐요.';
  if (!spec.options.some((option) => option.id === spec.correct)) return '정답인 보기를 하나 골라 주세요.';
  return null;
}
export const choiceLimits = { maxOptions: 6, maxText: 200 } as const;

/**
 * A wrong answer the author expects, and the name of the mistake behind it.
 *
 * For a picked answer `answer` is an option's name; for a written one it is the value itself, as a
 * learner would type it. Which is the whole trick for written answers: the wrong doors are endless
 * but the ones people actually walk through are few, and a wrong procedure lands on exactly one
 * value. Naming a couple per question catches most of the traffic, and an unnamed wrong answer is
 * treated exactly as it is today.
 */
export type ExpectedMisreading = { answer: string; misconception: string };
export const misreadingLimits = { maxPerProblem: 8 } as const;

/** Whether two written answers mean the same number — `2/8`, `1/4` and `0.25` are one answer. */
function sameNumber(left: string, right: string): boolean {
  const a = parseAnswer(left), b = parseAnswer(right);
  return !!a && !!b && a.numerator * b.denominator === b.numerator * a.denominator;
}

/** The value an answer specification expects, written the way a learner would type it. */
const expectedText = (spec: AnswerSpec): string | null =>
  spec.kind === 'choice' ? spec.correct : spec.kind === 'integer' ? String(spec.value) : `${spec.numerator}/${spec.denominator}`;

/**
 * Why a question's expected wrong answers cannot be published, or null when they can.
 *
 * The rule that matters is the third one: a wrong answer that is actually right would mark a
 * learner's correct answer as a mistake they keep making. The comparison is by value, so writing
 * `0.5` against an answer of `1/2` is caught however it was spelled.
 */
export function misreadingsIssue(spec: AnswerSpec, entries: ExpectedMisreading[], known: (key: string) => boolean): string | null {
  if (entries.length > misreadingLimits.maxPerProblem) return `한 문항에 예상 오답은 ${misreadingLimits.maxPerProblem}개까지 달 수 있어요.`;
  const seen: string[] = [];
  for (const entry of entries) {
    const written = entry.answer.trim();
    if (!written) return '예상 오답이 비어 있어요.';
    if (!known(entry.misconception)) return `「${entry.misconception}」는 알려진 오개념 이름이 아니에요.`;
    if (spec.kind === 'choice') {
      if (!spec.options.some((option) => option.id === written)) return `보기에 없는 이름이에요: ${written}`;
      if (written === spec.correct) return '정답인 보기에는 오답의 뜻을 달 수 없어요.';
      if (seen.includes(written)) return `한 보기에 뜻이 둘 달렸어요: ${written}`;
      seen.push(written);
      continue;
    }
    const parsed = parseAnswer(written);
    if (!parsed) return `답으로 읽을 수 없는 예상 오답이에요: ${written}`;
    if (spec.kind === 'integer' && !writtenAsInteger(written)) return `이 문항은 정수로 답하므로 예상 오답도 정수여야 해요: ${written}`;
    // What may not be named is an answer that would be **marked right**, not one that merely has
    // the right value: a question that wants a reduced fraction marks `6/9` wrong, and 「약분을
    // 도중에 멈추기」 is exactly what that answer means.
    const form = 'requiredForm' in spec ? spec.requiredForm : undefined;
    const wouldPass = sameNumber(written, expectedText(spec)!) && (form !== 'reduced_fraction' || (parsed.fraction && parsed.reduced));
    if (wouldPass) return `맞는 답으로 채점될 값에는 오답의 뜻을 달 수 없어요: ${written}`;
    if (seen.some((other) => sameNumber(other, written))) return `같은 값에 뜻이 둘 달렸어요: ${written}`;
    seen.push(written);
  }
  return null;
}

/**
 * Which expected mistake a written or picked answer is, or null when it is none of them. The author
 * decides before any general rule does: a name they wrote is what the question was built to catch,
 * while a shape read off the number is a guess that happens to be usually right.
 */
export function matchMisreading(answer: string, spec: AnswerSpec, entries: ExpectedMisreading[]): string | null {
  const written = answer.trim();
  for (const entry of entries) {
    const expected = entry.answer.trim();
    if (spec.kind === 'choice' ? expected === written : sameNumber(expected, written)) return entry.misconception;
  }
  return null;
}

/**
 * A written answer as TeX, or null when it is not a number yet.
 *
 * Only for showing back what somebody typed — `3/4` printed the way a book prints it, so they can
 * see whether the box holds what they meant before they save it. Nothing is graded from this, and
 * a half-typed answer simply has no picture.
 */
export function answerLatex(written: string): string | null {
  // Only what the marker can read gets a picture: `3/0` drawn as a fraction would promise a reading
  // that is refused a moment later.
  if (!parseAnswer(written)) return null;
  const input = normalizeAnswer(written);
  if (!input) return null;
  const fraction = /^([+-]?)(\d+)\s*\/\s*([+-]?\d+)$/.exec(input);
  // The sign goes in front of the fraction, where it is read, rather than inside the numerator.
  if (fraction) return `${fraction[1] === '-' ? '-' : ''}\\frac{${fraction[2]}}{${fraction[3]}}`;
  return /^[+-]?(?:\d+(?:\.\d+)?|\.\d+)$/.test(input) ? input : null;
}
