import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { existingRows, removeRowsAddedSince, type Existing } from './cleanup';
import { createDatabase } from '@/server/db';
import { AuthoringService, authoringRole, authoringRoleDetail, openAuthoring, openAuthoringAccount } from '@/server/authoring';
import { classRecord, importContent, termDefinitions } from '@/server/content-store';
import type { StoredClass } from '@/core/content';
import { newProblem, nextProblemVersionId, type DraftEdit, type DraftProblem } from '@/shared/authoring';
import { seedClasses } from './fixtures/content';

const url = process.env.TEST_DATABASE_URL;
describe.skipIf(!url)('content authoring on MySQL', () => {
  let db: ReturnType<typeof createDatabase>;
  let existing: Existing;
  let service: AuthoringService;
  let classKey: string;

  beforeAll(async () => {
    const parsed = new URL(url!);
    if (parsed.protocol !== 'mysql:' || !parsed.pathname.endsWith('_test')) throw new Error('Use an isolated _test database.');
    db = createDatabase(url!);
    existing = await existingRows(db);
    service = new AuthoringService(db);
    // A class of this suite's own, so drafts here never publish a version of a shared fixture.
    classKey = `authoring-${randomUUID()}`;
    const base = JSON.parse(JSON.stringify(seedClasses[0]).replaceAll('fraction-meaning', classKey)) as StoredClass;
    base.public.order = 2000;
    await importContent(db, { schemaVersion: 1, skills: [], classes: [base], diagnostics: [], terms: [] });
  });
  afterAll(async () => {
    // A shared database keeps whatever a run leaves behind, so this run leaves nothing.
    if (existing) await removeRowsAddedSince(db, existing);
    await db?.$disconnect();
  });

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
    expect(await service.workspace(learner.id)).toEqual({ role: null, drafts: [], classes: [], accounts: [], skills: [], expertMode: false });
    await expect(service.createDraft(learner.id, classKey)).rejects.toThrow(/권한/);
  });

  it('remembers how much of the editor an account wants to see, and lets it change nothing else', async () => {
    const author = await account('author');
    expect((await service.workspace(author.id)).expertMode).toBe(false);
    expect((await service.setExpertMode(author.id, true)).workspace.expertMode).toBe(true);
    expect((await service.workspace(author.id)).expertMode).toBe(true);
    // It is a setting, not a permission: writing content is still decided by the role.
    expect((await service.setExpertMode(author.id, true)).workspace.role).toBe('author');
    expect((await service.setExpertMode(author.id, false)).workspace.expertMode).toBe(false);
    const learner = await account();
    await expect(service.setExpertMode(learner.id, true)).rejects.toThrow(/권한/);
  });

  it('judges an answer tried against a draft the way the lesson will, and keeps nothing', async () => {
    const admin = await account('admin');
    const created = await service.createDraft(admin.id, classKey);
    const draftId = created.draft!.id;
    const problem = created.draft!.edit.problems[0];
    const written = problem.gradingSpec.kind === 'integer'
      ? String(problem.gradingSpec.value)
      : `${problem.gradingSpec.numerator}/${problem.gradingSpec.denominator}`;

    const right = await service.tryAnswer(admin.id, draftId, problem.problemVersionId, written, false);
    expect(right.tried).toMatchObject({ status: 'correct', assisted: false });
    const wrong = await service.tryAnswer(admin.id, draftId, problem.problemVersionId, '9999', false);
    expect(wrong.tried!.status).toBe('incorrect');
    // The same grader the learning API uses, so an author reads the words a learner will read.
    const helped = await service.tryAnswer(admin.id, draftId, problem.problemVersionId, written, true);
    expect(helped.tried).toMatchObject({ status: 'correct', assisted: true });
    expect(helped.tried!.message).not.toBe(right.tried!.message);

    const hinted = await service.draftHint(admin.id, draftId, problem.problemVersionId);
    expect(hinted.hint).toEqual(problem.hints);

    // Trying is not learning: no attempt, no hint use, no progress is written for whoever tried.
    expect(await db.attempt.count({ where: { userId: admin.id } })).toBe(0);
    expect(await db.hintUse.count({ where: { userId: admin.id } })).toBe(0);
    expect(await db.enrollment.count({ where: { userId: admin.id } })).toBe(0);

    await expect(service.tryAnswer(admin.id, draftId, 'no-such-problem', written, false)).rejects.toThrow(/문항/);
    // Someone else's draft stays someone else's, however the question is reached.
    const other = await account('author');
    await expect(service.tryAnswer(other.id, draftId, problem.problemVersionId, written, false)).rejects.toThrow(/다른 사람/);
    await service.deleteDraft(admin.id, draftId);
  });

  it('starts a class nobody has published, and refuses a key already spoken for', async () => {
    const admin = await account('admin');
    const key = `fresh-${randomUUID()}`.toLowerCase().slice(0, 40);
    const skillKey = (await classRecord(db, `${classKey}:v1`))!.public.skillKeys[0];
    const created = await service.createClass(admin.id, key, '처음부터 만든 수업', [skillKey]);

    expect(created.draft!.versionId).toBe(`${key}:v1`);
    // Nothing to carry over: there is no earlier version of this class to be the next one of.
    expect(created.draft!.baseVersionId).toBeNull();
    expect(created.draft!.edit.meta.skillKeys).toEqual([skillKey]);
    // It explains and then asks, which is the smallest thing publishing would accept.
    expect(created.draft!.edit.sections.map((section) => section.role)).toEqual(['explanation', 'practice']);
    expect(created.draft!.edit.problems).toHaveLength(1);
    expect(created.draft!.edit.problems[0].skillKeys).toEqual([skillKey]);
    // What it starts as is already a document publishing would take.
    expect(created.draft!.issues).toEqual([]);

    await expect(service.createClass(admin.id, key, '같은 키', [skillKey])).rejects.toThrow(/클래스 키/);
    await expect(service.createClass(admin.id, classKey, '발행된 키', [skillKey])).rejects.toThrow(/클래스 키/);
    await expect(service.createClass(admin.id, `other-${key}`, '없는 개념', ['no-such-skill'])).rejects.toThrow(/개념/);
    await service.deleteDraft(admin.id, created.draft!.id);
  });

  it('carries the concepts a class teaches through an edit, since a question may only claim one', async () => {
    const admin = await account('admin');
    const created = await service.createDraft(admin.id, classKey);
    const draftId = created.draft!.id;
    const before = created.draft!.edit.meta.skillKeys;
    expect(before.length).toBeGreaterThan(0);

    const widened = structuredClone(created.draft!.edit);
    widened.meta.skillKeys = [...before, 'fraction.equivalence'];
    const saved = await service.saveDraft(admin.id, draftId, widened);
    expect(saved.draft!.edit.meta.skillKeys).toEqual(widened.meta.skillKeys);
    expect(saved.draft!.issues).toEqual([]);
    // A class has to teach something, and what the editor may send is where that is enforced.
    const emptied = structuredClone(created.draft!.edit);
    emptied.meta.skillKeys = [];
    await expect(service.act(admin.id, { action: 'draft.save', draftId, edit: emptied })).rejects.toThrow();
    await service.deleteDraft(admin.id, draftId);
  });

  it('lets a writer hand work on without locking it, and lets it be handed back', async () => {
    const author = await account('author');
    const admin = await account('admin');
    const created = await service.createDraft(author.id, classKey);
    const draftId = created.draft!.id;
    expect(created.draft!.status).toBe('draft');

    const asked = await service.setReview(author.id, draftId, true);
    expect(asked.draft!.status).toBe('review');
    // Being asked to look at something is not a reason its author cannot go on fixing it.
    const written = await service.saveDraft(author.id, draftId, edited(created.draft!.edit, (sections) => {
      sections[0].title = '검토 중에도 고친 제목';
    }));
    expect(written.draft!.status).toBe('review');
    expect(written.draft!.edit.sections[0].title).toBe('검토 중에도 고친 제목');
    // An administrator sees it waiting, and may hand it back.
    expect((await service.workspace(admin.id)).drafts.find((item) => item.id === draftId)?.status).toBe('review');
    expect((await service.setReview(admin.id, draftId, false)).draft!.status).toBe('draft');

    const stranger = await account('author');
    await expect(service.setReview(stranger.id, draftId, true)).rejects.toThrow(/다른 사람/);
    await service.deleteDraft(author.id, draftId);
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
    expect(saved.draft!.issues.map((issue) => issue.message).join(' ')).toMatch(/filled must not exceed parts/);
    // A rule says what it refused; the editor is told where, so it can take an author to the block.
    expect(saved.draft!.issues[0]).toMatchObject({
      sectionId: created.draft!.edit.sections[0].sectionId,
      blockId: `${classKey}:explanation:scene:v2`,
    });
    expect(saved.draft!.issues[0].path).toContain('sections.0.contentBlocks.');
    const fixed = edited(created.draft!.edit, (sections) => { sections[0].contentBlocks.push(drawing(`${classKey}:explanation:scene:v2`)); });
    const good = await service.saveDraft(admin.id, draftId, fixed);
    expect(good.draft!.issues).toEqual([]);
    expect((await service.validateDraft(admin.id, draftId)).draft!.issues).toEqual([]);
  });

  it('points a refusal at the question it is about, wherever the rule found it', async () => {
    const admin = await account('admin');
    const created = await service.createDraft(admin.id, classKey);
    const draftId = created.draft!.id;
    const problem = created.draft!.edit.problems[0];

    // A rule with a path into a question reaches the block inside it, and names the field.
    const emptied = structuredClone(created.draft!.edit);
    emptied.problems[0].solution = [{ ...problem.solution[0], payload: { ...problem.solution[0].payload, text: '' } }];
    const blank = await service.saveDraft(admin.id, draftId, emptied);
    // Editing a published question makes a new one, so the names to match are the saved draft's.
    const renamed = blank.draft!.edit.problems[0];
    expect(blank.draft!.issues[0]).toMatchObject({
      problemVersionId: renamed.problemVersionId,
      blockId: renamed.solution[0].blockId,
      field: 'text',
    });
    // The rule is raised at the field it is about, not as a dump of everything the payload failed.
    expect(blank.draft!.issues[0].path).toBe(`problems.0.solution.0.payload.text`);
    expect(blank.draft!.issues[0].message).not.toContain('{');

    // A rule that only names what it refused is placed by that name instead.
    const claimed = structuredClone(blank.draft!.edit);
    claimed.problems[0].skillKeys = ['no-such-skill'];
    const missing = await service.saveDraft(admin.id, draftId, claimed);
    expect(missing.draft!.issues.some((issue) => issue.problemVersionId === missing.draft!.edit.problems[0].problemVersionId)).toBe(true);

    await service.deleteDraft(admin.id, draftId);
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
    const document = await classRecord(db, versionId) as StoredClass;
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
    const document = await classRecord(db, versionId) as StoredClass;
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
    const document = await classRecord(db, versionId) as StoredClass;
    const stored = document.problems.find((problem) => problem.problemVersionId === written.problemVersionId)!;
    // A question with no hints says so, and its response format restates the answer that was written.
    expect(stored.hintAvailable).toBe(false);
    expect(stored.responseSpec).toEqual({ kind: 'integer' });
  });

  it('hands content work to another account without touching the deployment', async () => {
    const admin = await account('admin');
    const learner = await account();
    expect(await authoringRole(db, learner.id)).toBeNull();
    const granted = await service.grantRole(admin.id, learner.id, 'author');
    expect(await authoringRole(db, learner.id)).toBe('author');
    expect(granted.workspace.accounts.find((item) => item.userId === learner.id))
      .toMatchObject({ role: 'author', source: 'granted', me: false });
    // The account can now open the editor, and sees only what an author may see.
    expect((await service.workspace(learner.id)).role).toBe('author');
    expect((await service.workspace(learner.id)).accounts).toEqual([]);
    // Raising and lowering a role is the same write, so a mistake is corrected in place.
    await service.grantRole(admin.id, learner.id, 'admin');
    expect(await authoringRole(db, learner.id)).toBe('admin');
    await service.revokeRole(admin.id, learner.id);
    expect(await authoringRole(db, learner.id)).toBeNull();
  });

  it('refuses to hand out or take back work without the role to do it', async () => {
    const author = await account('author');
    const admin = await account('admin');
    const learner = await account();
    await expect(service.grantRole(author.id, learner.id, 'author')).rejects.toThrow(/관리자만/);
    await expect(service.grantRole(learner.id, learner.id, 'admin')).rejects.toThrow(/권한/);
    await expect(service.grantRole(admin.id, 'no-such-account', 'author')).rejects.toThrow(/찾을 수 없어요/);
    // The shared account exists because nobody was signed in; there is no person to hand work to.
    await openAuthoringAccount(db);
    await expect(service.grantRole(admin.id, 'open-authoring', 'admin')).rejects.toThrow(/공용 편집 계정/);
    await expect(service.revokeRole(admin.id, learner.id)).rejects.toThrow(/거둘 역할이 없어요/);
  });

  it('keeps someone able to publish: no removing your own role, and never the last granted administrator', async () => {
    const admin = await account('admin');
    // An administrator never stands themselves down, so the list can never empty by revoking alone.
    await expect(service.revokeRole(admin.id, admin.id)).rejects.toThrow(/자기 관리자 역할/);

    // The last granted administrator is the one that survives a deployment change, so an
    // environment-named administrator is not allowed to take it away either.
    const named = await account();
    const subject = `google-${randomUUID()}`;
    await db.googleIdentity.create({ data: { subject, userId: named.id } });
    const others = await db.contentAuthor.findMany({ where: { role: 'admin', userId: { not: admin.id } } });
    await db.contentAuthor.updateMany({ where: { userId: { in: others.map((row) => row.userId) } }, data: { role: 'author' } });
    process.env.CONTENT_ADMIN_SUBJECTS = subject;
    try {
      await expect(service.revokeRole(named.id, admin.id)).rejects.toThrow(/마지막 관리자/);
      // Lowering the last administrator to author is the same loss, so it meets the same guard.
      await expect(service.grantRole(named.id, admin.id, 'author')).rejects.toThrow(/마지막 관리자/);
      await expect(service.grantRole(admin.id, admin.id, 'author')).rejects.toThrow(/자기 관리자 역할/);
      // Raising your own role is not a loss, so it is allowed and changes nothing here.
      await service.grantRole(admin.id, admin.id, 'admin');
      expect(await authoringRole(db, admin.id)).toBe('admin');
      // With a second granted administrator standing, the first may be stood down.
      const deputy = await account('admin');
      await service.revokeRole(named.id, admin.id);
      expect(await authoringRole(db, admin.id)).toBeNull();
      expect(await authoringRole(db, deputy.id)).toBe('admin');
    } finally {
      delete process.env.CONTENT_ADMIN_SUBJECTS;
      for (const row of others) await db.contentAuthor.update({ where: { userId: row.userId }, data: { role: row.role } });
    }
  });

  it('shows an environment-named administrator as one the screen cannot take back', async () => {
    const admin = await account('admin');
    const named = await account();
    const subject = `google-${randomUUID()}`;
    await db.googleIdentity.create({ data: { subject, userId: named.id } });
    process.env.CONTENT_ADMIN_SUBJECTS = subject;
    try {
      expect(await authoringRoleDetail(db, named.id)).toEqual({ role: 'admin', source: 'environment' });
      const listed = (await service.workspace(admin.id)).accounts.find((item) => item.userId === named.id);
      expect(listed).toMatchObject({ role: 'admin', source: 'environment', grantedAt: null });
      // There is no row behind it, so the screen has nothing to delete and says so.
      await expect(service.revokeRole(admin.id, named.id)).rejects.toThrow(/거둘 역할이 없어요/);
    } finally { delete process.env.CONTENT_ADMIN_SUBJECTS; }
  });

  it('finds an account by the name an administrator would know it by', async () => {
    const admin = await account('admin');
    const learner = await db.user.create({ data: { displayName: `찾기 ${randomUUID()}`, scopes: { create: { kind: 'personal' } } } });
    await openAuthoringAccount(db);
    const { matches } = await service.searchAccounts(admin.id, learner.displayName.slice(0, 12));
    expect(matches!.map((item) => item.userId)).toContain(learner.id);
    expect(matches!.find((item) => item.userId === learner.id)).toMatchObject({ role: null, source: 'none' });
    // The shared editing account is never a search result, since it is not a person.
    expect((await service.searchAccounts(admin.id, '열린 편집')).matches).toEqual([]);
    await expect(service.searchAccounts(learner.id, '찾기')).rejects.toThrow(/권한/);
  });

  it('writes a definition the class keeps, and rewrites it as the next version', async () => {
    const admin = await account('admin');
    const termKey = `term.class.${randomUUID()}`;
    const skillKey = (await classRecord(db, `${classKey}:v1`))!.public.skillKeys[0];
    const published = await service.saveTerm(admin.id, { termKey, scopeKind: 'class', scopeKey: classKey, skillKey,
      label: '이 수업의 용어', summary: '이 수업에서만 쓰는 풀이예요.',
      blocks: [{ blockId: 'term:block:1', kind: 'core.rich_text', typeVersion: 1, required: true, payload: { text: '뜻을 풀어 썼어요.' } }] });
    expect(published.publishedTermVersionId).toBe(`${classKey}:${termKey}:v1`);
    // Blocks are named after the version that holds them, so the editor never chose the ID.
    const row = await db.termVersion.findUniqueOrThrow({ where: { id: `${classKey}:${termKey}:v1` } });
    expect((await termDefinitions(db, [row]))[0].blocks[0].blockId).toBe(`${classKey}:${termKey}:v1:b1`);
    expect(row.scopeKind).toBe('class');
    expect(row.scopeKey).toBe(classKey);

    const listed = published.terms!.find(term => term.termKey === termKey)!;
    expect(listed).toMatchObject({ label: '이 수업의 용어', versionId: `${classKey}:${termKey}:v1` });
    // Saving again publishes the next version and the list shows the new one. This goes through the
    // action the screen posts, so the shape the editor sends is the shape the server accepts.
    const again = await service.act(admin.id, { action: 'term.save', edit: {
      termKey: listed.termKey, scopeKind: listed.scopeKind, scopeKey: listed.scopeKey, skillKey: listed.skillKey,
      label: listed.label, summary: '설명을 고쳐 썼어요.', blocks: listed.blocks } });
    expect(again.publishedTermVersionId).toBe(`${classKey}:${termKey}:v2`);
    expect(again.terms!.find(term => term.termKey === termKey)!.summary).toBe('설명을 고쳐 썼어요.');
    // The earlier version stays where it was; nothing is rewritten in place.
    expect((await db.termVersion.findUniqueOrThrow({ where: { id: `${classKey}:${termKey}:v1` } })).summary)
      .toBe('이 수업에서만 쓰는 풀이예요.');
  });

  it('keeps the shared dictionary to administrators and asks a class term which class it belongs to', async () => {
    const admin = await account('admin');
    const author = await account('author');
    const learner = await account();
    const termKey = `term.scope.${randomUUID()}`;
    const skillKey = (await classRecord(db, `${classKey}:v1`))!.public.skillKeys[0];
    const edit = { termKey, scopeKind: 'global' as const, scopeKey: '', skillKey, label: '사전 용어', summary: '사전이 쓴 풀이예요.',
      blocks: [{ blockId: 'term:block:1', kind: 'core.rich_text', typeVersion: 1, required: true, payload: { text: '사전 정의' } }] };
    await expect(service.saveTerm(author.id, edit)).rejects.toThrow(/공통 사전은 관리자만/);
    await expect(service.listTerms(learner.id, 'global', '')).rejects.toThrow(/권한/);
    // A class term is part of writing that class, so an author may write one.
    await expect(service.saveTerm(author.id, { ...edit, scopeKind: 'class', scopeKey: classKey })).resolves.toBeTruthy();

    await expect(service.saveTerm(admin.id, { ...edit, scopeKey: classKey })).rejects.toThrow(/소속을 적지 않아요/);
    await expect(service.saveTerm(admin.id, { ...edit, scopeKind: 'class', scopeKey: '' })).rejects.toThrow(/어느 클래스의 용어인지/);
    await expect(service.saveTerm(admin.id, { ...edit, scopeKind: 'class', scopeKey: 'no-such-class' })).rejects.toThrow(/발행된 적 없는/);
    // The dictionary and the class keep their own lists, even for the same key.
    await service.saveTerm(admin.id, edit);
    expect((await service.listTerms(admin.id, 'global', '')).terms!.some(term => term.termKey === termKey)).toBe(true);
    const mine = (await service.listTerms(admin.id, 'class', classKey)).terms!.find(term => term.termKey === termKey)!;
    expect(mine.versionId).toBe(`${classKey}:${termKey}:v1`);
  });

  it('refuses a definition the publishing rules would not accept', async () => {
    const admin = await account('admin');
    const termKey = `term.bad.${randomUUID()}`;
    const base = { termKey, scopeKind: 'class' as const, scopeKey: classKey, label: '나쁜 용어', summary: '설명이에요.',
      blocks: [{ blockId: 'term:block:1', kind: 'core.rich_text', typeVersion: 1, required: true, payload: { text: '정의' } }] };
    await expect(service.saveTerm(admin.id, { ...base, skillKey: 'no.such.skill' })).rejects.toThrow(/Missing skill/);
    expect(await db.termVersion.findUnique({ where: { id: `${classKey}:${termKey}:v1` } })).toBeNull();
  });

  it('offers a draft the terms it may link, and no others', async () => {
    const admin = await account('admin');
    const suffix = randomUUID();
    const skillKey = (await classRecord(db, `${classKey}:v1`))!.public.skillKeys[0];
    const define = (termKey: string, scopeKind: 'global' | 'class', scopeKey: string, label: string) =>
      service.saveTerm(admin.id, { termKey, scopeKind, scopeKey, skillKey, label, summary: `${label} 풀이예요.`,
        blocks: [{ blockId: 'term:block:1', kind: 'core.rich_text', typeVersion: 1, required: true, payload: { text: label } }] });
    await define(`term.shared.${suffix}`, 'global', '', '사전 낱말');
    await define(`term.mine.${suffix}`, 'class', classKey, '이 수업 낱말');
    // Another class keeps one of its own; this draft must not be offered it.
    const other = `other-${randomUUID()}`;
    const record = JSON.parse(JSON.stringify(seedClasses[0]).replaceAll('fraction-meaning', other)) as StoredClass;
    record.public.order = 3000;
    await importContent(db, { schemaVersion: 1, skills: [], classes: [record], diagnostics: [], terms: [] });
    await define(`term.other.${suffix}`, 'class', other, '남의 수업 낱말');

    const { draft } = await service.createDraft(admin.id, classKey);
    const offered = draft!.terms.map(term => term.termKey);
    expect(offered).toContain(`term.shared.${suffix}`);
    expect(offered).toContain(`term.mine.${suffix}`);
    expect(offered).not.toContain(`term.other.${suffix}`);
    expect(draft!.terms.find(term => term.termKey === `term.mine.${suffix}`))
      .toMatchObject({ scopeKind: 'class', scopeKey: classKey, label: '이 수업 낱말' });
    await service.deleteDraft(admin.id, draft!.id);
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
