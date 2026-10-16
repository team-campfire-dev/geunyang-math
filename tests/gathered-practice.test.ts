import { describe, expect, it, vi } from 'vitest';
import type { Prisma } from '@prisma/client';
import { gatheredPracticePools } from '@/server/gathered-practice';

describe('the shared practice preview and gather pool', () => {
  it('excludes diagnostic banks and first unaided successes, preserves assisted work, and deduplicates versions', async () => {
    const named = ['settled', 'assisted', 'retry', 'unseen', 'unseen', 'bank'].map(problemVersionId => ({ problemVersionId,
      ownerVersionId: problemVersionId === 'bank' ? 'diagnostic' : 'practice', misreadings: [{ misconception: 'add-denominators' }] }));
    const attempts = [
      { problemVersionId: 'settled', result: { status: 'invalid' }, hintUsed: false },
      { problemVersionId: 'settled', result: { status: 'correct', assisted: false }, hintUsed: false },
      { problemVersionId: 'assisted', result: { status: 'correct', assisted: false }, hintUsed: true },
      { problemVersionId: 'retry', result: { status: 'incorrect', assisted: false }, hintUsed: false },
      { problemVersionId: 'retry', result: { status: 'correct', assisted: false }, hintUsed: false },
    ];
    const db = { generatedProblemSet: { findMany: vi.fn().mockResolvedValue([]) }, publishedProblem: { findMany: vi.fn().mockResolvedValue(named) }, diagnosticVersion: { findMany: vi.fn().mockResolvedValue([{ problemSetVersionId: 'diagnostic' }]) },
      attempt: { findMany: vi.fn().mockResolvedValue(attempts) } } as unknown as Prisma.TransactionClient;
    expect((await gatheredPracticePools(db, 'user', ['add-denominators', 'missing'])).get('add-denominators')).toEqual(['assisted', 'retry', 'unseen']);
    expect((await gatheredPracticePools(db, 'user', ['missing'])).get('missing')).toEqual([]);
  });
  it('puts this learner\'s own generated questions after the catalogue\'s, and asks only for theirs', async () => {
    const tagged = (problemVersionId: string, ownerVersionId: string) => ({ problemVersionId, ownerVersionId, misreadings: [{ misconception: 'one-as-prime' }] });
    const sets = vi.fn().mockResolvedValue([{ id: 'generated:mine' }]);
    const findMany = vi.fn().mockImplementation(async ({ where }: { where: { ownerKind: string } }) =>
      where.ownerKind === 'generated' ? [tagged('generated:mine:1', 'generated:mine')] : [tagged('catalogue', 'practice')]);
    const db = { generatedProblemSet: { findMany: sets }, publishedProblem: { findMany }, diagnosticVersion: { findMany: vi.fn().mockResolvedValue([]) },
      attempt: { findMany: vi.fn().mockResolvedValue([]) } } as unknown as Prisma.TransactionClient;
    expect((await gatheredPracticePools(db, 'user', ['one-as-prime'])).get('one-as-prime')).toEqual(['catalogue', 'generated:mine:1']);
    expect(sets).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ userId: 'user' }) }));
  });
  it('caps the practice at six and does not query content when there is no target', async () => {
    const findMany = vi.fn().mockResolvedValue(Array.from({ length: 10 }, (_, index) => ({ problemVersionId: `p${index}`, ownerVersionId: 'practice', misreadings: [{ misconception: 'add-denominators' }] })));
    const db = { generatedProblemSet: { findMany: vi.fn().mockResolvedValue([]) }, publishedProblem: { findMany }, diagnosticVersion: { findMany: vi.fn().mockResolvedValue([]) }, attempt: { findMany: vi.fn().mockResolvedValue([]) } } as unknown as Prisma.TransactionClient;
    expect((await gatheredPracticePools(db, 'user', [])).size).toBe(0);
    expect(findMany).not.toHaveBeenCalled();
    expect((await gatheredPracticePools(db, 'user', ['add-denominators'])).get('add-denominators')).toHaveLength(6);
  });
});
