import { createHash, randomUUID } from 'node:crypto';
import { Prisma } from '@prisma/client';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { existingRows, removeRowsAddedSince, type Existing } from './cleanup';
import { getActivityProblemIds, type LessonRecord, type StoredProblem } from '@/core/content';
import { lessonBundle, seedLessons, writtenAnswer } from './fixtures/content';
import { developmentLoginEnabled, sessionUser } from '@/server/auth';
import { createDatabase } from '@/server/db';
import { LearningService } from '@/server/learning-service';
import { importContent, lessonRecord, indexDefinitionBlocks } from '@/server/content-store';
import type { LearningAction, ProblemSetRef } from '@/shared/api';

const testDatabaseUrl = process.env.TEST_DATABASE_URL;
const record = seedLessons[0];
const asJson = (value: unknown) => JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
const requestId = () => randomUUID();
const problemById = (id: string) => record.problems.find(problem => problem.problemVersionId === id)!;
// Answers are fixture inputs; the separate grading suite verifies the arithmetic itself.
const fixtureAnswer = writtenAnswer;

describe.skipIf(!testDatabaseUrl)('MySQL learning lifecycle and isolation', () => {
  let db: ReturnType<typeof createDatabase>;
  let existing: Existing;
  let service: LearningService;

  /** A fixture publishes the way the application does: the lesson and the sets it references, as one bundle. */
  async function publishImmutable(document: LessonRecord) {
    await importContent(db, lessonBundle([document]));
    expect(await lessonRecord(db, document.public.versionId), `Published fixture ${document.public.versionId} must read back whole`).toEqual(document);
  }

  beforeAll(async () => {
    const parsed = new URL(testDatabaseUrl!);
    if (parsed.protocol !== 'mysql:' || !decodeURIComponent(parsed.pathname.slice(1)).endsWith('_test')) {
      throw new Error('TEST_DATABASE_URL must use MySQL and a database name ending in _test.');
    }
    db = createDatabase(testDatabaseUrl!);
    existing = await existingRows(db);
    service = new LearningService(db);
    // Migrations are performed by the caller/CI. Never truncate, drop, or reset an existing DB.
    for (const seed of seedLessons) await publishImmutable(seed);
  }, 30_000);

  afterAll(async () => {
    // A shared database keeps whatever a run leaves behind, so this run leaves nothing.
    if (existing) await removeRowsAddedSince(db, existing);
    await db?.$disconnect();
  });

  async function newLearner() {
    const user = await db.user.create({ data: {
      displayName: `integration ${randomUUID().slice(0, 8)}`,
      learningScopes: { create: { kind: 'personal' } },
    }, include: { learningScopes: true } });
    return { userId: user.id, scopeId: user.learningScopes[0].id };
  }

  async function enroll(userId: string, lessonKey = record.public.lessonKey) {
    const response = await service.act(userId, { action: 'enrollment.start', lessonKey });
    expect(response.enrollmentId).toBeTruthy();
    return response.enrollmentId!;
  }

  async function openPractice(userId: string) {
    const enrollmentId = await enroll(userId);
    for (const section of record.sections) {
      if (getActivityProblemIds(record, section.sectionId).length) {
        return { enrollmentId, section, problem: problemById(getActivityProblemIds(record, section.sectionId)[0]) };
      }
      await service.act(userId, { action: 'section.complete', enrollmentId, sectionId: section.sectionId });
    }
    throw new Error('Fixture must have a practice section.');
  }

  async function finishSections(userId: string, enrollmentId: string) {
    for (const section of record.sections) {
      for (const problemVersionId of getActivityProblemIds(record, section.sectionId)) {
        await service.act(userId, { action: 'attempt.submit', context: 'lesson', contextId: enrollmentId,
          problemVersionId, answer: fixtureAnswer(problemById(problemVersionId)), requestId: requestId() });
      }
      await service.act(userId, { action: 'section.complete', enrollmentId, sectionId: section.sectionId });
    }
  }

  async function standaloneAssignment(learner: { userId: string; scopeId: string }) {
    const assignment = (await db.$transaction(tx => service.createPersonalAssignment(tx, learner.userId, learner.scopeId, record)))!;
    return db.assignmentRecipient.findFirstOrThrow({ where: { assignmentId: assignment.id, learnerUserId: learner.userId },
      include: { assignment: { include: { items: { orderBy: { position: 'asc' } } } }, submissions: true } });
  }

  it('keeps another learner out of enrollments, assignment attempts, hints, and finalization', async () => {
    const owner = await newLearner();
    const other = await newLearner();
    const { enrollmentId, section, problem } = await openPractice(owner.userId);
    const recipient = await standaloneAssignment(owner);
    const foreignActions: LearningAction[] = [
      { action: 'section.complete', enrollmentId, sectionId: section.sectionId },
      { action: 'attempt.submit', context: 'lesson', contextId: enrollmentId, problemVersionId: problem.problemVersionId, answer: fixtureAnswer(problem), requestId: requestId() },
      { action: 'hint.open', context: 'assignment', contextId: recipient.id, problemVersionId: recipient.assignment.items[0].problemVersionId },
      { action: 'attempt.submit', context: 'assignment', contextId: recipient.id, problemVersionId: recipient.assignment.items[0].problemVersionId, answer: '1', requestId: requestId() },
      { action: 'assignment.submit', recipientId: recipient.id, requestId: requestId() },
    ];
    for (const action of foreignActions) await expect(service.act(other.userId, action)).rejects.toMatchObject({ status: 404 });
    const state = await service.state(other.userId);
    expect(state.enrollments).toEqual([]);
    expect(state.assignments).toEqual([]);
    expect(await db.attempt.count({ where: { userId: other.userId } })).toBe(0);
  });

  it('accepts only problem versions assigned to the selected lesson or assignment context', async () => {
    const learner = await newLearner();
    const { enrollmentId, problem } = await openPractice(learner.userId);
    const recipient = await standaloneAssignment(learner);
    await expect(service.act(learner.userId, { action: 'attempt.submit', context: 'lesson', contextId: enrollmentId,
      problemVersionId: record.review!.problemVersionIds[0], answer: '1', requestId: requestId() })).rejects.toMatchObject({ status: 404 });
    await expect(service.act(learner.userId, { action: 'attempt.submit', context: 'lesson', contextId: enrollmentId,
      problemVersionId: seedLessons[1].problems[0].problemVersionId, answer: '1', requestId: requestId() })).rejects.toMatchObject({ status: 404 });
    await expect(service.act(learner.userId, { action: 'attempt.submit', context: 'assignment', contextId: recipient.id,
      problemVersionId: problem.problemVersionId, answer: fixtureAnswer(problem), requestId: requestId() })).rejects.toMatchObject({ status: 404 });
    expect(await db.attempt.count({ where: { userId: learner.userId } })).toBe(0);
  });

  it('rejects skipped sections, locked questions, invalid-only completion, and early lesson completion', async () => {
    const learner = await newLearner();
    const enrollmentId = await enroll(learner.userId);
    const section = record.sections.find(item => item.role === 'practice')!;
    const problemVersionId = getActivityProblemIds(record, section.sectionId)[0];
    await expect(service.act(learner.userId, { action: 'section.complete', enrollmentId, sectionId: section.sectionId })).rejects.toMatchObject({ status: 409 });
    await expect(service.act(learner.userId, { action: 'attempt.submit', context: 'lesson', contextId: enrollmentId,
      problemVersionId, answer: '1', requestId: requestId() })).rejects.toMatchObject({ status: 409 });
    for (const preceding of record.sections.slice(0, record.sections.indexOf(section))) {
      await service.act(learner.userId, { action: 'section.complete', enrollmentId, sectionId: preceding.sectionId });
    }
    const invalid = await service.act(learner.userId, { action: 'attempt.submit', context: 'lesson', contextId: enrollmentId,
      problemVersionId, answer: '1/0', requestId: requestId() });
    expect(invalid.result?.status).toBe('invalid');
    await expect(service.act(learner.userId, { action: 'section.complete', enrollmentId, sectionId: section.sectionId })).rejects.toMatchObject({ status: 409 });
    await expect(service.act(learner.userId, { action: 'lesson.complete', enrollmentId })).rejects.toMatchObject({ status: 409 });
    expect(await db.assignmentRecipient.count({ where: { learnerUserId: learner.userId } })).toBe(0);
  });

  it('deduplicates concurrent attempts and rejects changed answers under the same request ID', async () => {
    const learner = await newLearner();
    const { enrollmentId, problem } = await openPractice(learner.userId);
    const action: LearningAction = { action: 'attempt.submit', context: 'lesson', contextId: enrollmentId,
      problemVersionId: problem.problemVersionId, answer: fixtureAnswer(problem), requestId: requestId() };
    const results = await Promise.all([service.act(learner.userId, action), service.act(learner.userId, action)]);
    expect(results[0].result).toEqual(results[1].result);
    expect(results[0].result?.status).toBe('correct');
    expect(await db.attempt.count({ where: { userId: learner.userId, requestId: action.requestId } })).toBe(1);
    await expect(service.act(learner.userId, { ...action, answer: '999' })).rejects.toMatchObject({ status: 409 });
    expect(await db.attempt.count({ where: { userId: learner.userId } })).toBe(1);
  }, 30_000);

  it('completes a lesson once and atomically creates one next-day assignment, recipient, and draft submission', async () => {
    const learner = await newLearner();
    const enrollmentId = await enroll(learner.userId);
    await finishSections(learner.userId, enrollmentId);
    const beforeCompletion = Date.now();
    const action = { action: 'lesson.complete', enrollmentId };
    await Promise.all([service.act(learner.userId, action), service.act(learner.userId, action)]);
    const enrollment = await db.enrollment.findUniqueOrThrow({ where: { id: enrollmentId } });
    expect(enrollment.status).toBe('completed');
    expect(enrollment.completedAt).not.toBeNull();
    expect(enrollment.completedSectionIds).toEqual(record.sections.map(section => section.sectionId));
    const recipients = await db.assignmentRecipient.findMany({ where: { learnerUserId: learner.userId },
      include: { submissions: true, assignment: { include: { items: true } } } });
    expect(recipients).toHaveLength(1);
    expect(await db.assignment.count({ where: { ownerScopeId: learner.scopeId } })).toBe(1);
    const recipient = recipients[0];
    expect(recipient.sourceEnrollmentId).toBe(enrollmentId);
    expect(recipient.recommendedAt.getTime()).toBeGreaterThanOrEqual(beforeCompletion + 86_400_000);
    expect(recipient.assignment.sourceLessonVersionId).toBe(record.public.versionId);
    expect(recipient.assignment.items.map(item => item.problemVersionId).sort()).toEqual([...record.review!.problemVersionIds].sort());
    expect(recipient.submissions).toHaveLength(1);
    expect(recipient.submissions[0]).toMatchObject({ status: 'draft', submissionIndex: 1, finalizedAt: null });
  }, 30_000);

  it('records hint assistance only for attempts made after the hint was opened', async () => {
    const learner = await newLearner();
    const { enrollmentId, problem } = await openPractice(learner.userId);
    const base = { action: 'attempt.submit', context: 'lesson', contextId: enrollmentId,
      problemVersionId: problem.problemVersionId, answer: fixtureAnswer(problem) };
    const unassistedRequestId = requestId();
    const first = await service.act(learner.userId, { ...base, requestId: unassistedRequestId });
    expect(first.result).toMatchObject({ status: 'correct', assisted: false });
    const hint = await service.act(learner.userId, { action: 'hint.open', context: 'lesson', contextId: enrollmentId, problemVersionId: problem.problemVersionId });
    expect(hint.hint).toEqual(problem.hints);
    const second = await service.act(learner.userId, { ...base, requestId: requestId() });
    expect(second.result).toMatchObject({ status: 'correct', assisted: true });
    const original = await db.attempt.findUniqueOrThrow({ where: { userId_requestId: { userId: learner.userId, requestId: unassistedRequestId } } });
    expect(original.hintUsed).toBe(false);
    expect(original.result).toMatchObject({ assisted: false });
    expect(await db.hintUse.count({ where: { userId: learner.userId } })).toBe(1);
  });

  it('gathers the questions built to catch one mistake, and leaves out what this learner has shown', async () => {
    const learner = await newLearner();
    // `solute-over-solute` and `count-endpoints` are names the seeds do not use, so this test owns
    // the whole pool for them. If a course ever tags one, pick another unused key here.
    const tagged = record.problems.slice(0, 3).map((problem) => problem.problemVersionId);
    // Three questions named the same mistake. The published version carries it, which is allowed
    // because expected wrong answers are not frozen with it.
    for (const problemVersionId of tagged) {
      await db.publishedProblem.updateMany({ where: { problemVersionId },
        data: { misreadings: [{ answer: '99999', misconception: 'solute-over-solute' }] } });
    }
    // One of them this learner already answered right, first time and unaided: shown, so left out.
    const scope = await db.learningScope.findFirstOrThrow({ where: { ownerUserId: learner.userId } });
    await db.attempt.create({ data: { userId: learner.userId, scopeId: scope.id, problemVersionId: tagged[0],
      answer: '1', result: { status: 'correct', message: '', assisted: false }, requestId: requestId() } });
    try {
    const opened = await service.act(learner.userId, { action: 'practice.gather', misconception: 'solute-over-solute' });
    const view = (await service.state(learner.userId)).assignments.find((item) => item.recipientId === opened.recipientId)!;
    expect(view.items.map((item) => item.problem.problemVersionId).sort()).toEqual(tagged.slice(1).sort());
    // It came from no one set, and says so rather than naming one it did not come from.
    expect(view.problemSetId).toBeNull();
    expect(view.title).toContain('농도의 분모를 용질로 잡기');
    expect(view.policy.kind).toBe('practice');
    // Asking again while it is open is 「이어서」, not a second copy.
    expect((await service.act(learner.userId, { action: 'practice.gather', misconception: 'solute-over-solute' })).recipientId).toBe(opened.recipientId);
    // A name nothing in the catalogue carries has nothing to gather, and says so.
    await expect(service.act(learner.userId, { action: 'practice.gather', misconception: 'count-endpoints' })).rejects.toMatchObject({ status: 409 });
    await expect(service.act(learner.userId, { action: 'practice.gather', misconception: 'not-a-real-key' })).rejects.toMatchObject({ status: 404 });
    } finally {
      // The fixture lesson is shared with every other test here, so it goes back as it was.
      for (const problemVersionId of tagged) {
        await db.publishedProblem.updateMany({ where: { problemVersionId }, data: { misreadings: Prisma.DbNull } });
      }
    }
  });

  it('calls a mistake standing only once two different questions have shown it', async () => {
    const learner = await newLearner();
    const { enrollmentId } = await openPractice(learner.userId);
    const slip = (problemVersionId: string) => db.attempt.create({ data: { userId: learner.userId, scopeId: learner.scopeId,
      problemVersionId, answer: '0', enrollmentId, requestId: requestId(),
      result: { status: 'incorrect', message: '', assisted: false, misconception: 'add-denominators' } } });
    const standing = async () => (await service.state(learner.userId)).misconceptions;

    await slip(record.problems[0].problemVersionId);
    // One question is a slip, however many times it was answered that way.
    await slip(record.problems[0].problemVersionId);
    expect(await standing()).toEqual([]);

    await slip(record.problems[1].problemVersionId);
    expect(await standing()).toEqual([{ key: 'add-denominators', label: '분모끼리 더하기',
      note: '분모가 조각의 크기라는 것을 지나치고 위아래를 따로 더해요.', problems: 2 }]);
  });

  it('hands out a worked solution only once the work is done, and records nothing for it', async () => {
    const learner = await newLearner();
    const { enrollmentId, problem } = await openPractice(learner.userId);
    const ask = { action: 'solution.open' as const, context: 'lesson' as const, contextId: enrollmentId, problemVersionId: problem.problemVersionId };
    // Before an answer it is not a solution, it is the answer, so it is refused.
    await expect(service.act(learner.userId, ask)).rejects.toMatchObject({ status: 409 });
    await service.act(learner.userId, { action: 'attempt.submit', context: 'lesson', contextId: enrollmentId,
      problemVersionId: problem.problemVersionId, answer: '999999', requestId: requestId() });
    // A wrong answer is still an answer: this is exactly who the solution is for.
    const opened = await service.act(learner.userId, ask);
    expect(opened.solution).toEqual(problem.solution);
    expect(opened.solution!.length).toBeGreaterThan(0);
    // Reading it is not a hint and leaves no mark on what the learner has been recorded as doing.
    expect(await db.hintUse.count({ where: { userId: learner.userId } })).toBe(0);
    const again = await service.act(learner.userId, { action: 'attempt.submit', context: 'lesson', contextId: enrollmentId,
      problemVersionId: problem.problemVersionId, answer: fixtureAnswer(problem), requestId: requestId() });
    expect(again.result).toMatchObject({ status: 'correct', assisted: false });
  });

  it('keeps an assignment\u2019s solutions until it is handed in, and never when the policy says never', async () => {
    const learner = await newLearner();
    const recipient = await standaloneAssignment(learner);
    const problemVersionId = recipient.assignment.items[0].problemVersionId;
    const ask = { action: 'solution.open' as const, context: 'assignment' as const, contextId: recipient.id, problemVersionId };
    // A set is answerable until it is handed in, so until then the solution would be the answer.
    await expect(service.act(learner.userId, ask)).rejects.toMatchObject({ status: 409 });
    const state = await service.state(learner.userId);
    expect(state.assignments[0].items[0].problem.solutionAvailable).toBe(true);
    for (const item of recipient.assignment.items) {
      await service.act(learner.userId, { action: 'attempt.submit', context: 'assignment', contextId: recipient.id,
        problemVersionId: item.problemVersionId, answer: '1', requestId: requestId() });
    }
    await service.act(learner.userId, { action: 'assignment.submit', recipientId: recipient.id, requestId: requestId() });
    expect((await service.act(learner.userId, ask)).solution!.length).toBeGreaterThan(0);
    // A policy that never shows one neither offers it nor hands it over, handed in or not.
    await db.assignment.update({ where: { id: recipient.assignmentId }, data: { policy: { kind: 'exam', hints: false, results: 'after-submission', solutions: 'never' } } });
    expect((await service.state(learner.userId)).assignments[0].items[0].problem.solutionAvailable).toBe(false);
    await expect(service.act(learner.userId, ask)).rejects.toMatchObject({ status: 409 });
  });

  it('marks an exam as it goes and says nothing until it is handed in', async () => {
    const learner = await newLearner();
    const recipient = await standaloneAssignment(learner);
    await db.assignment.update({ where: { id: recipient.assignmentId },
      data: { policy: { kind: 'exam', hints: false, results: 'after-submission', solutions: 'after-submission' } } });
    const problemVersionId = recipient.assignment.items[0].problemVersionId;
    const problem = record.problems.find((item) => item.problemVersionId === problemVersionId)!;

    // A right answer is marked right and the learner is told only that it was saved.
    const sent = await service.act(learner.userId, { action: 'attempt.submit', context: 'assignment', contextId: recipient.id,
      problemVersionId, answer: writtenAnswer(problem), requestId: requestId() });
    expect(sent.result).toMatchObject({ status: 'withheld' });
    expect(sent.result!.message).not.toContain('맞았어요');
    // The record keeps what the marker actually decided, so nothing is lost.
    const stored = await db.attempt.findFirstOrThrow({ where: { userId: learner.userId, problemVersionId } });
    expect(stored.result).toMatchObject({ status: 'correct' });
    // And the screen is told the same nothing, on the item and on its first answer alike.
    let view = (await service.state(learner.userId)).assignments.find((item) => item.recipientId === recipient.id)!;
    expect(view.items[0].attempt!.result.status).toBe('withheld');
    expect(view.items[0].firstResult!.status).toBe('withheld');
    expect(JSON.stringify(view)).not.toContain('misconception');

    // An answer that cannot be read is still said out loud: a typo is about the writing.
    const typo = await service.act(learner.userId, { action: 'attempt.submit', context: 'assignment', contextId: recipient.id,
      problemVersionId, answer: '사분의 삼', requestId: requestId() });
    expect(typo.result).toMatchObject({ status: 'invalid' });

    // Handed in, everything it knew is said.
    for (const item of recipient.assignment.items) {
      await service.act(learner.userId, { action: 'attempt.submit', context: 'assignment', contextId: recipient.id,
        problemVersionId: item.problemVersionId, answer: writtenAnswer(record.problems.find((p) => p.problemVersionId === item.problemVersionId)!), requestId: requestId() });
    }
    await service.act(learner.userId, { action: 'assignment.submit', recipientId: recipient.id, requestId: requestId() });
    view = (await service.state(learner.userId)).assignments.find((item) => item.recipientId === recipient.id)!;
    expect(view.items[0].attempt!.result.status).toBe('correct');
    expect(view.items[0].firstResult!.status).toBe('correct');
  });

  it('keeps hints back when the assignment policy says so, and shows a recipient their own due date over the rule', async () => {
    const learner = await newLearner();
    const recipient = await standaloneAssignment(learner);
    const due = new Date('2026-10-01T09:00:00.000Z'), own = new Date('2026-10-03T09:00:00.000Z');
    await db.assignment.update({ where: { id: recipient.assignmentId }, data: { policy: { kind: 'exam', hints: false, results: 'after-submission', solutions: 'never' },
      schedule: { due: { kind: 'at', at: due.toISOString() } } } });
    let state = await service.state(learner.userId);
    expect(state.assignments[0]).toMatchObject({ policy: { kind: 'exam', hints: false }, dueAt: due.toISOString(), opensAt: null });
    expect(state.assignments[0].items.every(item => !item.problem.hintAvailable)).toBe(true);
    await expect(service.act(learner.userId, { action: 'hint.open', context: 'assignment', contextId: recipient.id,
      problemVersionId: recipient.assignment.items[0].problemVersionId })).rejects.toMatchObject({ status: 409 });
    expect(await db.hintUse.count({ where: { userId: learner.userId } })).toBe(0);
    await db.assignmentRecipient.update({ where: { id: recipient.id }, data: { dueAt: own } });
    state = await service.state(learner.userId);
    expect(state.assignments[0].dueAt).toBe(own.toISOString());
  });

  it('finalizes only answered work, deduplicates retries, and preserves the selected attempts after submission', async () => {
    const learner = await newLearner();
    const recipient = await standaloneAssignment(learner);
    const finalize = { action: 'assignment.submit', recipientId: recipient.id, requestId: requestId() };
    await expect(service.act(learner.userId, finalize)).rejects.toMatchObject({ status: 409 });
    expect(await db.submissionItem.count({ where: { submissionId: recipient.submissions[0].id } })).toBe(0);
    for (const item of recipient.assignment.items) {
      await service.act(learner.userId, { action: 'attempt.submit', context: 'assignment', contextId: recipient.id,
        problemVersionId: item.problemVersionId, answer: fixtureAnswer(problemById(item.problemVersionId)), requestId: requestId() });
    }
    await Promise.all([service.act(learner.userId, finalize), service.act(learner.userId, finalize)]);
    const initial = await db.submission.findUniqueOrThrow({ where: { id: recipient.submissions[0].id }, include: { items: true } });
    expect(initial).toMatchObject({ status: 'submitted', requestId: finalize.requestId });
    expect(initial.finalizedAt).not.toBeNull();
    expect(initial.items).toHaveLength(recipient.assignment.items.length);
    await expect(service.act(learner.userId, { action: 'attempt.submit', context: 'assignment', contextId: recipient.id,
      problemVersionId: recipient.assignment.items[0].problemVersionId, answer: '999', requestId: requestId() })).rejects.toMatchObject({ status: 409 });
    await expect(service.act(learner.userId, { action: 'hint.open', context: 'assignment', contextId: recipient.id,
      problemVersionId: recipient.assignment.items[0].problemVersionId })).rejects.toMatchObject({ status: 409 });
    await service.act(learner.userId, finalize);
    const retried = await db.submission.findUniqueOrThrow({ where: { id: initial.id }, include: { items: true } });
    expect(retried.finalizedAt).toEqual(initial.finalizedAt);
    expect(retried.items.map(item => item.selectedAttemptId).sort()).toEqual(initial.items.map(item => item.selectedAttemptId).sort());
    expect(await db.submission.count({ where: { recipientId: recipient.id } })).toBe(1);
  }, 30_000);

  it('supports a standalone assignment without an enrollment and reads its questions from the frozen problem set version', async () => {
    const learner = await newLearner();
    const recipient = await standaloneAssignment(learner);
    expect(recipient.sourceEnrollmentId).toBeNull();
    expect(await db.enrollment.count({ where: { userId: learner.userId } })).toBe(0);
    expect(recipient.assignment).toMatchObject({ problemSetId: record.review!.problemSetId, problemSetVersionId: record.review!.problemSetVersionId,
      policy: { kind: 'review', hints: true }, schedule: {} });
    expect(recipient.assignment.issuedAt).not.toBeNull();
    expect(recipient).toMatchObject({ opensAt: null, dueAt: null });
    const state = await service.state(learner.userId);
    expect(state.assignments).toHaveLength(1);
    expect(state.assignments[0]).toMatchObject({ recipientId: recipient.id, lessonKey: null, status: 'assigned', opensAt: null, dueAt: null, policy: { kind: 'review' } });
    expect(state.assignments[0].items.map(item => item.problem.problemVersionId)).toEqual(recipient.assignment.items.map(item => item.problemVersionId));
    expect(state.assignments[0].items[0].problem.promptContent).toEqual(problemById(recipient.assignment.items[0].problemVersionId).promptContent);
    expect(JSON.stringify(state.assignments)).not.toContain('gradingSpec');
    const firstItem = state.assignments[0].items[0];
    const result = await service.act(learner.userId, { action: 'attempt.submit', context: 'assignment', contextId: recipient.id,
      problemVersionId: firstItem.problem.problemVersionId, answer: fixtureAnswer(problemById(firstItem.problem.problemVersionId)), requestId: requestId() });
    expect(result.result?.status).toBe('correct');
  });

  it('shows the frozen submitted answer when the latest draft attempt was invalid', async () => {
    const learner = await newLearner();
    const recipient = await standaloneAssignment(learner);
    for (const item of recipient.assignment.items) {
      await service.act(learner.userId, { action: 'attempt.submit', context: 'assignment', contextId: recipient.id,
        problemVersionId: item.problemVersionId, answer: fixtureAnswer(problemById(item.problemVersionId)), requestId: requestId() });
    }
    const firstItem = recipient.assignment.items[0];
    const practicing = await service.state(learner.userId);
    expect(practicing.concepts.filter(concept => problemById(firstItem.problemVersionId).conceptKeys.includes(concept.key)))
      .toEqual(expect.arrayContaining([expect.objectContaining({ state: 'practicing' })]));
    const validAttempt = await db.attempt.findFirstOrThrow({ where: {
      userId: learner.userId, submissionId: recipient.submissions[0].id, assignmentItemId: firstItem.id,
    } });
    const invalid = await service.act(learner.userId, { action: 'attempt.submit', context: 'assignment', contextId: recipient.id,
      problemVersionId: firstItem.problemVersionId, answer: '?', requestId: requestId() });
    expect(invalid.result?.status).toBe('invalid');
    const draftItem = invalid.state.assignments.find(item => item.recipientId === recipient.id)!.items.find(item => item.id === firstItem.id)!;
    expect(draftItem.attempt).toMatchObject({ answer: '?', result: { status: 'invalid' } });

    const finalized = await service.act(learner.userId, { action: 'assignment.submit', recipientId: recipient.id, requestId: requestId() });
    const selected = await db.submissionItem.findUniqueOrThrow({ where: {
      submissionId_assignmentItemId: { submissionId: recipient.submissions[0].id, assignmentItemId: firstItem.id },
    } });
    expect(selected.selectedAttemptId).toBe(validAttempt.id);
    for (const state of [finalized.state, await service.state(learner.userId)]) {
      const assignment = state.assignments.find(item => item.recipientId === recipient.id)!;
      expect(assignment.status).toBe('submitted');
      expect(assignment.items.find(item => item.id === firstItem.id)!.attempt).toMatchObject({
        id: selected.selectedAttemptId, answer: validAttempt.answer, result: { status: 'correct' },
      });
    }
  });

  it('pins an existing enrollment to v1 after v2 is published while new learners receive v2', async () => {
    const learner = await newLearner();
    const nextLearner = await newLearner();
    const lessonKey = `integration-pin-${randomUUID()}`;
    const first = structuredClone(record);
    first.public = { ...first.public, lessonKey, versionId: `${lessonKey}:v1` };
    await publishImmutable(first);
    const enrollmentId = await enroll(learner.userId, lessonKey);
    const second = structuredClone(first);
    second.public = { ...second.public, versionId: `${lessonKey}:v2`, title: `${second.public.title} · 두 번째 판본` };
    await publishImmutable(second);
    expect((await service.lessonDocument(lessonKey, learner.userId)).versionId).toBe(first.public.versionId);
    expect((await service.catalog()).find(item => item.lessonKey === lessonKey)?.versionId).toBe(second.public.versionId);
    expect(await enroll(learner.userId, lessonKey)).toBe(enrollmentId);
    const nextEnrollmentId = await enroll(nextLearner.userId, lessonKey);
    const nextEnrollment = await db.enrollment.findUniqueOrThrow({ where: { id: nextEnrollmentId } });
    expect(nextEnrollment.lessonVersionId).toBe(second.public.versionId);
    // The version a learner started stays exactly what it was published as.
    expect(await lessonRecord(db, first.public.versionId)).toEqual(first);
  });

  /** The same lesson under fresh identities, so a test may publish it again beside the fixture. */
  function derive(source: LessonRecord, suffix: string): LessonRecord {
    const rename = (id: string) => `${id}.${suffix}`;
    const clone = structuredClone(source) as LessonRecord;
    clone.public = { ...clone.public, lessonKey: rename(clone.public.lessonKey), versionId: rename(clone.public.versionId) };
    for (const section of clone.sections) {
      section.sectionId = rename(section.sectionId);
      for (const block of section.contentBlocks) {
        block.blockId = rename(block.blockId);
        if (block.kind !== 'core.problem_set') continue;
        const ref = block.payload as unknown as ProblemSetRef;
        block.payload = { problemSetId: rename(ref.problemSetId), problemSetVersionId: rename(ref.problemSetVersionId),
          problemVersionIds: ref.problemVersionIds.map(rename) } as unknown as typeof block.payload;
      }
    }
    if (clone.review) clone.review = { problemSetId: rename(clone.review.problemSetId), problemSetVersionId: rename(clone.review.problemSetVersionId),
      problemVersionIds: clone.review.problemVersionIds.map(rename) };
    const block = <T extends { blockId: string }>(item: T) => ({ ...item, blockId: rename(item.blockId) });
    clone.problems = clone.problems.map(problem => ({ ...problem, problemVersionId: rename(problem.problemVersionId),
      promptContent: problem.promptContent.map(block), hints: problem.hints.map(block), solution: problem.solution.map(block) }));
    return clone;
  }

  /** Publishes a lesson whose sets carry names, which is what puts them on the practice shelf. */
  async function publishNamed(source: LessonRecord, suffix: string) {
    const lesson = derive(source, suffix);
    const bundle = lessonBundle([lesson]);
    await importContent(db, { ...bundle, problemSets: bundle.problemSets.map(set => ({ ...set, name: `${set.problemSetId} 문제집` })) });
    return lesson;
  }

  it('lists lessons in the order the catalogue gives their courses, not the order they were installed', async () => {
    // Install order used to decide this, so a database seeded today and one that grew over weeks
    // disagreed about what comes after what — and the catalogue's order is what a learner who has
    // chosen nothing is recommended by.
    const suffix = randomUUID().slice(0, 8);
    const [second, first] = [`b-${suffix}`, `a-${suffix}`].map(name => derive(record, name));
    const publish = async (lesson: LessonRecord, key: string, place: number) => {
      const bundle = lessonBundle([lesson], { key, title: key });
      await importContent(db, { ...bundle, courses: bundle.courses.map(course => ({ ...course, order: place })) });
    };
    // The one installed first is placed last, so the two orders cannot agree by accident.
    await publish(second, `course-late-${suffix}`, 9001);
    await publish(first, `course-early-${suffix}`, 9000);
    const catalogue = (await service.catalog()).filter(lesson => lesson.courseKey.endsWith(suffix));
    expect(catalogue.map(lesson => lesson.lessonKey)).toEqual([first.public.lessonKey, second.public.lessonKey]);
  });

  it('lets a learner pick a named problem set and solve it without opening the lesson', async () => {
    const learner = await newLearner();
    const suffix = `pick-${randomUUID().slice(0, 8)}`;
    const lesson = await publishNamed(record, suffix);
    const shelf = await service.publicProblemSets();
    const mine = shelf.filter(set => set.problemSetId.endsWith(suffix));
    expect(mine.length, '이름을 준 문제집이 목록에 없다').toBeGreaterThan(0);
    expect(mine.every(set => set.courseKey === 'fractions' && set.lessonKey === lesson.public.lessonKey)).toBe(true);
    // The catalogue never carries an answer, whatever else it carries.
    expect(JSON.stringify(mine)).not.toContain('gradingSpec');

    const chosen = mine[0];
    const started = await service.act(learner.userId, { action: 'problemSet.start', problemSetId: chosen.problemSetId });
    expect(started.recipientId).toBeTruthy();
    const opened = started.state.assignments.find(item => item.recipientId === started.recipientId)!;
    expect(opened.policy.kind).toBe('practice');
    expect(opened.problemSetId).toBe(chosen.problemSetId);
    expect(opened.items).toHaveLength(chosen.questionCount);
    // Nobody assigned it, so nothing is due and the home screen has no review to point at.
    expect(opened.dueAt).toBeNull();
    expect(started.state.plan.review).toBeNull();
    // No enrollment was created: picking a set is not starting the lesson that uses it.
    expect(started.state.enrollments).toEqual([]);

    // Opening it again while it is unsubmitted is the same run, not a second copy of it.
    const again = await service.act(learner.userId, { action: 'problemSet.start', problemSetId: chosen.problemSetId });
    expect(again.recipientId).toBe(started.recipientId);
    expect(again.state.assignments.filter(item => item.problemSetId === chosen.problemSetId)).toHaveLength(1);

    for (const item of opened.items) {
      const answer = fixtureAnswer(lesson.problems.find(problem => problem.problemVersionId === item.problem.problemVersionId)!);
      await service.act(learner.userId, { action: 'attempt.submit', context: 'assignment', contextId: started.recipientId!,
        problemVersionId: item.problem.problemVersionId, answer, requestId: requestId() });
    }
    const finished = await service.act(learner.userId, { action: 'assignment.submit', recipientId: started.recipientId!, requestId: requestId() });
    const solved = finished.state.assignments.find(entry => entry.recipientId === started.recipientId)!;
    expect(solved.status).toBe('submitted');
    expect(solved.items.every(entry => entry.attempt?.result.status === 'correct')).toBe(true);
    // Work counts as work: the concepts it asked about are no longer untouched.
    expect(finished.state.concepts.filter(concept => chosen.conceptKeys.includes(concept.key)).every(concept => concept.state !== 'unknown')).toBe(true);

    // Once submitted, picking it again is a new sitting rather than a reopened one.
    const second = await service.act(learner.userId, { action: 'problemSet.start', problemSetId: chosen.problemSetId });
    expect(second.recipientId).not.toBe(started.recipientId);
  });

  it('offers no set a diagnostic asks from, and none a course keeps unnamed', async () => {
    const shelf = await service.publicProblemSets();
    // The fixture course keeps its lesson sets unnamed and its placement bank named; neither is
    // offered. A learner who has rehearsed the placement bank has made their own placement useless.
    const asked = new Set((await db.diagnosticVersion.findMany({ select: { problemSetId: true } })).map(row => row.problemSetId));
    expect(shelf.some(set => asked.has(set.problemSetId)), '진단이 묻는 은행이 목록에 있다').toBe(false);
    expect(shelf.some(set => set.problemSetId === 'fraction-meaning:practice'), '이름 없는 문제집이 목록에 있다').toBe(false);
    for (const set of shelf) expect(set.questionCount, set.problemSetId).toBeGreaterThan(0);
    // Picking something that is not on the shelf is not a set this learner can pick.
    const learner = await newLearner();
    await expect(service.act(learner.userId, { action: 'problemSet.start', problemSetId: 'starting-point' })).rejects.toMatchObject({ status: 404 });
  });

  it('explains every definition a lesson linked, wherever the author linked it', async () => {
    const learner = await newLearner();
    const suffix = randomUUID();
    const lessonKey = `integration-glossary-${suffix}`;
    const [earlier, primary, secondary] = ['earlier', 'primary', 'secondary'].map(name => `test.${name}.${suffix}`);
    await db.concept.createMany({ data: [earlier, primary, secondary].map((key) => ({ key, label: key, assessable: true })) });
    // A fixture writes a definition the way the application does: the row, then the blocks it owns.
    const publishDefinition = async (conceptKey: string) => {
      const row = await db.conceptDefinition.create({ data: { conceptKey, scopeKind: 'global', scopeKey: '', summary: `${conceptKey} 한 줄 설명` } });
      await indexDefinitionBlocks(db, row.id, [{ blockId: `${conceptKey}:b1`, kind: 'core.rich_text', typeVersion: 1, required: true, payload: { text: `${conceptKey} 정의` } }]);
    };
    for (const conceptKey of [earlier, primary, secondary]) await publishDefinition(conceptKey);

    // Fresh question IDs: a published problem version is immutable across every lesson in the database.
    const custom = JSON.parse(JSON.stringify(record).replaceAll(record.public.lessonKey, lessonKey)) as LessonRecord;
    custom.public = { ...custom.public, conceptKeys: [primary, secondary], prerequisiteConceptKeys: [earlier] };
    for (const problem of custom.problems) problem.conceptKeys = [primary];
    const [firstHomework, secondHomework] = custom.review!.problemVersionIds.map(id => custom.problems.find(p => p.problemVersionId === id)!);
    secondHomework.conceptKeys = [secondary];
    const link = (conceptKey: string, surface: string) => ({ conceptKey, surface });
    const section = custom.sections[0];
    section.contentBlocks[0] = { ...section.contentBlocks[0], typeVersion: 3, payload: {
      text: '앞선 개념 위에서 지금 개념을 배워요.',
      definitions: [link(earlier, '앞선 개념'), link(primary, '지금 개념')] } };
    // A question may carry links too; what it explains is the author's decision, not the server's.
    firstHomework.promptContent[0] = { ...firstHomework.promptContent[0], typeVersion: 3, payload: {
      text: '앞선 개념을 떠올리고 다른 개념도 확인해요.',
      definitions: [link(earlier, '앞선 개념'), link(secondary, '다른 개념')] } };
    await publishImmutable(custom);

    const document = await service.lessonDocument(lessonKey);
    // Every word any of the document's blocks linked is explained — its sections and its questions
    // alike — including the concept this very lesson teaches, which used to be withheld.
    expect(document.glossary.map(entry => entry.conceptKey).sort())
      .toEqual([earlier, primary, secondary].sort());
    expect(document.glossary.find(entry => entry.conceptKey === earlier))
      .toMatchObject({ label: earlier, lessonKey: null, summary: `${earlier} 한 줄 설명` });

    const enrollmentId = await enroll(learner.userId, lessonKey);
    for (const item of custom.sections) {
      for (const problemVersionId of getActivityProblemIds(custom, item.sectionId)) {
        await service.act(learner.userId, { action: 'attempt.submit', context: 'lesson', contextId: enrollmentId,
          problemVersionId, answer: fixtureAnswer(custom.problems.find(p => p.problemVersionId === problemVersionId)!), requestId: requestId() });
      }
      await service.act(learner.userId, { action: 'section.complete', enrollmentId, sectionId: item.sectionId });
    }
    const state = (await service.act(learner.userId, { action: 'lesson.complete', enrollmentId })).state;
    const assignment = state.assignments.find(item => item.lessonKey === lessonKey)!;
    expect(assignment.items.map(item => item.problem.problemVersionId).sort()).toEqual([...custom.review!.problemVersionIds].sort());
    // The review carries what its own questions linked, and only that: the section's link to the
    // primary concept is not part of this assignment, so its definition is not sent here.
    expect(assignment.glossary.map(entry => entry.conceptKey).sort()).toEqual([earlier, secondary].sort());
    expect(JSON.stringify(assignment)).not.toContain(`${primary} 정의`);
  });
});

describe('development login deployment guard', () => {
  afterEach(() => { vi.unstubAllEnvs(); });

  it('rejects existing development cookies in production before querying the database', async () => {
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv('DEV_LOGIN_ENABLED', 'true');
    const request = new Request('http://127.0.0.1:3017/api/v1/session', {
      headers: { cookie: `gm_session=${'a'.repeat(64)}` },
    });
    expect(await sessionUser(request)).toBeNull();
  });

  it('cannot enable the development login in production or on an external hostname', () => {
    const local = new Request('http://127.0.0.1:3017/api/v1/dev-session');
    vi.stubEnv('DEV_LOGIN_ENABLED', 'true');
    vi.stubEnv('NODE_ENV', 'production');
    expect(developmentLoginEnabled(local)).toBe(false);
    vi.stubEnv('NODE_ENV', 'development');
    expect(developmentLoginEnabled(local)).toBe(true);
    expect(developmentLoginEnabled(new Request('https://math.example.com/api/v1/dev-session'))).toBe(false);
    vi.stubEnv('DEV_LOGIN_ENABLED', 'false');
    expect(developmentLoginEnabled(local)).toBe(false);
  });
});
