import { createHash, randomUUID } from 'node:crypto';
import { Prisma } from '@prisma/client';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { existingRows, removeRowsAddedSince, type Existing } from './cleanup';
import { createDatabase } from '@/server/db';
import { LearningService } from '@/server/learning-service';
import { diagnosticProblems } from './fixtures/content';
import { lessonBundle, seedLessons } from './fixtures/content';
import type { LessonRecord } from '@/core/content';
import { getActivityProblemIds } from '@/core/content';
import historical from './fixtures/fractions-v1.json';
import { importContent } from '@/server/content-store';
import type { DiagnosticView, LearningState } from '@/shared/api';

const url = process.env.TEST_DATABASE_URL;
const json = (v: unknown) => JSON.parse(JSON.stringify(v)) as Prisma.InputJsonValue;
const answers = ['4/9', '12', '10', '3/4', '7/11', '5/12'];

describe.skipIf(!url)('personalized learning on MySQL', () => {
  let db: ReturnType<typeof createDatabase>;
  let existing: Existing;
  let service: LearningService;
  beforeAll(async () => {
    const parsed = new URL(url!);
    if (parsed.protocol !== 'mysql:' || !parsed.pathname.endsWith('_test')) throw new Error('Use an isolated _test database.');
    db = createDatabase(url!); service = new LearningService(db);
    existing = await existingRows(db);
    // This policy scenario deliberately uses the historical three-topic diagnostic.
    await importContent(db, historical);
  });
  afterAll(async () => {
    // A shared database keeps whatever a run leaves behind, so this run leaves nothing.
    if (existing) await removeRowsAddedSince(db, existing);
    await db?.$disconnect();
  });
  async function learner(minutes = 10) {
    return db.user.create({ data: { displayName: `placement ${randomUUID().slice(0, 8)}`, dailyMinutes: minutes, learningScopes: { create: { kind: 'personal' } } } });
  }
  /** `values` is what the learner would answer to each question of the bank, in the bank's order. */
  async function place(userId: string, values: (string | null)[]) {
    const intended = new Map(diagnosticProblems.map((problem, index) => [problem.problemVersionId, values[index]]));
    let state = (await service.act(userId, { action: 'diagnostic.start' })).state;
    // A placement chooses which of those to put, and stops when it has settled what it can.
    while (state.diagnostic?.currentProblem) {
      const asked = state.diagnostic.currentProblem.problemVersionId;
      state = (await service.act(userId, { action: 'diagnostic.answer', diagnosticId: state.diagnostic.id,
        problemVersionId: asked, answer: intended.get(asked) ?? null })).state;
    }
    return state;
  }
  /** The answer meant for whichever question the placement has put, since it chooses the order. */
  const meantFor = (run: DiagnosticView) =>
    answers[diagnosticProblems.findIndex(p => p.problemVersionId === run.currentProblem!.problemVersionId)];
  function answer(run: DiagnosticView, value: string | null) {
    return { action: 'diagnostic.answer', diagnosticId: run.id, problemVersionId: run.currentProblem!.problemVersionId, answer: value };
  }
  it('persists resume progress without answer-key leakage, rejects foreign or out-of-order writes, and excludes invalid input', async () => {
    const a = await learner(), b = await learner();
    const start = await service.act(a.id, { action: 'diagnostic.start' });
    // The scope is every concept the catalogue teaches; the bank only asks about some of them.
    expect(start.state.diagnostic).toMatchObject({ answered: 0, settled: 0 });
    expect(start.state.diagnostic!.scope).toBeGreaterThan(0);
    expect(start.state.diagnostic?.results).toEqual([]);
    const publicText = JSON.stringify(start);
    for (const field of ['gradingSpec', 'solution', 'numerator', 'denominator']) expect(publicText).not.toContain(`"${field}":`);
    const action = answer(start.state.diagnostic!, meantFor(start.state.diagnostic!));
    await expect(service.act(b.id, action)).rejects.toMatchObject({ status: 404 });
    // Any question but the one the placement is asking, since it no longer walks the bank in order.
    const elsewhere = diagnosticProblems.find(p => p.problemVersionId !== action.problemVersionId)!;
    await expect(service.act(a.id, { ...action, problemVersionId: elsewhere.problemVersionId })).rejects.toMatchObject({ status: 409 });
    const invalid = await service.act(a.id, { ...action, answer: '1/0' });
    expect(invalid.result?.status).toBe('invalid');
    expect(invalid.state.diagnostic?.answered).toBe(0);
    await Promise.all([service.act(a.id, action), service.act(a.id, action)]);
    const state = await new LearningService(db).state(a.id);
    expect(state.diagnostic).toMatchObject({ answered: 1, status: 'active', results: [] });
    expect(state.plan.readiness.every(s => s.readiness === 'unknown')).toBe(true);
    await expect(service.act(a.id, { ...action, answer: '99' })).rejects.toMatchObject({ status: 409 });
    expect((await service.state(b.id)).diagnostic).toBeNull();
  });
  it('treats skips as unknown, completes once, and never grants mastery or completion for placement', async () => {
    const user = await learner();
    const state = await place(user.id, Array(6).fill(null));
    // A skip settles its concept at once, so the six-question bank ends after one per concept.
    expect(state.diagnostic).toMatchObject({ status: 'completed', answered: 3 });
    expect(state.plan.readiness.every(s => s.readiness === 'unknown')).toBe(true);
    expect(state.concepts.every(s => s.state === 'unknown')).toBe(true);
    expect(state.enrollments).toEqual([]);
    const restart = await service.act(user.id, { action: 'diagnostic.start' });
    expect(restart.state.diagnostic?.id).toBe(state.diagnostic?.id);
    expect(restart.state.diagnostic?.status).toBe('completed');
    expect(await db.diagnosticRun.count({ where: { userId: user.id } })).toBe(1);
  });
  it('starts over rather than stranding a run begun before placements descended a graph', async () => {
    const user = await learner();
    const started = (await service.act(user.id, { action: 'diagnostic.start' })).state;
    const before = started.diagnostic!.id;
    // What such a row looks like: a snapshot and answers, and no record of what it had settled.
    await db.diagnosticRun.update({ where: { id: before }, data: { placement: Prisma.DbNull } });
    expect((await service.state(user.id)).diagnostic).toBeNull();
    const again = (await service.act(user.id, { action: 'diagnostic.start' })).state;
    expect(again.diagnostic).not.toBeNull();
    expect(again.diagnostic!.id).not.toBe(before);
    expect(again.diagnostic!.currentProblem).not.toBeNull();
    expect(await db.diagnosticRun.count({ where: { userId: user.id } })).toBe(1);
  });
  it('selects the next unknown concept and retains a reason/history across reconnects without GET writes', async () => {
    const user = await learner();
    const state = await place(user.id, [...answers.slice(0, 4), null, null]);
    const target = state.lessons.find(c => c.lessonKey === state.recommendations[0].lessonKey)!;
    expect(target.conceptKeys).toContain('fraction.addition');
    // Answering equivalence carried meaning without asking about it, all the way through the stack.
    expect(state.plan.readiness[0]).toMatchObject({ readiness: 'ready', source: 'inferred' });
    const before = await db.recommendationHistory.count({ where: { userId: user.id } });
    const reconnect = await service.state(user.id);
    expect(reconnect.recommendations).toEqual(state.recommendations);
    expect(await db.recommendationHistory.count({ where: { userId: user.id } })).toBe(before);
    expect(reconnect.recommendationHistory[0].trigger).toBe('diagnostic.answer');
    await service.act(user.id, { action: 'profile.update', dailyMinutes: 5, targetCourseKey: null });
    expect((await service.state(user.id)).recommendations[0].suggestedMinutes).toBe(5);
    expect(await db.recommendationHistory.count({ where: { userId: user.id } })).toBe(before + 1);
    await service.act(user.id, { action: 'profile.update', dailyMinutes: 5, targetCourseKey: null });
    expect(await db.recommendationHistory.count({ where: { userId: user.id } })).toBe(before + 1);
  });
  it('persists explicit choices per account, validates the catalogue, and can return to automatic recommendations', async () => {
    const a = await learner(), b = await learner();
    await expect(service.act(a.id, { action: 'recommendation.choose', lessonKey: 'missing-lesson' })).rejects.toMatchObject({ status: 404 });
    const chosen = await service.act(a.id, { action: 'recommendation.choose', lessonKey: 'fraction-addition' });
    expect(chosen.state.recommendations[0].lessonKey).toBe('fraction-addition');
    expect((await service.state(a.id)).plan.preferredLessonKey).toBe('fraction-addition');
    expect((await service.state(b.id)).plan.preferredLessonKey).toBeNull();
    const automatic = await service.act(a.id, { action: 'recommendation.choose', lessonKey: null });
    expect(automatic.state.plan.preferredLessonKey).toBeNull();
    expect(automatic.state.lessons.find(c => c.lessonKey === automatic.state.recommendations[0].lessonKey)!.conceptKeys).toContain('fraction.meaning');
  });
  async function finishLesson(userId: string, incorrectFirst = false) {
    const record = seedLessons[0];
    const enrollmentId = (await service.act(userId, { action: 'enrollment.start', lessonKey: record.public.lessonKey })).enrollmentId!;
    for (const section of record.sections) {
      for (const problemVersionId of getActivityProblemIds(record, section.sectionId)) {
        const spec = record.problems.find(p => p.problemVersionId === problemVersionId)!.gradingSpec;
        const correct = spec.kind === 'integer' ? String(spec.value) : `${spec.numerator}/${spec.denominator}`;
        const action = { action: 'attempt.submit', context: 'lesson', contextId: enrollmentId, problemVersionId, answer: correct, requestId: randomUUID() };
        if (incorrectFirst) await service.act(userId, { ...action, answer: '999', requestId: randomUUID() });
        await service.act(userId, action);
      }
      await service.act(userId, { action: 'section.complete', enrollmentId, sectionId: section.sectionId });
    }
    return (await service.act(userId, { action: 'lesson.complete', enrollmentId })).state;
  }
  it('adapts new homework and preserves issued snapshots after profile changes; retries do not inflate evidence', async () => {
    const strong = await learner(10), needsPractice = await learner(5);
    await service.act(strong.id, { action: 'recommendation.choose', lessonKey: 'fraction-meaning' });
    const strongState = await finishLesson(strong.id);
    expect(strongState.plan.preferredLessonKey).toBeNull();
    const weakState = await finishLesson(needsPractice.id, true);
    const strongAssignment = strongState.assignments[0], weakAssignment = weakState.assignments[0];
    expect(strongAssignment.items).toHaveLength(2);
    expect(weakAssignment.items).toHaveLength(1);
    expect(strongState.plan.readiness[0].readiness).toBe('ready');
    expect(weakState.plan.readiness[0].readiness).toBe('needs-practice');
    expect(new Date(strongAssignment.recommendedAt).getTime() - Date.now()).toBeGreaterThan(2 * 86_400_000);
    expect(new Date(weakAssignment.recommendedAt).getTime() - Date.now()).toBeLessThanOrEqual(86_400_000);
    const changed = (await service.act(needsPractice.id, { action: 'profile.update', targetCourseKey: 'fractions', dailyMinutes: 20 })).state;
    expect(changed.assignments).toEqual(weakState.assignments);
  }, 30_000);
  it('does not use draft homework as assessment; submitted difficulty supersedes diagnostic success', async () => {
    const user = await learner();
    await place(user.id, answers);
    const scope = await db.learningScope.findUniqueOrThrow({ where: { ownerUserId: user.id } });
    const assignment = (await db.$transaction(tx => service.createPersonalAssignment(tx, user.id, scope.id, seedLessons[0])))!;
    let state: LearningState = await service.state(user.id);
    const recipient = state.assignments.find(a => a.id === assignment.id)!;
    for (const item of recipient.items) state = (await service.act(user.id, { action: 'attempt.submit', context: 'assignment', contextId: recipient.recipientId,
      problemVersionId: item.problem.problemVersionId, answer: '999', requestId: randomUUID() })).state;
    // Answering equivalence carried meaning without asking about it, all the way through the stack.
    expect(state.plan.readiness[0]).toMatchObject({ readiness: 'ready', source: 'inferred' });
    const finalized = await service.act(user.id, { action: 'assignment.submit', recipientId: recipient.recipientId, requestId: randomUUID() });
    expect(finalized.state.plan.readiness[0]).toMatchObject({ readiness: 'needs-practice', source: 'learning' });
  }, 30_000);

  it('names only the concepts a published lesson teaches, since the rest can never be settled', async () => {
    const user = await learner();
    const state = await service.state(user.id);
    const taught = new Set(state.lessons.flatMap(lesson => lesson.conceptKeys));
    const listed = state.plan.readiness.map(item => item.key);
    expect(listed.length).toBeGreaterThan(0);
    // A concept no lesson teaches has nowhere to be learned, so 「아직 확인 전」would be permanent.
    expect(listed.filter(key => !taught.has(key)), '가르치는 수업이 없는 개념이 준비도에 있다').toEqual([]);
    expect(state.concepts.map(item => item.key).filter(key => !taught.has(key))).toEqual([]);
  });

  it('bounds a placement by the course someone named, and refuses a course nobody published', async () => {
    const wide = await learner();
    const wideRun = (await service.act(wide.id, { action: 'diagnostic.start' })).state.diagnostic!;

    const narrow = await learner();
    const named = (await service.act(narrow.id, { action: 'profile.update', targetCourseKey: 'fractions', dailyMinutes: 10 })).state;
    expect(named.user.targetCourseKey).toBe('fractions');
    const narrowRun = (await service.act(narrow.id, { action: 'diagnostic.start' })).state.diagnostic!;
    expect(narrowRun.scope, '과정을 골라도 카탈로그 전체를 확인한다').toBeLessThan(wideRun.scope);

    // A destination has to be somewhere the catalogue goes; clearing it is always allowed.
    await expect(service.act(narrow.id, { action: 'profile.update', targetCourseKey: 'no-such-course', dailyMinutes: 10 }))
      .rejects.toMatchObject({ status: 404 });
    expect((await service.act(narrow.id, { action: 'profile.update', targetCourseKey: null, dailyMinutes: 10 })).state.user.targetCourseKey).toBeNull();
    // The placement already under way keeps the scope it started with.
    expect((await service.state(narrow.id)).diagnostic!.scope).toBe(narrowRun.scope);
  });

  it('reads the placement a run recorded rather than working it out again', async () => {
    const user = await learner();
    const done = await place(user.id, answers);
    const key = done.plan.readiness.find(r => r.readiness === 'ready')!.key;

    // The record says otherwise than the answers would. Whichever the screen shows is the answer to
    // whether a finished placement is a record or a calculation — and it has to be a record, or a
    // catalogue published next month quietly re-places everyone who has stopped answering.
    const run = await db.diagnosticRun.findFirstOrThrow({ where: { userId: user.id } });
    const held = run.placement as { placed: Record<string, string>; source: Record<string, string> };
    await db.diagnosticRun.update({ where: { id: run.id },
      data: { placement: json({ ...held, placed: { ...held.placed, [key]: 'needs-practice' } }) } });

    const after = await service.state(user.id);
    expect(after.plan.readiness.find(r => r.key === key)).toMatchObject({ readiness: 'needs-practice' });
  });

  // Last in the file: it publishes a lesson version that changes the graph the catalogue implies.
  it('keeps a finished placement as it was decided when the catalogue changes underneath it', async () => {
    const user = await learner();
    const before = await place(user.id, answers);
    expect(before.diagnostic?.status).toBe('completed');
    // Keyed, not ordered: the catalogue decides the order concepts are listed in, and it is moving.
    const verdicts = (state: { plan: { readiness: { key: string; readiness: string; source: string }[] } }) =>
      Object.fromEntries(state.plan.readiness.map(r => [r.key, `${r.readiness}/${r.source}`]));
    const decided = verdicts(before);

    // The same lesson, published again with nothing standing in front of it. The concepts are the
    // same, so the placement still speaks about them — what moves is what depends on what, which is
    // exactly what the descent read when it chose its questions.
    const loosened = structuredClone(seedLessons[1] as unknown as LessonRecord);
    loosened.public = { ...loosened.public, versionId: `loosened-${randomUUID().slice(0, 8)}`, prerequisiteConceptKeys: [] };
    await importContent(db, lessonBundle([loosened]));
    const after = await service.state(user.id);

    expect(after.lessons.find(l => l.lessonKey === loosened.public.lessonKey)?.prerequisiteConceptKeys).toEqual([]);
    expect(verdicts(after)).toEqual(decided);
  });
});
