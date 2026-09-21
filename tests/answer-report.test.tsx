// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from './render';
import { AnswerReport, type ReportItem } from '@/features/learning/answer-report';
import type { PublicConcept, PublicLesson } from '@/shared/api';

const concepts: PublicConcept[] = [{ key: 'reduce', label: '약분' }, { key: 'common', label: '통분' }, { key: 'add', label: '덧셈' }];
const lessons: PublicLesson[] = [
  { lessonKey: 'fraction-equivalence', versionId: 'v1', title: '동치분수와 약분', summary: '', estimatedMinutes: 10,
    conceptKeys: ['reduce'], prerequisiteConceptKeys: [], sectionCount: 5, courseKey: 'fractions' },
  { lessonKey: 'fraction-addition', versionId: 'v1', title: '분수의 덧셈', summary: '', estimatedMinutes: 10,
    conceptKeys: ['common', 'add'], prerequisiteConceptKeys: [], sectionCount: 5, courseKey: 'fractions' },
];
const item = (over: Partial<ReportItem>): ReportItem =>
  ({ conceptKeys: ['reduce'], correct: true, firstCorrect: true, assisted: false, ...over });
const show = (items: ReportItem[], onOpenLesson = () => {}) =>
  render(<AnswerReport items={items} concepts={concepts} lessons={lessons} onOpenLesson={onOpenLesson} />);
const rows = () => [...window.document.querySelectorAll('.report-concept')]
  .map((node) => [node.querySelector('.report-concept-name')!.textContent, node.querySelector('.report-count')!.textContent]);

describe('what a finished round says back', () => {
  it('counts a concept by what the learner could do unaided, not by where they ended up', () => {
    show([
      item({ conceptKeys: ['reduce'] }),
      // Right in the end, but only after being told it was wrong: the concept is not settled.
      item({ conceptKeys: ['common'], correct: true, firstCorrect: false, misreading: 'tenfold' }),
      // Right first time, but with a hint, which is the other way of not doing it yourself.
      item({ conceptKeys: ['common'], assisted: true }),
    ]);
    expect(rows()).toEqual([['통분', '0 / 2'], ['약분', '1 / 1']]);
    expect(screen.getByText('여기가 걸려요')).toBeDefined();
    // The score is still what they finished with; the concepts are the separate reading.
    expect(window.document.querySelector('.report-score')!.textContent).toBe('3 / 3');
    expect(screen.getByText(/처음에 맞힌 것 1개/)).toBeDefined();
    expect(screen.getByText(/고쳐서 맞힌 것 1개/)).toBeDefined();
    expect(screen.getByText(/힌트와 함께 푼 것 1개/)).toBeDefined();
  });

  it('sorts the weakest concept first and sends the learner to the lesson that teaches it', () => {
    const onOpenLesson = vi.fn();
    show([
      item({ conceptKeys: ['reduce'] }),
      item({ conceptKeys: ['add'], correct: false, firstCorrect: false }),
      item({ conceptKeys: ['common'], correct: false, firstCorrect: false }),
      item({ conceptKeys: ['common'] }),
    ], onOpenLesson);
    // 덧셈 0/1 and 통분 1/2: the one that was never right comes first, and among equals the one
    // asked about more often would, because more questions make the finding firmer.
    expect(rows().map(([label]) => label)).toEqual(['덧셈', '통분', '약분']);
    fireEvent.click(screen.getByRole('button', { name: /그 수업 열기/ }));
    expect(onOpenLesson).toHaveBeenCalledWith('fraction-addition');
    expect(screen.getByText(/다음은 「덧셈」부터 다시/)).toBeDefined();
  });

  it('adds up the kinds of slip the marker could read, and says what to do about each', () => {
    show([
      item({ correct: false, firstCorrect: false, misreading: 'sign' }),
      item({ conceptKeys: ['common'], correct: false, firstCorrect: false, misreading: 'sign' }),
      item({ conceptKeys: ['add'], correct: false, firstCorrect: false, misreading: 'reciprocal' }),
    ]);
    const slips = [...window.document.querySelectorAll('.report-slips > div strong')].map((node) => node.textContent);
    // Most frequent first, since that is the one worth changing a habit over.
    expect(slips).toEqual(['부호를 놓침2번', '분자와 분모를 바꿔 씀1번']);
    expect(screen.getByText('답을 쓰기 전에 부호를 한 번 더 읽어 보세요.')).toBeDefined();
  });

  it('says so plainly when nothing was shaky, and says nothing at all with nothing to report', () => {
    show([item({}), item({ conceptKeys: ['add'] })]);
    expect(screen.getByText('오늘은 걸리는 곳이 없었어요.')).toBeDefined();
    expect(window.document.querySelector('.report-slips')).toBeNull();
    expect(window.document.querySelector('.report-next')).toBeNull();
    const empty = render(<AnswerReport items={[]} concepts={concepts} lessons={lessons} onOpenLesson={() => {}} />);
    expect(empty.container.querySelector('.answer-report')).toBeNull();
  });
});
