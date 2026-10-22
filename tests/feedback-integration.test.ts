import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { existingRows, removeRowsAddedSince, type Existing } from './cleanup';
import { createDatabase } from '@/server/db';
import { FeedbackService } from '@/server/feedback-service';
import { feedbackLimits } from '@/shared/feedback';

const url = process.env.TEST_DATABASE_URL;

describe.skipIf(!url)('lesson feedback on MySQL', () => {
  let db: ReturnType<typeof createDatabase>;
  let existing: Existing;
  let feedback: FeedbackService;
  /** A seeded lesson that holds prose, a drawing or a table, and a set of questions, and the steps they are in. */
  let place: { lessonKey: string; lessonVersionId: string; sectionId: string; figure: string; prose: string; proseStep: string;
    set: string; setStep: string; problem: string };
  let closed: string | null = null;
  beforeAll(async () => {
    const parsed = new URL(url!);
    if (parsed.protocol !== 'mysql:' || !parsed.pathname.endsWith('_test')) throw new Error('Use an isolated _test database.');
    db = createDatabase(url!); feedback = new FeedbackService(db);
    existing = await existingRows(db);
    const blocks = await db.contentBlock.findMany({ where: { ownerKind: 'section' }, select: { ownerVersionId: true, ownerId: true, blockId: true, kind: true, payload: true } });
    const versions = new Map<string, typeof blocks>();
    for (const block of blocks) versions.set(block.ownerVersionId, [...(versions.get(block.ownerVersionId) ?? []), block]);
    for (const [lessonVersionId, held] of versions) {
      const figure = held.find((block) => block.kind !== 'core.rich_text' && block.kind !== 'core.problem_set');
      const prose = held.find((block) => block.kind === 'core.rich_text');
      const set = held.find((block) => block.kind === 'core.problem_set');
      if (!figure || !prose || !set) continue;
      const version = await db.lessonVersion.findUnique({ where: { id: lessonVersionId }, select: { lessonKey: true, lesson: { select: { course: { select: { visibility: true } } } } } });
      if (!version || version.lesson.course.visibility !== 'public') continue;
      place = { lessonKey: version.lessonKey, lessonVersionId, sectionId: figure.ownerId, figure: figure.blockId,
        prose: prose.blockId, proseStep: prose.ownerId, set: set.blockId, setStep: set.ownerId,
        problem: (set.payload as { problemVersionIds: string[] }).problemVersionIds[0] };
      break;
    }
    if (!place) throw new Error('Seed the test database first.');
  });
  afterAll(async () => {
    // A seeded lesson is not this suite's to keep closed; it goes back to how every other suite expects it.
    if (closed) await db.lesson.update({ where: { key: closed }, data: { feedbackOpen: true } });
    if (existing) await removeRowsAddedSince(db, existing);
    await db?.$disconnect();
  });
  const person = async (name: string, role?: 'admin' | 'author') => db.user.create({ data: {
    displayName: `${name} ${randomUUID().slice(0, 8)}`, learningScopes: { create: { kind: 'personal' } },
    ...(role ? { contentAuthor: { create: { role } } } : {}) } });
  const at = (extra: Partial<{ blockId: string | null; problemVersionId: string | null; quote: string | null }> = {}) => ({
    lessonKey: place.lessonKey, lessonVersionId: place.lessonVersionId,
    sectionId: extra.blockId === place.prose ? place.proseStep : extra.blockId === place.set ? place.setStep : place.sectionId,
    blockId: place.figure, problemVersionId: null, quote: null, ...extra });

  it('keeps what a reader said at a place, and shows it to them and to an operator only', async () => {
    const learner = await person('learner'), other = await person('other'), operator = await person('operator', 'admin');
    await feedback.act(learner.id, { action: 'feedback.add', ...at(), body: '  그림에서 칸이 몇 개인지 잘 안 보여요 ' });
    await feedback.act(learner.id, { action: 'feedback.add', ...at({ blockId: place.prose, quote: '  이 \n 문장이\t헷갈려요  ' }), body: '무슨 뜻인지 모르겠어요' });
    const mine = await feedback.act(learner.id, { action: 'feedback.add', ...at({ blockId: place.set, problemVersionId: place.problem }), body: '답이 두 개 같아요' });
    expect(mine.feedback.reviewer).toBe(false);
    expect(mine.feedback.items.map((item) => [item.blockId, item.problemVersionId, item.quote, item.body])).toEqual([
      [place.figure, null, null, '그림에서 칸이 몇 개인지 잘 안 보여요'],
      [place.prose, null, '이 문장이 헷갈려요', '무슨 뜻인지 모르겠어요'],
      [place.set, place.problem, null, '답이 두 개 같아요'],
    ]);
    expect(mine.feedback.items.every((item) => item.author.mine && item.status === 'open')).toBe(true);
    // Another reader sees none of it; an operator sees all of it, with who said it.
    expect((await feedback.lesson(place.lessonKey, other.id)).items.filter((item) => item.author.name === learner.displayName)).toEqual([]);
    const reviewed = await feedback.lesson(place.lessonKey, operator.id);
    expect(reviewed.reviewer).toBe(true);
    expect(reviewed.items.filter((item) => item.author.name === learner.displayName)).toHaveLength(3);
    // Signed out there is nothing to see and nowhere to write.
    expect(await feedback.lesson(place.lessonKey, null)).toEqual({ accepting: false, reviewer: false, items: [] });
  });

  it('refuses a place the reader was not shown', async () => {
    const learner = await person('learner');
    const add = (extra: Parameters<typeof at>[0]) => feedback.act(learner.id, { action: 'feedback.add', ...at(extra), body: '?' });
    await expect(add({ blockId: 'no-such-block' })).rejects.toMatchObject({ status: 404 });
    await expect(add({ blockId: place.figure, problemVersionId: place.problem })).rejects.toMatchObject({ status: 404 });
    await expect(add({ blockId: null, problemVersionId: place.problem })).rejects.toMatchObject({ status: 400 });
    await expect(feedback.act(learner.id, { action: 'feedback.add', ...at(), lessonKey: 'no-such-lesson', body: '?' })).rejects.toMatchObject({ status: 404 });
    await expect(feedback.act(learner.id, { action: 'feedback.add', ...at(), body: '   ' })).rejects.toThrow();
    await expect(feedback.act(learner.id, { action: 'feedback.add', ...at(), body: 'x'.repeat(feedbackLimits.body + 1) })).rejects.toThrow();
    // A long drag is kept as the start of what was dragged.
    const long = await add({ blockId: place.prose, quote: '가'.repeat(feedbackLimits.quote + 40) });
    expect(long.feedback.items.at(-1)!.quote).toHaveLength(feedbackLimits.quote);
  });

  it('lets an operator settle feedback and the reader take back their own', async () => {
    const learner = await person('learner'), other = await person('other'), operator = await person('operator', 'admin'), teacher = await person('teacher', 'author');
    const [item] = (await feedback.act(learner.id, { action: 'feedback.add', ...at(), body: '헷갈려요' })).feedback.items;
    await expect(feedback.act(learner.id, { action: 'feedback.resolve', feedbackId: item.id })).rejects.toMatchObject({ status: 403 });
    await expect(feedback.act(teacher.id, { action: 'feedback.resolve', feedbackId: item.id })).rejects.toMatchObject({ status: 404 });
    await expect(feedback.act(other.id, { action: 'feedback.remove', feedbackId: item.id })).rejects.toMatchObject({ status: 404 });
    await feedback.act(operator.id, { action: 'feedback.resolve', feedbackId: item.id });
    const settled = (await feedback.lesson(place.lessonKey, learner.id)).items.find((entry) => entry.id === item.id)!;
    expect(settled.status).toBe('resolved');
    expect(settled.resolvedAt).not.toBeNull();
    await feedback.act(operator.id, { action: 'feedback.reopen', feedbackId: item.id });
    expect((await db.lessonFeedback.findUniqueOrThrow({ where: { id: item.id } })).resolvedByUserId).toBeNull();
    await feedback.act(learner.id, { action: 'feedback.remove', feedbackId: item.id });
    expect(await db.lessonFeedback.count({ where: { id: item.id } })).toBe(0);
  });

  it('gives the operator a list that says where each note points and whether it still matches', async () => {
    const learner = await person('learner'), operator = await person('operator', 'admin'), teacher = await person('teacher', 'author');
    await feedback.act(learner.id, { action: 'feedback.add', ...at({ blockId: place.prose, quote: '여기' }), body: '목록에 나와야 해요' });
    await expect(feedback.inbox(teacher.id)).rejects.toMatchObject({ status: 403 });
    await expect(feedback.inbox(learner.id)).rejects.toMatchObject({ status: 403 });
    const inbox = await feedback.inbox(operator.id);
    const entry = inbox.entries.find((item) => item.body === '목록에 나와야 해요')!;
    expect(entry).toMatchObject({ lessonKey: place.lessonKey, quote: '여기', author: { name: learner.displayName, mine: false } });
    expect(entry.lessonTitle).not.toBe('');
    expect(entry.sectionTitle).not.toBe('');
    const newest = await db.lessonVersion.findFirst({ where: { lessonKey: place.lessonKey }, orderBy: [{ publishedAt: 'desc' }, { id: 'desc' }], select: { id: true } });
    if (newest!.id === place.lessonVersionId) expect(entry.current).toBe(true);
    expect(entry.step).toBeGreaterThan(0);
    expect(inbox.lessons.find((lesson) => lesson.lessonKey === place.lessonKey)!.open).toBeGreaterThan(0);
  });

  it('takes no feedback on a lesson an operator closed, and only an operator closes one', async () => {
    const learner = await person('learner'), operator = await person('operator', 'admin');
    await expect(feedback.act(learner.id, { action: 'lesson.accepting', lessonKey: place.lessonKey, accepting: false })).rejects.toMatchObject({ status: 403 });
    closed = place.lessonKey;
    expect((await feedback.act(operator.id, { action: 'lesson.accepting', lessonKey: place.lessonKey, accepting: false })).feedback.accepting).toBe(false);
    expect((await feedback.lesson(place.lessonKey, learner.id)).accepting).toBe(false);
    await expect(feedback.act(learner.id, { action: 'feedback.add', ...at(), body: '닫혔나요?' })).rejects.toMatchObject({ status: 409 });
    expect((await feedback.inbox(operator.id)).lessons.find((lesson) => lesson.lessonKey === place.lessonKey)!.accepting).toBe(false);
    await feedback.act(operator.id, { action: 'lesson.accepting', lessonKey: place.lessonKey, accepting: true });
    closed = null;
    await feedback.act(learner.id, { action: 'feedback.add', ...at(), body: '다시 열렸어요' });
  });
});
