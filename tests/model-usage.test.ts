import { afterEach, describe, expect, it } from 'vitest';
import { budgetLimits } from '@/server/ai-budget';
import { costMicros } from '@/server/model-usage';

describe('what a model call costs', () => {
  it('prices each kind of token at the model that answered, in millionths of a dollar', () => {
    // Sonnet 5.5: $2 in, $10 out, $0.20 cache read, $2.50 cache write per million.
    expect(costMicros({ model: 'claude-sonnet-5-5', input: 1000, output: 500, cacheRead: 2000, cacheWrite: 0 })).toBe(7400);
    expect(costMicros({ model: 'claude-sonnet-5-5', input: 0, output: 0, cacheRead: 0, cacheWrite: 14108 })).toBe(35270);
    expect(costMicros({ model: 'claude-opus-5-5', input: 1000, output: 500, cacheRead: 0, cacheWrite: 0 })).toBe(14000);
  });

  it('never reads an unknown model as cheap, and never adds many small calls to nothing', () => {
    expect(costMicros({ model: 'claude-something-new', input: 1000, output: 500, cacheRead: 0, cacheWrite: 0 })).toBe(14000);
    expect(costMicros({ model: 'claude-haiku-5-5', input: 1, output: 0, cacheRead: 0, cacheWrite: 0 })).toBe(1);
  });
});

describe('the limits an operator sets', () => {
  const saved = { ...process.env };
  afterEach(() => { process.env = { ...saved }; });

  it('reads dollars from the environment and falls back on the defaults for anything else', () => {
    delete process.env.AI_ACCOUNT_DAILY_USD; delete process.env.AI_ACCOUNT_MONTHLY_USD; delete process.env.AI_SERVICE_DAILY_USD;
    expect(budgetLimits()).toEqual({ accountDay: 2_000_000, accountMonth: 20_000_000, serviceDay: 30_000_000 });
    process.env.AI_ACCOUNT_DAILY_USD = '0.5'; process.env.AI_ACCOUNT_MONTHLY_USD = 'lots'; process.env.AI_SERVICE_DAILY_USD = '0';
    expect(budgetLimits()).toEqual({ accountDay: 500_000, accountMonth: 20_000_000, serviceDay: 0 });
  });
});
