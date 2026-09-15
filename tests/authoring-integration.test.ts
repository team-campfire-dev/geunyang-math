import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createDatabase } from '@/server/db';
import { AuthoringService, authoringRole, openAuthoring, openAuthoringAccount } from '@/server/authoring';
import { importContent } from '@/server/content-store';
import type { StoredClass } from '@/core/content';
import { newProblem, nextProblemVersionId, type DraftEdit, type DraftProblem } from '@/shared/authoring';
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
  const drawing = (blockId: string) => ({
    blockId, kind: 'core.scene', typeVersion: 1, required: true,
    payload: { alt: '4등분한 막대 중 세 칸을 채운 그림', width: 320, height: 200,
      items: [{ kind: 'strip', x: 20, y: 80, width: 280, height: 40, parts: 4, filled: 3 }] },
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

  it('starts a draft at the next version of the published class and opens its questions', async () => {
    const admin = await account('admin');
    const { draft, workspace } = await service.createDraft(admin.id, classKey);
    expect(workspace.classes.find((item) => item.classKey === classKey)).toMatchObject({ hasDraft: true });
    expect(draft!.versionId).toBe(`${classKey}:v2`);
    expect(draft!.baseVersionId).toBe(`${classKey}:v1`);
    expect(draft!.edit.sections).toHaveLength(5);
    expect(draft!.issues).toEqual([]);
    // Writing a question means writing its answer, so an account holding the role receives all of it.
    for (const problem of draft!.edit.problems) expect(Object.keys(problem).sort())
      .toEqual(['gradingSpec', 'hints', 'problemVersionId', 'promptContent', 'skillKeys', 'solution']);
    // The two fields that follow from the rest are never sent, so they cannot come back disagreeing.
    const serialized = JSON.stringify(draft);
    expect(serialized).not.toContain('responseSpec');
    expect(serialized).not.toContain('hintAvailable');
  });

  it('saves work in progress and reports what still blocks publishing', async () => {
    const admin = await account('admin');
    const created = await service.createDraft(admin.id, classKey);
    const draftId = created.draft!.id;
    const broken = edited(created.draft!.edit, (sections) => {
      sections[0].contentBlocks.push({ ...drawing(`${classKey}:explanation:scene:v2`),
        payload: { alt: '그림', width: 320, height: 200, items: [{ kind: 'strip', x: 20, y: 80, width: 280, height: 40, parts: 4, filled: 9 }] } });
    });
    const saved = await service.saveDraft(admin.id, draftId, broken);
    expect(saved.draft!.issues.join(' ')).toMatch(/filled must not exceed parts/);
    const fixed = edited(created.draft!.edit, (sections) => { sections[0].contentBlocks.push(drawing(`${classKey}:explanation:scene:v2`)); });
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
      sections[0].contentBlocks.push(drawing(`${classKey}:explanation:scene:${versionId.split(':').at(-1)}`));
    }));
    const published = await service.publishDraft(admin.id, draftId);
    expect(published.publishedVersionId).toBe(versionId);
    expect(published.draft!.status).toBe('published');
    const row = await db.classVersion.findUniqueOrThrow({ where: { id: versionId } });
    const document = row.document as unknown as StoredClass;
    expect(document.sections[0].contentBlocks.at(-1)!.kind).toBe('core.scene');
    // The published class carries the halves that follow from the answer, restated when it was saved.
    expect(document.problems[0].responseSpec.kind).toBe(document.problems[0].gradingSpec.kind);
    expect(document.problems[0].hintAvailable).toBe(document.problems[0].hints.length > 0);
    expect(await db.classVersion.findUniqueOrThrow({ where: { id: `${classKey}:v1` } })).toEqual(before);
    await expect(service.saveDraft(admin.id, draftId, created.draft!.edit)).rejects.toThrow(/이미 발행/);
  });

  const rewritten = (edit: DraftEdit, problemVersionId: string, change: (problem: DraftProblem) => void): DraftEdit => {
    const next = structuredClone(edit);
    change(next.problems.find((problem) => problem.problemVersionId === problemVersionId)!);
    return next;
  };
  // Earlier tests in this file publish versions of their own, so a draft's version is never assumed.
  const suffixOf = (versionId: string) => versionId.slice(versionId.lastIndexOf(':') + 1);
  const activityOf = (edit: DraftEdit, problemVersionId: string) => edit.sections.flatMap((section) => section.contentBlocks)
    .find((block) => block.kind === 'core.problem_set' && (block.payload.problemVersionIds as string[]).includes(problemVersionId));

  it('renames a question an edit changed and moves every reference with it', async () => {
    const admin = await account('admin');
    const created = await service.createDraft(admin.id, classKey);
    const draftId = created.draft!.id;
    const answered = `${classKey}:practice-1:v1`;
    const saved = await service.saveDraft(admin.id, draftId, rewritten(created.draft!.edit, answered,
      (problem) => { problem.promptContent[0].payload.text = '고쳐 쓴 문제예요.'; }));
    const renamed = `${classKey}:practice-1:${suffixOf(created.draft!.versionId)}`;
    const names = saved.draft!.edit.problems.map((problem) => problem.problemVersionId);
    expect(names).toContain(renamed);
    expect(names).not.toContain(answered);
    // The activity that held the question now names the new one, and nothing still names the old.
    expect(activityOf(saved.draft!.edit, renamed)).toBeDefined();
    expect(activityOf(saved.draft!.edit, answered)).toBeUndefined();
    // Blocks are named after the question they belong to, so they move to the new name as well.
    const moved = saved.draft!.edit.problems.find((problem) => problem.problemVersionId === renamed)!;
    expect(moved.promptContent[0].blockId.startsWith(`${renamed}:`)).toBe(true);
    expect(saved.draft!.issues).toEqual([]);
    // Saving again renames nothing: the new question is this draft's own until it is published.
    const again = await service.saveDraft(admin.id, draftId, saved.draft!.edit);
    expect(again.draft!.edit.problems.map((problem) => problem.problemVersionId)).toEqual(names);
    await service.deleteDraft(admin.id, draftId);
  });

  it('leaves a question alone when an edit did not touch it', async () => {
    const admin = await account('admin');
    const created = await service.createDraft(admin.id, classKey);
    const before = created.draft!.edit.problems.map((problem) => problem.problemVersionId);
    const saved = await service.saveDraft(admin.id, created.draft!.id, created.draft!.edit);
    expect(saved.draft!.edit.problems.map((problem) => problem.problemVersionId)).toEqual(before);
    expect(saved.draft!.issues).toEqual([]);
    await service.deleteDraft(admin.id, created.draft!.id);
  });

  it('moves a homework reference too, since homework names questions without a block', async () => {
    const admin = await account('admin');
    const created = await service.createDraft(admin.id, classKey);
    const draftId = created.draft!.id;
    const answered = `${classKey}:homework-1:v1`;
    await service.saveDraft(admin.id, draftId, rewritten(created.draft!.edit, answered,
      (problem) => { problem.solution[0].payload.text = '풀이를 다시 썼어요.'; }));
    const row = await db.contentDraft.findUniqueOrThrow({ where: { id: draftId } });
    const document = row.document as unknown as StoredClass;
    expect(document.homeworkProblemIds).toContain(`${classKey}:homework-1:${suffixOf(created.draft!.versionId)}`);
    expect(document.homeworkProblemIds).not.toContain(answered);
    await service.deleteDraft(admin.id, draftId);
  });

  it('publishes an edited question as a new one and leaves the answered one as it was', async () => {
    const admin = await account('admin');
    const created = await service.createDraft(admin.id, classKey);
    const draftId = created.draft!.id;
    const versionId = created.draft!.versionId;
    const answered = `${classKey}:check-1:v1`;
    const before = await db.classVersion.findUniqueOrThrow({ where: { id: `${classKey}:v1` } });
    await service.saveDraft(admin.id, draftId, rewritten(created.draft!.edit, answered, (problem) => {
      problem.promptContent[0].payload.text = '답이 달라진 문제예요.';
      problem.gradingSpec = { kind: 'rational', numerator: 2, denominator: 3 };
    }));
    await service.publishDraft(admin.id, draftId);
    const document = (await db.classVersion.findUniqueOrThrow({ where: { id: versionId } })).document as unknown as StoredClass;
    const written = document.problems.find((problem) => problem.problemVersionId === `${classKey}:check-1:${suffixOf(versionId)}`)!;
    expect(written.gradingSpec).toEqual({ kind: 'rational', numerator: 2, denominator: 3 });
    expect(document.problems.some((problem) => problem.problemVersionId === answered)).toBe(false);
    // The version a learner may be part-way through still holds the question they answered.
    expect(await db.classVersion.findUniqueOrThrow({ where: { id: `${classKey}:v1` } })).toEqual(before);
  });

  it('publishes a question written in the editor as part of the activity that holds it', async () => {
    const admin = await account('admin');
    const created = await service.createDraft(admin.id, classKey);
    const draftId = created.draft!.id;
    const versionId = created.draft!.versionId;
    const edit = structuredClone(created.draft!.edit);
    const written = newProblem(nextProblemVersionId(classKey, 'practice', versionId,
      edit.problems.map((problem) => problem.problemVersionId)), edit.problems[0].skillKeys);
    written.promptContent[0].payload.text = '새로 쓴 문제예요. 답은 3입니다.';
    written.gradingSpec = { kind: 'integer', value: 3 };
    edit.problems.push(written);
    const activity = edit.sections.flatMap((section) => section.contentBlocks)
      .find((block) => block.kind === 'core.problem_set')!;
    (activity.payload.problemVersionIds as string[]).push(written.problemVersionId);
    const saved = await service.saveDraft(admin.id, draftId, edit);
    expect(saved.draft!.issues).toEqual([]);
    expect(saved.draft!.edit.problems.map((problem) => problem.problemVersionId)).toContain(written.problemVersionId);
    await service.publishDraft(admin.id, draftId);
    const document = (await db.classVersion.findUniqueOrThrow({ where: { id: versionId } })).document as unknown as StoredClass;
    const stored = document.problems.find((problem) => problem.problemVersionId === written.problemVersionId)!;
    // A question with no hints says so, and its response format restates the answer that was written.
    expect(stored.hintAvailable).toBe(false);
    expect(stored.responseSpec).toEqual({ kind: 'integer' });
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
