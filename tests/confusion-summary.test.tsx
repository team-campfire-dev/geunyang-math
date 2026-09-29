// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from './render';
import { ConfusionSummary, reviewAttempt } from '@/features/learning/confusion-summary';
import { learningApi } from '@/features/learning/api-client';
import type { ConfusionSummary as Summary } from '@/shared/confusion';

afterEach(() => { cleanup(); vi.restoreAllMocks(); });
const fixture = (): Summary => ({
  version: 1, latestAt: '2026-09-29T00:00:00.000Z',
  concepts: [{ key: 'fractions', label: '분수', state: 'missed', description: '서로 다른 두 문제에서 첫 답을 놓쳤어요.', lessonKey: 'fractions-lesson', evidenceIds: ['p1'], latestAt: '2026-09-29T00:00:00.000Z' },
    { key: 'integers', label: '정수', state: 'unknown', description: '아직 풀이 기록이 없어요.', lessonKey: null, evidenceIds: [], latestAt: null }],
  repeated: [], evidence: [{ problemVersionId: 'p1', conceptKeys: ['fractions'],
    promptContent: [{ blockId: 'prompt', kind: 'core.rich_text', typeVersion: 1, required: true, payload: { text: '분수의 덧셈을 골라 보세요.' } }],
    responseSpec: { kind: 'choice', options: [{ id: 'a', text: '분모끼리 더하기' }, { id: 'b', text: '통분해서 더하기' }] },
    first: { id: 'first', answer: 'a', status: 'incorrect', hintUsed: false, createdAt: '2026-09-28T00:00:00.000Z', source: { kind: 'lesson', title: '처음 배우는 분수', id: 'lesson', lessonKey: 'fractions-lesson' }, signal: null },
    corrections: [{ id: 'second', answer: 'b', status: 'correct', hintUsed: true, createdAt: '2026-09-29T00:00:00.000Z', source: { kind: 'practice', title: '분수 문제집', id: 'practice', lessonKey: null }, signal: null }],
  }],
});
const props = () => ({ onOpenLesson: vi.fn(), onGather: vi.fn() });

describe('learner confusion summary', () => {
  it('opens the actual question and choice text with first/corrected answers and their context', async () => {
    const actions = props();
    render(<ConfusionSummary summary={fixture()} {...actions} />);
    expect(screen.queryByText('분수의 덧셈을 골라 보세요.')).toBeNull();
    const details = screen.getByText('풀이 근거 보기 · 1문제').closest('details')!;
    details.open = true;
    fireEvent(details, new Event('toggle'));
    expect(await screen.findByText('분수의 덧셈을 골라 보세요.')).toBeDefined();
    expect(screen.getByText('분모끼리 더하기')).toBeDefined();
    expect(screen.getByText('통분해서 더하기')).toBeDefined();
    expect(screen.getByText('첫 답')).toBeDefined();
    expect(screen.getByText('다시 쓴 답')).toBeDefined();
    expect(screen.getByText('놓침 · 힌트 없이')).toBeDefined();
    expect(screen.getByText('맞힘 · 힌트 사용')).toBeDefined();
    expect(screen.getByText(/처음 배우는 분수/)).toBeDefined();
    expect(screen.getByText(/분수 문제집/)).toBeDefined();
    fireEvent.click(screen.getByRole('button', { name: '이 개념의 수업 보기' }));
    expect(actions.onOpenLesson).toHaveBeenCalledWith('fractions-lesson');
  });

  it('keeps unanswered concepts out until requested', () => {
    render(<ConfusionSummary summary={fixture()} {...props()} />);
    expect(screen.queryByText('정수')).toBeNull();
    fireEvent.click(screen.getByRole('checkbox', { name: '아직 풀지 않은 개념도 보기' }));
    expect(screen.getByText('정수')).toBeDefined();
    expect(screen.getByText('확인 전')).toBeDefined();
  });

  it('offers existing gathered practice only for active named patterns', () => {
    const summary = fixture();
    summary.repeated = [
      { kind: 'misconception', key: 'add-denominators', label: '분모끼리 더하기', note: '분모를 확인해요.', status: 'repeated', description: '두 문제에서 나왔어요.', evidenceIds: ['p1'], improvementEvidenceIds: [], lastSeenAt: summary.latestAt! },
      { kind: 'misreading', key: 'sign', label: '부호를 놓친 답', note: '부호를 확인해요.', status: 'repeated', description: '두 문제에서 나왔어요.', evidenceIds: ['p1'], improvementEvidenceIds: [], lastSeenAt: summary.latestAt! },
    ];
    const actions = props();
    const { rerender } = render(<ConfusionSummary summary={summary} {...actions} />);
    expect(screen.getAllByRole('button', { name: '이것만 모아 풀기' })).toHaveLength(1);
    fireEvent.click(screen.getByRole('button', { name: '이것만 모아 풀기' }));
    expect(actions.onGather).toHaveBeenCalledWith('add-denominators');
    summary.repeated[0].status = 'improving';
    rerender(<ConfusionSummary summary={summary} {...actions} />);
    expect(screen.getByText('최근에는 스스로 해결')).toBeDefined();
    expect(screen.queryByRole('button', { name: '이것만 모아 풀기' })).toBeNull();
  });

  it('has a useful empty state without fabricating findings', () => {
    render(<ConfusionSummary summary={{ version: 1, latestAt: null, concepts: [], repeated: [], evidence: [] }} {...props()} />);
    expect(screen.getByText(/아직 살펴볼 풀이가 없어요/)).toBeDefined();
    expect(screen.queryByText('되풀이된 실수와 최근 변화')).toBeNull();
  });
});

