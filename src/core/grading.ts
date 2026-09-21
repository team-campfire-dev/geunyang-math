import 'server-only';
import type { GradeResult } from '@/shared/api';
import type { Misreading } from '@/shared/misreading';
import { matchMisreading, parseAnswer, writtenAsInteger, type ExpectedMisreading } from '@/shared/answer';
import { misconceptionOf } from '@/shared/misconception';
import type { StoredProblem } from './content';

type NumericSpec = Exclude<StoredProblem['gradingSpec'], { kind: 'choice' }>;
function expectedValue(spec: NumericSpec): { numerator: bigint; denominator: bigint } {
  if (spec.kind === 'integer') {
    if (!Number.isSafeInteger(spec.value)) throw new Error('Invalid integer grading specification');
    return { numerator: BigInt(spec.value!), denominator: 1n };
  }
  if (!Number.isSafeInteger(spec.numerator) || !Number.isSafeInteger(spec.denominator) || spec.denominator! <= 0) {
    throw new Error('Invalid rational grading specification');
  }
  return { numerator: BigInt(spec.numerator!), denominator: BigInt(spec.denominator!) };
}

type Rational = { numerator: bigint; denominator: bigint };
const times = (value: Rational, factor: bigint): Rational => ({ numerator: value.numerator * factor, denominator: value.denominator });
const same = (a: Rational, b: Rational) => a.numerator * b.denominator === b.numerator * a.denominator;

/**
 * Where a wrong answer looks like it went wrong, or null when there is nothing to say.
 *
 * Every wrong answer used to be met with the same sentence, which is the one thing a teacher never
 * says: they look at what you wrote. Most slips in this catalogue leave a signature in the number
 * itself — the size is right and the sign is not, the fraction is upside down, the digits are right
 * and sit one place over, the count is off by one. Reading that costs nothing and needs no author
 * to have written anything.
 *
 * These name where to look, not what to write. They can only be given after an answer has been
 * sent, and the learning record keeps the **first** answer to each question, so a learner who fixes
 * one after being nudged has already been recorded as having missed it. Nothing here is a hint, and
 * nothing here marks the attempt as assisted.
 */
function misreadingOf(written: Rational, expected: Rational): Misreading | null {
  // Sign first: everything below would also match a number that is merely the wrong way round.
  if (same(written, times(expected, -1n))) return 'sign';
  // An upside-down fraction, which is only worth saying when the answer is a fraction to begin with.
  // Zero has no reciprocal, and cross-multiplying against one would match every answer there is.
  if (expected.denominator !== 1n && expected.numerator !== 0n && written.numerator !== 0n
    && same(written, { numerator: expected.denominator, denominator: expected.numerator })) return 'reciprocal';
  if (same(written, times(expected, 100n)) || same(times(written, 100n), expected)) return 'hundredfold';
  if (same(written, times(expected, 10n)) || same(times(written, 10n), expected)) return 'tenfold';
  // One too many or one too few, which is what a miscount looks like and only reads as one when
  // both sides are whole numbers.
  if (written.denominator === 1n && expected.denominator === 1n
    && (written.numerator - expected.numerator === 1n || expected.numerator - written.numerator === 1n)) return 'off-by-one';
  return null;
}

/** What each kind says to the learner who just wrote it: where to look, never what to write. */
const misreadingMessages: Record<Misreading, string> = {
  sign: '값의 크기는 맞아요. 부호를 다시 보세요.',
  reciprocal: '분자와 분모가 서로 바뀐 것 같아요.',
  hundredfold: '수는 맞는데 크기가 백 배 어긋나요. 비율로 답할지 백분율로 답할지 확인해 보세요.',
  tenfold: '수는 맞는데 크기가 열 배 어긋나요. 자릿값을 한 번 더 세어 보세요.',
  'off-by-one': '셈이 아주 조금 어긋났어요. 하나를 더 세었는지, 덜 세었는지 확인해 보세요.',
  unreduced: '값은 맞아요. 분모를 양수로 하고 더 이상 약분할 수 없는 분수로 써 주세요. 예: 1/2',
};

/**
 * The wrong answer the author named, if this is one of them.
 *
 * It is asked before any shape is read off the number, because a name the author wrote is what the
 * question was built to catch while a shape is a guess that happens to be usually right. The note
 * becomes what the learner is told: it says which step went wrong, which is the same standard the
 * general messages hold to — where to look, never what to write.
 */
function named(answer: string, spec: StoredProblem['gradingSpec'], expected: ExpectedMisreading[] | undefined, assisted: boolean): GradeResult | null {
  const key = expected?.length ? matchMisreading(answer, spec, expected) : null;
  const record = key ? misconceptionOf(key) : undefined;
  if (!key || !record) return null;
  return { status: 'incorrect', message: record.note, misconception: key, assisted };
}

/** Exact arithmetic only: no floating point equality, dynamic execution, or expressions. */
export function gradeAnswer(answer: string, spec: StoredProblem['gradingSpec'], assisted = false, expected?: ExpectedMisreading[]): GradeResult {
  // A picked answer is compared by name, never by what the name says: two options may read the same
  // and still be different options, and the text a learner saw is the published question's.
  if (spec.kind === 'choice') {
    const picked = spec.options.find((option) => option.id === answer.trim());
    if (!picked) return { status: 'invalid', message: '보기 중에서 하나를 골라 주세요.', assisted };
    if (picked.id !== spec.correct) return named(answer, spec, expected, assisted)
      ?? { status: 'incorrect', message: '아직 답이 맞지 않아요. 보기를 하나씩 다시 견주어 보세요.', assisted };
    return { status: 'correct', message: assisted ? '맞았어요. 다음에는 힌트 없이도 한 번 골라 봐요.' : '맞았어요. 잘 골랐어요!', assisted };
  }
  const value = expectedValue(spec);
  const parsed = parseAnswer(answer);
  if (!parsed) {
    return { status: 'invalid', message: '숫자 또는 1/2처럼 분수를 입력해 주세요. 분모에는 0을 쓸 수 없어요.', assisted };
  }
  if (spec.kind === 'integer' && !writtenAsInteger(answer)) {
    return { status: 'invalid', message: '이 문제는 정수로 답해 주세요. 예: 3', assisted };
  }
  const equivalent = parsed.numerator * value.denominator === value.numerator * parsed.denominator;
  // The catalogue is no longer only fractions, so what to reconsider is the question's to say.
  if (!equivalent) {
    const read = misreadingOf({ numerator: parsed.numerator, denominator: parsed.denominator }, value);
    return named(answer, spec, expected, assisted)
      ?? { status: 'incorrect', assisted, ...(read ? { misreading: read, message: misreadingMessages[read] } : { message: '아직 답이 맞지 않아요. 풀이를 한 번 더 확인해 보세요.' }) };
  }
  if (spec.kind === 'rational' && spec.requiredForm === 'reduced_fraction' && (!parsed.fraction || !parsed.reduced)) {
    // The right value in a form this question refuses is still a wrong answer, and often a named
    // one: `6/9` against `2/3` is 「약분을 도중에 멈추기」, not a general remark about reducing.
    return named(answer, spec, expected, assisted)
      ?? { status: 'incorrect', message: misreadingMessages.unreduced, misreading: 'unreduced', assisted };
  }
  return { status: 'correct', message: assisted ? '맞았어요. 다음에는 힌트 없이도 한 번 풀어 봐요.' : '맞았어요. 잘 풀었어요!', assisted };
}
