import { createHash, randomUUID } from 'node:crypto';
import { Prisma } from '@prisma/client';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { existingRows, removeRowsAddedSince, type Existing } from './cleanup';
import { getActivityProblemIds, validateLesson, type StoredLesson, type StoredProblem } from '@/core/content';
import { seedLessons } from './fixtures/content';
import { ensureLesson } from './fixtures/identity';
import { developmentLoginEnabled, sessionUser } from '@/server/auth';
import { createDatabase } from '@/server/db';
import { LearningService } from '@/server/learning-service';
import { lessonMetadata, lessonRecord, indexLessonDocument, indexTermDocument } from '@/server/content-store';
import type { LearningAction } from '@/shared/api';

const testDatabaseUrl = process.env.TEST_DATABASE_URL;
const record = seedLessons[0];
const asJson = (value: unknown) => JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
const requestId = () => randomUUID();
const problemById = (id: string) => record.problems.find(problem => problem.problemVersionId === id)!;
// Answers are fixture inputs; the separate grading suite verifies the arithmetic itself.
function fixtureAnswer(problem: StoredProblem): string {
  const spec = problem.gradingSpec;
  return spec.kind === 'integer' ? String(spec.value) : `${spec.numerator}/${spec.denominator}`;
}

describe.skipIf(!testDatabaseUrl)('MySQL learning lifecycle and isolation', () => {
  let db: ReturnType<typeof createDatabase>;
  let existing: Existing;
  let service: LearningService;

  async function publishImmutable(document: StoredLesson, publishedAt?: Date) {
    validateLesson(document);
    const serialized = JSON.stringify(document);
    const contentHash = createHash('sha256').update(serialized).digest('hex');
    const previous = await db.lessonVersion.findUnique({ where: { id: document.public.versionId } });
    // A fixture publishes the way the application does, the question index included.
    await indexLessonDocument(db, document);
    if (previous) {
      // A migration renamed the seeded rows in place, so the stored hash is historical; the content must still read back whole.
      expect(await lessonRecord(db, document.public.versionId), `Published fixture ${document.public.versionId} must not change`).toEqual(document);
      return previous;
    }
    await ensureLesson(db, document.public.lessonKey);
    return db.lessonVersion.create({ data: {
      id: document.public.versionId, lessonKey: document.public.lessonKey,
      title: document.public.title,
      metadata: asJson(lessonMetadata(document)), contentHash, ...(publishedAt ? { publishedAt } : {}),
    } });
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
    const assignment = await db.$transaction(tx => service.createPersonalAssignment(tx, learner.userId, learner.scopeId, record));
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
      problemVersionId: record.homeworkProblemIds[0], answer: '1', requestId: requestId() })).rejects.toMatchObject({ status: 404 });
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
    expect(recipient.assignment.items.map(item => item.problemVersionId).sort()).toEqual([...record.homeworkProblemIds].sort());
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

  it('supports a standalone assignment without an enrollment while preserving its content snapshot', async () => {
    const learner = await newLearner();
    const recipient = await standaloneAssignment(learner);
    expect(recipient.sourceEnrollmentId).toBeNull();
    expect(await db.enrollment.count({ where: { userId: learner.userId } })).toBe(0);
    expect(recipient.assignment.items[0].problemSnapshot).toEqual(problemById(recipient.assignment.items[0].problemVersionId));
    const state = await service.state(learner.userId);
    expect(state.assignments).toHaveLength(1);
    expect(state.assignments[0]).toMatchObject({ recipientId: recipient.id, lessonKey: null, status: 'assigned' });
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
    expect(practicing.skills.filter(skill => problemById(firstItem.problemVersionId).skillKeys.includes(skill.key)))
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
    await publishImmutable(first, new Date(Date.now() - 10_000));
    const enrollmentId = await enroll(learner.userId, lessonKey);
    const second = structuredClone(first);
    second.public = { ...second.public, versionId: `${lessonKey}:v2`, title: `${second.public.title} · 두 번째 판본` };
    await publishImmutable(second, new Date());
    expect((await service.lessonDocument(lessonKey, learner.userId)).versionId).toBe(first.public.versionId);
    expect((await service.catalog()).find(item => item.lessonKey === lessonKey)?.versionId).toBe(second.public.versionId);
    expect(await enroll(learner.userId, lessonKey)).toBe(enrollmentId);
    const nextEnrollmentId = await enroll(nextLearner.userId, lessonKey);
    const nextEnrollment = await db.enrollment.findUniqueOrThrow({ where: { id: nextEnrollmentId } });
    expect(nextEnrollment.lessonVersionId).toBe(second.public.versionId);
    // The version a learner started stays exactly what it was published as.
    expect(await lessonRecord(db, first.public.versionId)).toEqual(first);
  });

  it('explains every term a lesson linked, wherever the author linked it', async () => {
    const learner = await newLearner();
    const suffix = randomUUID();
    const lessonKey = `integration-glossary-${suffix}`;
    const [earlier, primary, secondary] = ['earlier', 'primary', 'secondary'].map(name => `test.${name}.${suffix}`);
    await db.skill.createMany({ data: [earlier, primary, secondary].map((key, order) => ({ key, label: key, order: 2000 + order })) });
    // A fixture publishes the way the application does: the definition is read back from its rows.
    const publishTerm = async (skillKey: string) => {
      const blocks = [{ blockId: `term.${skillKey}:v1:b1`, kind: 'core.rich_text', typeVersion: 1, required: true, payload: { text: `${skillKey} 정의` } }];
      await db.termVersion.create({ data: {
        id: `term.${skillKey}:v1`, termKey: `term.${skillKey}`, skillKey, label: skillKey, summary: `${skillKey} 한 줄 설명`,
        contentHash: createHash('sha256').update(skillKey).digest('hex'),
      } });
      await indexTermDocument(db, `term.${skillKey}:v1`, blocks);
    };
    for (const skillKey of [earlier, primary, secondary]) await publishTerm(skillKey);

    // Fresh question IDs: a published problem version is immutable across every lesson in the database.
    const custom = JSON.parse(JSON.stringify(record).replaceAll(record.public.lessonKey, lessonKey)) as StoredLesson;
    custom.public = { ...custom.public, skillKeys: [primary, secondary], prerequisiteSkillKeys: [earlier] };
    for (const problem of custom.problems) problem.skillKeys = [primary];
    const [firstHomework, secondHomework] = custom.homeworkProblemIds.map(id => custom.problems.find(p => p.problemVersionId === id)!);
    secondHomework.skillKeys = [secondary];
    const link = (termKey: string, surface: string) => ({ termKey, surface });
    const section = custom.sections[0];
    section.contentBlocks[0] = { ...section.contentBlocks[0], typeVersion: 2, payload: {
      text: '앞선 개념 위에서 지금 개념을 배워요.',
      terms: [link(`term.${earlier}`, '앞선 개념'), link(`term.${primary}`, '지금 개념')] } };
    // A question may carry links too; what it explains is the author's decision, not the server's.
    firstHomework.promptContent[0] = { ...firstHomework.promptContent[0], typeVersion: 2, payload: {
      text: '앞선 개념을 떠올리고 다른 개념도 확인해요.',
      terms: [link(`term.${earlier}`, '앞선 개념'), link(`term.${secondary}`, '다른 개념')] } };
    await publishImmutable(custom);

    const document = await service.lessonDocument(lessonKey);
    // Every word any of the document's blocks linked is explained — its sections and its questions
    // alike — including the concept this very lesson teaches, which used to be withheld.
    expect(document.glossary.map(entry => entry.termKey).sort())
      .toEqual([`term.${earlier}`, `term.${primary}`, `term.${secondary}`].sort());
    expect(document.glossary.find(entry => entry.termKey === `term.${earlier}`))
      .toMatchObject({ skillKey: earlier, lessonKey: null, summary: `${earlier} 한 줄 설명` });

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
    expect(assignment.items.map(item => item.problem.problemVersionId).sort()).toEqual([...custom.homeworkProblemIds].sort());
    // The review carries what its own questions linked, and only that: the section's link to the
    // primary concept is not part of this assignment, so its definition is not sent here.
    expect(assignment.glossary.map(entry => entry.termKey).sort()).toEqual([`term.${earlier}`, `term.${secondary}`].sort());
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
