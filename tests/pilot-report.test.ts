import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { existingRows, removeRowsAddedSince, type Existing } from './cleanup';
import { getActivityProblemIds, type StoredProblem } from '@/core/content';
import { lessonBundle, seedLessons, writtenAnswer } from './fixtures/content';
import { createDatabase } from '@/server/db';
import { LearningService } from '@/server/learning-service';
import { importContent } from '@/server/content-store';
import { pilotReport } from '@/server/pilot-report';

const testDatabaseUrl = process.env.TEST_DATABASE_URL;
const record = seedLessons[0];
const problemById = (id: string) => record.problems.find((problem) => problem.problemVersionId === id)!;
const rightAnswer = writtenAnswer;
const problemsOf = (sectionId: string) => getActivityProblemIds(record, sectionId);
const firstActivity = record.sections.find((section) => problemsOf(section.sectionId).length)!;

describe.skipIf(!testDatabaseUrl)('MySQL pilot report', () => {
  let db: ReturnType<typeof createDatabase>;
  let existing: Existing;
  let service: LearningService;
  /** Only this run's learners, so a shared database's other rows cannot move the numbers. */
  let from: Date;

  beforeAll(async () => {
    db = createDatabase(testDatabaseUrl!);
    existing = await existingRows(db);
    service = new LearningService(db);
    for (const seed of seedLessons) await importContent(db, lessonBundle([seed]));
    from = new Date(Date.now() + 1000);
    await new Promise((resolve) => setTimeout(resolve, 1100));
  }, 30_000);

  afterAll(async () => {
    if (existing) await removeRowsAddedSince(db, existing);
    await db?.$disconnect();
  });

  const report = () => pilotReport(db, { from });
  async function learner() {
    const user = await db.user.create({ data: { displayName: `pilot ${randomUUID().slice(0, 8)}`, learningScopes: { create: { kind: 'personal' } } } });
    return user.id;
  }
  const start = async (userId: string) => (await service.act(userId, { action: 'enrollment.start', lessonKey: record.public.lessonKey })).enrollmentId!;
  /** A question can only be answered once the steps before it are finished, so this walks there. */
  async function reachActivity(userId: string) {
    const enrollmentId = await start(userId);
    for (const section of record.sections) {
      if (problemsOf(section.sectionId).length) return { enrollmentId, problemVersionId: problemsOf(section.sectionId)[0] };
      await service.act(userId, { action: 'section.complete', enrollmentId, sectionId: section.sectionId });
    }
    throw new Error('Fixture must have a section with questions.');
  }
  const answer = (userId: string, enrollmentId: string, problemVersionId: string, value: string) =>
    service.act(userId, { action: 'attempt.submit', context: 'lesson', contextId: enrollmentId, problemVersionId, answer: value, requestId: randomUUID() });

  it('counts a lesson someone started and did not finish, and says where they stopped', async () => {
    const userId = await learner();
    const enrollmentId = await start(userId);
    await service.act(userId, { action: 'section.complete', enrollmentId, sectionId: record.sections[0].sectionId });

    const lesson = (await report()).lessons.find((item) => item.lessonKey === record.public.lessonKey)!;
    expect(lesson.started).toBe(1);
    expect(lesson.completed).toBe(0);
    expect(lesson.medianMinutesToComplete).toBeNull();
    // Stopped at the step after the one they finished, named as the learner saw it.
    expect(lesson.stoppedAt[0].sectionId).toBe(record.sections[1].sectionId);
    expect(lesson.stoppedAt[0].learners).toBe(1);
    expect(lesson.stoppedAt[0].title).toBe(record.sections[1].title);
  }, 30_000);

  it('keeps the first try apart from what came after it', async () => {
    const userId = await learner();
    const { enrollmentId, problemVersionId } = await reachActivity(userId);
    const problem = problemById(problemVersionId);
    await answer(userId, enrollmentId, problemVersionId, '1000000');
    await answer(userId, enrollmentId, problemVersionId, rightAnswer(problem));

    const entry = (await report()).problems.find((item) => item.problemVersionId === problemVersionId)!;
    // Personalization believes the first attempt, so the report counts the same one.
    expect(entry.firstTry).toEqual({ correct: 0, incorrect: 1, rejected: 0 });
    expect(entry.retried).toBe(1);
    expect(entry.learners).toBe(1);
  }, 30_000);

  it('collects the writing the grader could not read', async () => {
    const userId = await learner();
    const { enrollmentId, problemVersionId } = await reachActivity(userId);
    await answer(userId, enrollmentId, problemVersionId, '\\frac{1+1}{4}');
    await answer(userId, enrollmentId, problemVersionId, '\\frac{1+1}{4}');

    const rejected = (await report()).rejectedAnswers.find((item) => item.answer === '\\frac{1+1}{4}')!;
    expect(rejected.problemVersionId).toBe(problemVersionId);
    expect(rejected.times).toBe(2);
    expect(rejected.learners).toBe(1);
  }, 30_000);

  it('never lets a name out', async () => {
    const userId = await learner();
    const named = await db.user.findUniqueOrThrow({ where: { id: userId }, select: { displayName: true } });
    const { enrollmentId, problemVersionId } = await reachActivity(userId);
    await answer(userId, enrollmentId, problemVersionId, 'abc');

    const serialised = JSON.stringify(await report());
    expect(serialised).not.toContain(named.displayName);
    expect(serialised).not.toContain(userId);
    // The one piece of writing that does come out is the answer itself.
    expect(serialised).toContain('abc');
  }, 30_000);

  it('counts someone as returning only once they answered on another day', async () => {
    const userId = await learner();
    const { enrollmentId, problemVersionId } = await reachActivity(userId);
    await answer(userId, enrollmentId, problemVersionId, rightAnswer(problemById(problemVersionId)));
    const sameDay = await report();
    const before = sameDay.returning.learners;

    // A second day, written directly because the service always stamps the present.
    await db.attempt.updateMany({ where: { userId, problemVersionId }, data: { createdAt: new Date(Date.now() - 2 * 86400000) } });
    await answer(userId, enrollmentId, problemVersionId, rightAnswer(problemById(problemVersionId)));
    const later = await pilotReport(db, {});
    expect(later.returning.learners).toBeGreaterThan(before);
  }, 30_000);

  it('reads without writing anything', async () => {
    const userId = await learner();
    const { enrollmentId, problemVersionId } = await reachActivity(userId);
    await answer(userId, enrollmentId, problemVersionId, 'abc');
    const counts = async () => ({
      attempts: await db.attempt.count(), enrollments: await db.enrollment.count(),
      users: await db.user.count(), hints: await db.hintUse.count(), runs: await db.diagnosticRun.count(),
    });
    const before = await counts();
    await report();
    await report();
    expect(await counts()).toEqual(before);
  }, 30_000);
});
