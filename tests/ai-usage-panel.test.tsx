// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from './render';
import { AiUsagePanel } from '@/features/authoring/ai-usage-panel';
import type { AiUsageView } from '@/shared/ai-usage';

const totals = (costMicros: number, calls: number) => ({ calls, costMicros, inputTokens: 4000, outputTokens: 2000, cacheReadTokens: 12000, cacheWriteTokens: 4000 });
const view: AiUsageView = {
  limits: { accountDay: 2_000_000, accountMonth: 20_000_000, serviceDay: 30_000_000 },
  serviceDay: 7_500_000,
  total: totals(9_000_000, 120),
  days: [{ day: '2026-10-21', costMicros: 7_500_000, calls: 100, byFeature: { 'ai-practice': 7_000_000, editor: 500_000 } },
    { day: '2026-10-20', costMicros: 0, calls: 0, byFeature: {} }],
  features: [{ feature: 'ai-practice', runs: 20, ...totals(8_000_000, 110) }, { feature: 'editor', runs: 2, ...totals(1_000_000, 10) }],
  models: [{ model: 'claude-sonnet-5-5', ...totals(9_000_000, 120) }],
  accounts: [
    { userId: 'u1', displayName: '가상 학습자', last24h: 1_700_000, last30d: 3_000_000, calls: 40, runs: 5, lastAt: '2026-10-21T06:00:00.000Z' },
    { userId: null, displayName: '(지운 계정)', last24h: 0, last30d: 200_000, calls: 3, runs: 1, lastAt: '2026-10-19T06:00:00.000Z' },
  ],
};

describe('what the models cost, for the operator', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('shows the day against its limit, then each feature, account and day in dollars', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ usage: view }), { status: 200, headers: { 'content-type': 'application/json' } })));
    render(<AiUsagePanel />);
    await waitFor(() => expect(screen.getByText('AI 사용량')).toBeTruthy());
    // Today's spending, as the figure at the top and as today's row.
    expect(screen.getAllByText('$7.50')).toHaveLength(2);
    expect(screen.getByText('하루 한도 $30.00의 25%')).toBeTruthy();
    // What an AI practice set costs on average, which is what a limit is set against.
    expect(screen.getByText('$0.400')).toBeTruthy();
    // An account past 80% of its day reads in bold; days with nothing spent are left out.
    expect(screen.getByText('가상 학습자').closest('tr')?.className).toBe('is-near');
    expect(screen.getByText('(지운 계정)').closest('tr')?.className).toBe('');
    expect(screen.queryByText('2026-10-20')).toBeNull();
    expect(screen.getByText('2026-10-21')).toBeTruthy();
  });

  it('says so when the account is not an operator', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ error: { code: 'not_an_operator', message: '운영자만 볼 수 있어요.' } }), { status: 403, headers: { 'content-type': 'application/json' } })));
    render(<AiUsagePanel />);
    await waitFor(() => expect(screen.getByRole('alert').textContent).toContain('운영자만 볼 수 있어요.'));
  });
});
