import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { existingRows, removeRowsAddedSince, type Existing } from './cleanup';
import { deleteAccount } from '@/server/account-service';
import { createDatabase } from '@/server/db';
import { LearnerSessionsService } from '@/server/learner-sessions';
import { recordVisit } from '@/server/learner-visits';
import { LearningService } from '@/server/learning-service';

const url = process.env.TEST_DATABASE_URL;
const instagram = 'Mozilla/5.0 (Linux; Android 16; SM-S931N; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/155.0 Mobile Safari/537.36 Instagram 451.0.0.53.80 Android';

describe.skipIf(!url)('learners’ sittings on MySQL', () => {
  let db: ReturnType<typeof createDatabase>;
  let existing: Existing;
  let learning: LearningService;
  let sessions: LearnerSessionsService;
  beforeAll(async () => {
    const parsed = new URL(url!);
    if (parsed.protocol !== 'mysql:' || !parsed.pathname.endsWith('_test')) throw new Error('Use an isolated _test database.');
    db = createDatabase(url!); learning = new LearningService(db); sessions = new LearnerSessionsService(db);
    existing = await existingRows(db);
    if (!(await db.lessonVersion.findFirst({ where: { lessonKey: 'similar-triangles' } }))) throw new Error('Seed the test database first.');
  });
  afterAll(async () => {
    if (existing) await removeRowsAddedSince(db, existing);
    await db?.$disconnect();
  });
  const person = async (name: string, role?: 'admin' | 'author') => db.user.create({ data: {
    displayName: `${name} ${randomUUID().slice(0, 8)}`, learningScopes: { create: { kind: 'personal' } },
    ...(role ? { contentAuthor: { create: { role } } } : {}) } });

  it('reads a sitting back as it happened: the browser, each step with its time, each answer', async () => {
    const operator = await person('operator', 'admin'), learner = await person('learner');
    await recordVisit(db, { userId: learner.id, sessionId: 's1', kind: 'login', userAgent: instagram });
    await recordVisit(db, { userId: learner.id, sessionId: 's1', kind: 'open', userAgent: instagram });
    // The same page asking again in the same breath is the same visit.
    await recordVisit(db, { userId: learner.id, sessionId: 's1', kind: 'open', userAgent: instagram });
    expect(await db.learnerVisit.count({ where: { userId: learner.id } })).toBe(2);
    const enrollmentId = (await learning.act(learner.id, { action: 'enrollment.start', lessonKey: 'similar-triangles' })).enrollmentId!;
    const lesson = await learning.lessonDocument('similar-triangles', learner.id);
    const [explanation, example, practice] = lesson.sections;
    await learning.act(learner.id, { action: 'section.complete', enrollmentId, sectionId: explanation.sectionId });
    await learning.act(learner.id, { action: 'section.complete', enrollmentId, sectionId: example.sectionId });
    const question = lesson.problems.find((problem) => practice.contentBlocks.some((block) => JSON.stringify(block).includes(problem.problemVersionId)))!;
    await learning.act(learner.id, { action: 'attempt.submit', context: 'lesson', contextId: enrollmentId, problemVersionId: question.problemVersionId, answer: '999', requestId: randomUUID() });

    // When each step was finished is kept beside what was finished. MySQL keeps a JSON object's keys in its own order.
    const enrollment = await db.enrollment.findUniqueOrThrow({ where: { id: enrollmentId } });
    expect(Object.keys(enrollment.sectionTimes as object).sort()).toEqual([explanation.sectionId, example.sectionId].sort());

    const { learner: listing, sittings } = await sessions.detail(operator.id, learner.id);
    expect(listing).toMatchObject({ recentSittings: 1, answers: 1, lessonsCompleted: 0, lastClient: { inApp: 'instagram', device: 'phone' } });
    expect(sittings).toHaveLength(1);
    const [sitting] = sittings;
    expect(sitting.learnerActive).toBe(true);
    expect(sitting.events.map((event) => event.kind)).toEqual(['joined', 'visit', 'visit', 'lesson', 'section', 'section', 'answer']);
    const steps = sitting.events.filter((event) => event.kind === 'section');
    expect(steps.map((event) => event.kind === 'section' && [event.position, event.sectionTitle])).toEqual([[1, explanation.title], [2, example.title]]);
    expect(steps.every((event) => event.kind === 'section' && event.seconds !== null && event.seconds < 10)).toBe(true);
    const answer = sitting.events.find((event) => event.kind === 'answer');
    expect(answer).toMatchObject({ answer: '999', status: 'incorrect', attempt: 1, where: lesson.title });
    // Read through, it is an app's browser, two steps passed in seconds, and a lesson left unfinished.
    expect(sitting.notes.map((note) => note.kind)).toEqual(['in-app', 'skimmed', 'skimmed', 'stopped']);
    expect(sitting.notes.at(-1)!.text).toBe(`「${lesson.title}」를 ${lesson.sections.length}단계 중 2단계까지 하고 멈췄어요.`);
  });

  it('is the operator’s alone, and goes with the account', async () => {
    const operator = await person('operator', 'admin'), author = await person('author', 'author'), learner = await person('learner');
    await recordVisit(db, { userId: learner.id, sessionId: null, kind: 'open', userAgent: null });
    await expect(sessions.list(author.id)).rejects.toMatchObject({ status: 403 });
    await expect(sessions.detail(learner.id, learner.id)).rejects.toMatchObject({ status: 403 });
    await expect(sessions.detail(operator.id, 'nobody')).rejects.toMatchObject({ status: 404 });
    expect((await sessions.list(operator.id)).learners.some((item) => item.userId === learner.id)).toBe(true);
    await deleteAccount(db, learner.id);
    expect(await db.learnerVisit.count({ where: { userId: learner.id } })).toBe(0);
  });
});
