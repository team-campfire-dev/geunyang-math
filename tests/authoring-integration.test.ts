import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createDatabase } from '@/server/db';
import { AuthoringService, authoringRole, openAuthoring, openAuthoringAccount } from '@/server/authoring';
import { importContent } from '@/server/content-store';
import type { StoredClass } from '@/core/content';
import type { DraftEdit } from '@/shared/authoring';
import { seedClasses } from './fixtures/content';

const url = process.env.TEST_DATABASE_URL;
describe.skipIf(!url)('content authoring on MySQL', () => {
  let db: ReturnType<typeof createDatabase>;
  let service: AuthoringService;
  let classKey: string;

  beforeAll(async () => {
    const parsed = new URL(url!);
    if (parsed.protocol !== 'mysql:' || !parsed.pathname.endsWith('_test')) throw new Error('Use an isolated _test database.');
    db = createDatabase(url!);
    service = new AuthoringService(db);
    // A class of this suite's own, so drafts here never publish a version of a shared fixture.
    classKey = `authoring-${randomUUID()}`;
    const base = JSON.parse(JSON.stringify(seedClasses[0]).replaceAll('fraction-meaning', classKey)) as StoredClass;
    base.public.order = 2000;
    await importContent(db, { schemaVersion: 1, skills: [], classes: [base], diagnostics: [], terms: [] });
  });
  afterAll(async () => { await db?.$disconnect(); });

  const account = async (role?: 'admin' | 'author') => {
    const user = await db.user.create({ data: { displayName: `author ${randomUUID()}`, scopes: { create: { kind: 'personal' } } } });
    if (role) await db.contentAuthor.create({ data: { userId: user.id, role } });
    return user;
  };
  const edited = (edit: DraftEdit, change: (sections: DraftEdit['sections']) => void): DraftEdit => {
    const next = structuredClone(edit);
    change(next.sections);
    return next;
  };
  const animation = (blockId: string) => ({
    blockId, kind: 'math.fraction_sequence', typeVersion: 1, required: true,
    payload: { parts: 4, alt: '4등분한 막대가 세 칸까지 채워지는 장면', frames: [{ filled: 0 }, { filled: 3 }] },
  });

  it('grants content work by role, and treats an account without one as a learner', async () => {
    const learner = await account();
    const author = await account('author');
    const admin = await account('admin');
    expect(await authoringRole(db, learner.id)).toBeNull();
    expect(await authoringRole(db, author.id)).toBe('author');
    expect(await authoringRole(db, admin.id)).toBe('admin');
    expect(await service.workspace(learner.id)).toEqual({ role: null, drafts: [], classes: [] });
    await expect(service.createDraft(learner.id, classKey)).rejects.toThrow(/권한/);
  });

  it('stays closed unless the deployment opens it, and then needs no account of its own', async () => {
    const stranger = await account();
    expect(openAuthoring()).toBe(false);
    expect(await authoringRole(db, stranger.id)).toBeNull();
    process.env.CONTENT_OPEN_ACCESS = 'true';
    try {
      expect(await authoringRole(db, stranger.id)).toBe('admin');
      const shared = await openAuthoringAccount(db);
      expect(shared.id).toBe('open-authoring');
      const created = await service.createDraft(shared.id, classKey);
      expect(created.draft!.authorName).toBe('열린 편집');
      await service.deleteDraft(shared.id, created.draft!.id);
    } finally { delete process.env.CONTENT_OPEN_ACCESS; }
    // Turning it off closes the door again, including for drafts written while it was open.
    expect(await authoringRole(db, stranger.id)).toBeNull();
    await expect(service.createDraft(stranger.id, classKey)).rejects.toThrow(/권한/);
  });

  it('names the first administrators from the environment so a new deployment has one', async () => {
    const admin = await account();
    const subject = `google-${randomUUID()}`;
    await db.googleIdentity.create({ data: { subject, userId: admin.id } });
    expect(await authoringRole(db, admin.id)).toBeNull();
    process.env.CONTENT_ADMIN_SUBJECTS = ` ${subject} ,other-subject`;
    try { expect(await authoringRole(db, admin.id)).toBe('admin'); }
    finally { delete process.env.CONTENT_ADMIN_SUBJECTS; }
  });

  it('starts a draft at the next version of the published class and keeps answers on the server', async () => {
    const admin = await account('admin');
    const { draft, workspace } = await service.createDraft(admin.id, classKey);
    expect(workspace.classes.find((item) => item.classKey === classKey)).toMatchObject({ hasDraft: true });
    expect(draft!.versionId).toBe(`${classKey}:v2`);
    expect(draft!.baseVersionId).toBe(`${classKey}:v1`);
    expect(draft!.edit.sections).toHaveLength(5);
    expect(draft!.issues).toEqual([]);
    // What the editor receives carries questions, but never their answers, hints or solutions.
    const serialized = JSON.stringify(draft);
    expect(serialized).not.toContain('gradingSpec');
    expect(serialized).not.toContain('"solution"');
    for (const problem of draft!.problems) expect(Object.keys(problem).sort())
      .toEqual(['hintAvailable', 'problemVersionId', 'promptContent', 'responseSpec', 'skillKeys']);
  });

  it('saves work in progress and reports what still blocks publishing', async () => {
    const admin = await account('admin');
    const created = await service.createDraft(admin.id, classKey);
    const draftId = created.draft!.id;
    const broken = edited(created.draft!.edit, (sections) => {
      sections[0].contentBlocks.push({ ...animation(`${classKey}:explanation:sequence:v2`), payload: { parts: 4, alt: '장면', frames: [{ filled: 9 }, { filled: 3 }] } });
    });
    const saved = await service.saveDraft(admin.id, draftId, broken);
    expect(saved.draft!.issues.join(' ')).toMatch(/filled must not exceed parts/);
    const fixed = edited(created.draft!.edit, (sections) => { sections[0].contentBlocks.push(animation(`${classKey}:explanation:sequence:v2`)); });
    const good = await service.saveDraft(admin.id, draftId, fixed);
    expect(good.draft!.issues).toEqual([]);
    expect((await service.validateDraft(admin.id, draftId)).draft!.issues).toEqual([]);
  });

  it('publishes the draft as a new immutable version and leaves the base version untouched', async () => {
    const admin = await account('admin');
    const created = await service.createDraft(admin.id, classKey);
    const draftId = created.draft!.id;
    const versionId = created.draft!.versionId;
    const before = await db.classVersion.findUniqueOrThrow({ where: { id: `${classKey}:v1` } });
    await service.saveDraft(admin.id, draftId, edited(created.draft!.edit, (sections) => {
      sections[0].contentBlocks.push(animation(`${classKey}:explanation:sequence:${versionId.split(':').at(-1)}`));
    }));
    const published = await service.publishDraft(admin.id, draftId);
    expect(published.publishedVersionId).toBe(versionId);
    expect(published.draft!.status).toBe('published');
    const row = await db.classVersion.findUniqueOrThrow({ where: { id: versionId } });
    const document = row.document as unknown as StoredClass;
    expect(document.sections[0].contentBlocks.at(-1)!.kind).toBe('math.fraction_sequence');
    // The published class still carries the private half the editor never saw.
    expect(document.problems[0].gradingSpec).toBeDefined();
    expect(await db.classVersion.findUniqueOrThrow({ where: { id: `${classKey}:v1` } })).toEqual(before);
    await expect(service.saveDraft(admin.id, draftId, created.draft!.edit)).rejects.toThrow(/이미 발행/);
  });

  it('refuses to publish an invalid draft, or to publish at all without the role', async () => {
    const admin = await account('admin');
    const author = await account('author');
    const created = await service.createDraft(author.id, classKey);
    const draftId = created.draft!.id;
    await service.saveDraft(author.id, draftId, edited(created.draft!.edit, (sections) => { sections[0].contentBlocks = []; }));
    await expect(service.publishDraft(author.id, draftId)).rejects.toThrow(/관리자만/);
    await expect(service.publishDraft(admin.id, draftId)).rejects.toThrow(/고칠 곳/);
    expect(await db.classVersion.findUnique({ where: { id: created.draft!.versionId } })).toBeNull();
  });

  it('keeps a draft inside its own class when the version ID is edited by hand', async () => {
    const admin = await account('admin');
    const created = await service.createDraft(admin.id, classKey);
    const stray = { ...created.draft!.edit, meta: { ...created.draft!.edit.meta, versionId: 'fraction-addition:v9' } };
    await expect(service.saveDraft(admin.id, created.draft!.id, stray)).rejects.toThrow(/판본 ID는/);
    expect(await db.classVersion.findUnique({ where: { id: 'fraction-addition:v9' } })).toBeNull();
  });

  it('rejects a version ID that is already published instead of rewriting it', async () => {
    const admin = await account('admin');
    const created = await service.createDraft(admin.id, classKey);
    const taken = { ...created.draft!.edit, meta: { ...created.draft!.edit.meta, versionId: `${classKey}:v1` } };
    await service.saveDraft(admin.id, created.draft!.id, taken);
    await expect(service.publishDraft(admin.id, created.draft!.id)).rejects.toThrow(/immutable/);
  });

  it('keeps one author out of a draft that is not theirs while an administrator can pick it up', async () => {
    const first = await account('author');
    const second = await account('author');
    const admin = await account('admin');
    const created = await service.createDraft(first.id, classKey);
    await expect(service.draft(second.id, created.draft!.id)).rejects.toThrow(/다른 사람/);
    expect((await service.workspace(second.id)).drafts.find((item) => item.id === created.draft!.id)).toBeUndefined();
    const seen = (await service.workspace(admin.id)).drafts.find((item) => item.id === created.draft!.id);
    expect(seen).toMatchObject({ mine: false, authorName: expect.stringContaining('author') });
    await service.deleteDraft(admin.id, created.draft!.id);
    expect(await db.contentDraft.findUnique({ where: { id: created.draft!.id } })).toBeNull();
  });
});
