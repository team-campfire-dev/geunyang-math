import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { existingRows, removeRowsAddedSince, type Existing } from './cleanup';
import { createDatabase } from '@/server/db';
import { AuthoringService } from '@/server/authoring';
import { currentDiagnostic, problemSetRecords } from '@/server/content-store';
import type { DiagnosticEdit } from '@/shared/authoring';

/**
 * Writing a placement on a screen.
 *
 * Its questions are the only ones no lesson holds, so nothing in the studio could reach them: the
 * only way to change what a placement asks was to edit `prisma/seed/` and deploy. That put the
 * thirty-nine questions the service places everybody with out of reach of the people who write it.
 */
const url = process.env.TEST_DATABASE_URL;
describe.skipIf(!url)('writing a placement', () => {
  let db: ReturnType<typeof createDatabase>;
  let existing: Existing;
  let service: AuthoringService;
  beforeAll(async () => {
    const parsed = new URL(url!);
    if (parsed.protocol !== 'mysql:' || !parsed.pathname.endsWith('_test')) throw new Error('Use an isolated _test database.');
    db = createDatabase(url!);
    existing = await existingRows(db);
    service = new AuthoringService(db);
  });
  afterAll(async () => {
    if (existing) await removeRowsAddedSince(db, existing);
    await db?.$disconnect();
  });

  const account = async (role?: 'admin' | 'author') => {
    const user = await db.user.create({ data: { displayName: `writer ${randomUUID()}`, learningScopes: { create: { kind: 'personal' } } } });
    if (role) await db.contentAuthor.create({ data: { userId: user.id, role } });
    return user;
  };
  const key = async () => (await currentDiagnostic(db))!;

  it('lists the placements and says which one a learner starting today would take', async () => {
    const admin = await account('admin');
    const now = await key();
    const listed = (await service.workspace(admin.id)).diagnostics;
    expect(listed.length).toBeGreaterThan(0);
    const current = listed.filter((item) => item.current);
    expect(current).toHaveLength(1);
    expect(current[0].latestVersionId).toBe(now.versionId);
    expect(current[0].problemCount).toBe(now.problems.length);
  });

  it('opens the next version with the questions the published one asks', async () => {
    const admin = await account('admin');
    const now = await key();
    const opened = (await service.act(admin.id, { action: 'diagnostic.draft', diagnosticKey: now.diagnosticKey })).diagnostic!;
    expect(opened.baseVersionId).toBe(now.versionId);
    expect(opened.versionId).not.toBe(now.versionId);
    expect(opened.edit.problemVersionIds).toEqual(now.problemSet.problemVersionIds);
    expect(opened.edit.problems).toHaveLength(now.problems.length);
    expect(opened.issues).toEqual([]);
    // Asking again hands back the same draft rather than starting a second one.
    expect((await service.act(admin.id, { action: 'diagnostic.draft', diagnosticKey: now.diagnosticKey })).diagnostic!.id).toBe(opened.id);
    await service.act(admin.id, { action: 'diagnostic.delete', draftId: opened.id });
  });

  it('refuses to publish a placement that helps, or one that says nothing', async () => {
    const admin = await account('admin');
    const now = await key();
    const opened = (await service.act(admin.id, { action: 'diagnostic.draft', diagnosticKey: now.diagnosticKey })).diagnostic!;

    const helping: DiagnosticEdit = structuredClone(opened.edit);
    helping.problems[0].hints = [{ blockId: 'h1', kind: 'core.rich_text', typeVersion: 1, required: true, payload: { text: '분모를 보세요' } }];
    helping.title = '';
    const saved = (await service.act(admin.id, { action: 'diagnostic.save', draftId: opened.id, edit: helping })).diagnostic!;
    expect(saved.issues.map((issue) => issue.field)).toContain('title');
    expect(saved.issues.some((issue) => issue.field === 'hints')).toBe(true);
    await expect(service.act(admin.id, { action: 'diagnostic.publish', draftId: opened.id })).rejects.toMatchObject({ status: 422 });

    const empty: DiagnosticEdit = { ...structuredClone(opened.edit), problemVersionIds: [], problems: [] };
    expect((await service.act(admin.id, { action: 'diagnostic.save', draftId: opened.id, edit: empty })).diagnostic!.issues.length).toBeGreaterThan(0);
    await service.act(admin.id, { action: 'diagnostic.delete', draftId: opened.id });
  });

  it('publishes a changed question as a new one, and becomes the placement in use', async () => {
    const admin = await account('admin');
    const before = await key();
    const opened = (await service.act(admin.id, { action: 'diagnostic.draft', diagnosticKey: before.diagnosticKey })).diagnostic!;

    const edit: DiagnosticEdit = structuredClone(opened.edit);
    edit.description = '화면에서 고친 설명이에요.';
    edit.problems[0].gradingSpec = { kind: 'integer', value: 9191 };
    // And one question fewer: what it stops asking leaves the set it publishes.
    const dropped = edit.problemVersionIds.at(-1)!;
    edit.problemVersionIds = edit.problemVersionIds.filter((problemId) => problemId !== dropped);
    const saved = (await service.act(admin.id, { action: 'diagnostic.save', draftId: opened.id, edit })).diagnostic!;
    expect(saved.issues).toEqual([]);
    expect(saved.edit.problemVersionIds[0]).not.toBe(opened.edit.problemVersionIds[0]);
    expect(saved.edit.problemVersionIds).toHaveLength(opened.edit.problemVersionIds.length - 1);

    const published = await service.act(admin.id, { action: 'diagnostic.publish', draftId: opened.id });
    expect(published.publishedVersionId).toBe(saved.versionId);
    const now = await key();
    expect(now.versionId).toBe(saved.versionId);
    expect(now.description).toBe('화면에서 고친 설명이에요.');
    expect(now.problems).toHaveLength(before.problems.length - 1);
    expect(JSON.stringify(now.problems)).toContain('9191');
    // What it stopped asking leaves the set it publishes: a set version holds what its owner asks.
    const published2 = (await problemSetRecords(db, [now.problemSet.problemSetVersionId])).get(now.problemSet.problemSetVersionId)!;
    expect(published2.problems.map((problem) => problem.problemVersionId)).toEqual(now.problemSet.problemVersionIds);
    expect(published2.problems.some((problem) => problem.problemVersionId === dropped)).toBe(false);

    // The version it replaced is exactly as it was published, questions and all.
    const old = (await problemSetRecords(db, [before.problemSet.problemSetVersionId])).get(before.problemSet.problemSetVersionId)!;
    expect(old.problems).toHaveLength(before.problems.length);
    expect(JSON.stringify(old.problems)).not.toContain('9191');
  }, 30_000);

  it('keeps writing to those who may write, and publishing to those who may publish', async () => {
    const author = await account('author');
    const learner = await account();
    const admin = await account('admin');
    const now = await key();
    await expect(service.act(learner.id, { action: 'diagnostic.draft', diagnosticKey: now.diagnosticKey })).rejects.toMatchObject({ status: 403 });
    const opened = (await service.act(author.id, { action: 'diagnostic.draft', diagnosticKey: now.diagnosticKey })).diagnostic!;
    await expect(service.act(author.id, { action: 'diagnostic.publish', draftId: opened.id })).rejects.toMatchObject({ status: 403 });
    // An administrator may pick up a writer's draft, which is how review works everywhere else here.
    expect((await service.act(admin.id, { action: 'diagnostic.save', draftId: opened.id, edit: opened.edit })).diagnostic!.mine).toBe(false);
    await service.act(admin.id, { action: 'diagnostic.delete', draftId: opened.id });
  });
});
