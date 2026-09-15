import 'server-only';
import type { GradeResult } from '@/shared/api';
import { parseAnswer, writtenAsInteger } from '@/shared/answer';
import type { StoredProblem } from './content';

function expectedValue(spec: StoredProblem['gradingSpec']): { numerator: bigint; denominator: bigint } {
  if (spec.kind === 'integer') {
    if (!Number.isSafeInteger(spec.value)) throw new Error('Invalid integer grading specification');
    return { numerator: BigInt(spec.value!), denominator: 1n };
  }
  if (!Number.isSafeInteger(spec.numerator) || !Number.isSafeInteger(spec.denominator) || spec.denominator! <= 0) {
    throw new Error('Invalid rational grading specification');
  }
  return { numerator: BigInt(spec.numerator!), denominator: BigInt(spec.denominator!) };
}

/** Exact arithmetic only: no floating point equality, dynamic execution, or expressions. */
export function gradeAnswer(answer: string, spec: StoredProblem['gradingSpec'], assisted = false): GradeResult {
  const expected = expectedValue(spec);
  const parsed = parseAnswer(answer);
  if (!parsed) {
    return { status: 'invalid', message: '숫자 또는 1/2처럼 분수를 입력해 주세요. 분모에는 0을 쓸 수 없어요.', assisted };
  }
  if (spec.kind === 'integer' && !writtenAsInteger(answer)) {
    return { status: 'invalid', message: '이 문제는 정수로 답해 주세요. 예: 3', assisted };
  }
  const equivalent = parsed.numerator * expected.denominator === expected.numerator * parsed.denominator;
  if (!equivalent) return { status: 'incorrect', message: '아직 답이 맞지 않아요. 같은 크기의 조각을 기준으로 다시 생각해 보세요.', assisted };
  if (spec.requiredForm === 'reduced_fraction' && (!parsed.fraction || !parsed.reduced)) {
    return { status: 'incorrect', message: '값은 맞아요. 분모를 양수로 하고 더 이상 약분할 수 없는 분수로 써 주세요. 예: 1/2', assisted };
  }
  return { status: 'correct', message: assisted ? '맞았어요. 다음에는 힌트 없이도 한 번 풀어 봐요.' : '맞았어요. 잘 풀었어요!', assisted };
}
