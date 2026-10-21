import 'server-only';
import type { CourseStage } from '@/shared/api';

/**
 * What a stage has not learned yet. Every writer that writes for a learner is told it — a lesson, an
 * explanation, a question — and what it writes is checked against it, because a model that knows the
 * mathematics reaches for the tidiest tool whether or not the learner has met it.
 */
export const notYet: Partial<Record<CourseStage, string>> = {
  'middle-2': '제곱근 기호(√)와 무리수는 중3에서 배운다. 쓰지 않는다. 제곱한 값에서 길이를 구할 때는 「제곱해서 25가 되는 양수는 5」처럼 말한다.',
  'middle-1': '문자를 쓴 방정식의 이항, 제곱근, 피타고라스 정리는 아직 배우지 않았다.',
};

/** What in `text` a learner at `stage` has not learned, or null. Only what can be seen in the text is caught. */
export function beyondStage(stage: CourseStage | null | undefined, text: string): string | null {
  if (stage === 'middle-2' && /\\sqrt|√|무리수|sqrt\(/.test(text)) return '중2가 아직 배우지 않은 제곱근을 썼어요.';
  return null;
}
