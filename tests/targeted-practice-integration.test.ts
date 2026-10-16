import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { LearningService } from '@/server/learning-service';
import { createDatabase } from '@/server/db';
import { importContent, verifyContent } from '@/server/content-store';
import { deleteAccount } from '@/server/account-service';
import type { ProblemModel, WrittenProblem } from '@/server/problem-generation';
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
  it('fills a gathered set the catalogue cannot, from this learner\'s own wrong answers, with checked questions only they get', async () => {
    const asked: string[] = [];
    const written = (prompt: string, misreadings: WrittenProblem['misreadings']): WrittenProblem => ({
      prompt, form: 'written', options: [], answer: '3/4', reducedFraction: false, misreadings,
      solves: JSON.stringify({ kind: 'value', expression: '1/2 + 1/4' }), hints: ['$\\frac{1}{2}=\\frac{2}{4}$이에요.'], solution: '$\\frac{2}{4}+\\frac{1}{4}=\\frac{3}{4}$이에요.' });
    const model: ProblemModel = { name: 'fake',
      write: async (_system, user) => { asked.push(user); return [
        written('$\\frac{1}{2}+\\frac{1}{4}$을 계산해 써 주세요.', [{ answer: '2/6', misconception, expression: '(1+1)/(2+4)' }]),
        // Checked and right, but not built to catch this mistake, so it says nothing about it.
        written('$\\frac{1}{4}+\\frac{1}{2}$을 계산해 써 주세요.', []),
      ]; },
      solve: async () => '3/4' };
    const filling = new LearningService(db, () => model);
    const who = await learner();
    expect((await filling.state(who.userId)).plan.targetedPractice?.problemCount).toBe(6);
    const pool = (await gatheredPracticePools(db, who.userId, [misconception])).get(misconception)!;
    expect(pool.length).toBeLessThan(6);
    const opened = await filling.act(who.userId, { action: 'practice.gather', misconception });
    const assignment = opened.state.assignments.find(item => item.recipientId === opened.recipientId)!;
    const ids = assignment.items.map(item => item.problem.problemVersionId);
    // The catalogue's questions first, then the one written for this learner; the off-target one is not kept.
    expect(ids.slice(0, pool.length)).toEqual(pool);
    expect(ids.slice(pool.length)).toHaveLength(1);
    expect(ids.at(-1)).toMatch(/^generated:/);
    expect(assignment.generated).toBe(1);
    // The writer read what this learner actually wrote.
    expect(asked[0]).toContain('학습자의 답: 99999');
    const set = await db.generatedProblemSet.findFirstOrThrow({ where: { userId: who.userId } });
    expect(set).toMatchObject({ misconception, requested: 6 - pool.length, kept: 1, courseKey: key });
    // A wrong answer to it is recorded under the mistake it was written to catch.
    const graded = await filling.act(who.userId, { action: 'attempt.submit', context: 'assignment', contextId: assignment.recipientId,
      problemVersionId: ids.at(-1)!, answer: '2/6', requestId: randomUUID() });
    expect(graded.result).toMatchObject({ status: 'incorrect', misconception });
    // Nobody else's gathering reads it, and the published content still verifies whole.
    const other = await learner();
    expect((await gatheredPracticePools(db, other.userId, [misconception])).get(misconception)).not.toContain(ids.at(-1));
    await expect(verifyContent(db)).resolves.toBeDefined();
    // Asking again on another day reuses what is unanswered rather than writing it again.
    await db.generatedProblemSet.update({ where: { id: set.id }, data: { createdAt: new Date(Date.now() - 2 * 86400000) } });
    expect((await gatheredPracticePools(db, who.userId, [misconception])).get(misconception)).toContain(ids.at(-1));
    // Their account takes the questions with it.
    await deleteAccount(db, who.userId);
    expect(await db.publishedProblem.count({ where: { ownerVersionId: set.id } })).toBe(0);
    expect(await db.contentBlock.count({ where: { ownerVersionId: set.id } })).toBe(0);
  });

  it('writes nothing past the day\'s limit, and says so when there is nothing else to give', async () => {
    let writes = 0;
    const model: ProblemModel = { name: 'fake', write: async () => { writes += 1; return []; }, solve: async () => '' };
    const limited = new LearningService(db, () => model);
    const who = await learner();
    await db.generatedProblemSet.createMany({ data: Array.from({ length: 5 }, () => ({ id: `generated:${randomUUID()}`, userId: who.userId,
      misconception, model: 'fake', requested: 1, kept: 0 })) });
    expect((await limited.state(who.userId)).plan.targetedPractice?.problemCount).toBeLessThan(6);
    const opened = await limited.act(who.userId, { action: 'practice.gather', misconception });
    expect(writes).toBe(0);
    expect(opened.state.assignments.find(item => item.recipientId === opened.recipientId)?.generated).toBeUndefined();
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
