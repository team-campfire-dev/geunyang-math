import { describe, expect, it } from 'vitest';
import { coalesceMs, emptyHistory, historyLimit, historyReducer, type HistoryState } from '@/features/authoring/edit-history';
import { editShape, type DraftEdit } from '@/shared/authoring';
import type { ClassSection, ContentBlock } from '@/shared/api';

type Doc = { shape: string; text: string };
const signature = (value: Doc) => value.shape;
const write = (state: HistoryState<Doc>, value: Doc, at: number) =>
  historyReducer(state, { kind: 'write', value, signature: signature(value), at });
const opened = (value: Doc) => historyReducer(emptyHistory<Doc>(), { kind: 'open', value, signature: signature(value) });
const present = (state: HistoryState<Doc>) => state.present?.value;

describe('taking back what the editor did', () => {
  it('starts a document with nothing to take back', () => {
    const state = opened({ shape: 'a', text: '' });
    expect(present(state)).toEqual({ shape: 'a', text: '' });
    expect(state.past).toHaveLength(0);
    expect(state.future).toHaveLength(0);
  });

  it('folds a run of typing into one step rather than one step per letter', () => {
    let state = opened({ shape: 'a', text: '' });
    state = write(state, { shape: 'a', text: '분' }, 1000);
    state = write(state, { shape: 'a', text: '분수' }, 1100);
    state = write(state, { shape: 'a', text: '분수는' }, 1200);
    expect(state.past).toHaveLength(1);
    state = historyReducer(state, { kind: 'undo' });
    expect(present(state)).toEqual({ shape: 'a', text: '' });
  });

  it('breaks the run once the writing pauses, so a long paragraph is more than one step', () => {
    let state = opened({ shape: 'a', text: '' });
    state = write(state, { shape: 'a', text: '하나' }, 1000);
    state = write(state, { shape: 'a', text: '하나둘' }, 1000 + coalesceMs + 1);
    expect(state.past).toHaveLength(2);
  });

  it('never folds a change of shape into the typing beside it', () => {
    let state = opened({ shape: 'a', text: '글' });
    state = write(state, { shape: 'a', text: '글자' }, 1000);
    // A block removed a moment later is its own step, however fast it followed the last letter.
    state = write(state, { shape: 'b', text: '글자' }, 1050);
    expect(state.past).toHaveLength(2);
    state = historyReducer(state, { kind: 'undo' });
    expect(present(state)).toEqual({ shape: 'a', text: '글자' });
  });

  it('redoes what it took back, and drops the redo once something else is written', () => {
    let state = opened({ shape: 'a', text: '' });
    state = write(state, { shape: 'b', text: '하나' }, 1000);
    state = historyReducer(state, { kind: 'undo' });
    expect(present(state)).toEqual({ shape: 'a', text: '' });
    state = historyReducer(state, { kind: 'redo' });
    expect(present(state)).toEqual({ shape: 'b', text: '하나' });
    state = historyReducer(state, { kind: 'undo' });
    state = write(state, { shape: 'c', text: '다른 길' }, 5000);
    expect(state.future).toHaveLength(0);
    expect(historyReducer(state, { kind: 'redo' })).toEqual(state);
  });

  it('keeps a restored step from swallowing the next thing written', () => {
    let state = opened({ shape: 'a', text: '' });
    state = write(state, { shape: 'a', text: '처음' }, 1000);
    state = historyReducer(state, { kind: 'undo' });
    // The restored step carries no moment, so writing straight after it is a step of its own.
    state = write(state, { shape: 'a', text: '다시' }, 1010);
    expect(state.past).toHaveLength(1);
    state = historyReducer(state, { kind: 'undo' });
    expect(present(state)).toEqual({ shape: 'a', text: '' });
  });

  it('takes the server restatement of the same document without making it a step', () => {
    let state = opened({ shape: 'a', text: '쓴 것' });
    state = write(state, { shape: 'a', text: '쓴 것들' }, 1000);
    const past = state.past.length;
    state = historyReducer(state, { kind: 'replace', value: { shape: 'a', text: '쓴 것들' }, signature: 'a' });
    expect(state.past).toHaveLength(past);
    expect(state.future).toHaveLength(0);
  });

  it('opens a different document carrying no history from the last one', () => {
    let state = opened({ shape: 'a', text: '' });
    state = write(state, { shape: 'b', text: '한참 쓴 것' }, 1000);
    state = historyReducer(state, { kind: 'open', value: { shape: 'z', text: '' }, signature: 'z' });
    expect(state.past).toHaveLength(0);
    expect(state.future).toHaveLength(0);
    expect(historyReducer(state, { kind: 'undo' })).toEqual(state);
  });

  it('forgets the oldest steps rather than growing without a limit', () => {
    let state = opened({ shape: 's0', text: '' });
    for (let index = 1; index <= historyLimit + 20; index++) state = write(state, { shape: `s${index}`, text: '' }, index * 10_000);
    expect(state.past).toHaveLength(historyLimit);
  });
});

const block = (blockId: string, kind = 'core.rich_text', payload: Record<string, unknown> = { text: '글' }): ContentBlock =>
  ({ blockId, kind, typeVersion: 1, required: true, payload });
const section = (sectionId: string, contentBlocks: ContentBlock[]): ClassSection =>
  ({ sectionId, role: 'explanation', title: '단계', contentBlocks });
const draft = (sections: ClassSection[], problems: DraftEdit['problems'] = []): DraftEdit =>
  ({ meta: { versionId: 'fractions:v2', title: '수업', summary: '한 줄', estimatedMinutes: 12, skillKeys: ['fraction.meaning'] }, sections, problems });

describe('what counts as the same shape while writing', () => {
  const base = draft([section('s1', [block('b1'), block('b2')])]);

  it('reads a rewritten paragraph as the same shape, and the version name too', () => {
    const typed = draft([section('s1', [block('b1', 'core.rich_text', { text: '고쳐 쓴 글' }), block('b2')])]);
    expect(editShape(typed)).toBe(editShape(base));
    // The version name is typed a letter at a time like anything else, so it is not part of the shape.
    expect(editShape({ ...base, meta: { ...base.meta, versionId: 'fractions:v3' } })).toBe(editShape(base));
  });

  it('reads adding, removing, moving or renaming as a different shape', () => {
    expect(editShape(draft([section('s1', [block('b1')])]))).not.toBe(editShape(base));
    expect(editShape(draft([section('s1', [block('b2'), block('b1')])]))).not.toBe(editShape(base));
    expect(editShape(draft([section('s1', [block('b1'), block('b2'), block('b3')])]))).not.toBe(editShape(base));
    expect(editShape(draft([{ ...section('s1', [block('b1'), block('b2')]), role: 'practice' }]))).not.toBe(editShape(base));
  });

  it('reads the order an activity names its questions in', () => {
    const set = (ids: string[]) => draft([section('s1', [block('b1', 'core.problem_set', { problemVersionIds: ids })])]);
    expect(editShape(set(['p1', 'p2']))).not.toBe(editShape(set(['p2', 'p1'])));
    expect(editShape(set(['p1', 'p2']))).toBe(editShape(set(['p1', 'p2'])));
  });
});
