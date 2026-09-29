// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from './render';
import { ProblemCard } from '@/features/learning/problem-card';
import { learningApi } from '@/features/learning/api-client';
import type { AttemptView, ConceptHelp, PublicProblem } from '@/shared/api';

const problem: PublicProblem = { problemVersionId: 'p1', conceptKeys: ['fraction'], responseSpec: { kind: 'rational' },
  promptContent: [{ blockId: 'prompt', kind: 'core.rich_text', typeVersion: 1, required: true, payload: { text: '분수를 써 보세요.' } }], hintAvailable: false, solutionAvailable: false };
const attempt = (status: AttemptView['result']['status'] = 'incorrect'): AttemptView => ({ id: 'a1', problemVersionId: 'p1', answer: '2/3', hintUsed: false, result: { status, message: '다시 생각해 보세요.', assisted: false } });
const help: ConceptHelp = { concepts: [{ key: 'fraction', label: '분수', definition: { conceptKey: 'fraction', scopeKind: 'global', scopeKey: '', label: '분수', summary: '', lessonKey: 'fractions',
  blocks: [{ blockId: 'def', kind: 'core.rich_text', typeVersion: 1, required: true, payload: { text: '전체를 똑같이 나눈 조각을 세어요.' } }] },
  lesson: { lessonKey: 'fractions', title: '분수 만나기', sections: [{ sectionId: 'intro', title: '개념 만나기', contentBlocks: [{ blockId: 'step', kind: 'core.rich_text', typeVersion: 1, required: true, payload: { text: '분모는 나눈 조각 수예요.' } }] }] } }] };
const actions = { submit: vi.fn().mockResolvedValue(undefined), openHint: vi.fn().mockResolvedValue([]) };
const card = (value: AttemptView | undefined = attempt(), recordsLearning = true) => <ProblemCard problem={problem} attempt={value} actions={actions} busy={false} recordsLearning={recordsLearning} />;

describe('concept help beside an answer', () => {
  it('loads on demand, preserves the draft while reading and closing, and does not open a hint', async () => {
    const load = vi.spyOn(learningApi, 'conceptHelp').mockResolvedValue(help);
    render(card());
    expect(load).not.toHaveBeenCalled();
    fireEvent.change(screen.getByRole('textbox', { name: '나의 답' }), { target: { value: '3/4' } });
    fireEvent.click(screen.getByRole('button', { name: '관련 개념 설명' }));
    expect(await screen.findByText('전체를 똑같이 나눈 조각을 세어요.')).toBeTruthy();
    expect(load).toHaveBeenCalledWith('a1');
    fireEvent.click(screen.getByText('수업 설명 읽기 · 분수 만나기'));
    expect(screen.getByText('분모는 나눈 조각 수예요.')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: '개념 설명 접기' }));
    expect(screen.queryByText('전체를 똑같이 나눈 조각을 세어요.')).toBeNull();
    expect((screen.getByRole('textbox', { name: '나의 답' }) as HTMLInputElement).value).toBe('3/4');
    fireEvent.click(screen.getByRole('button', { name: '관련 개념 설명' }));
    expect(load).toHaveBeenCalledTimes(1);
    expect(actions.openHint).not.toHaveBeenCalled();
    load.mockRestore();
  });
  it.each(['correct', 'invalid', 'withheld'] as const)('does not offer explanations for %s answers', status => {
    render(card(attempt(status)));
    expect(screen.queryByRole('button', { name: '관련 개념 설명' })).toBeNull();
  });
  it('does not expose the learner endpoint in author previews or before an answer', () => {
    const view = render(card(attempt(), false));
    expect(screen.queryByRole('button', { name: '관련 개념 설명' })).toBeNull();
    view.rerender(<ProblemCard problem={problem} actions={actions} busy={false} />);
    expect(screen.queryByRole('button', { name: '관련 개념 설명' })).toBeNull();
  });
  it('retries failed reads and explicitly handles missing explanations', async () => {
    const load = vi.spyOn(learningApi, 'conceptHelp').mockRejectedValueOnce(new Error('연결이 끊겼어요.'))
      .mockResolvedValueOnce({ concepts: [{ key: 'fraction', label: '분수', definition: null, lesson: null }] });
    render(card());
    fireEvent.click(screen.getByRole('button', { name: '관련 개념 설명' }));
    expect(await screen.findByRole('alert')).toHaveProperty('textContent', '연결이 끊겼어요.다시 시도');
    fireEvent.click(screen.getByRole('button', { name: '다시 시도' }));
    expect(await screen.findByText('아직 이 개념에 연결된 설명이 없어요.')).toBeTruthy();
    load.mockRestore();
  });
  it('discards a pending response after a new attempt and can read the new answer', async () => {
    let resolve!: (value: ConceptHelp) => void;
    const load = vi.spyOn(learningApi, 'conceptHelp').mockImplementationOnce(() => new Promise(done => { resolve = done; })).mockResolvedValue(help);
    const view = render(card());
    fireEvent.click(screen.getByRole('button', { name: '관련 개념 설명' }));
    view.rerender(card({ ...attempt(), id: 'a2' }));
    resolve(help);
    await waitFor(() => expect(screen.queryByText('전체를 똑같이 나눈 조각을 세어요.')).toBeNull());
    fireEvent.click(screen.getByRole('button', { name: '관련 개념 설명' }));
    expect(await screen.findByText('전체를 똑같이 나눈 조각을 세어요.')).toBeTruthy();
    expect(load).toHaveBeenLastCalledWith('a2');
    load.mockRestore();
  });
});
