import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { LearningService } from '@/server/learning-service';
import { createDatabase } from '@/server/db';
import { importContent } from '@/server/content-store';
import { gatheredPracticePools } from '@/server/gathered-practice';
import { existingRows, removeRowsAddedSince, type Existing } from './cleanup';
import { lessonBundle, seedLessons, writtenAnswer } from './fixtures/content';

const url = process.env.TEST_DATABASE_URL;
describe.skipIf(!url)('targeted practice lifecycle on MySQL', () => {
  let db: ReturnType<typeof createDatabase>, service: LearningService, existing: Existing;
  const key = `targeted-${randomUUID()}`;
  const misconception = 'solute-over-solute'; // No production question uses this label.
  const record = JSON.parse(JSON.stringify(seedLessons[0]).replaceAll('fraction-meaning', key)) as typeof seedLessons[number];
  record.problems.forEach(problem => { problem.misreadings = [{ answer: '99999', misconception }]; });
  beforeAll(async () => {
    if (!new URL(url!).pathname.endsWith('_test')) throw new Error('Use an isolated _test database.');
    db = createDatabase(url!); service = new LearningService(db); existing = await existingRows(db);
    await importContent(db, lessonBundle([record], { key, title: '맞춤 연습 검사' }));
  });
  afterAll(async () => { if (existing) await removeRowsAddedSince(db, existing); await db?.$disconnect(); });
  async function learner(count = 2) {
    const user = await db.user.create({ data: { displayName: 'targeted test', learningScopes: { create: { kind: 'personal' } } }, include: { learningScopes: true } });
    const scopeId = user.learningScopes[0].id;
    const enrollment = await db.enrollment.create({ data: { userId: user.id, scopeId, lessonVersionId: record.public.versionId, completedSectionIds: [] } });
    const who = { userId: user.id, scopeId, enrollmentId: enrollment.id };
    for (let index = 0; index < count; index++) await answer(who, index, false, new Date(Date.now() - 60_000 + index));
    return who;
  }
  async function answer(who: { userId: string; scopeId: string; enrollmentId: string }, index: number, correct: boolean, createdAt = new Date()) {
    return db.attempt.create({ data: { ...who, problemVersionId: record.problems[index].problemVersionId,
      answer: correct ? writtenAnswer(record.problems[index]) : '99999', createdAt, requestId: randomUUID(),
      result: { status: correct ? 'correct' : 'incorrect', message: 'historical feedback', assisted: false } } });
  }
  it('recommends from reinterpreted historical answers, previews the exact pool, and creates nothing while reading', async () => {
    const who = await learner();
    const before = await db.assignment.count();
    const state = await service.state(who.userId);
    const proposed = state.plan.targetedPractice!;
    expect(proposed).toMatchObject({ misconception, recipientId: null, evidenceIds: record.problems.slice(0, 2).map(problem => problem.problemVersionId) });
    const pool = (await gatheredPracticePools(db, who.userId, [misconception])).get(misconception)!;
    expect(proposed.problemCount).toBe(pool.length);
    expect(proposed.problemCount).toBeGreaterThan(0);
    expect(await db.assignment.count()).toBe(before);
    const opened = await service.act(who.userId, { action: 'practice.gather', misconception });
    const assignment = opened.state.assignments.find(item => item.recipientId === opened.recipientId)!;
    expect(assignment.items.map(item => item.problem.problemVersionId)).toEqual(pool);
    expect(assignment.misconception).toBe(misconception);
    expect((await service.state(who.userId)).assignments.find(item => item.recipientId === opened.recipientId)?.misconception).toBe(misconception);
    expect(opened.state.plan.targetedPractice?.recipientId).toBe(opened.recipientId);
    expect((await service.act(who.userId, { action: 'practice.gather', misconception })).recipientId).toBe(opened.recipientId);
    expect(opened.state.recommendationHistory[0].targetedPractice).toMatchObject({ misconception, recipientId: opened.recipientId });
  });
  it('does not recommend a single miss, an improving pattern, or override a chosen lesson', async () => {
    const single = await learner(1);
    expect((await service.state(single.userId)).plan.targetedPractice).toBeNull();
    const who = await learner();
    await answer(who, 2, true); await answer(who, 3, true);
    const improved = await service.state(who.userId);
    expect(improved.confusion.repeated.find(item => item.key === misconception)?.status).toBe('improving');
    expect(improved.plan.targetedPractice).toBeNull();
    const chosen = await learner();
    const selected = await service.act(chosen.userId, { action: 'recommendation.choose', lessonKey: key });
    expect(selected.state.plan.targetedPractice).toBeNull();
    expect((await service.act(chosen.userId, { action: 'recommendation.choose', lessonKey: null })).state.plan.targetedPractice?.misconception).toBe(misconception);
  });
  it('pauses after submitting a focused round and returns only after another visible occurrence', async () => {
    const who = await learner();
    const opened = await service.act(who.userId, { action: 'practice.gather', misconception });
    const assignment = opened.state.assignments.find(item => item.recipientId === opened.recipientId)!;
    for (const item of assignment.items) await service.act(who.userId, { action: 'attempt.submit', context: 'assignment', contextId: assignment.recipientId,
      problemVersionId: item.problem.problemVersionId, answer: '99999', requestId: randomUUID() });
    const submitted = await service.act(who.userId, { action: 'assignment.submit', recipientId: assignment.recipientId, requestId: randomUUID() });
    expect(submitted.state.confusion.repeated.find(item => item.key === misconception)?.status).toBe('repeated');
    expect(submitted.state.plan.targetedPractice).toBeNull();
    expect(submitted.state.assignments.find(item => item.recipientId === opened.recipientId)?.misconception).toBe(misconception);
    expect(submitted.state.recommendationHistory[0].targetedPractice).toBeNull();
    const sitting = await db.submission.findUniqueOrThrow({ where: { id: assignment.submissionId } });
    await answer(who, 0, false, new Date(sitting.finalizedAt!.getTime() + 1));
    expect((await service.state(who.userId)).plan.targetedPractice?.misconception).toBe(misconception);
  });
  it('does not let a withheld exam verdict change either the recommendation or the gathered pool', async () => {
    const who = await learner();
    const before = await service.state(who.userId);
    const assignment = await db.assignment.create({ data: { ownerScopeId: who.scopeId, title: '비공개 채점', policy: { kind: 'exam', hints: false, results: 'after-submission', solutions: 'never' }, schedule: {}, policySnapshot: {},
      items: { create: { position: 0, problemVersionId: record.problems[2].problemVersionId } },
      recipients: { create: { learnerUserId: who.userId, recommendedAt: new Date(), submissions: { create: {} } } } },
      include: { items: true, recipients: { include: { submissions: true } } } });
    const attempt = await db.attempt.create({ data: { userId: who.userId, scopeId: who.scopeId, submissionId: assignment.recipients[0].submissions[0].id,
      assignmentItemId: assignment.items[0].id, problemVersionId: record.problems[2].problemVersionId, answer: writtenAnswer(record.problems[2]), requestId: randomUUID(),
      result: { status: 'correct', message: '', assisted: false } } });
    const pool = (await gatheredPracticePools(db, who.userId, [misconception])).get(misconception)!;
    expect(pool).toContain(record.problems[2].problemVersionId);
    expect((await service.state(who.userId)).plan.targetedPractice).toEqual(before.plan.targetedPractice);
    await db.attempt.update({ where: { id: attempt.id }, data: { answer: '99999', result: { status: 'incorrect', message: '', assisted: false } } });
    expect((await gatheredPracticePools(db, who.userId, [misconception])).get(misconception)).toEqual(pool);
    expect((await service.state(who.userId)).plan.targetedPractice).toEqual(before.plan.targetedPractice);
  });
});
