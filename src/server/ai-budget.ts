import 'server-only';
import type { Prisma, PrismaClient } from '@prisma/client';
import { costMicros, type UsageFeature, type UsageSink } from './model-usage';

type Db = PrismaClient | Prisma.TransactionClient;

/**
 * How much model work the service pays for: one account over a day and over thirty days, and the
 * whole service over a day. The counts that already bound each feature (three AI practice sets a
 * day, five gathered fillings) say how often; these say how much, which is what a bill is made of
 * and what a run that goes wrong runs up.
 *
 * In US dollars, from the environment so an operator can move them without a release; the defaults
 * leave room for an ordinary day of every feature (an AI practice set costs about 0.3–0.4 dollars).
 * Each is checked before work starts, so a run already under way may finish a little past it.
 */
export function budgetLimits() {
  const usd = (name: string, fallback: number) => {
    const raw = process.env[name];
    const value = raw ? Number(raw) : Number.NaN;
    return Math.round((Number.isFinite(value) && value >= 0 ? value : fallback) * 1_000_000);
  };
  return { accountDay: usd('AI_ACCOUNT_DAILY_USD', 2), accountMonth: usd('AI_ACCOUNT_MONTHLY_USD', 20), serviceDay: usd('AI_SERVICE_DAILY_USD', 30) };
}

const day = 24 * 60 * 60 * 1000;
const sum = async (db: Db, where: Prisma.ModelUsageWhereInput) =>
  (await db.modelUsage.aggregate({ where, _sum: { costMicros: true } }))._sum.costMicros ?? 0;

/** What has been spent in each window that a limit watches, in millionths of a dollar. */
export async function spending(db: Db, userId: string) {
  const now = Date.now();
  const [accountDay, accountMonth, serviceDay] = await Promise.all([
    sum(db, { userId, createdAt: { gte: new Date(now - day) } }),
    sum(db, { userId, createdAt: { gte: new Date(now - 30 * day) } }),
    sum(db, { createdAt: { gte: new Date(now - day) } }),
  ]);
  return { accountDay, accountMonth, serviceDay };
}

/** Why this account may not start more model work now, in words for them, or null when it may. */
export async function budgetRefusal(db: Db, userId: string): Promise<string | null> {
  const limits = budgetLimits();
  const spent = await spending(db, userId);
  if (spent.serviceDay >= limits.serviceDay) return '오늘은 AI 문제 만들기를 쉬고 있어요. 내일 다시 해 보세요.';
  if (spent.accountDay >= limits.accountDay) return '오늘 쓸 수 있는 AI 사용량을 다 썼어요. 내일 다시 해 보세요.';
  if (spent.accountMonth >= limits.accountMonth) return '최근 30일 동안 쓸 수 있는 AI 사용량을 다 썼어요.';
  return null;
}

/**
 * Where a model run's calls go: each is written for this account as it returns, so a run cut off
 * halfway still counts what it spent. Writing never fails the run — a lost row is logged instead.
 * `settled` waits for the writes, for a caller (or a test) that reads them back.
 */
export function usageRecorder(db: PrismaClient, userId: string, feature: UsageFeature, setId?: string) {
  const writes: Promise<unknown>[] = [];
  const sink: UsageSink = (call) => {
    writes.push(db.modelUsage.create({ data: { userId, feature, step: call.step, model: call.model,
      inputTokens: call.input, outputTokens: call.output, cacheReadTokens: call.cacheRead, cacheWriteTokens: call.cacheWrite,
      costMicros: costMicros(call), ...(setId ? { setId } : {}) } })
      .catch((reason: unknown) => console.error(JSON.stringify({ event: 'model_usage_unrecorded', feature, step: call.step,
        reason: reason instanceof Error ? reason.message : String(reason) }))));
  };
  return { sink, settled: () => Promise.all(writes).then(() => undefined) };
}
