// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from './render';
import { LessonSettings } from '@/features/authoring/lesson-settings';
import { ExpertMode } from '@/features/authoring/expert-mode';
import type { ConceptChoice, DraftDetail, DraftEdit, DraftProblem } from '@/shared/authoring';

/**
 * Writing the questions a lesson gives back as homework.
 *
 * Every installed lesson keeps a review pool that **no step shows** — two questions a learner only
 * meets the day after. The editor was told the pool existed and could point the review at a step's
 * questions instead, but the pool's own questions could be changed nowhere except the seed file.
 */
const concepts: ConceptChoice[] = [{ key: 'fraction', label: '분수', assessable: true }];
const problem = (problemVersionId: string, text: string): DraftProblem => ({
  problemVersionId, conceptKeys: ['fraction'],
  promptContent: [{ blockId: `${problemVersionId}:p`, kind: 'core.rich_text', typeVersion: 1, required: true, payload: { text } }],
  gradingSpec: { kind: 'integer', value: 3 }, hints: [], solution: [],
});
const edit = (over: Partial<DraftEdit> = {}): DraftEdit => ({
  meta: { versionId: 'lesson-a:v2', title: '수업', summary: '설명', estimatedMinutes: 10, conceptKeys: ['fraction'], prerequisiteConceptKeys: [] },
  sections: [{ sectionId: 's1', role: 'practice', title: '연습', contentBlocks: [
    { blockId: 's1:b1', kind: 'core.problem_set', typeVersion: 2, required: true, payload: { problemSetId: 'lesson-a:practice', problemSetVersionId: 'lesson-a:practice:v1', problemVersionIds: ['shown'] } },
  ] }],
  problems: [problem('shown', '수업에서 보이는 문항'), problem('hw1', '복습 첫 문항'), problem('hw2', '복습 둘째 문항')],
  reviewProblemIds: ['hw1', 'hw2'],
  ...over,
});
const detail = (current: DraftEdit): DraftDetail => ({
  id: 'd1', lessonKey: 'lesson-a', versionId: 'lesson-a:v2', baseVersionId: 'lesson-a:v1', title: '수업',
  status: 'draft', mine: true, authorName: '나', updatedAt: '', edit: current, definitions: [], glossary: [], issues: [],
  review: { problemSetId: 'lesson-a:review', problemSetVersionId: 'lesson-a:review:v1', problemVersionIds: ['hw1', 'hw2'] },
} as unknown as DraftDetail);

function settings(current = edit(), onEdit = vi.fn()) {
  render(<ExpertMode.Provider value={false}><LessonSettings
    edit={current} draft={detail(current)} concepts={concepts} lessons={[]} published={false} issues={[]}
    showDefinitions={false} mayEditDictionary={false} answerInputs={{}} onAnswerInput={() => {}}
    onEdit={onEdit} onShowDefinitions={() => {}} onDefinitionDirty={() => {}}
    onListDefinitions={async () => []} onSaveDefinition={async () => []} onDelete={() => {}} onClose={() => {}} />
  </ExpertMode.Provider>);
  return onEdit;
}

describe('the review pool on the lesson-information page', () => {
  it('lists the questions no step shows, and not the ones a step does', () => {
    settings();
    expect(screen.getByText('복습 첫 문항')).toBeTruthy();
    expect(screen.getByText('복습 둘째 문항')).toBeTruthy();
    expect(screen.queryByText('수업에서 보이는 문항')).toBeNull();
  });

  it('opens one to be written, and writes back to the question the draft holds', () => {
    const onEdit = settings();
    fireEvent.click(screen.getByText('복습 둘째 문항'));
    const answer = screen.getByPlaceholderText('예: -3, 2.5, 1/4') as HTMLInputElement;
    expect(answer.value).toBe('3');
    fireEvent.change(answer, { target: { value: '8' } });
    const next = onEdit.mock.calls.at(-1)![0] as DraftEdit;
    expect(next.problems.find((item) => item.problemVersionId === 'hw2')!.gradingSpec).toEqual({ kind: 'integer', value: 8 });
    // And the one a step shows is untouched, whatever the pool's editor did.
    expect(next.problems.find((item) => item.problemVersionId === 'shown')!.gradingSpec).toEqual({ kind: 'integer', value: 3 });
  });

  it('writes the text of a question no step shows, since there is nowhere else to write it', () => {
    const onEdit = settings();
    fireEvent.click(screen.getByText('복습 첫 문항'));
    expect(screen.getByText('이 문항은 수업 화면에 나오지 않아요. 지문도 여기에서 씁니다.')).toBeTruthy();
    const body = screen.getByDisplayValue('복습 첫 문항');
    fireEvent.change(body, { target: { value: '고쳐 쓴 복습 지문' } });
    const next = onEdit.mock.calls.at(-1)![0] as DraftEdit;
    expect(next.problems.find((item) => item.problemVersionId === 'hw1')!.promptContent[0].payload.text).toBe('고쳐 쓴 복습 지문');
  });

  it('takes a question out of the pool and out of the draft together', () => {
    const onEdit = settings();
    fireEvent.click(screen.getByLabelText('1번 문항 삭제'));
    const next = onEdit.mock.calls.at(-1)![0] as DraftEdit;
    expect(next.reviewProblemIds).toEqual(['hw2']);
    // A question nothing names cannot be published, so removing it from the list removes it outright.
    expect(next.problems.map((item) => item.problemVersionId)).toEqual(['shown', 'hw2']);
  });

  it('adds a question to the pool, and nowhere else', () => {
    const onEdit = settings();
    fireEvent.click(screen.getByText('문항 추가'));
    const next = onEdit.mock.calls.at(-1)![0] as DraftEdit;
    expect(next.reviewProblemIds).toHaveLength(3);
    expect(next.problems).toHaveLength(4);
    const added = next.reviewProblemIds!.at(-1)!;
    expect(next.sections[0].contentBlocks[0].payload.problemVersionIds).toEqual(['shown']);
    expect(next.problems.some((item) => item.problemVersionId === added)).toBe(true);
  });

  it('offers the pool as a choice, beside a step’s questions and none at all', () => {
    settings();
    const choice = screen.getAllByRole('combobox').find((box) =>
      [...(box as HTMLSelectElement).options].some((option) => option.value === 'own')) as HTMLSelectElement;
    expect(choice.value).toBe('own');
    expect([...choice.options].map((option) => option.value)).toEqual(['none', 'own', 's1:b1']);
  });

  it('shows no pool editor when the review points at a step instead', () => {
    settings(edit({ reviewProblemIds: undefined, reviewBlockId: 's1:b1', problems: [problem('shown', '수업에서 보이는 문항')] }));
    expect(screen.queryByText('복습 첫 문항')).toBeNull();
    expect(screen.queryByText('문항 추가')).toBeNull();
  });

  it('warns that the pool’s questions are held by nothing once the review points elsewhere', () => {
    // They were only ever held by the pool, so pointing the review at a step leaves them loose —
    // and publishing refuses a lesson that carries a question nothing names.
    settings(edit({ reviewProblemIds: undefined, reviewBlockId: 's1:b1' }));
    expect(screen.getByText('어디에도 속하지 않은 문항')).toBeTruthy();
    expect(screen.getByText('복습 첫 문항')).toBeTruthy();
  });
});
