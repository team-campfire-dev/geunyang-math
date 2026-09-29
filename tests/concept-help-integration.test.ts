import { randomUUID } from 'node:crypto';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { LearningService } from '@/server/learning-service';
import * as database from '@/server/db';
import * as auth from '@/server/auth';
import { importContent } from '@/server/content-store';
import { POST } from '@/app/api/v1/concept-help/route';
import { existingRows, removeRowsAddedSince, type Existing } from './cleanup';
import { lessonBundle, seedLessons } from './fixtures/content';
import type { ContentBlock } from '@/shared/api';

const url = process.env.TEST_DATABASE_URL;
describe.skipIf(!url)('concept help access and content on MySQL', () => {
  let db: ReturnType<typeof database.createDatabase>, service: LearningService, existing: Existing;
  let userId: string, scopeId: string, enrollmentId: string, wrongId: string;
  const suffix = randomUUID();
  const key = `help-${suffix}`;
  const known = `known-${suffix}`, missing = `missing-${suffix}`;
  const record = JSON.parse(JSON.stringify(seedLessons[0]).replaceAll('fraction-meaning', key)) as typeof seedLessons[number];
  const block = (text: string, scoped = false): ContentBlock => ({ blockId: `${key}:${scoped ? 'intro' : text.length}`, kind: 'core.rich_text', typeVersion: 3, required: true,
    payload: { text, definitions: scoped ? [{ conceptKey: known, surface: '설명', scopeKind: 'lesson', scopeKey: key }] : [] } });
  record.public.conceptKeys = [...record.public.conceptKeys, known, missing];
  record.problems[0].conceptKeys = [known, missing];
  record.sections[0].contentBlocks = [block('이 수업의 설명입니다.', true)];
  const bundle = lessonBundle([record], { key, title: '개념 설명 테스트' });
  bundle.concepts.push(...[known, missing].map(key => ({ key, label: key, assessable: true })));
  bundle.definitions = [
    { conceptKey: known, scopeKind: 'global', scopeKey: '', blocks: [block('전역 뜻풀이')] },
    { conceptKey: known, scopeKind: 'lesson', scopeKey: key, blocks: [block('이 수업의 뜻풀이')] },
  ];
  const revisionCounts = () => db.$transaction([db.attempt.count(), db.hintUse.count(), db.enrollment.count(), db.recommendationHistory.count()]);
  beforeAll(async () => {
    if (!new URL(url!).pathname.endsWith('_test')) throw new Error('Use an isolated _test database.');
    db = database.createDatabase(url!); service = new LearningService(db); existing = await existingRows(db);
    await importContent(db, bundle);
    const user = await db.user.create({ data: { displayName: 'concept help test', learningScopes: { create: { kind: 'personal' } } }, include: { learningScopes: true } });
    userId = user.id; scopeId = user.learningScopes[0].id;
    const enrollment = await db.enrollment.create({ data: { userId, scopeId, lessonVersionId: record.public.versionId, completedSectionIds: [] } });
    enrollmentId = enrollment.id;
    wrongId = (await db.attempt.create({ data: { userId, scopeId, enrollmentId, problemVersionId: record.problems[0].problemVersionId,
      answer: '999', result: { status: 'incorrect', message: '다시 생각해 보세요.', assisted: false }, requestId: randomUUID() } })).id;
  });
  afterEach(() => { vi.restoreAllMocks(); vi.unstubAllEnvs(); });
  afterAll(async () => { if (existing) await removeRowsAddedSince(db, existing); await db?.$disconnect(); });

  it('reads a named or unnamed wrong answer, prefers a published scoped meaning, and falls back to the teaching step', async () => {
    const before = await revisionCounts();
    const result = await service.conceptHelp(userId, { attemptId: wrongId });
    expect(result.concepts[0].definition?.blocks[0].payload.text).toBe('이 수업의 뜻풀이');
    expect(result.concepts[1]).toMatchObject({ key: missing, definition: null, lesson: { lessonKey: key } });
    expect(result.concepts[1].lesson?.sections[0].contentBlocks[0].payload.definitions).toEqual([]);
    expect(JSON.stringify(result)).not.toMatch(/gradingSpec|misreadings|core.problem_set/);
    expect(await revisionCounts()).toEqual(before);
    // Correcting an answer does not erase access to the historical incorrect attempt.
    await db.attempt.create({ data: { userId, scopeId, enrollmentId, problemVersionId: record.problems[0].problemVersionId,
      answer: '1', result: { status: 'correct', assisted: false }, requestId: randomUUID() } });
    expect((await service.conceptHelp(userId, { attemptId: wrongId })).concepts).toEqual(result.concepts);
  });
  it('rejects other accounts, missing attempts, correct/invalid attempts, and arbitrary client concept requests', async () => {
    await expect(service.conceptHelp('someone-else', { attemptId: wrongId })).rejects.toMatchObject({ status: 404 });
    await expect(service.conceptHelp(userId, { attemptId: 'missing' })).rejects.toMatchObject({ status: 404 });
    for (const status of ['correct', 'invalid']) {
      const attempt = await db.attempt.create({ data: { userId, scopeId, enrollmentId, problemVersionId: record.problems[0].problemVersionId,
        answer: '1', result: { status, assisted: false }, requestId: randomUUID() } });
      await expect(service.conceptHelp(userId, { attemptId: attempt.id })).rejects.toMatchObject({ status: 404 });
    }
    await expect(service.conceptHelp(userId, { attemptId: wrongId, conceptKey: 'unrelated' })).rejects.toThrow();
  });
  it('allows per-item practice but keeps exam results sealed until the same sitting is submitted', async () => {
    const assignment = await db.assignment.create({ data: { ownerScopeId: scopeId, title: '시험', policy: { kind: 'exam', hints: false, results: 'after-submission', solutions: 'never' }, schedule: {}, policySnapshot: {},
      items: { create: { position: 0, problemVersionId: record.problems[0].problemVersionId } },
      recipients: { create: { learnerUserId: userId, recommendedAt: new Date(), submissions: { create: {} } } } },
      include: { items: true, recipients: { include: { submissions: true } } } });
    const submission = assignment.recipients[0].submissions[0];
    const attempt = await db.attempt.create({ data: { userId, scopeId, submissionId: submission.id, assignmentItemId: assignment.items[0].id,
      problemVersionId: record.problems[0].problemVersionId, answer: '999', result: { status: 'incorrect', assisted: false }, requestId: randomUUID() } });
    await expect(service.conceptHelp(userId, { attemptId: attempt.id })).rejects.toMatchObject({ status: 404 });
    await db.submission.update({ where: { id: submission.id }, data: { status: 'submitted' } });
    expect((await service.conceptHelp(userId, { attemptId: attempt.id })).concepts[0].lesson?.lessonKey).toBe(key);
    await db.submission.update({ where: { id: submission.id }, data: { status: 'draft' } });
    await db.assignment.update({ where: { id: assignment.id }, data: { policy: { kind: 'practice', hints: true, results: 'per-item', solutions: 'after-submission' } } });
    expect((await service.conceptHelp(userId, { attemptId: attempt.id })).concepts).toHaveLength(2);
  });
  it('uses the held lesson explanation even after a new version is published', async () => {
    const newer = structuredClone(record);
    newer.public.versionId = `${key}:new`;
    newer.sections[0].contentBlocks = [block('새 판본의 설명')];
    const next = lessonBundle([newer], { key, title: '개념 설명 테스트' });
    next.concepts = bundle.concepts;
    await importContent(db, next);
    const help = await service.conceptHelp(userId, { attemptId: wrongId });
    expect(help.concepts[0].lesson?.sections[0].contentBlocks[0].payload.text).toBe('이 수업의 설명입니다.');
  });
  it('requires a session over HTTP, validates origin/body, and never caches the explanation', async () => {
    vi.stubEnv('APP_ORIGIN', 'http://localhost:3017');
    vi.spyOn(database, 'getDatabase').mockReturnValue(db);
    const incoming = (body: unknown, origin = 'http://localhost:3017') => new Request('http://localhost:3017/api/v1/concept-help', {
      method: 'POST', headers: { origin, 'content-type': 'application/json' }, body: JSON.stringify(body),
    });
    expect((await POST(incoming({ attemptId: wrongId }))).status).toBe(401);
    vi.spyOn(auth, 'requireUser').mockResolvedValue(await db.user.findUniqueOrThrow({ where: { id: userId } }));
    const response = await POST(incoming({ attemptId: wrongId }));
    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect((await POST(incoming({ attemptId: wrongId }, 'https://foreign.invalid'))).status).toBe(403);
    expect((await POST(incoming({ attemptId: 4 }))).status).toBe(400);
  });
});
