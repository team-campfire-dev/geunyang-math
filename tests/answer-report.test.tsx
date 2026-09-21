// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from './render';
import { AnswerReport, type ReportItem } from '@/features/learning/answer-report';
import type { ConceptState, PublicConcept, PublicLesson } from '@/shared/api';

const concepts: PublicConcept[] = [{ key: 'reduce', label: '약분' }, { key: 'common', label: '통분' }, { key: 'add', label: '덧셈' }];
const lessons: PublicLesson[] = [
  { lessonKey: 'fraction-equivalence', versionId: 'v1', title: '동치분수와 약분', summary: '', estimatedMinutes: 10,
    conceptKeys: ['reduce'], prerequisiteConceptKeys: [], sectionCount: 5, courseKey: 'fractions' },
  { lessonKey: 'fraction-addition', versionId: 'v1', title: '분수의 덧셈', summary: '', estimatedMinutes: 10,
    conceptKeys: ['common', 'add'], prerequisiteConceptKeys: [], sectionCount: 5, courseKey: 'fractions' },
];
const item = (over: Partial<ReportItem>): ReportItem =>
  ({ conceptKeys: ['reduce'], correct: true, firstCorrect: true, assisted: false, ...over });
const missed = (key: string, over: Partial<ReportItem> = {}) =>
  item({ conceptKeys: [key], correct: false, firstCorrect: false, ...over });
const show = (items: ReportItem[], options: { standings?: { key: string; state: ConceptState }[]; onOpenLesson?: (key: string) => void } = {}) =>
  render(<AnswerReport items={items} concepts={concepts} lessons={lessons} standings={options.standings}
    onOpenLesson={options.onOpenLesson ?? (() => {})} />);
const rows = () => [...window.document.querySelectorAll('.report-concept')].map((node) => [
  node.querySelector('.report-concept-name')!.textContent,
  node.querySelector('.report-count')!.textContent,
  node.querySelector('.report-verdict')!.textContent,
  node.querySelector('.report-standing')!.textContent,
]);

