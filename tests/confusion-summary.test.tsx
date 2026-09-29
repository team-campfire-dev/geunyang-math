// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from './render';
import { ConfusionSummary } from '@/features/learning/confusion-summary';
import type { ConfusionSummary as Summary } from '@/shared/confusion';

afterEach(cleanup);
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
