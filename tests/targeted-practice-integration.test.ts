import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { LearningService } from '@/server/learning-service';
import { createDatabase } from '@/server/db';
import { importContent, verifyContent } from '@/server/content-store';
import { deleteAccount } from '@/server/account-service';
import type { ProblemModel, WrittenProblem } from '@/server/problem-generation';
import { gatheredPracticePools } from '@/server/gathered-practice';
import { AiUsageService } from '@/server/ai-usage-service';
import type { UsageSink } from '@/server/model-usage';
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

  describe('AI 맞춤 연습', () => {
    const concept = record.problems[0].conceptKeys[0];
    // The wrong answer is named for whatever the request aims at: a guess of its own, or the catalogue's name.
    const question = (prompt: string, aim: string): WrittenProblem => ({ prompt, form: 'written', options: [], answer: '3/4', reducedFraction: false,
      misreadings: [{ answer: '2/6', misconception: aim, expression: '(1+1)/(2+4)' }],
      solves: JSON.stringify({ kind: 'value', expression: '1/2 + 1/4' }), hints: ['$\\frac{1}{2}=\\frac{2}{4}$이에요.'], solution: '$\\frac{3}{4}$이에요.' });
    const model = (plan: () => Promise<unknown>) => {
      const read: string[] = [];
      const wrote: string[] = [];
      const fake: ProblemModel = { name: 'fake',
        plan: async (_system, user) => { read.push(user); return plan(); },
        write: async (_system, user) => {
          wrote.push(user);
          // Told the catalogue's name, it uses it; told only the guess's, that one.
          const aim = user.includes(`${misconception}(`) ? misconception : 'hypothesis:1';
          return [question('$\\frac{1}{2}+\\frac{1}{4}$을 계산해 써 주세요.', aim), question('$\\frac{1}{4}+\\frac{1}{2}$을 계산해 써 주세요.', aim)];
        },
        solve: async () => '3/4' };
      return { fake, read, wrote };
    };
    // A guess the catalogue has no name for, pointing at the first two questions.
    const planned = async () => ({
      hypotheses: [{ name: '농도의 기준을 소금의 양으로 잡기', how: '소금물 전체가 아니라 소금의 양으로 나눈다.', evidence: [1, 2], confidence: 'medium', misconception: '' }],
      diagnosis: '농도를 구할 때 소금의 양으로 나눈 답이 있었어요. 기준을 다시 연습해요.',
      targets: [{ conceptKey: concept, focus: 'confused', hypothesis: 1, reason: '서로 다른 문제에서 같은 기준을 잘못 잡았어요.', count: 8 }] });
    // The same guess, which the catalogue does have a name for.
    const catalogued = async () => { const plan = await planned(); plan.hypotheses[0].misconception = misconception; return plan; };

    it('reads the record, writes after the request returns, and opens a set that says what it saw and why', async () => {
      // The model waits until the test has looked at the pending request, as a real one takes a minute.
      let release = () => {};
      const held = new Promise<void>(resolve => { release = resolve; });
      const { fake, read, wrote } = model(async () => { await held; return planned(); });
      const ai = new LearningService(db, () => fake);
      const who = await learner(3);
      expect((await ai.state(who.userId)).aiPractice).toMatchObject({ available: true, remaining: 3, runs: [] });
      const asked = await ai.act(who.userId, { action: 'practice.ai', scope: { kind: 'all' } });
      // The request returns at once, with the work under way.
      expect(asked.recipientId).toBeUndefined();
      expect(asked.state.aiPractice.runs).toMatchObject([{ scope: 'all', status: 'pending' }]);
      await expect(ai.act(who.userId, { action: 'practice.ai', scope: { kind: 'lesson', key } })).rejects.toMatchObject({ status: 409 });
      release();
      await ai.settled();
      expect(read[0]).toContain('범위: 전체 기록');
      expect(read[0]).toContain(`[${concept}]`);
      // What the learner did, question by question, numbered for a guess to point at — and no why.
      expect(read[0]).toContain('#1 [');
      expect(read[0]).toContain('첫 답: 99999 — 틀림, 힌트 없이');
      // The writer was told the guess and the name to give its wrong answer.
      expect(wrote[0]).toContain('hypothesis:1: 농도의 기준을 소금의 양으로 잡기 — 소금물 전체가 아니라 소금의 양으로 나눈다.');
      const state = await ai.state(who.userId);
      expect(state.aiPractice).toMatchObject({ remaining: 2, runs: [] });
      const made = state.assignments.find(item => item.ai?.scope === 'all')!;
      expect(made.title).toBe('AI 맞춤 연습 · 전체 기록');
      expect(made.ai!.diagnosis).toContain('소금의 양으로 나눈 답');
      expect(made.items).toHaveLength(2);
      expect(made.items.every(item => item.problem.problemVersionId.startsWith('generated:') && item.reason === '서로 다른 문제에서 같은 기준을 잘못 잡았어요.')).toBe(true);
      expect(made.ai!.hypotheses).toEqual([{ name: '농도의 기준을 소금의 양으로 잡기', check: { asked: 2, answered: 0, predicted: 0, correct: 0, other: 0 } }]);
      // The guess stays with the set: the frozen questions carry only the catalogue's names.
      const frozen = await db.publishedProblem.findMany({ where: { problemVersionId: { in: made.items.map(item => item.problem.problemVersionId) } } });
      expect(frozen.every(row => row.misreadings === null)).toBe(true);
      // Asking again for the same range opens the set still open.
      expect((await ai.act(who.userId, { action: 'practice.ai', scope: { kind: 'all' } })).recipientId).toBe(made.recipientId);
      // Its questions are graded like any other; the predicted wrong answer is no catalogue mistake,
      // but it is what the guess said, and the set says so.
      const graded = await ai.act(who.userId, { action: 'attempt.submit', context: 'assignment', contextId: made.recipientId,
        problemVersionId: made.items[0].problem.problemVersionId, answer: '2/6', requestId: randomUUID() });
      expect(graded.result).toMatchObject({ status: 'incorrect' });
      expect(graded.result).not.toHaveProperty('misconception');
      await ai.act(who.userId, { action: 'attempt.submit', context: 'assignment', contextId: made.recipientId,
        problemVersionId: made.items[1].problem.problemVersionId, answer: '3/4', requestId: randomUUID() });
      const checked = (await ai.state(who.userId)).assignments.find(item => item.recipientId === made.recipientId)!;
      expect(checked.ai!.hypotheses![0].check).toEqual({ asked: 2, answered: 2, predicted: 1, correct: 1, other: 0 });
      // Once the set is finished, the next plan reads the guess and what its questions found.
      await ai.act(who.userId, { action: 'assignment.submit', recipientId: made.recipientId, requestId: randomUUID() });
      await ai.act(who.userId, { action: 'practice.ai', scope: { kind: 'lesson', key } });
      await ai.settled();
      expect(read.at(-1)).toContain('지난 추측과 확인 결과');
      expect(read.at(-1)).toContain('「농도의 기준을 소금의 양으로 잡기」');
      expect(read.at(-1)).toContain('예측한 오답 1번, 맞힘 1번');
      expect(read.at(-1)).toContain('지난 추측 「농도의 기준을 소금의 양으로 잡기」이 예측한 오답: 2/6');
    });

    it('reads a lesson as the lesson, takes the catalogue\'s name when the guess has one, and refuses a range with too little in it', async () => {
      const { fake, read } = model(catalogued);
      const ai = new LearningService(db, () => fake);
      const thin = await learner(2);
      await expect(ai.act(thin.userId, { action: 'practice.ai', scope: { kind: 'lesson', key } })).rejects.toMatchObject({ status: 409 });
      await expect(ai.act(thin.userId, { action: 'practice.ai', scope: { kind: 'lesson', key: 'no-such-lesson' } })).rejects.toMatchObject({ status: 404 });
      const who = await learner(3);
      await ai.act(who.userId, { action: 'practice.ai', scope: { kind: 'lesson', key } });
      await ai.settled();
      expect(read.at(-1)).toContain(`범위: ${record.public.title}`);
      const made = (await ai.state(who.userId)).assignments.find(item => item.ai?.scope === `lesson:${key}`)!;
      expect(made.title).toBe(`AI 맞춤 연습 · ${record.public.title}`);
      // A guess with a catalogue name is recorded under it, so it adds up with everyone else's.
      const graded = await ai.act(who.userId, { action: 'attempt.submit', context: 'assignment', contextId: made.recipientId,
        problemVersionId: made.items[0].problem.problemVersionId, answer: '2/6', requestId: randomUUID() });
      expect(graded.result).toMatchObject({ status: 'incorrect', misconception });
      const checked = (await ai.state(who.userId)).assignments.find(item => item.recipientId === made.recipientId)!;
      expect(checked.ai!.hypotheses![0].check).toMatchObject({ answered: 1, predicted: 1 });
    });

    it('reads the courses a learner is heading for as one range, and only courses they can see', async () => {
      const { fake, read } = model(planned);
      const ai = new LearningService(db, () => fake);
      const who = await learner(3);
      await expect(ai.act(who.userId, { action: 'practice.ai', scope: { kind: 'courses', keys: [key, 'no-such-course'] } })).rejects.toMatchObject({ status: 404 });
      await ai.act(who.userId, { action: 'practice.ai', scope: { kind: 'courses', keys: [key] } });
      await ai.settled();
      expect(read.at(-1)).toContain('범위: 맞춤 연습 검사');
      const made = (await ai.state(who.userId)).assignments.find(item => item.ai?.scope === `courses:${key}`)!;
      expect(made.title).toBe('AI 맞춤 연습 · 맞춤 연습 검사');
      // Asking again for the same courses in another order opens the same set.
      expect((await ai.act(who.userId, { action: 'practice.ai', scope: { kind: 'courses', keys: [key, key] } })).recipientId).toBe(made.recipientId);
    });

    it('says when it failed, and stops at the day\'s limit', async () => {
      const { fake } = model(async () => { throw new Error('model down'); });
      const ai = new LearningService(db, () => fake);
      const who = await learner(3);
      await ai.act(who.userId, { action: 'practice.ai', scope: { kind: 'all' } });
      await ai.settled();
      const failed = await ai.state(who.userId);
      expect(failed.aiPractice.runs).toMatchObject([{ scope: 'all', status: 'failed' }]);
      expect(failed.aiPractice.runs[0].message).toBeTruthy();
      expect(failed.assignments.some(item => item.ai)).toBe(false);
      await ai.act(who.userId, { action: 'practice.ai', scope: { kind: 'all' } }); await ai.settled();
      await ai.act(who.userId, { action: 'practice.ai', scope: { kind: 'all' } }); await ai.settled();
      expect((await ai.state(who.userId)).aiPractice.remaining).toBe(0);
      await expect(ai.act(who.userId, { action: 'practice.ai', scope: { kind: 'all' } })).rejects.toMatchObject({ status: 409 });
    });

    /** The fake as the real model is: every call it makes is reported to whoever asked, at a fixed size. */
    const metered = (fake: ProblemModel) => (onUsage?: UsageSink): ProblemModel => {
      const report = (step: string) => onUsage?.({ step, model: 'claude-sonnet-5-5', input: 1000, output: 500, cacheRead: 2000, cacheWrite: 0 });
      return { name: fake.name,
        plan: async (system, user) => { report('plan'); return fake.plan!(system, user); },
        write: async (system, user) => { report('write'); return fake.write(system, user); },
        solve: async (system, user) => { report('solve'); return fake.solve(system, user); } };
    };

    it('writes down what each call cost, for the learner and the set, and shows it only to an operator', async () => {
      const { fake } = model(planned);
      const ai = new LearningService(db, metered(fake));
      const who = await learner(3);
      await ai.act(who.userId, { action: 'practice.ai', scope: { kind: 'all' } });
      await ai.settled();
      const set = await db.generatedProblemSet.findFirstOrThrow({ where: { userId: who.userId, scope: 'all' } });
      const rows = await db.modelUsage.findMany({ where: { userId: who.userId } });
      // One plan, one write for the one target, one solve per question written.
      expect(rows.map(row => row.step).sort()).toEqual(['plan', 'solve', 'solve', 'write']);
      expect(rows.every(row => row.feature === 'ai-practice' && row.setId === set.id && row.model === 'claude-sonnet-5-5' && row.costMicros === 7400)).toBe(true);

      const operator = await db.user.create({ data: { displayName: 'usage operator', contentAuthor: { create: { role: 'admin' } } } });
      const author = await db.user.create({ data: { displayName: 'usage author', contentAuthor: { create: { role: 'author' } } } });
      await expect(new AiUsageService(db).view(author.id)).rejects.toMatchObject({ status: 403 });
      const view = await new AiUsageService(db).view(operator.id);
      expect(view.accounts.find(account => account.userId === who.userId)).toMatchObject({ displayName: 'targeted test', last24h: 29600, last30d: 29600, calls: 4, runs: 1 });
      expect(view.features.find(item => item.feature === 'ai-practice')?.runs).toBeGreaterThanOrEqual(1);
      expect(view.days).toHaveLength(30);

      // An account that goes takes its name with it, not what it spent.
      await deleteAccount(db, who.userId);
      const kept = await db.modelUsage.findMany({ where: { id: { in: rows.map(row => row.id) } } });
      expect(kept).toHaveLength(4);
      expect(kept.every(row => row.userId === null)).toBe(true);
      await db.modelUsage.deleteMany({ where: { id: { in: rows.map(row => row.id) } } });
    });

    it('starts nothing once an account or the service has spent what it may, and says why', async () => {
      let writes = 0;
      const { fake } = model(planned);
      const counting: ProblemModel = { ...fake, write: async (system, user) => { writes += 1; return fake.write(system, user); } };
      const ai = new LearningService(db, metered(counting));
      const who = await learner(3);
      // Two dollars in the last day is the default for one account.
      await db.modelUsage.create({ data: { userId: who.userId, feature: 'ai-practice', step: 'write', model: 'claude-sonnet-5-5',
        inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0, costMicros: 2_000_000 } });
      const state = await ai.state(who.userId);
      expect(state.aiPractice).toMatchObject({ remaining: 0, refused: '오늘 쓸 수 있는 AI 사용량을 다 썼어요. 내일 다시 해 보세요.' });
      await expect(ai.act(who.userId, { action: 'practice.ai', scope: { kind: 'all' } })).rejects.toMatchObject({ status: 409, message: expect.stringContaining('AI 사용량을 다 썼어요') });
      // A gathered set opens from the catalogue alone, and nothing is written for it.
      await ai.act(who.userId, { action: 'practice.gather', misconception });
      expect(writes).toBe(0);

      // The service's own limit stops everyone, whatever each has spent.
      const saved = process.env.AI_SERVICE_DAILY_USD;
      process.env.AI_SERVICE_DAILY_USD = '0';
      try {
        const other = await learner(3);
        expect((await ai.state(other.userId)).aiPractice.refused).toBe('오늘은 AI 문제 만들기를 쉬고 있어요. 내일 다시 해 보세요.');
        await expect(ai.act(other.userId, { action: 'practice.ai', scope: { kind: 'all' } })).rejects.toMatchObject({ status: 409 });
      } finally {
        if (saved === undefined) delete process.env.AI_SERVICE_DAILY_USD; else process.env.AI_SERVICE_DAILY_USD = saved;
      }
    });

    it('is not offered where the deployment has no model', async () => {
      const none = new LearningService(db, () => null);
      const who = await learner(3);
      expect((await none.state(who.userId)).aiPractice.available).toBe(false);
      await expect(none.act(who.userId, { action: 'practice.ai', scope: { kind: 'all' } })).rejects.toMatchObject({ status: 503 });
    });
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
