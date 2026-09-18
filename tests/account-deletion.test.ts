import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { existingRows, removeRowsAddedSince, type Existing } from './cleanup';
import { getActivityProblemIds, type StoredProblem } from '@/core/content';
import { lessonBundle, seedLessons } from './fixtures/content';
import { createDatabase } from '@/server/db';
import { LearningService } from '@/server/learning-service';
import { importContent } from '@/server/content-store';
import { deleteAccount } from '@/server/account-service';

const testDatabaseUrl = process.env.TEST_DATABASE_URL;
const record = seedLessons[0];
const problemById = (id: string) => record.problems.find((problem) => problem.problemVersionId === id)!;
const fixtureAnswer = (problem: StoredProblem) => problem.gradingSpec.kind === 'integer'
  ? String(problem.gradingSpec.value) : `${problem.gradingSpec.numerator}/${problem.gradingSpec.denominator}`;
/** Column names come from the database's own catalogue, but a name still has to look like one. */
const safeName = (value: string) => /^[A-Za-z0-9_]+$/.test(value);

describe.skipIf(!testDatabaseUrl)('MySQL account deletion', () => {
  let db: ReturnType<typeof createDatabase>;
  let existing: Existing;
  let service: LearningService;

  beforeAll(async () => {
    const parsed = new URL(testDatabaseUrl!);
    if (parsed.protocol !== 'mysql:' || !decodeURIComponent(parsed.pathname.slice(1)).endsWith('_test')) {
      throw new Error('TEST_DATABASE_URL must use MySQL and a database name ending in _test.');
    }
    db = createDatabase(testDatabaseUrl!);
    existing = await existingRows(db);
    service = new LearningService(db);
    for (const seed of seedLessons) await importContent(db, lessonBundle([seed]));
  }, 30_000);

  afterAll(async () => {
    if (existing) await removeRowsAddedSince(db, existing);
    await db?.$disconnect();
  });

  async function newLearner() {
    const user = await db.user.create({ data: {
      displayName: `deletion ${randomUUID().slice(0, 8)}`,
      learningScopes: { create: { kind: 'personal' } },
    }, include: { learningScopes: true } });
    return { userId: user.id, scopeId: user.learningScopes[0].id };
  }

  /** Walks a learner all the way through a lesson so every kind of record exists to be deleted. */
  async function learnerWithRecords() {
    const learner = await newLearner();
    const { userId } = learner;
    await service.act(userId, { action: 'profile.update', targetCourseKey: null, dailyMinutes: 20 });
    const started = await service.act(userId, { action: 'enrollment.start', lessonKey: record.public.lessonKey });
    const enrollmentId = started.enrollmentId!;
    for (const section of record.sections) {
      for (const problemVersionId of getActivityProblemIds(record, section.sectionId)) {
        await service.act(userId, { action: 'hint.open', context: 'lesson', contextId: enrollmentId, problemVersionId }).catch(() => undefined);
        await service.act(userId, { action: 'attempt.submit', context: 'lesson', contextId: enrollmentId,
          problemVersionId, answer: fixtureAnswer(problemById(problemVersionId)), requestId: randomUUID() });
      }
      await service.act(userId, { action: 'section.complete', enrollmentId, sectionId: section.sectionId });
    }
    await service.act(userId, { action: 'lesson.complete', enrollmentId });
    return learner;
  }

  /**
   * Every table the database itself says holds a person, asked one by one. Counting named tables
   * would pass a table added later and never wired into the deletion; this cannot.
   */
  async function rowsNaming(userId: string) {
    const columns = await db.$queryRawUnsafe<{ TABLE_NAME: string; COLUMN_NAME: string }[]>(
      `SELECT TABLE_NAME, COLUMN_NAME FROM information_schema.COLUMNS
       WHERE TABLE_SCHEMA = DATABASE() AND COLUMN_NAME IN ('userId', 'learnerUserId', 'authorId', 'ownerUserId')`);
    expect(columns.length, '사람을 가리키는 열이 하나도 없을 수는 없다').toBeGreaterThan(5);
    const found: Record<string, number> = {};
    for (const { TABLE_NAME: table, COLUMN_NAME: column } of columns) {
      if (!safeName(table) || !safeName(column)) throw new Error(`Unexpected identifier: ${table}.${column}`);
      // `rows` is reserved in MySQL 8, so the count comes back under a name of our own.
      const [{ total }] = await db.$queryRawUnsafe<{ total: bigint }[]>(
        `SELECT COUNT(*) AS total FROM \`${table}\` WHERE \`${column}\` = ?`, userId);
      if (Number(total) > 0) found[`${table}.${column}`] = Number(total);
    }
    const [{ total: self }] = await db.$queryRawUnsafe<{ total: bigint }[]>('SELECT COUNT(*) AS total FROM `User` WHERE `id` = ?', userId);
    if (Number(self) > 0) found['User.id'] = Number(self);
    return found;
  }

  it('leaves no row anywhere that names the person', async () => {
    const learner = await learnerWithRecords();
    const before = await rowsNaming(learner.userId);
    // The walk above has to have produced something, or the deletion would be proving nothing.
    expect(Object.keys(before)).toEqual(expect.arrayContaining(['User.id', 'Attempt.userId', 'Enrollment.userId', 'LearningScope.ownerUserId']));

    const removed = await deleteAccount(db, learner.userId);
    expect(removed.attempts).toBeGreaterThan(0);
    expect(removed.enrollments).toBe(1);
    expect(await rowsNaming(learner.userId)).toEqual({});
  }, 30_000);

  it('reports what it removed', async () => {
    const learner = await learnerWithRecords();
    const removed = await deleteAccount(db, learner.userId);
    // One review assignment is created by finishing the lesson, and it leaves with its recipient.
    expect(removed.assignments).toBe(1);
    expect(removed.hints + removed.attempts).toBeGreaterThan(0);
  }, 30_000);

  it('leaves everyone else exactly as they were', async () => {
    const [leaving, staying] = [await learnerWithRecords(), await learnerWithRecords()];
    const before = await rowsNaming(staying.userId);
    await deleteAccount(db, leaving.userId);
    expect(await rowsNaming(staying.userId)).toEqual(before);
    const state = await service.state(staying.userId);
    expect(state.enrollments).toHaveLength(1);
    expect(state.assignments).toHaveLength(1);
  }, 30_000);

  it('leaves the published lessons untouched', async () => {
    const learner = await learnerWithRecords();
    const before = await db.lessonVersion.count();
    await deleteAccount(db, learner.userId);
    expect(await db.lessonVersion.count()).toBe(before);
    // What a person wrote for everyone is not theirs to take away, and carries no name to remove.
    expect(await db.lessonVersion.findFirst({ where: { id: record.public.versionId } })).toBeTruthy();
  }, 30_000);

  it('refuses while the account may still write content', async () => {
    const learner = await newLearner();
    await db.contentAuthor.create({ data: { userId: learner.userId, role: 'author' } });
    await expect(deleteAccount(db, learner.userId)).rejects.toThrow(/편집 권한/);
    expect(await db.user.count({ where: { id: learner.userId } })).toBe(1);

    await db.contentAuthor.delete({ where: { userId: learner.userId } });
    await db.contentDraft.create({ data: {
      ownerKind: 'lesson', ownerKey: 'deletion-probe', versionId: `deletion-probe:${randomUUID().slice(0, 8)}`,
      title: '쓰다 만 수업', document: {}, authorId: learner.userId,
    } });
    await expect(deleteAccount(db, learner.userId)).rejects.toThrow(/초안이 1개/);

    await db.contentDraft.deleteMany({ where: { authorId: learner.userId } });
    await deleteAccount(db, learner.userId);
    expect(await rowsNaming(learner.userId)).toEqual({});
  }, 30_000);
});
