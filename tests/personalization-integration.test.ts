import { createHash, randomUUID } from 'node:crypto';
import { Prisma } from '@prisma/client';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createDatabase } from '@/server/db';
import { LearningService } from '@/server/learning-service';
import { diagnosticProblems } from '@/core/diagnostic';
import { seedClasses } from '@/core/seed';
import { getActivityProblemIds } from '@/core/content';
import type { DiagnosticView, LearningState } from '@/shared/api';

const url = process.env.TEST_DATABASE_URL;
const json = (v: unknown) => JSON.parse(JSON.stringify(v)) as Prisma.InputJsonValue;
const answers = ['4/9', '12', '10', '3/4', '7/11', '5/12'];

describe.skipIf(!url)('personalized learning on MySQL', () => {
  let db: ReturnType<typeof createDatabase>;
  let service: LearningService;
  beforeAll(async () => {
    const parsed = new URL(url!);
    if (parsed.protocol !== 'mysql:' || !parsed.pathname.endsWith('_test')) throw new Error('Use an isolated _test database.');
    db = createDatabase(url!); service = new LearningService(db);
    for (const record of seedClasses) await db.classVersion.upsert({ where: { id: record.public.versionId }, update: {}, create: {
      id: record.public.versionId, classKey: record.public.classKey, title: record.public.title, order: record.public.order,
      document: json(record), contentHash: createHash('sha256').update(JSON.stringify(record)).digest('hex'),
    } });
  });
  afterAll(async () => { await db?.$disconnect(); });
  async function learner(minutes = 10) {
    return db.user.create({ data: { displayName: `placement ${randomUUID().slice(0, 8)}`, dailyMinutes: minutes, scopes: { create: { kind: 'personal' } } } });
  }
  async function place(userId: string, values: (string | null)[]) {
    let state = (await service.act(userId, { action: 'diagnostic.start' })).state;
    for (let i = 0; i < 6; i++) state = (await service.act(userId, { action: 'diagnostic.answer', diagnosticId: state.diagnostic!.id,
      problemVersionId: state.diagnostic!.currentProblem!.problemVersionId, answer: values[i] })).state;
    return state;
  }
  function answer(run: DiagnosticView, value: string | null) {
    return { action: 'diagnostic.answer', diagnosticId: run.id, problemVersionId: run.currentProblem!.problemVersionId, answer: value };
  }
  it('persists resume progress without answer-key leakage, rejects foreign or out-of-order writes, and excludes invalid input', async () => {
    const a = await learner(), b = await learner();
    const start = await service.act(a.id, { action: 'diagnostic.start' });
    expect(start.state.diagnostic?.total).toBe(6);
    expect(start.state.diagnostic?.results).toEqual([]);
    const publicText = JSON.stringify(start);
    for (const field of ['gradingSpec', 'solution', 'numerator', 'denominator']) expect(publicText).not.toContain(`"${field}"`);
    const action = answer(start.state.diagnostic!, '4/9');
    await expect(service.act(b.id, action)).rejects.toMatchObject({ status: 404 });
    await expect(service.act(a.id, { ...action, problemVersionId: diagnosticProblems[2].problemVersionId })).rejects.toMatchObject({ status: 409 });
    const invalid = await service.act(a.id, { ...action, answer: '1/0' });
    expect(invalid.result?.status).toBe('invalid');
    expect(invalid.state.diagnostic?.answered).toBe(0);
    await Promise.all([service.act(a.id, action), service.act(a.id, action)]);
    const state = await new LearningService(db).state(a.id);
    expect(state.diagnostic).toMatchObject({ answered: 1, status: 'active', results: [] });
    expect(state.plan.readiness.every(s => s.readiness === 'unknown')).toBe(true);
    await expect(service.act(a.id, { ...action, answer: '5/9' })).rejects.toMatchObject({ status: 409 });
    expect((await service.state(b.id)).diagnostic).toBeNull();
  });
  it('treats skips as unknown, completes once, and never grants mastery or completion for placement', async () => {
    const user = await learner();
    const state = await place(user.id, Array(6).fill(null));
    expect(state.diagnostic).toMatchObject({ status: 'completed', answered: 6 });
    expect(state.plan.readiness.every(s => s.readiness === 'unknown')).toBe(true);
    expect(state.skills.every(s => s.state === 'unknown')).toBe(true);
    expect(state.enrollments).toEqual([]);
    const restart = await service.act(user.id, { action: 'diagnostic.start' });
    expect(restart.state.diagnostic?.id).toBe(state.diagnostic?.id);
    expect(restart.state.diagnostic?.status).toBe('completed');
    expect(await db.diagnosticRun.count({ where: { userId: user.id } })).toBe(1);
  });
  it('selects the next unknown skill and retains a reason/history across reconnects without GET writes', async () => {
    const user = await learner();
    const state = await place(user.id, [...answers.slice(0, 4), null, null]);
    const target = state.classes.find(c => c.classKey === state.recommendations[0].classKey)!;
    expect(target.skillKeys).toContain('fraction.addition');
    expect(state.plan.readiness[0]).toMatchObject({ readiness: 'ready', source: 'diagnostic' });
    const before = await db.recommendationHistory.count({ where: { userId: user.id } });
    const reconnect = await service.state(user.id);
    expect(reconnect.recommendations).toEqual(state.recommendations);
    expect(await db.recommendationHistory.count({ where: { userId: user.id } })).toBe(before);
    expect(reconnect.recommendationHistory[0].trigger).toBe('diagnostic.answer');
    await service.act(user.id, { action: 'profile.update', dailyMinutes: 5, goal: 'foundation-recovery' });
    expect((await service.state(user.id)).recommendations[0].suggestedMinutes).toBe(5);
    expect(await db.recommendationHistory.count({ where: { userId: user.id } })).toBe(before + 1);
    await service.act(user.id, { action: 'profile.update', dailyMinutes: 5, goal: 'foundation-recovery' });
    expect(await db.recommendationHistory.count({ where: { userId: user.id } })).toBe(before + 1);
  });
  it('persists explicit choices per account, validates the catalogue, and can return to automatic recommendations', async () => {
    const a = await learner(), b = await learner();
    await expect(service.act(a.id, { action: 'recommendation.choose', classKey: 'missing-class' })).rejects.toMatchObject({ status: 404 });
    const chosen = await service.act(a.id, { action: 'recommendation.choose', classKey: 'fraction-addition' });
    expect(chosen.state.recommendations[0].classKey).toBe('fraction-addition');
    expect((await service.state(a.id)).plan.preferredClassKey).toBe('fraction-addition');
    expect((await service.state(b.id)).plan.preferredClassKey).toBeNull();
    const automatic = await service.act(a.id, { action: 'recommendation.choose', classKey: null });
    expect(automatic.state.plan.preferredClassKey).toBeNull();
    expect(automatic.state.classes.find(c => c.classKey === automatic.state.recommendations[0].classKey)!.skillKeys).toContain('fraction.meaning');
  });
  async function finishClass(userId: string, incorrectFirst = false) {
    const record = seedClasses[0];
    const enrollmentId = (await service.act(userId, { action: 'enrollment.start', classKey: record.public.classKey })).enrollmentId!;
    for (const section of record.sections) {
      for (const problemVersionId of getActivityProblemIds(record, section.sectionId)) {
        const spec = record.problems.find(p => p.problemVersionId === problemVersionId)!.gradingSpec;
        const correct = spec.kind === 'integer' ? String(spec.value) : `${spec.numerator}/${spec.denominator}`;
        const action = { action: 'attempt.submit', context: 'class', contextId: enrollmentId, problemVersionId, answer: correct, requestId: randomUUID() };
        if (incorrectFirst) await service.act(userId, { ...action, answer: '999', requestId: randomUUID() });
        await service.act(userId, action);
      }
      await service.act(userId, { action: 'section.complete', enrollmentId, sectionId: section.sectionId });
    }
    return (await service.act(userId, { action: 'class.complete', enrollmentId })).state;
  }
  it('adapts new homework and preserves issued snapshots after profile changes; retries do not inflate evidence', async () => {
    const strong = await learner(10), needsPractice = await learner(5);
    await service.act(strong.id, { action: 'recommendation.choose', classKey: 'fraction-meaning' });
    const strongState = await finishClass(strong.id);
    expect(strongState.plan.preferredClassKey).toBeNull();
    const weakState = await finishClass(needsPractice.id, true);
    const strongAssignment = strongState.assignments[0], weakAssignment = weakState.assignments[0];
    expect(strongAssignment.items).toHaveLength(2);
    expect(weakAssignment.items).toHaveLength(1);
    expect(strongState.plan.readiness[0].readiness).toBe('ready');
    expect(weakState.plan.readiness[0].readiness).toBe('needs-practice');
    expect(new Date(strongAssignment.recommendedAt).getTime() - Date.now()).toBeGreaterThan(2 * 86_400_000);
    expect(new Date(weakAssignment.recommendedAt).getTime() - Date.now()).toBeLessThanOrEqual(86_400_000);
    const changed = (await service.act(needsPractice.id, { action: 'profile.update', goal: 'algebra-ready', dailyMinutes: 20 })).state;
    expect(changed.assignments).toEqual(weakState.assignments);
  }, 30_000);
  it('does not use draft homework as assessment; submitted difficulty supersedes diagnostic success', async () => {
    const user = await learner();
    await place(user.id, answers);
    const scope = await db.scope.findUniqueOrThrow({ where: { ownerUserId: user.id } });
    const assignment = await db.$transaction(tx => service.createPersonalAssignment(tx, user.id, scope.id, seedClasses[0]));
    let state: LearningState = await service.state(user.id);
    const recipient = state.assignments.find(a => a.id === assignment.id)!;
    for (const item of recipient.items) state = (await service.act(user.id, { action: 'attempt.submit', context: 'assignment', contextId: recipient.recipientId,
      problemVersionId: item.problem.problemVersionId, answer: '999', requestId: randomUUID() })).state;
    expect(state.plan.readiness[0]).toMatchObject({ readiness: 'ready', source: 'diagnostic' });
    const finalized = await service.act(user.id, { action: 'assignment.submit', recipientId: recipient.recipientId, requestId: randomUUID() });
    expect(finalized.state.plan.readiness[0]).toMatchObject({ readiness: 'needs-practice', source: 'learning' });
  }, 30_000);
});
