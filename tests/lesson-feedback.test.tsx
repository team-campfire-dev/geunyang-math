// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import katex from 'katex';
import { fireEvent, render, screen, waitFor } from './render';
import { FeedbackLayer, FeedbackSpot } from '@/features/learning/lesson-feedback';
import { quoteOf, rangeOf } from '@/features/learning/feedback-quote';
import type { FeedbackItem, LessonFeedbackView } from '@/shared/feedback';

const place = { lessonKey: 'fractions', lessonVersionId: 'fractions-v2', sectionId: 'explain' };
const note = (extra: Partial<FeedbackItem>): FeedbackItem => ({ id: 'f1', ...place, blockId: 'figure', problemVersionId: null, quote: null, reason: null,
  body: '칸이 잘 안 보여요', status: 'open', createdAt: '2026-10-22T03:00:00.000Z', resolvedAt: null,
  author: { name: '민지', mine: true }, ...extra });
const view = (extra: Partial<LessonFeedbackView> = {}): LessonFeedbackView => ({ accepting: true, reviewer: false, items: [], ...extra });

function Step({ feedback, act = vi.fn() }: { feedback: LessonFeedbackView; act?: (action: unknown) => Promise<void> }) {
  return <FeedbackLayer view={feedback} place={place} act={act}>
    <FeedbackSpot blockId="prose" mark="when-noted"><p>분모는 나눈 칸의 수예요.</p></FeedbackSpot>
    <FeedbackSpot blockId="figure" mark="always"><div role="img" aria-label="띠 그림" /></FeedbackSpot>
    <FeedbackSpot blockId="set" mark="never">
      <FeedbackSpot blockId="set" problemVersionId="q1" mark="always"><p>문제 1</p></FeedbackSpot>
    </FeedbackSpot>
  </FeedbackLayer>;
}

describe('feedback on a lesson step', () => {
  it('puts a mark on a drawing and on each question, and none on prose nobody spoke about', () => {
    render(<Step feedback={view()} />);
    expect(screen.getAllByRole('button', { name: '여기에 의견 남기기' })).toHaveLength(2);
  });

  it('sends a quick answer in one press, with no field to type in until one is asked for', async () => {
    const act = vi.fn(async () => {});
    render(<Step feedback={view()} act={act} />);
    fireEvent.click(screen.getAllByRole('button', { name: '여기에 의견 남기기' })[0]);
    expect(screen.queryByLabelText('의견')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: '헷갈려요' }));
    await waitFor(() => expect(act).toHaveBeenCalledWith({ action: 'feedback.add', ...place, blockId: 'figure', problemVersionId: null, quote: null, reason: 'confusing', body: '' }));
    expect(await screen.findByText('의견을 남겼어요. 고마워요!')).toBeTruthy();
  });

  it('opens the field on asking and sends what was written there', async () => {
    const act = vi.fn(async () => {});
    render(<Step feedback={view()} act={act} />);
    fireEvent.click(screen.getAllByRole('button', { name: '여기에 의견 남기기' })[1]);
    fireEvent.click(screen.getByRole('button', { name: '직접 쓰기' }));
    const field = screen.getByLabelText('의견');
    fireEvent.change(field, { target: { value: '  보기 두 개가 같아요 ' } });
    fireEvent.click(screen.getByRole('button', { name: '보내기' }));
    await waitFor(() => expect(act).toHaveBeenCalledWith({ action: 'feedback.add', ...place, blockId: 'set', problemVersionId: 'q1', quote: null, reason: null, body: '보기 두 개가 같아요' }));
    // A quick answer pressed after writing takes the words along.
    fireEvent.click(screen.getAllByRole('button', { name: '여기에 의견 남기기' })[0]);
    fireEvent.click(screen.getByRole('button', { name: '직접 쓰기' }));
    fireEvent.change(screen.getByLabelText('의견'), { target: { value: '눈금이 없어요' } });
    fireEvent.click(screen.getByRole('button', { name: '화면이 이상해요' }));
    await waitFor(() => expect(act).toHaveBeenLastCalledWith(expect.objectContaining({ blockId: 'figure', reason: 'broken', body: '눈금이 없어요' })));
  });

  it('shows prose its mark once something was said about it, with the words that were dragged over', () => {
    render(<Step feedback={view({ items: [note({ id: 'f2', blockId: 'prose', quote: '나눈 칸의 수', body: '나눈다는 게 뭔가요' }), note({ id: 'f3', blockId: 'prose', reason: 'hard', body: '' })] })} />);
    fireEvent.click(screen.getByRole('button', { name: '남긴 의견 2개 보기' }));
    expect(screen.getAllByText('어려워요')).toHaveLength(2);
    expect(screen.getByText('나눈 칸의 수')).toBeTruthy();
    expect(screen.getByText('나눈다는 게 뭔가요')).toBeTruthy();
    expect(screen.getAllByText(/내 의견/)).toHaveLength(2);
  });

  it('lets a reviewer settle a note, and tells a lesson that takes none apart', async () => {
    const act = vi.fn(async () => {});
    const { unmount } = render(<Step act={act} feedback={view({ reviewer: true, items: [note({ author: { name: '민지', mine: false } })] })} />);
    fireEvent.click(screen.getByRole('button', { name: '남긴 의견 1개 보기' }));
    expect(screen.getByText(/민지/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: '처리함으로' }));
    await waitFor(() => expect(act).toHaveBeenCalledWith({ action: 'feedback.resolve', feedbackId: 'f1' }));
    unmount();
    render(<Step feedback={view({ accepting: false, items: [note({})] })} />);
    fireEvent.click(screen.getByRole('button', { name: '남긴 의견 1개 보기' }));
    expect(screen.getByText('이 수업은 지금 의견을 받지 않아요.')).toBeTruthy();
    expect(screen.queryByRole('button', { name: '헷갈려요' })).toBeNull();
    expect(screen.queryByRole('button', { name: '직접 쓰기' })).toBeNull();
  });

  it('draws nothing of its own for somebody who cannot leave feedback', () => {
    render(<Step feedback={view({ accepting: false })} />);
    expect(screen.queryByRole('button', { name: '여기에 의견 남기기' })).toBeNull();
  });
});

describe('quoting dragged words', () => {
  it('reads a formula as its source and finds the quote again', () => {
    const block = document.createElement('div');
    block.innerHTML = `<p>전체를 ${katex.renderToString('\\frac{1}{2}', { output: 'htmlAndMathml' })}로   나눠요.</p>`;
    document.body.append(block);
    const range = document.createRange();
    range.selectNodeContents(block);
    expect(quoteOf(range, block)).toBe('전체를 $\\frac{1}{2}$로 나눠요.');
    const found = rangeOf('$\\frac{1}{2}$로 나눠요', block)!;
    expect(found).not.toBeNull();
    expect(found.toString()).toContain('로   나눠요');
    expect(rangeOf('없는 말', block)).toBeNull();
    block.remove();
  });
});
