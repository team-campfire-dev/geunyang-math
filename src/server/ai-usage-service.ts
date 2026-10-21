import 'server-only';
import type { PrismaClient } from '@prisma/client';
import type { AiUsageView, UsageFeature, UsageTotals } from '@/shared/ai-usage';
import { budgetLimits } from './ai-budget';
import { authoringRole } from './authoring';
import { AppError } from './errors';

const day = 24 * 60 * 60 * 1000;
/** A Korean calendar day, as 2026-10-21: the day an operator in Korea means by 「오늘」. */
const kstDay = (date: Date) => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul', year: 'numeric', month: '2-digit', day: '2-digit' }).format(date);
const empty = (): UsageTotals => ({ calls: 0, costMicros: 0, inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 });
type Row = { userId: string | null; feature: string; model: string; setId: string | null; costMicros: number; createdAt: Date;
  inputTokens: number; outputTokens: number; cacheReadTokens: number; cacheWriteTokens: number };
function add(totals: UsageTotals, row: Row) {
  totals.calls += 1; totals.costMicros += row.costMicros; totals.inputTokens += row.inputTokens; totals.outputTokens += row.outputTokens;
  totals.cacheReadTokens += row.cacheReadTokens; totals.cacheWriteTokens += row.cacheWriteTokens;
}
/** A run is one set written, or one editor request; calls without a set each count as their own run's part, by the minute. */
const runOf = (row: Row) => row.setId ?? `${row.userId}:${row.feature}:${Math.floor(row.createdAt.getTime() / 60_000)}`;

/**
 * Model spending, for the operator. Only an operator (the authoring role `admin`) reads it: it names
 * every account that caused a call, and what each cost.
 *
 * Thirty days of rows are read and added up here rather than in SQL. At today's size that is a few
 * thousand rows; when it is not, the day and account totals move into grouped queries.
 */
export class AiUsageService {
  constructor(private readonly db: PrismaClient) {}

  async view(userId: string): Promise<AiUsageView> {
    if (await authoringRole(this.db, userId) !== 'admin') throw new AppError(403, 'not_an_operator', '운영자만 볼 수 있어요.');
    const now = Date.now();
    const rows: Row[] = await this.db.modelUsage.findMany({ where: { createdAt: { gte: new Date(now - 30 * day) } }, orderBy: { createdAt: 'desc' },
      select: { userId: true, feature: true, model: true, setId: true, costMicros: true, createdAt: true,
        inputTokens: true, outputTokens: true, cacheReadTokens: true, cacheWriteTokens: true } });
    const total = empty();
    const days = new Map<string, AiUsageView['days'][number]>();
    for (let back = 0; back < 30; back++) { const key = kstDay(new Date(now - back * day)); days.set(key, { day: key, costMicros: 0, calls: 0, byFeature: {} }); }
    const features = new Map<string, UsageTotals & { runs: Set<string> }>();
    const models = new Map<string, UsageTotals>();
    const accounts = new Map<string, { userId: string | null; last24h: number; last30d: number; calls: number; runs: Set<string>; lastAt: Date }>();
    let serviceDay = 0;
    for (const row of rows) {
      add(total, row);
      const inDay = days.get(kstDay(row.createdAt));
      if (inDay) {
        inDay.costMicros += row.costMicros; inDay.calls += 1;
        inDay.byFeature[row.feature as UsageFeature] = (inDay.byFeature[row.feature as UsageFeature] ?? 0) + row.costMicros;
      }
      const feature = features.get(row.feature) ?? { ...empty(), runs: new Set<string>() };
      add(feature, row); feature.runs.add(runOf(row)); features.set(row.feature, feature);
      const model = models.get(row.model) ?? empty();
      add(model, row); models.set(row.model, model);
      const recent = row.createdAt.getTime() >= now - day;
      if (recent) serviceDay += row.costMicros;
      const key = row.userId ?? '';
      const account = accounts.get(key) ?? { userId: row.userId, last24h: 0, last30d: 0, calls: 0, runs: new Set<string>(), lastAt: row.createdAt };
      account.last30d += row.costMicros; account.calls += 1; account.runs.add(runOf(row));
      if (recent) account.last24h += row.costMicros;
      if (row.createdAt > account.lastAt) account.lastAt = row.createdAt;
      accounts.set(key, account);
    }
    const ids = [...accounts.values()].flatMap((account) => (account.userId ? [account.userId] : []));
    const names = new Map((await this.db.user.findMany({ where: { id: { in: ids } }, select: { id: true, displayName: true } }))
      .map((user) => [user.id, user.displayName]));
    return {
      limits: budgetLimits(), serviceDay, total,
      days: [...days.values()],
      features: [...features].map(([feature, { runs, ...totals }]) => ({ feature: feature as UsageFeature, runs: runs.size, ...totals }))
        .sort((a, b) => b.costMicros - a.costMicros),
      models: [...models].map(([model, totals]) => ({ model, ...totals })).sort((a, b) => b.costMicros - a.costMicros),
      accounts: [...accounts.values()].sort((a, b) => b.last30d - a.last30d).slice(0, 100).map(({ runs, lastAt, ...account }) => ({ ...account,
        displayName: account.userId ? names.get(account.userId) ?? '(알 수 없는 계정)' : '(지운 계정)', runs: runs.size, lastAt: lastAt.toISOString() })),
    };
  }
}
