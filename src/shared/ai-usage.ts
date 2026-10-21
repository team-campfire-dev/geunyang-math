/**
 * What the operator reads about model spending: the last thirty days by day, by feature and model,
 * and by account, with the limits that stop it. Money is in millionths of a US dollar throughout, as
 * it is stored; the screen turns it into dollars.
 */
export type UsageFeature = 'ai-practice' | 'gathered' | 'editor';
export const usageFeatureLabels: Record<UsageFeature, string> = { 'ai-practice': 'AI 맞춤 연습', gathered: '모아 풀기 채우기', editor: '편집 화면' };

export type UsageTotals = { calls: number; costMicros: number; inputTokens: number; outputTokens: number; cacheReadTokens: number; cacheWriteTokens: number };
export type AiUsageView = {
  /** Where the limits stand, from the environment. */
  limits: { accountDay: number; accountMonth: number; serviceDay: number };
  /** Spent by everyone in the last 24 hours, the window the service limit watches. */
  serviceDay: number;
  total: UsageTotals;
  /** Each Korean calendar day of the thirty, newest first, including days with nothing. */
  days: { day: string; costMicros: number; calls: number; byFeature: Partial<Record<UsageFeature, number>> }[];
  features: ({ feature: UsageFeature; runs: number } & UsageTotals)[];
  models: ({ model: string } & UsageTotals)[];
  /** The accounts that spent, dearest first. `userId` is null for rows whose account was deleted. */
  accounts: { userId: string | null; displayName: string; last24h: number; last30d: number; calls: number; runs: number; lastAt: string }[];
};
