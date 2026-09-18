// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from './render';
import { DiagnosticPanel } from '@/features/learning/diagnostic-panel';
import type { ConceptReadiness, DiagnosticOffering, DiagnosticView, PublicProblem } from '@/shared/api';

/**
 * What the placement screen can honestly say while it is running.
 *
 * It used to count questions — "3 / 13" — because the bank was walked end to end and its length was
 * known before anyone answered. A placement chooses what to ask and stops when it has settled what
 * it can, so there is no such number. What it counts instead is concepts settled, which is the thing
 * that actually moves, and which jumps when one answer carries several.
 */
const problem: PublicProblem = { problemVersionId: 'q1', promptContent: [], responseSpec: { kind: 'rational' }, hintAvailable: false, hints: [], conceptKeys: ['fraction'] } as unknown as PublicProblem;
const offering: DiagnosticOffering = { version: 'v3', title: '시작점 확인', description: '지금 어디쯤인지 봐요', total: 13, estimatedMinutes: 6 };
const run = (over: Partial<DiagnosticView> = {}): DiagnosticView => ({
  id: 'run', version: 'v3', status: 'active', completedAt: null,
  scope: 20, settled: 6, asked: 2, inferred: 4, answered: 3, currentProblem: problem, results: [], ...over,
});
const panel = (props: Partial<Parameters<typeof DiagnosticPanel>[0]> = {}) => render(
  <DiagnosticPanel diagnostic={run()} offering={offering} busy={false} readiness={[]}
    dispatch={vi.fn(async () => ({}) as never)} onBack={vi.fn()} onOpenLesson={vi.fn()} {...props} />);

describe('the placement screen', () => {
  it('measures progress in concepts settled, not in questions of a length it cannot know', () => {
    panel();
    const bar = screen.getByRole('progressbar', { name: '시작점 확인 진행' });
    expect(bar.getAttribute('value')).toBe('6');
    expect(bar.getAttribute('max')).toBe('20');
    expect(screen.getByText(/개념 20개 중 6개 확인/)).toBeTruthy();
  });

  it('never promises which question is the last one, because it does not know', () => {
    panel({ diagnostic: run({ settled: 19, scope: 20 }) });
    expect(screen.queryByText('저장하고 결과 보기')).toBeNull();
    expect(screen.getByRole('button', { name: '저장하고 다음으로' })).toBeTruthy();
  });

  it('offers a ceiling rather than a count, since most people answer far fewer', () => {
    panel({ diagnostic: null });
    expect(screen.getByText(/최대 13문제/)).toBeTruthy();
    expect(screen.getByText(/한 문제를 풀면 그 위나 아래의 개념까지 함께 정해지기/)).toBeTruthy();
  });

  it('says which concepts it worked out rather than asked about', () => {
    const readiness: ConceptReadiness[] = [
      { key: 'fraction', label: '분수', readiness: 'ready', source: 'diagnostic' },
      { key: 'numerator', label: '분자', readiness: 'ready', source: 'inferred' },
    ];
    panel({ diagnostic: run({ status: 'completed', settled: 8, inferred: 5, results: [{ problemVersionId: 'q1', answer: '1/2', status: 'correct' }] }), readiness });
    expect(screen.getByText('분수').closest('.readiness')!.textContent).not.toMatch(/앞의 답에서/);
    expect(screen.getByText('분자').closest('.readiness')!.textContent).toMatch(/앞의 답에서/);
    expect(screen.getByText(/개념 8개의 자리를 찾았어요/).textContent).toMatch(/5개는 직접 묻지 않고/);
  });

  it('sends the answer for the question it is showing, whichever one that is', () => {
    const dispatch = vi.fn(async () => ({}) as never);
    panel({ dispatch, diagnostic: run({ currentProblem: { ...problem, problemVersionId: 'q7' } }) });
    fireEvent.change(screen.getByLabelText('진단 답안'), { target: { value: '3/4' } });
    fireEvent.click(screen.getByRole('button', { name: '저장하고 다음으로' }));
    expect(dispatch).toHaveBeenCalledWith({ action: 'diagnostic.answer', diagnosticId: 'run', problemVersionId: 'q7', answer: '3/4' });
  });
});
