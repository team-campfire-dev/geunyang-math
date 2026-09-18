// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from './render';
import { ProblemSetPanel } from '@/features/authoring/problem-editor';
import { ExpertMode } from '@/features/authoring/expert-mode';
import { splitProblemSet } from '@/shared/authoring';
import type { ContentBlock } from '@/shared/api';
import type { DraftProblem, ProblemSetChoice } from '@/shared/authoring';

/**
 * What a problem set is, above the questions it holds.
 *
 * A set several lessons hold is a shared thing: editing its questions here changes them for all of
 * those lessons, and the way out has to be on the screen rather than something an author finds out
 * afterwards. A set one lesson holds says nothing, because there is nothing to say.
 */
const block = (problemSetId: string, ids: string[]): ContentBlock => ({
  blockId: 'b1', kind: 'core.problem_set', typeVersion: 2, required: true,
  payload: { problemSetId, problemSetVersionId: `${problemSetId}:v1`, problemVersionIds: ids },
});
const set = (over: Partial<ProblemSetChoice> = {}): ProblemSetChoice =>
  ({ problemSetId: 'shared', name: '함께 쓰는 묶음', courseKey: 'fractions', latestVersionId: 'shared:v1', lessonKeys: ['a', 'b'], ...over });
const titles: Record<string, string> = { a: '첫 수업', b: '둘째 수업' };
const panel = (props: Partial<Parameters<typeof ProblemSetPanel>[0]> = {}) => {
  const onSplit = vi.fn(); const onName = vi.fn(); const onTakeUp = vi.fn();
  render(<ExpertMode.Provider value={false}><ProblemSetPanel
    block={block('shared', ['p1'])} sets={[set()]} mayName courseKey="fractions" lessonTitle={(key) => titles[key] ?? key}
    onName={onName} onTakeUp={onTakeUp} onSplit={onSplit} {...props} /></ExpertMode.Provider>);
  return { onSplit, onName, onTakeUp };
};

describe('a problem set above its questions', () => {
  it('says who else is holding it, and what editing it here would mean', () => {
    panel();
    expect(screen.getByText('이 문제집은 수업 2개가 함께 써요.')).toBeTruthy();
    expect(screen.getByText('첫 수업 · 둘째 수업')).toBeTruthy();
    expect(screen.getByRole('button', { name: '이 수업만 따로 두기' })).toBeTruthy();
  });

  it('says nothing when one lesson holds it, which is almost every set', () => {
    panel({ sets: [set({ lessonKeys: ['a'] })] });
    expect(screen.queryByText(/함께 써요/)).toBeNull();
    expect(screen.queryByRole('button', { name: '이 수업만 따로 두기' })).toBeNull();
  });

  it('takes sharing from the lessons that hold it, not from whether it has a name', () => {
    panel({ sets: [set({ name: null })] });
    expect(screen.getByText('이 문제집은 수업 2개가 함께 써요.')).toBeTruthy();
  });

  it('saves a name only when it changed, and leaves what is published alone', () => {
    const { onName } = panel();
    const field = screen.getByDisplayValue('함께 쓰는 묶음');
    fireEvent.blur(field);
    expect(onName).not.toHaveBeenCalled();
    fireEvent.change(field, { target: { value: '새 이름' } });
    fireEvent.blur(field);
    expect(onName).toHaveBeenCalledWith('새 이름');
  });

  it('offers the sets an author could take up, and never the one already here', () => {
    panel({ sets: [set(), set({ problemSetId: 'other', name: '다른 묶음', lessonKeys: ['c'] }),
      set({ problemSetId: 'nameless', name: null, lessonKeys: ['d'] }),
      // A set belongs to one course, and the server refuses one from another; so does this list.
      set({ problemSetId: 'elsewhere', name: '다른 코스 묶음', courseKey: 'decimals', lessonKeys: ['e'] })] });
    fireEvent.click(screen.getByText('다른 문제집 가져다 쓰기'));
    const options = [...(screen.getByRole('combobox') as HTMLSelectElement).options].map((option) => option.value);
    // A set without a name was made in place for one activity and is nobody else's to take up.
    expect(options).toEqual(['', 'other']);
  });
});

describe('taking a set apart', () => {
  const problems: DraftProblem[] = ['p1', 'p2'].map((problemVersionId) => ({
    problemVersionId, conceptKeys: ['fraction'], promptContent: [], gradingSpec: { kind: 'integer', value: 1 }, hints: [], solution: [],
  }));

  it('gives the activity a set of its own, with copies, since a question belongs to one set', () => {
    const apart = splitProblemSet(block('shared', ['p1', 'p2']), problems, 'lesson-a', 'practice', 'lesson-a:v2');
    expect(apart.block.payload.problemSetId).not.toBe('shared');
    const ids = apart.block.payload.problemVersionIds as string[];
    expect(ids).toHaveLength(2);
    for (const id of ids) expect(id).not.toBe('p1');
    // The shared set's questions are not carried into the document; the copies are.
    expect(apart.problems.map((problem) => problem.problemVersionId).sort()).toEqual([...ids].sort());
  });

  it('keeps the order the activity asked them in', () => {
    const apart = splitProblemSet(block('shared', ['p2', 'p1']), problems, 'lesson-a', 'practice', 'lesson-a:v2');
    const ids = apart.block.payload.problemVersionIds as string[];
    const held = new Map(apart.problems.map((problem) => [problem.problemVersionId, problem]));
    expect(ids.every((id) => held.has(id))).toBe(true);
    expect(new Set(ids).size).toBe(2);
  });
});