describe('from a summary to explanation and practice', () => {
  const pattern = () => {
    const summary = fixture();
    const signal = { kind: 'misconception' as const, key: 'add-denominators', label: '분모끼리 더하기', note: '조각의 크기를 맞춰요.' };
    summary.evidence[0].first.signal = signal;
    summary.repeated = [{ ...signal, status: 'repeated', description: '두 문제에서 반복했어요.', evidenceIds: ['p1'], improvementEvidenceIds: [], lastSeenAt: summary.latestAt! }];
    return summary;
  };
  it('opens an explanation directly, keeps it on gather failure, and allows a retry', async () => {
    const load = vi.spyOn(learningApi, 'conceptHelp').mockResolvedValue({ concepts: [{ key: 'fractions', label: '분수', definition: null, lesson: null }] });
    const gather = vi.fn().mockRejectedValueOnce(new Error('연습 문제를 준비하지 못했어요.')).mockResolvedValue(undefined);
    render(<ConfusionSummary summary={pattern()} onOpenLesson={vi.fn()} onGather={gather} />);
    const card = screen.getByRole('heading', { name: '분모끼리 더하기' }).closest('article')!;
    const ui = within(card);
    expect(load).not.toHaveBeenCalled();
    expect(card.querySelector('details')!.open).toBe(false);
    fireEvent.click(ui.getByRole('button', { name: '관련 개념 설명' }));
    expect(await ui.findByText('아직 이 개념에 연결된 설명이 없어요.')).toBeTruthy();
    expect(load).toHaveBeenCalledWith('first');
    expect(ui.queryByText(/쓰던 답으로 돌아가/)).toBeNull();
    fireEvent.click(ui.getByRole('button', { name: '이것만 모아 풀기' }));
    expect(await ui.findByRole('alert')).toHaveProperty('textContent', '연습 문제를 준비하지 못했어요.');
    expect(ui.getByRole('button', { name: '개념 설명 접기' })).toBeTruthy();
    fireEvent.click(ui.getByRole('button', { name: '이것만 모아 풀기' }));
    await waitFor(() => expect(gather).toHaveBeenCalledTimes(2));
    expect(gather).toHaveBeenLastCalledWith('add-denominators');
  });
  it('identifies unfinished focused practice as a continuation', () => {
    render(<ConfusionSummary summary={pattern()} {...props()} continuingKeys={['add-denominators']} />);
    expect(screen.getByRole('button', { name: '모아 풀기 이어서' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: '이것만 모아 풀기' })).toBeNull();
  });
  it('uses the matching wrong attempt rather than a newer unrelated error or correction', () => {
    const summary = pattern(), evidence = summary.evidence[0];
    evidence.corrections.push({ ...evidence.first, id: 'unrelated', createdAt: '2026-09-30T00:00:00Z', signal: { kind: 'misreading', key: 'sign', label: '부호', note: '' } });
    expect(reviewAttempt(['p1'], new Map([['p1', evidence]]), summary.repeated[0])?.id).toBe('first');
    expect(reviewAttempt([], new Map())).toBeUndefined();
  });
  it('shows only the selected concept when reading a concept card', async () => {
    vi.spyOn(learningApi, 'conceptHelp').mockResolvedValue({ concepts: [
      { key: 'fractions', label: '설명 속 분수', definition: null, lesson: null },
      { key: 'unrelated', label: '다른 개념', definition: null, lesson: null },
    ] });
    render(<ConfusionSummary summary={fixture()} {...props()} />);
    fireEvent.click(screen.getByRole('button', { name: '이 개념 설명' }));
    expect(await screen.findByText('설명 속 분수')).toBeTruthy();
    expect(screen.queryByText('다른 개념')).toBeNull();
  });
  it('draws recorded numeric answers as math while retaining the first and corrected distinction', async () => {
    const summary = fixture(); summary.evidence[0].responseSpec = { kind: 'expression' };
    summary.evidence[0].first.answer = 'sqrt(8)/2';
    render(<ConfusionSummary summary={summary} {...props()} />);
    const details = screen.getByText('풀이 근거 보기 · 1문제').closest('details')!;
    details.open = true; fireEvent(details, new Event('toggle'));
    await waitFor(() => expect(details.querySelector('.katex')).not.toBeNull());
    expect(screen.queryByText('sqrt(8)/2')).toBeNull();
    expect(screen.getByText('첫 답')).toBeTruthy();
  });
});
