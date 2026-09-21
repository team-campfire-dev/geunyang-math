import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { existingRows, removeRowsAddedSince, type Existing } from './cleanup';
import { createDatabase } from '@/server/db';
import { AuthoringService, authoringRole, authoringRoleDetail, openAuthoring, openAuthoringAccount } from '@/server/authoring';
import { lessonRecord, importContent, definitionRecords, problemSetRecords } from '@/server/content-store';
import type { LessonRecord, StoredLesson } from '@/core/content';
import { newProblem, nextProblemVersionId, type DraftEdit, type DraftProblem } from '@/shared/authoring';
import { lessonBundle, seedLessons, writtenAnswer } from './fixtures/content';

const url = process.env.TEST_DATABASE_URL;
describe.skipIf(!url)('content authoring on MySQL', () => {
  let db: ReturnType<typeof createDatabase>;
  let existing: Existing;
  let service: AuthoringService;
  let lessonKey: string;

  beforeAll(async () => {
    const parsed = new URL(url!);
    if (parsed.protocol !== 'mysql:' || !parsed.pathname.endsWith('_test')) throw new Error('Use an isolated _test database.');
    db = createDatabase(url!);
    existing = await existingRows(db);
    service = new AuthoringService(db);
    // A lesson of this suite's own, so drafts here never publish a version of a shared fixture.
    lessonKey = `authoring-${randomUUID()}`;
    const base = JSON.parse(JSON.stringify(seedLessons[0]).replaceAll('fraction-meaning', lessonKey)) as LessonRecord;

    await importContent(db, lessonBundle([base], { key: `course-${base.public.lessonKey}`, title: '검사 코스' }));
  });
  afterAll(async () => {
    // A shared database keeps whatever a run leaves behind, so this run leaves nothing.
    if (existing) await removeRowsAddedSince(db, existing);
    await db?.$disconnect();
  });

  const account = async (role?: 'admin' | 'author') => {
    const user = await db.user.create({ data: { displayName: `author ${randomUUID()}`, learningScopes: { create: { kind: 'personal' } } } });
    if (role) await db.contentAuthor.create({ data: { userId: user.id, role } });
    return user;
  };
  const edited = (edit: DraftEdit, change: (sections: DraftEdit['sections']) => void): DraftEdit => {
    const next = structuredClone(edit);
    change(next.sections);
    return next;
  };
  /** A lesson of this test's own, so publishing a version of it disturbs nobody else's counting. */
  const ownLesson = async (courseKey?: string) => {
    const key = `authoring-${randomUUID()}`;
    const base = JSON.parse(JSON.stringify(seedLessons[0]).replaceAll('fraction-meaning', key)) as LessonRecord;
    // A set belongs to one course, so two lessons can only share one when they are in the same course.
    await importContent(db, lessonBundle([base], { key: courseKey ?? `course-${key}`, title: '검사 코스' }));
    return key;
  };
  const drawing = (blockId: string) => ({
    blockId, kind: 'core.scene', typeVersion: 1, required: true,
    payload: { alt: '4등분한 막대 중 세 칸을 채운 그림', width: 320, height: 200,
      items: [{ kind: 'strip', x: 20, y: 80, width: 280, height: 40, parts: 4, filled: 3 }] },
  });

  it('adds up the wrong answers learners really wrote, by value and with nobody named', async () => {
    const author = await account('author');
    const record = (await lessonRecord(db, `${lessonKey}:v3`)) ?? (await lessonRecord(db, `${lessonKey}:v1`))!;
    const problemVersionId = record.problems[0].problemVersionId;
    const write = async (answer: string, status: 'incorrect' | 'correct' | 'invalid') => {
      const learner = await account();
      const scope = await db.learningScope.findFirstOrThrow({ where: { ownerUserId: learner.id } });
      await db.attempt.create({ data: { userId: learner.id, scopeId: scope.id, problemVersionId, answer,
        result: { status, message: '', assisted: false }, requestId: randomUUID() } });
      return learner;
    };
    // The same mistake in three spellings, from three people.
    await write('2/8', 'incorrect');
    await write('0.25', 'incorrect');
    await write('1/4', 'incorrect');
    // One person writing the same thing twice is one person, not two.
    const twice = await write('9', 'incorrect');
    const scope = await db.learningScope.findFirstOrThrow({ where: { ownerUserId: twice.id } });
    await db.attempt.create({ data: { userId: twice.id, scopeId: scope.id, problemVersionId, answer: '9',
      result: { status: 'incorrect', message: '', assisted: false }, requestId: randomUUID() } });
    // A right answer is not a wrong answer, and a typo is not an answer at all.
    await write('8', 'correct');
    await write('사분의 삼', 'invalid');

    const { wrongAnswers } = await service.act(author.id, { action: 'problem.wrongAnswers', problemVersionId });
    expect(wrongAnswers).toBeDefined();
    expect(wrongAnswers!.map((row) => [row.count, row.learners])).toEqual([[3, 3], [2, 1]]);
    // The spelling shown is one people actually used, and the three spellings are one row.
    expect(['2/8', '0.25', '1/4']).toContain(wrongAnswers![0].answer);
    expect(wrongAnswers![1].answer).toBe('9');
    expect(JSON.stringify(wrongAnswers)).not.toContain(twice.id);
    // Reading what learners wrote is content work: a learner asking gets nothing.
    await expect(service.act((await account()).id, { action: 'problem.wrongAnswers', problemVersionId })).rejects.toMatchObject({ status: 403 });
  });

  it('reads a published version without creating drafts and still requires an author role', async () => {
    const author = await account('author'); const learner = await account();
    const before = await db.contentDraft.count();
    await expect(service.act(learner.id, { action: 'lesson.read', versionId: `${lessonKey}:v1` })).rejects.toThrow(/권한/);
    const response = await service.act(author.id, { action: 'lesson.read', versionId: `${lessonKey}:v1` });
    expect(response.draft).toMatchObject({ status: 'published', versionId: `${lessonKey}:v1` });
    expect(response.draft!.edit.problems.length).toBeGreaterThan(0);
    expect(await db.contentDraft.count()).toBe(before);
    expect(response.workspace.lessons.find(l => l.lessonKey === lessonKey)!.conceptKeys!.length).toBeGreaterThan(0);
  });

  it('saves temporarily blank metadata without allowing it to publish', async () => {
    const admin = await account('admin');
    const draft = (await service.createDraft(admin.id, lessonKey)).draft!;
    const edit = structuredClone(draft.edit);
    edit.meta.title = ''; edit.meta.summary = ''; edit.meta.conceptKeys = []; edit.sections[0].title = '';
    const saved = await service.act(admin.id, {action:'draft.save',draftId:draft.id,edit});
    expect(saved.draft!.edit.meta.title).toBe('');
    expect(saved.draft!.issues.length).toBeGreaterThan(0);
    await expect(service.publishDraft(admin.id,draft.id)).rejects.toThrow(/고칠 곳/);
    await service.deleteDraft(admin.id,draft.id);
  });

  it('manages course information and complete lesson order only as an administrator', async () => {
    const admin = await account('admin');
    const author = await account('author');
    const key = `ui-course-${randomUUID()}`;
    await expect(service.act(author.id, { action: 'course.save', key, title: '새 코스', summary: '', creating: true })).rejects.toThrow(/관리자/);
    await service.act(admin.id, { action: 'course.save', key, title: '새 코스', summary: '차근차근', creating: true });
    await expect(service.act(admin.id, { action: 'course.save', key, title: '중복', summary: '', creating: true })).rejects.toThrow(/이미/);
    const concept = (await service.workspace(admin.id)).concepts.find((item) => item.assessable)!;
    const first = await service.createLesson(author.id, key, `first-${randomUUID()}`, '첫 수업', [concept.key]);
    const second = await service.createLesson(author.id, key, `second-${randomUUID()}`, '둘째 수업', [concept.key]);
    const keys = [second.draft!.lessonKey, first.draft!.lessonKey];
    expect((await service.workspace(author.id)).lessons.find((item) => item.lessonKey === keys[0]))
      .toMatchObject({ courseKey: key, latestVersionId: null, hasDraft: true, title: '둘째 수업' });
    await expect(service.act(author.id, { action: 'course.reorder', courseKey: key, lessonKeys: keys })).rejects.toThrow(/관리자/);
    await service.act(admin.id, { action: 'course.reorder', courseKey: key, lessonKeys: keys });
    expect((await service.workspace(admin.id)).lessons.filter((item) => item.courseKey === key).map((item) => item.lessonKey)).toEqual(keys);
    for (const invalid of [[keys[0]], [keys[0], keys[0]], [keys[0], lessonKey]]) {
      await expect(service.act(admin.id, { action: 'course.reorder', courseKey: key, lessonKeys: invalid })).rejects.toThrow(/목록/);
    }
    await service.act(admin.id, { action: 'course.save', key, title: '수정한 코스', summary: '새 소개', creating: false });
    expect((await service.workspace(admin.id)).courses.find((item) => item.key === key)).toMatchObject({ title: '수정한 코스', summary: '새 소개' });
  });

  it('lets administrators add an assessable concept without changing existing concepts', async () => {
    const admin = await account('admin');
    const author = await account('author');
    const key = `concept-${randomUUID()}`;
    await expect(service.act(author.id, { action: 'concept.create', key, label: '새 학습 개념' })).rejects.toThrow(/관리자/);
    const response = await service.act(admin.id, { action: 'concept.create', key, label: '새 학습 개념' });
    expect(response.workspace.concepts.find((item) => item.key === key)).toMatchObject({ label: '새 학습 개념', assessable: true });
    await expect(service.act(admin.id, { action: 'concept.create', key, label: '덮어쓰기' })).rejects.toThrow(/이미/);
  });

  it('saves prerequisites and follows the selected activity through review publication and edits', async () => {
    const admin = await account('admin');
    const workspace = await service.workspace(admin.id);
    const concepts = workspace.concepts.filter((item) => item.assessable);
    const courseKey = workspace.lessons.find((item) => item.lessonKey === lessonKey)!.courseKey;
    const made = await service.createLesson(admin.id, courseKey, `review-ui-${randomUUID()}`, '복습 설정 검사', [concepts[0].key]);
    const draft = made.draft!;
    const activity = draft.edit.sections[1].contentBlocks[0];
    const edit = { ...draft.edit, meta: { ...draft.edit.meta, prerequisiteConceptKeys: [concepts[1].key] }, reviewBlockId: activity.blockId };
    const saved = await service.act(admin.id, { action: 'draft.save', draftId: draft.id, edit });
    expect(saved.draft!.review).toMatchObject({ problemVersionIds: [edit.problems[0].problemVersionId] });
    expect(saved.draft!.edit.reviewBlockId).toBe(activity.blockId);
    const completed = structuredClone(saved.draft!.edit);
    completed.meta.summary = '수업 소개'; completed.sections[0].title = '개념 살펴보기'; completed.sections[0].contentBlocks[0].payload.text = '설명 본문'; completed.problems[0].promptContent[0].payload.text = '0을 입력해 주세요.';
    await service.saveDraft(admin.id, draft.id, completed);
    await service.publishDraft(admin.id, draft.id);
    const published = await lessonRecord(db, draft.versionId);
    expect(published!.public.prerequisiteConceptKeys).toEqual([concepts[1].key]);
    const next = (await service.createDraft(admin.id, draft.lessonKey)).draft!;
    const changed = structuredClone(next.edit);
    changed.problems[0].gradingSpec = { kind: 'integer', value: 7 };
    const rewritten = (await service.saveDraft(admin.id, next.id, changed)).draft!;
    expect(rewritten.review!.problemVersionIds).toEqual([rewritten.edit.problems[0].problemVersionId]);
    expect(rewritten.edit.problems[0].problemVersionId).not.toBe(edit.problems[0].problemVersionId);
    const original = await lessonRecord(db, draft.versionId);
    expect(original!.review!.problemVersionIds).toEqual([edit.problems[0].problemVersionId]);
    const disabled = (await service.saveDraft(admin.id, next.id, { ...rewritten.edit, reviewBlockId: null })).draft!;
    expect(disabled.review).toBeNull();
    await expect(service.saveDraft(admin.id, next.id, { ...disabled.edit, reviewBlockId: 'missing-block' })).rejects.toThrow(/다시 골라/);
    expect((await service.draft(admin.id, next.id)).review).toBeNull();
  });

  it('provides draft glossary bodies, including definitions on an unpublished lesson', async () => {
    const admin = await account('admin');
    const workspace = await service.workspace(admin.id);
    const courseKey = workspace.lessons.find((item) => item.lessonKey === lessonKey)!.courseKey;
    const concept = workspace.concepts.find((item) => item.assessable)!;
    const draft = (await service.createLesson(admin.id, courseKey, `glossary-ui-${randomUUID()}`, '뜻풀이 검사', [concept.key])).draft!;
    await service.saveDefinition(admin.id, { conceptKey: concept.key, scopeKind: 'lesson', scopeKey: draft.lessonKey,
      label: '수업에서 부르는 이름', summary: '한 줄 설명', blocks: [{ blockId: 'definition:body', kind: 'core.rich_text', typeVersion: 1, required: true, payload: { text: '실제로 펼치는 설명' } }] });
    const opened = await service.draft(admin.id, draft.id);
    expect(opened.glossary.find((item) => item.scopeKey === draft.lessonKey)).toMatchObject({
      label: '수업에서 부르는 이름', summary: '한 줄 설명', blocks: [{ payload: { text: '실제로 펼치는 설명' } }],
    });
  });

  it('grants content work by role, and treats an account without one as a learner', async () => {
    const learner = await account();
    const author = await account('author');
    const admin = await account('admin');
    expect(await authoringRole(db, learner.id)).toBeNull();
    expect(await authoringRole(db, author.id)).toBe('author');
    expect(await authoringRole(db, admin.id)).toBe('admin');
    expect(await service.workspace(learner.id)).toEqual({ role: null, drafts: [], courses: [], lessons: [], accounts: [], concepts: [], problemSets: [], diagnostics: [], expertMode: false });
    await expect(service.createDraft(learner.id, lessonKey)).rejects.toThrow(/권한/);
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
    const created = await service.createDraft(admin.id, lessonKey);
    const draftId = created.draft!.id;
    const problem = created.draft!.edit.problems[0];
    const written = writtenAnswer(problem);

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

  it('starts a lesson nobody has published, and refuses a key already spoken for', async () => {
    const admin = await account('admin');
    const key = `fresh-${randomUUID()}`.toLowerCase().slice(0, 40);
    const conceptKey = (await lessonRecord(db, `${lessonKey}:v1`))!.public.conceptKeys[0];
    const created = await service.createLesson(admin.id, 'fractions', key, '처음부터 만든 수업', [conceptKey]);

    expect(created.draft!.versionId).toBe(`${key}:v1`);
    // Nothing to carry over: there is no earlier version of this lesson to be the next one of.
    expect(created.draft!.baseVersionId).toBeNull();
    expect(created.draft!.edit.meta.conceptKeys).toEqual([conceptKey]);
    // It explains and then asks, which is the smallest thing publishing would accept.
    expect(created.draft!.edit.sections.map((section) => section.role)).toEqual(['explanation', 'practice']);
    expect(created.draft!.edit.problems).toHaveLength(1);
    expect(created.draft!.edit.problems[0].conceptKeys).toEqual([conceptKey]);
    // A starter is saved, but instructional copy must never be published by accident.
    expect(created.draft!.issues.length).toBeGreaterThan(0);
    await expect(service.publishDraft(admin.id, created.draft!.id)).rejects.toThrow(/고칠 곳/);

    await expect(service.createLesson(admin.id, 'fractions', key, '같은 키', [conceptKey])).rejects.toThrow(/수업 키/);
    await expect(service.createLesson(admin.id, 'fractions', lessonKey, '발행된 키', [conceptKey])).rejects.toThrow(/수업 키/);
    await expect(service.createLesson(admin.id, 'fractions', `other-${key}`, '없는 개념', ['no-such-concept'])).rejects.toThrow(/개념/);
    await service.deleteDraft(admin.id, created.draft!.id);
  });

  it('carries the concepts a lesson teaches through an edit, since a question may only claim one', async () => {
    const admin = await account('admin');
    const created = await service.createDraft(admin.id, lessonKey);
    const draftId = created.draft!.id;
    const before = created.draft!.edit.meta.conceptKeys;
    expect(before.length).toBeGreaterThan(0);

    const widened = structuredClone(created.draft!.edit);
    widened.meta.conceptKeys = [...before, 'fraction.equivalence'];
    const saved = await service.saveDraft(admin.id, draftId, widened);
    expect(saved.draft!.edit.meta.conceptKeys).toEqual(widened.meta.conceptKeys);
    expect(saved.draft!.issues).toEqual([]);
    // Classification may be unfinished in a saved draft; publication is still blocked.
    const emptied = structuredClone(created.draft!.edit);
    emptied.meta.conceptKeys = [];
    const incomplete = await service.act(admin.id, { action: 'draft.save', draftId, edit: emptied });
    expect(incomplete.draft!.edit.meta.conceptKeys).toEqual([]);
    expect(incomplete.draft!.issues.length).toBeGreaterThan(0);
    await expect(service.publishDraft(admin.id, draftId)).rejects.toThrow(/고칠 곳/);
    await service.deleteDraft(admin.id, draftId);
  });

  it('hands the editor the review pool\u2019s own questions, which no section shows', async () => {
    const admin = await account('admin');
    const created = await service.createDraft(admin.id, lessonKey);
    const review = created.draft!.review!;
    expect(review.problemVersionIds.length).toBeGreaterThan(0);
    // The pool names them, the draft carries them, and no activity in the lesson shows them.
    expect(created.draft!.edit.reviewProblemIds).toEqual(review.problemVersionIds);
    expect(created.draft!.edit.reviewBlockId).toBeUndefined();
    for (const id of review.problemVersionIds) {
      expect(created.draft!.edit.problems.some((problem) => problem.problemVersionId === id), id).toBe(true);
      expect(created.draft!.edit.sections.some((section) => section.contentBlocks.some((block) =>
        Array.isArray(block.payload.problemVersionIds) && (block.payload.problemVersionIds as string[]).includes(id))), id).toBe(false);
    }
    await service.deleteDraft(admin.id, created.draft!.id);
  });

  it('publishes an edited review question as a new one, into the pool\u2019s next version', async () => {
    const admin = await account('admin');
    const created = await service.createDraft(admin.id, await ownLesson());
    const draftId = created.draft!.id;
    const before = created.draft!.review!;
    const [first] = before.problemVersionIds;

    const edited = structuredClone(created.draft!.edit);
    const target = edited.problems.find((problem) => problem.problemVersionId === first)!;
    target.promptContent = [{ ...target.promptContent[0], payload: { ...target.promptContent[0].payload, text: '복습 문항을 여기에서 고쳤어요.' } }];
    const saved = await service.saveDraft(admin.id, draftId, edited);
    // A published question is immutable, so the edited one is published under a new name and the
    // pool follows it. Its own `reviewProblemIds` must name the new one, not the one it replaced.
    const renamed = saved.draft!.edit.reviewProblemIds!;
    expect(renamed).toHaveLength(before.problemVersionIds.length);
    expect(renamed[0]).not.toBe(first);
    expect(saved.draft!.issues).toEqual([]);

    const published = await service.publishDraft(admin.id, draftId);
    const lesson = (await lessonRecord(db, published.draft!.versionId))!;
    expect(lesson.review!.problemSetId).toBe(before.problemSetId);
    expect(lesson.review!.problemSetVersionId).not.toBe(before.problemSetVersionId);
    expect(lesson.review!.problemVersionIds).toEqual(renamed);
    const set = (await problemSetRecords(db, [lesson.review!.problemSetVersionId])).get(lesson.review!.problemSetVersionId)!;
    const written = set.problems.find((problem) => problem.problemVersionId === renamed[0])!;
    expect(JSON.stringify(written.promptContent)).toContain('여기에서 고쳤어요');
    // The version it replaced is untouched, and so is the question a learner may already have answered.
    const old = (await problemSetRecords(db, [before.problemSetVersionId])).get(before.problemSetVersionId)!;
    expect(old.problems.map((problem) => problem.problemVersionId)).toEqual(before.problemVersionIds);
  });

  it('names a problem set without publishing anything, and says which lessons hold it', async () => {
    const admin = await account('admin');
    const author = await account('author');
    const key = await ownLesson();
    const before = await db.problemSetVersion.count();

    const opened = await service.createDraft(admin.id, key);
    const setId = String(opened.draft!.edit.sections.flatMap((section) => section.contentBlocks)
      .find((block) => block.kind === 'core.problem_set')!.payload.problemSetId);
    // Only a publisher names a set: the name is what makes it something other lessons take up.
    await expect(service.act(author.id, { action: 'problemSet.name', problemSetId: setId, name: '가져다 쓸 묶음' })).rejects.toMatchObject({ status: 403 });

    const named = await service.act(admin.id, { action: 'problemSet.name', problemSetId: setId, name: '가져다 쓸 묶음' });
    const listed = named.workspace.problemSets.find((set) => set.problemSetId === setId)!;
    expect(listed.name).toBe('가져다 쓸 묶음');
    expect(listed.lessonKeys).toEqual([key]);
    // A name is the set's, not a version's, so nothing was published to carry it.
    expect(await db.problemSetVersion.count()).toBe(before);
    await service.deleteDraft(admin.id, opened.draft!.id);
  });

  it('takes the lessons that share a set along when the set changes', async () => {
    const admin = await account('admin');
    const together = `course-${randomUUID()}`;
    const first = await ownLesson(together);
    const second = await ownLesson(together);

    // The second lesson takes up the first one's activity set, so two lessons now hold it.
    const opened = await service.createDraft(admin.id, second);
    const mine = opened.draft!.edit.sections.flatMap((section) => section.contentBlocks).find((block) => block.kind === 'core.problem_set')!;
    const theirs = (await lessonRecord(db, `${first}:v1`))!.sections.flatMap((section) => section.contentBlocks)
      .find((block) => block.kind === 'core.problem_set')!.payload as { problemSetId: string; problemSetVersionId: string; problemVersionIds: string[] };
    const taken = (await service.act(admin.id, { action: 'problemSet.read', versionId: theirs.problemSetVersionId })).problemSet!;

    const sharing = structuredClone(opened.draft!.edit);
    sharing.sections = sharing.sections.map((section) => ({ ...section, contentBlocks: section.contentBlocks.map((block) =>
      (block.blockId === mine.blockId ? { ...block, payload: { problemSetId: taken.problemSetId, problemSetVersionId: taken.versionId,
        problemVersionIds: taken.problems.map((problem) => problem.problemVersionId) } } : block)) }));
    sharing.problems = [...sharing.problems.filter((problem) => !(mine.payload.problemVersionIds as string[]).includes(problem.problemVersionId)), ...taken.problems];
    await service.saveDraft(admin.id, opened.draft!.id, sharing);
    const shared = await service.publishDraft(admin.id, opened.draft!.id);
    expect(shared.carriedLessons).toBeUndefined();
    expect((await service.workspace(admin.id)).problemSets.find((set) => set.problemSetId === taken.problemSetId)!.lessonKeys.sort())
      .toEqual([first, second].sort());

    // Now editing it from the second lesson has to move the first one too, or the set's newest
    // version would be what only one of its two holders uses.
    const again = await service.createDraft(admin.id, second);
    const changed = structuredClone(again.draft!.edit);
    const target = changed.problems.find((problem) => problem.problemVersionId === taken.problems[0].problemVersionId)!;
    target.gradingSpec = { kind: 'integer', value: 4242 };
    await service.saveDraft(admin.id, again.draft!.id, changed);
    const published = await service.publishDraft(admin.id, again.draft!.id);
    expect(published.carriedLessons!.map((lesson) => lesson.lessonKey)).toEqual([first]);

    const moved = (await lessonRecord(db, published.carriedLessons![0].versionId))!;
    const nowAt = moved.sections.flatMap((section) => section.contentBlocks)
      .find((block) => block.kind === 'core.problem_set')!.payload as { problemSetVersionId: string };
    expect(nowAt.problemSetVersionId).not.toBe(theirs.problemSetVersionId);
    const set = (await problemSetRecords(db, [nowAt.problemSetVersionId])).get(nowAt.problemSetVersionId)!;
    expect(set.problems.some((problem) => JSON.stringify(problem.gradingSpec).includes('4242'))).toBe(true);
    // The version the first lesson used to name is untouched, and so is that lesson's old version.
    const old = (await problemSetRecords(db, [theirs.problemSetVersionId])).get(theirs.problemSetVersionId)!;
    expect(JSON.stringify(old.problems)).not.toContain('4242');
  }, 30_000);

  it('refuses to carry a lesson somebody else is in the middle of writing', async () => {
    const admin = await account('admin');
    const author = await account('author');
    const together = `course-${randomUUID()}`;
    const first = await ownLesson(together);
    const second = await ownLesson(together);
    const opened = await service.createDraft(admin.id, second);
    const mine = opened.draft!.edit.sections.flatMap((section) => section.contentBlocks).find((block) => block.kind === 'core.problem_set')!;
    const theirs = (await lessonRecord(db, `${first}:v1`))!.sections.flatMap((section) => section.contentBlocks)
      .find((block) => block.kind === 'core.problem_set')!.payload as { problemSetVersionId: string };
    const taken = (await service.act(admin.id, { action: 'problemSet.read', versionId: theirs.problemSetVersionId })).problemSet!;
    const sharing = structuredClone(opened.draft!.edit);
    sharing.sections = sharing.sections.map((section) => ({ ...section, contentBlocks: section.contentBlocks.map((block) =>
      (block.blockId === mine.blockId ? { ...block, payload: { problemSetId: taken.problemSetId, problemSetVersionId: taken.versionId,
        problemVersionIds: taken.problems.map((problem) => problem.problemVersionId) } } : block)) }));
    sharing.problems = [...sharing.problems.filter((problem) => !(mine.payload.problemVersionIds as string[]).includes(problem.problemVersionId)), ...taken.problems];
    await service.saveDraft(admin.id, opened.draft!.id, sharing);
    await service.publishDraft(admin.id, opened.draft!.id);

    // Somebody else opens the lesson that would be carried, and is not to be moved under.
    const theirDraft = await service.createDraft(author.id, first);
    const again = await service.createDraft(admin.id, second);
    const changed = structuredClone(again.draft!.edit);
    changed.problems.find((problem) => problem.problemVersionId === taken.problems[0].problemVersionId)!.gradingSpec = { kind: 'integer', value: 77 };
    await service.saveDraft(admin.id, again.draft!.id, changed);
    await expect(service.publishDraft(admin.id, again.draft!.id)).rejects.toMatchObject({ status: 409 });

    await service.deleteDraft(author.id, theirDraft.draft!.id);
    // With their draft gone the publish goes through, carrying the lesson as it would have.
    expect((await service.publishDraft(admin.id, again.draft!.id)).carriedLessons!.map((lesson) => lesson.lessonKey)).toEqual([first]);
  }, 30_000);

  it('lets a writer hand work on without locking it, and lets it be handed back', async () => {
    const author = await account('author');
    const admin = await account('admin');
    const created = await service.createDraft(author.id, lessonKey);
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
      const created = await service.createDraft(shared.id, lessonKey);
      expect(created.draft!.authorName).toBe('열린 편집');
      await service.deleteDraft(shared.id, created.draft!.id);
    } finally { delete process.env.CONTENT_OPEN_ACCESS; }
    // Turning it off closes the door again, including for drafts written while it was open.
    expect(await authoringRole(db, stranger.id)).toBeNull();
    await expect(service.createDraft(stranger.id, lessonKey)).rejects.toThrow(/권한/);
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

  it('starts a draft at the next version of the published lesson and opens its questions', async () => {
    const admin = await account('admin');
    const { draft, workspace } = await service.createDraft(admin.id, lessonKey);
    expect(workspace.lessons.find((item) => item.lessonKey === lessonKey)).toMatchObject({ hasDraft: true });
    expect(draft!.versionId).toBe(`${lessonKey}:v2`);
    expect(draft!.baseVersionId).toBe(`${lessonKey}:v1`);
    expect(draft!.edit.sections).toHaveLength(5);
    expect(draft!.issues).toEqual([]);
    // Writing a question means writing its answer, so an account holding the role receives all of it.
    for (const problem of draft!.edit.problems) expect(Object.keys(problem).sort())
      .toEqual(['conceptKeys', 'gradingSpec', 'hints', 'problemVersionId', 'promptContent', 'solution']);
    // The two fields that follow from the rest are never sent, so they cannot come back disagreeing.
    const serialized = JSON.stringify(draft);
    expect(serialized).not.toContain('responseSpec');
    expect(serialized).not.toContain('hintAvailable');
  });

  it('saves work in progress and reports what still blocks publishing', async () => {
    const admin = await account('admin');
    const created = await service.createDraft(admin.id, lessonKey);
    const draftId = created.draft!.id;
    const broken = edited(created.draft!.edit, (sections) => {
      sections[0].contentBlocks.push({ ...drawing(`${lessonKey}:explanation:scene:v2`),
        payload: { alt: '그림', width: 320, height: 200, items: [{ kind: 'strip', x: 20, y: 80, width: 280, height: 40, parts: 4, filled: 9 }] } });
    });
    const saved = await service.saveDraft(admin.id, draftId, broken);
    expect(saved.draft!.issues.map((issue) => issue.message).join(' ')).toMatch(/filled must not exceed parts/);
    // A rule says what it refused; the editor is told where, so it can take an author to the block.
    expect(saved.draft!.issues[0]).toMatchObject({
      sectionId: created.draft!.edit.sections[0].sectionId,
      blockId: `${lessonKey}:explanation:scene:v2`,
    });
    expect(saved.draft!.issues[0].path).toContain('sections.0.contentBlocks.');
    const fixed = edited(created.draft!.edit, (sections) => { sections[0].contentBlocks.push(drawing(`${lessonKey}:explanation:scene:v2`)); });
    const good = await service.saveDraft(admin.id, draftId, fixed);
    expect(good.draft!.issues).toEqual([]);
    expect((await service.validateDraft(admin.id, draftId)).draft!.issues).toEqual([]);
  });

  it('points a refusal at the question it is about, wherever the rule found it', async () => {
    const admin = await account('admin');
    const created = await service.createDraft(admin.id, lessonKey);
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
    claimed.problems[0].conceptKeys = ['no-such-concept'];
    const missing = await service.saveDraft(admin.id, draftId, claimed);
    expect(missing.draft!.issues.some((issue) => issue.problemVersionId === missing.draft!.edit.problems[0].problemVersionId)).toBe(true);

    await service.deleteDraft(admin.id, draftId);
  });

  it('publishes the draft as a new immutable version and leaves the base version untouched', async () => {
    const admin = await account('admin');
    const created = await service.createDraft(admin.id, lessonKey);
    const draftId = created.draft!.id;
    const versionId = created.draft!.versionId;
    const before = await db.lessonVersion.findUniqueOrThrow({ where: { id: `${lessonKey}:v1` } });
    await service.saveDraft(admin.id, draftId, edited(created.draft!.edit, (sections) => {
      sections[0].contentBlocks.push(drawing(`${lessonKey}:explanation:scene:${versionId.split(':').at(-1)}`));
    }));
    const published = await service.publishDraft(admin.id, draftId);
    expect(published.publishedVersionId).toBe(versionId);
    expect(published.draft!.status).toBe('published');
    const document = await lessonRecord(db, versionId) as LessonRecord;
    expect(document.sections[0].contentBlocks.at(-1)!.kind).toBe('core.scene');
    // Nothing about the questions changed, so the new lesson version references the same set versions.
    for (const block of document.sections.flatMap((section) => section.contentBlocks).filter((block) => block.kind === 'core.problem_set')) {
      expect(String(block.payload.problemSetVersionId)).toMatch(/:v1$/);
    }
    // The published lesson carries the halves that follow from the answer, restated when it was saved.
    expect(document.problems[0].responseSpec.kind).toBe(document.problems[0].gradingSpec.kind);
    expect(document.problems[0].hintAvailable).toBe(document.problems[0].hints.length > 0);
    expect(await db.lessonVersion.findUniqueOrThrow({ where: { id: `${lessonKey}:v1` } })).toEqual(before);
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
    const created = await service.createDraft(admin.id, lessonKey);
    const draftId = created.draft!.id;
    const answered = `${lessonKey}:practice-1:v1`;
    const saved = await service.saveDraft(admin.id, draftId, rewritten(created.draft!.edit, answered,
      (problem) => { problem.promptContent[0].payload.text = '고쳐 쓴 문제예요.'; }));
    const renamed = `${lessonKey}:practice-1:${suffixOf(created.draft!.versionId)}`;
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
    const created = await service.createDraft(admin.id, lessonKey);
    const before = created.draft!.edit.problems.map((problem) => problem.problemVersionId);
    const saved = await service.saveDraft(admin.id, created.draft!.id, created.draft!.edit);
    expect(saved.draft!.edit.problems.map((problem) => problem.problemVersionId)).toEqual(before);
    expect(saved.draft!.issues).toEqual([]);
    await service.deleteDraft(admin.id, created.draft!.id);
  });

  it('drafts the next version of a set only for the activity that changed', async () => {
    const admin = await account('admin');
    const created = await service.createDraft(admin.id, lessonKey);
    const draftId = created.draft!.id;
    const answered = `${lessonKey}:practice-1:v1`;
    await service.saveDraft(admin.id, draftId, rewritten(created.draft!.edit, answered,
      (problem) => { problem.solution[0].payload.text = '풀이를 다시 썼어요.'; }));
    const setDrafts = await db.contentDraft.findMany({ where: { ownerKind: 'problem_set', status: { not: 'published' } } });
    // One set draft, for the practice set; the check set matches its published version and needs none.
    expect(setDrafts.filter((draft) => draft.ownerKey.startsWith(`${lessonKey}:`)).map((draft) => draft.ownerKey)).toEqual([`${lessonKey}:practice`]);
    const row = await db.contentDraft.findUniqueOrThrow({ where: { id: draftId } });
    const document = row.document as unknown as StoredLesson;
    const practice = document.sections.flatMap((section) => section.contentBlocks)
      .find((block) => block.kind === 'core.problem_set' && block.payload.problemSetId === `${lessonKey}:practice`)!;
    expect(practice.payload.problemSetVersionId).toBe(`${lessonKey}:practice:v2`);
    expect(practice.payload.problemVersionIds).toContain(`${lessonKey}:practice-1:${suffixOf(created.draft!.versionId)}`);
    // Putting the question back the way it was published lets the activity reference the published set again.
    await service.saveDraft(admin.id, draftId, created.draft!.edit);
    expect(await db.contentDraft.count({ where: { ownerKind: 'problem_set', ownerKey: `${lessonKey}:practice`, status: { not: 'published' } } })).toBe(0);
    await service.deleteDraft(admin.id, draftId);
  });

  it('publishes an edited question as a new one and leaves the answered one as it was', async () => {
    const admin = await account('admin');
    const created = await service.createDraft(admin.id, lessonKey);
    const draftId = created.draft!.id;
    const versionId = created.draft!.versionId;
    const answered = `${lessonKey}:check-1:v1`;
    const before = await db.lessonVersion.findUniqueOrThrow({ where: { id: `${lessonKey}:v1` } });
    await service.saveDraft(admin.id, draftId, rewritten(created.draft!.edit, answered, (problem) => {
      problem.promptContent[0].payload.text = '답이 달라진 문제예요.';
      problem.gradingSpec = { kind: 'rational', numerator: 2, denominator: 3 };
    }));
    await service.publishDraft(admin.id, draftId);
    const document = await lessonRecord(db, versionId) as LessonRecord;
    const written = document.problems.find((problem) => problem.problemVersionId === `${lessonKey}:check-1:${suffixOf(versionId)}`)!;
    // The changed activity published a new version of its set; the other activity still references its old one.
    const setVersions = document.sections.flatMap((section) => section.contentBlocks).filter((block) => block.kind === 'core.problem_set')
      .map((block) => String(block.payload.problemSetVersionId));
    expect(setVersions).toContain(`${lessonKey}:check:v2`);
    expect(setVersions).toContain(`${lessonKey}:practice:v1`);
    expect(written.gradingSpec).toEqual({ kind: 'rational', numerator: 2, denominator: 3 });
    expect(document.problems.some((problem) => problem.problemVersionId === answered)).toBe(false);
    // The version a learner may be part-way through still holds the question they answered.
    expect(await db.lessonVersion.findUniqueOrThrow({ where: { id: `${lessonKey}:v1` } })).toEqual(before);
  });

  it('publishes a question written in the editor as part of the activity that holds it', async () => {
    const admin = await account('admin');
    const created = await service.createDraft(admin.id, lessonKey);
    const draftId = created.draft!.id;
    const versionId = created.draft!.versionId;
    const edit = structuredClone(created.draft!.edit);
    const written = newProblem(nextProblemVersionId(lessonKey, 'practice', versionId,
      edit.problems.map((problem) => problem.problemVersionId)), edit.problems[0].conceptKeys);
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
    const document = await lessonRecord(db, versionId) as LessonRecord;
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
    const learner = await db.user.create({ data: { displayName: `찾기 ${randomUUID()}`, learningScopes: { create: { kind: 'personal' } } } });
    await openAuthoringAccount(db);
    const { matches } = await service.searchAccounts(admin.id, learner.displayName.slice(0, 12));
    expect(matches!.map((item) => item.userId)).toContain(learner.id);
    expect(matches!.find((item) => item.userId === learner.id)).toMatchObject({ role: null, source: 'none' });
    // The shared editing account is never a search result, since it is not a person.
    expect((await service.searchAccounts(admin.id, '열린 편집')).matches).toEqual([]);
    await expect(service.searchAccounts(learner.id, '찾기')).rejects.toThrow(/권한/);
  });

  it('writes a definition the lesson keeps, and rewrites it in place', async () => {
    const admin = await account('admin');
    const conceptKey = `lesson-word-${randomUUID()}`;
    const saved = await service.saveDefinition(admin.id, { conceptKey, scopeKind: 'lesson', scopeKey: lessonKey,
      newConcept: { label: '이 수업의 낱말' }, label: '', summary: '이 수업에서만 쓰는 풀이예요.', usageNote: '실수 한 변수 함수',
      blocks: [{ blockId: 'definition:block:1', kind: 'core.rich_text', typeVersion: 1, required: true, payload: { text: '뜻을 풀어 썼어요.' } }] });
    expect(saved.savedDefinition).toEqual({ conceptKey });
    // A concept created with a definition is also available for assessment.
    expect(await db.concept.findUniqueOrThrow({ where: { key: conceptKey } })).toMatchObject({ label: '이 수업의 낱말', assessable: true });
    // Blocks are named after the row that holds them, so the editor never chose the ID.
    const row = await db.conceptDefinition.findUniqueOrThrow({ where: { conceptKey_scopeKind_scopeKey: { conceptKey, scopeKind: 'lesson', scopeKey: lessonKey } } });
    expect((await definitionRecords(db, [row]))[0].blocks[0].blockId).toBe(`lesson:${lessonKey}:${conceptKey}:b1`);

    const listed = saved.definitions!.find(definition => definition.conceptKey === conceptKey)!;
    expect(listed).toMatchObject({ conceptLabel: '이 수업의 낱말', label: '', summary: '이 수업에서만 쓰는 풀이예요.', usageNote: '실수 한 변수 함수' });
    // Saving again rewrites the same row and the list shows the new wording. This goes through the
    // action the screen posts, so the shape the editor sends is the shape the server accepts.
    const again = await service.act(admin.id, { action: 'definition.save', edit: {
      conceptKey: listed.conceptKey, scopeKind: listed.scopeKind, scopeKey: listed.scopeKey,
      label: '분모 맞추기', summary: '설명을 고쳐 썼어요.', usageNote: '복소수 벡터공간', blocks: listed.blocks } });
    expect(again.definitions!.find(definition => definition.conceptKey === conceptKey))
      .toMatchObject({ label: '분모 맞추기', summary: '설명을 고쳐 썼어요.', usageNote: '복소수 벡터공간' });
    // One row per concept and scope: a definition has no versions.
    expect(await db.conceptDefinition.count({ where: { conceptKey } })).toBe(1);
    expect((await db.conceptDefinition.findUniqueOrThrow({ where: { id: row.id } })).summary).toBe('설명을 고쳐 썼어요.');
  });

  it('keeps the shared dictionary to administrators and asks a lesson definition which lesson it belongs to', async () => {
    const admin = await account('admin');
    const author = await account('author');
    const learner = await account();
    const conceptKey = `scope-word-${randomUUID()}`;
    const edit = { conceptKey, scopeKind: 'global' as const, scopeKey: '', newConcept: { label: '사전 낱말' }, label: '', summary: '사전이 쓴 풀이예요.',
      blocks: [{ blockId: 'definition:block:1', kind: 'core.rich_text', typeVersion: 1, required: true, payload: { text: '사전 정의' } }] };
    await expect(service.saveDefinition(author.id, edit)).rejects.toThrow(/공통 사전은 관리자만/);
    await expect(service.listDefinitions(learner.id, 'global', '')).rejects.toThrow(/권한/);
    // A lesson definition is part of writing that lesson, so an author may write one.
    await expect(service.saveDefinition(author.id, { ...edit, scopeKind: 'lesson', scopeKey: lessonKey })).resolves.toBeTruthy();

    await expect(service.saveDefinition(admin.id, { ...edit, scopeKey: lessonKey })).rejects.toThrow(/소속을 적지 않아요/);
    await expect(service.saveDefinition(admin.id, { ...edit, scopeKind: 'lesson', scopeKey: '' })).rejects.toThrow(/어느 수업의 뜻풀이인지/);
    await expect(service.saveDefinition(admin.id, { ...edit, scopeKind: 'lesson', scopeKey: 'no-such-lesson' })).rejects.toThrow(/그런 수업이 없어요/);
    // The dictionary and the lesson keep their own definitions of one concept.
    await service.saveDefinition(admin.id, edit);
    expect((await service.listDefinitions(author.id, 'global', '')).definitions!.some(definition => definition.conceptKey === conceptKey)).toBe(true);
    expect((await service.listDefinitions(admin.id, 'global', '')).definitions!.some(definition => definition.conceptKey === conceptKey)).toBe(true);
    expect((await service.listDefinitions(admin.id, 'lesson', lessonKey)).definitions!.some(definition => definition.conceptKey === conceptKey)).toBe(true);
    expect(await db.conceptDefinition.count({ where: { conceptKey } })).toBe(2);
  });

  it('refuses a definition the publishing rules would not accept', async () => {
    const admin = await account('admin');
    const conceptKey = `bad-word-${randomUUID()}`;
    const base = { conceptKey, scopeKind: 'lesson' as const, scopeKey: lessonKey, label: '', summary: '설명이에요.',
      blocks: [{ blockId: 'definition:block:1', kind: 'core.rich_text', typeVersion: 1, required: true, payload: { text: '정의' } }] };
    // A concept nobody named: without a name for it, there is nothing to make.
    await expect(service.saveDefinition(admin.id, base)).rejects.toThrow(/없는 개념/);
    // A definition never holds a question.
    await expect(service.saveDefinition(admin.id, { ...base, newConcept: { label: '나쁜 낱말' },
      blocks: [{ blockId: 'definition:block:1', kind: 'core.problem_set', typeVersion: 2, required: true, payload: { problemSetId: `${lessonKey}:practice`, problemSetVersionId: `${lessonKey}:practice:v1`, problemVersionIds: [`${lessonKey}:practice-1:v1`] } }] }))
      .rejects.toThrow(/cannot embed/);
    expect(await db.concept.findUnique({ where: { key: conceptKey } })).toBeNull();
  });

  it('offers a draft the definitions it may link, and no others', async () => {
    const admin = await account('admin');
    const suffix = randomUUID();
    const define = (conceptKey: string, scopeKind: 'global' | 'lesson', scopeKey: string, label: string) =>
      service.saveDefinition(admin.id, { conceptKey, scopeKind, scopeKey, newConcept: { label }, label: '', summary: `${label} 풀이예요.`,
        blocks: [{ blockId: 'definition:block:1', kind: 'core.rich_text', typeVersion: 1, required: true, payload: { text: label } }] });
    await define(`shared-${suffix}`, 'global', '', '사전 낱말');
    await define(`mine-${suffix}`, 'lesson', lessonKey, '이 수업 낱말');
    // A definition with no body only renames the concept, and cannot be linked.
    await service.saveDefinition(admin.id, { conceptKey: `nameonly-${suffix}`, scopeKind: 'lesson', scopeKey: lessonKey,
      newConcept: { label: '이름만' }, label: '이 수업에서 부르는 이름', summary: '', blocks: [] });
    // Another lesson keeps one of its own; this draft must not be offered it.
    const other = `other-${randomUUID()}`;
    const record = JSON.parse(JSON.stringify(seedLessons[0]).replaceAll('fraction-meaning', other)) as LessonRecord;
    await importContent(db, lessonBundle([record], { key: `course-${record.public.lessonKey}`, title: '검사 코스' }));
    await define(`other-${suffix}`, 'lesson', other, '남의 수업 낱말');

    const { draft } = await service.createDraft(admin.id, lessonKey);
    const offered = draft!.definitions.map(definition => definition.conceptKey);
    expect(offered).toContain(`shared-${suffix}`);
    expect(offered).toContain(`mine-${suffix}`);
    expect(offered).not.toContain(`nameonly-${suffix}`);
    expect(offered).not.toContain(`other-${suffix}`);
    expect(draft!.definitions.find(definition => definition.conceptKey === `mine-${suffix}`))
      .toMatchObject({ scopeKind: 'lesson', scopeKey: lessonKey, label: '이 수업 낱말' });
    await service.deleteDraft(admin.id, draft!.id);
  });

  it('refuses to publish an invalid draft, or to publish at all without the role', async () => {
    const admin = await account('admin');
    const author = await account('author');
    const created = await service.createDraft(author.id, lessonKey);
    const draftId = created.draft!.id;
    await service.saveDraft(author.id, draftId, edited(created.draft!.edit, (sections) => { sections[0].contentBlocks = []; }));
    await expect(service.publishDraft(author.id, draftId)).rejects.toThrow(/관리자만/);
    await expect(service.publishDraft(admin.id, draftId)).rejects.toThrow(/고칠 곳/);
    expect(await db.lessonVersion.findUnique({ where: { id: created.draft!.versionId } })).toBeNull();
  });

  it('keeps a draft inside its own lesson when the version ID is edited by hand', async () => {
    const admin = await account('admin');
    const created = await service.createDraft(admin.id, lessonKey);
    const stray = { ...created.draft!.edit, meta: { ...created.draft!.edit.meta, versionId: 'fraction-addition:v9' } };
    await expect(service.saveDraft(admin.id, created.draft!.id, stray)).rejects.toThrow(/판본 ID는/);
    expect(await db.lessonVersion.findUnique({ where: { id: 'fraction-addition:v9' } })).toBeNull();
  });

  it('rejects a version ID that is already published instead of rewriting it', async () => {
    const admin = await account('admin');
    const created = await service.createDraft(admin.id, lessonKey);
    const taken = { ...created.draft!.edit, meta: { ...created.draft!.edit.meta, versionId: `${lessonKey}:v1` } };
    await service.saveDraft(admin.id, created.draft!.id, taken);
    await expect(service.publishDraft(admin.id, created.draft!.id)).rejects.toThrow(/immutable/);
  });

  it('keeps one author out of a draft that is not theirs while an administrator can pick it up', async () => {
    const first = await account('author');
    const second = await account('author');
    const admin = await account('admin');
    const created = await service.createDraft(first.id, lessonKey);
    await expect(service.draft(second.id, created.draft!.id)).rejects.toThrow(/다른 사람/);
    expect((await service.workspace(second.id)).drafts.find((item) => item.id === created.draft!.id)).toBeUndefined();
    const seen = (await service.workspace(admin.id)).drafts.find((item) => item.id === created.draft!.id);
    expect(seen).toMatchObject({ mine: false, authorName: expect.stringContaining('author') });
    await service.deleteDraft(admin.id, created.draft!.id);
    expect(await db.contentDraft.findUnique({ where: { id: created.draft!.id } })).toBeNull();
  });
});
