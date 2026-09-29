// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from './render';
import { ProblemCard } from '@/features/learning/problem-card';
import type { PublicProblem } from '@/shared/api';

const problem: PublicProblem = { problemVersionId: 'submission:p1', conceptKeys: ['fraction'],
  promptContent: [{ blockId: 'prompt', kind: 'core.rich_text', typeVersion: 1, required: true, payload: { text: '분수를 써 보세요.' } }],
  responseSpec: { kind: 'rational' }, hintAvailable: false, solutionAvailable: false };

beforeEach(() => {
  const original = window.matchMedia;
  vi.spyOn(window, 'matchMedia').mockImplementation(query => ({ ...original(query), matches: query === '(any-pointer: coarse)' }));
});
afterEach(() => vi.restoreAllMocks());

describe('one submission control per problem', () => {
  it.each(['정답 확인', '답안 저장'])('shows one %s button with the keypad open or closed', submitLabel => {
    render(<ProblemCard problem={problem} actions={{ submit: vi.fn().mockResolvedValue(undefined), openHint: vi.fn() }} busy={false} submitLabel={submitLabel} />);
    expect(screen.getAllByRole('button', { name: submitLabel })).toHaveLength(1);
    fireEvent.focus(screen.getByRole('textbox', { name: '나의 답' }));
    fireEvent.click(screen.getByRole('button', { name: '수식 키보드 열기' }));
    expect(screen.getByRole('group', { name: '숫자 키패드' })).toBeTruthy();
    expect(screen.getAllByRole('button', { name: submitLabel })).toHaveLength(1);
    fireEvent.blur(screen.getByRole('textbox', { name: '나의 답' }));
    expect(screen.getAllByRole('button', { name: submitLabel })).toHaveLength(1);
  });
  it('sends once from the pad, closes it, and restores one submission button', async () => {
    const submit = vi.fn().mockResolvedValue(undefined);
    render(<ProblemCard problem={problem} actions={{ submit, openHint: vi.fn() }} busy={false} />);
    const box = screen.getByRole('textbox', { name: '나의 답' });
    fireEvent.focus(box);
    fireEvent.click(screen.getByRole('button', { name: '수식 키보드 열기' }));
    expect((screen.getByRole('button', { name: '정답 확인' }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: '3' }));
    const button = screen.getByRole('button', { name: '정답 확인' });
    expect(fireEvent.pointerDown(button)).toBe(false);
    fireEvent.click(button);
    await waitFor(() => expect(submit).toHaveBeenCalledExactlyOnceWith('3', expect.any(String)));
    expect(screen.queryByRole('group', { name: '숫자 키패드' })).toBeNull();
    expect(screen.getAllByRole('button', { name: '정답 확인' })).toHaveLength(1);
  });
  it('keeps one working button after switching to the keyboard and respects disabled state', async () => {
    const submit = vi.fn().mockResolvedValue(undefined);
    const actions = { submit, openHint: vi.fn() };
    const view = render(<ProblemCard problem={problem} actions={actions} busy={false} />);
    const box = screen.getByRole('textbox', { name: '나의 답' });
    fireEvent.focus(box);
    fireEvent.click(screen.getByRole('button', { name: '수식 키보드 열기' }));
    fireEvent.click(screen.getByRole('button', { name: '기본 키보드' }));
    fireEvent.change(box, { target: { value: '1/2' } });
    expect(screen.getAllByRole('button', { name: '정답 확인' })).toHaveLength(1);
    fireEvent.click(screen.getByRole('button', { name: '정답 확인' }));
    await waitFor(() => expect(submit).toHaveBeenCalledExactlyOnceWith('1/2', expect.any(String)));
    view.rerender(<ProblemCard problem={problem} actions={actions} busy />);
    expect((screen.getByRole('button', { name: '저장 중…' }) as HTMLButtonElement).disabled).toBe(true);
    view.rerender(<ProblemCard problem={problem} actions={actions} busy={false} disabled />);
    expect((screen.getByRole('button', { name: '정답 확인' }) as HTMLButtonElement).disabled).toBe(true);
  });
  it('keeps the normal form submit button for a multiple-choice problem', async () => {
    const submit = vi.fn().mockResolvedValue(undefined);
    const choice: PublicProblem = { ...problem, responseSpec: { kind: 'choice', options: [{ id: 'a', text: '하나' }, { id: 'b', text: '둘' }] } };
    render(<ProblemCard problem={choice} actions={{ submit, openHint: vi.fn() }} busy={false} />);
    fireEvent.click(screen.getByRole('radio', { name: /하나/ }));
    expect(screen.getAllByRole('button', { name: '정답 확인' })).toHaveLength(1);
    fireEvent.click(screen.getByRole('button', { name: '정답 확인' }));
    await waitFor(() => expect(submit).toHaveBeenCalledExactlyOnceWith('a', expect.any(String)));
  });
});
