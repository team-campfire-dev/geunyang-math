import { answerSpec, answerText, choiceIssue, type AnswerSpec } from './answer';
import type { ContentBlock } from './api';
import type { DraftEdit, DraftIssue, LessonChoice, DraftSummary } from './authoring';

export type AnswerInput = { text: string; spec: string };
export function displayedAnswer(spec: AnswerSpec, input?: AnswerInput) {
  return input?.spec === JSON.stringify(spec) ? input.text : answerText(spec);
}
export function invalidAnswers(edit: DraftEdit, inputs: Record<string, AnswerInput>) {
  // A picked answer is not written, so what makes it wrong is its options, not a box of text.
  return edit.problems.filter(problem => problem.gradingSpec.kind === 'choice'
    ? choiceIssue(problem.gradingSpec) !== null
    : !answerSpec(displayedAnswer(problem.gradingSpec, inputs[problem.problemVersionId])));
}

/** Old starter copy must not accidentally become a published lesson. Exact matches only. */
const starterText = new Set(['여기에 설명을 씁니다.', '여기에 문제를 씁니다.', '여기에 풀이를 씁니다.', '여기에 뜻을 풀어 씁니다.']);
export function unfinishedIssues(edit: DraftEdit): DraftIssue[] {
  const issues: DraftIssue[] = [];
  if (!edit.meta.title.trim()) issues.push({ message: '수업 제목을 적어 주세요.', field: 'title' });
  if (!edit.meta.summary.trim() || edit.meta.summary === '한 줄 소개를 적어 주세요.') issues.push({ message: '수업 소개를 작성해 주세요.', field: 'summary' });
  if (!edit.meta.conceptKeys.length) issues.push({ message: '수업에서 다루는 개념을 하나 이상 골라 주세요.', field: 'conceptKeys' });
  if (!Number.isInteger(edit.meta.estimatedMinutes) || edit.meta.estimatedMinutes < 1 || edit.meta.estimatedMinutes > 240) issues.push({ message: '예상 시간은 1~240분으로 적어 주세요.', field: 'estimatedMinutes' });
  const check = (blocks: ContentBlock[], anchor: Partial<DraftIssue>) => {
    for (const block of blocks) {
      if (block.kind === 'core.rich_text' && typeof block.payload.text === 'string' && starterText.has(block.payload.text.trim())) {
        issues.push({ message: '안내용 기본 문구 대신 수업 내용을 작성해 주세요.', ...anchor, blockId: block.blockId, field: 'text' });
      }
    }
  };
  for (const section of edit.sections) {
    if (!section.title.trim() || section.title === '새 단계') issues.push({ message: '단계 제목을 작성해 주세요.', sectionId: section.sectionId, field: 'title' });
    check(section.contentBlocks, { sectionId: section.sectionId });
  }
  for (const problem of edit.problems) check([...problem.promptContent, ...problem.hints, ...problem.solution], { problemVersionId: problem.problemVersionId });
  return issues;
}
export function lessonMatches(lesson: LessonChoice, drafts: DraftSummary[], query: string) {
  const needle = query.trim().toLocaleLowerCase();
  return [lesson.title, ...drafts.filter(d => d.lessonKey === lesson.lessonKey && d.status !== 'published').map(d => d.title)]
    .some(title => title.toLocaleLowerCase().includes(needle));
}
