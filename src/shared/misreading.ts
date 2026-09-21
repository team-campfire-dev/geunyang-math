/**
 * The kinds of going-wrong the system can name without anybody having written them down.
 *
 * A wrong answer used to be one fact — wrong. That is enough to say a learner is not ready for a
 * concept and nothing at all about *what they did*, so every report built on it could only ever
 * count. These names are the first structured thing a wrong answer carries: they are read off the
 * number itself (see `misreadingOf` in core/grading), they are the same names in every course, and
 * they are written onto the attempt, so what a learner keeps doing accumulates on its own.
 *
 * What they are not: they are not what the learner was thinking. `tenfold` says the digits were
 * right and the place was not; it does not say whether that was a misplaced decimal point or a unit
 * left unconverted. Telling those apart needs the question to say what its wrong answers mean,
 * which is a thing an author writes and this is not.
 */
export type Misreading = 'sign' | 'reciprocal' | 'hundredfold' | 'tenfold' | 'off-by-one' | 'unreduced';

/** What each looks like to a learner reading a report about themselves. */
export const misreadingLabels: Record<Misreading, string> = {
  sign: '부호를 놓친 답',
  reciprocal: '분자와 분모를 바꿔 쓴 답',
  hundredfold: '비율과 백분율을 헷갈린 답',
  tenfold: '자릿값이 한 자리 어긋난 답',
  'off-by-one': '하나를 더 세거나 덜 센 답',
  unreduced: '약분을 끝까지 하지 않은 답',
};

/** One line of advice per kind, for a report that would otherwise only name the mistake. */
export const misreadingAdvice: Record<Misreading, string> = {
  sign: '답을 쓰기 전에 부호를 한 번 더 읽어 보세요.',
  reciprocal: '분모는 전체를 몇으로 나누었는지, 분자는 그중 몇인지를 먼저 정하고 쓰세요.',
  hundredfold: '문제가 비율을 묻는지 백분율을 묻는지 확인하고 답하세요.',
  tenfold: '자리를 세어 보고 소수점이나 단위를 다시 확인하세요.',
  'off-by-one': '처음과 끝을 세었는지 빠뜨렸는지 확인하며 다시 세어 보세요.',
  unreduced: '값을 구한 뒤 더 나눌 공약수가 남았는지 확인하세요.',
};
