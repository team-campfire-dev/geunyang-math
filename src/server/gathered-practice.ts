import 'server-only';
import { Prisma } from '@prisma/client';
import type { GradeResult } from '@/shared/api';
import { parseAssignmentPolicy } from '@/core/assignment';

export const gatheredQuestions = 6;

/** The preview and the actual gather use this same eligible, ordered pool. No work is created here. */
export async function gatheredPracticePools(db: Prisma.TransactionClient, userId: string, keys: string[]) {
  const pools = new Map(keys.map(key => [key, [] as string[]]));
  if (!keys.length) return pools;
  const [named, diagnostics, attempts] = await Promise.all([
    db.publishedProblem.findMany({ where: { ownerKind: 'problem_set', misreadings: { not: Prisma.DbNull } },
      orderBy: [{ ownerVersionId: 'asc' }, { order: 'asc' }], select: { ownerVersionId: true, problemVersionId: true, misreadings: true } }),
    db.diagnosticVersion.findMany({ select: { problemSetVersionId: true } }),
    db.attempt.findMany({ where: { userId }, orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      select: { problemVersionId: true, result: true, hintUsed: true,
        submission: { select: { status: true, recipient: { select: { assignment: { select: { policy: true } } } } } } } }),
  ]);
  const banks = new Set(diagnostics.map(row => row.problemSetVersionId));
  const answered = new Map<string, { result: GradeResult; hintUsed: boolean }>();
  for (const attempt of attempts) {
    // Withheld grades must not change the preview count or the questions returned by gathering.
    if (attempt.submission && attempt.submission.status !== 'submitted'
      && parseAssignmentPolicy(attempt.submission.recipient.assignment.policy).results === 'after-submission') continue;
    const result = attempt.result as GradeResult;
    if ((result.status === 'correct' || result.status === 'incorrect') && !answered.has(attempt.problemVersionId)) {
      answered.set(attempt.problemVersionId, { result, hintUsed: attempt.hintUsed });
    }
  }
  for (const row of named) {
    const first = answered.get(row.problemVersionId);
    if (banks.has(row.ownerVersionId) || (first?.result.status === 'correct' && !first.result.assisted && !first.hintUsed)) continue;
    for (const [key, ids] of pools) {
      if (!ids.includes(row.problemVersionId) && (row.misreadings as { misconception?: unknown }[] | null)?.some(item => item.misconception === key)) ids.push(row.problemVersionId);
    }
  }
  for (const [key, ids] of pools) pools.set(key, ids.sort((a, b) => Number(answered.has(b)) - Number(answered.has(a))).slice(0, gatheredQuestions));
  return pools;
}