describe('what a finished round says back', () => {
  it('counts a concept by what the learner could do unaided, not by where they ended up', () => {
    show([
      item({ conceptKeys: ['reduce'] }),
      item({ conceptKeys: ['reduce'] }),
      // Right in the end, but only after being told it was wrong: the concept is not settled.
      item({ conceptKeys: ['common'], correct: true, firstCorrect: false, misreading: 'tenfold' }),
      // Right first time, but with a hint, which is the other way of not doing it yourself.
      item({ conceptKeys: ['common'], assisted: true }),
    ]);
    expect(rows().map(([label, count]) => [label, count])).toEqual([['통분', '0 / 2'], ['약분', '2 / 2']]);
    // The score is still what they finished with; the concepts are the separate reading.
    expect(window.document.querySelector('.report-score')!.textContent).toBe('4 / 4');
    expect(screen.getByText(/처음에 맞힌 것 2개/)).toBeDefined();
    expect(screen.getByText(/고쳐서 맞힌 것 1개/)).toBeDefined();
    expect(screen.getByText(/힌트와 함께 푼 것 1개/)).toBeDefined();
  });

  it('refuses to turn one answer into a verdict', () => {
    show([missed('reduce'), item({ conceptKeys: ['add'] })]);
    // Asked once and missed once is a wrong answer, not a finding, and it is said that way.
    expect(rows()).toEqual([
      ['약분', '0 / 1', '한 번 틀렸어요', '그동안 아직 확인 전'],
      ['덧셈', '1 / 1', '한 번 맞혔어요', '그동안 아직 확인 전'],
    ]);
    // It is still somewhere to go back to, and the invitation says how thin the evidence is.
    expect(screen.getByText(/단정할 수는 없지만/)).toBeDefined();
    // Two of the same concept missed twice is a different sentence entirely.
    cleanup();
    show([missed('reduce'), missed('reduce')]);
    expect(rows()[0][2]).toBe('여기서 자꾸 막혀요');
  });

  it('keeps a bad round in proportion to what the record already knows', () => {
    const standings = [{ key: 'reduce', state: 'independent' as const }];
    show([missed('reduce'), missed('reduce')], { standings });
    expect(rows()[0]).toEqual(['약분', '0 / 2', '오늘만 삐끗했어요', '그동안 스스로 해결']);
    // Nothing to go back to: two different sittings already said this learner can do it.
    expect(window.document.querySelector('.report-next')).toBeNull();
    expect(screen.getByText('그동안 풀던 곳에서 오늘만 삐끗했어요.')).toBeDefined();
    expect(window.document.querySelector('.report-concept .text-button')).toBeNull();
    // And one right answer on a concept the record already trusts is allowed to read as settled.
    cleanup();
    show([item({ conceptKeys: ['reduce'] })], { standings });
    expect(rows()[0][2]).toBe('든든해요');
  });

  it('puts the real gaps first and sends the learner to the lesson that teaches one', () => {
    const onOpenLesson = vi.fn();
    show([
      item({ conceptKeys: ['reduce'] }),
      missed('add'), missed('add'),
      missed('common'), item({ conceptKeys: ['common'] }),
    ], { standings: [{ key: 'common', state: 'retained' }], onOpenLesson });
    // 통분 went 1/2 today but the record has it retained, so it is not a gap and sorts after one.
    expect(rows().map(([label]) => label)).toEqual(['덧셈', '통분', '약분']);
    expect(rows()[1][2]).toBe('오늘만 삐끗했어요');
    fireEvent.click(screen.getByRole('button', { name: /그 수업 열기/ }));
    expect(onOpenLesson).toHaveBeenCalledWith('fraction-addition');
    expect(screen.getByText(/「덧셈」부터 다시 볼까요/)).toBeDefined();
    expect(screen.getByText(/가장 많이 걸린 곳/)).toBeDefined();
  });

  it('adds up the kinds of slip the marker could read, and says what to do about each', () => {
    show([
      missed('reduce', { misreading: 'sign' }),
      missed('common', { misreading: 'sign' }),
      missed('add', { misreading: 'reciprocal' }),
    ]);
    const slips = [...window.document.querySelectorAll('.report-slips > div strong')].map((node) => node.textContent);
    // Most frequent first, since that is the one worth changing a habit over.
    expect(slips).toEqual(['부호를 놓친 답2번', '분자와 분모를 바꿔 쓴 답1번']);
    expect(screen.getByText('답을 쓰기 전에 부호를 한 번 더 읽어 보세요.')).toBeDefined();
  });

  it('counts a named mistake in the same list, and never beside the guess it replaced', () => {
    show([
      missed('reduce', { misconception: 'add-denominators' }),
      missed('common', { misconception: 'add-denominators' }),
      missed('add', { misreading: 'sign' }),
    ]);
    const slips = [...window.document.querySelectorAll('.report-slips > div strong')].map((node) => node.textContent);
    expect(slips).toEqual(['분모끼리 더하기2번', '부호를 놓친 답1번']);
    // The advice is the vocabulary's own note, which says what the learner did rather than what
    // they lack — the same standard the read-off kinds hold to.
    expect(screen.getByText('분모가 조각의 크기라는 것을 지나치고 위아래를 따로 더해요.')).toBeDefined();
  });

  it('says so plainly when nothing was shaky, and says nothing at all with nothing to report', () => {
    show([item({}), item({ conceptKeys: ['add'] })]);
    expect(screen.getByText('오늘은 막히는 데가 없었어요.')).toBeDefined();
    expect(window.document.querySelector('.report-slips')).toBeNull();
    expect(window.document.querySelector('.report-next')).toBeNull();
    const empty = render(<AnswerReport items={[]} concepts={concepts} lessons={lessons} onOpenLesson={() => {}} />);
    expect(empty.container.querySelector('.answer-report')).toBeNull();
  });
});
