import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { existingRows, removeRowsAddedSince, type Existing } from './cleanup';
import { createDatabase } from '@/server/db';
import { LearningService } from '@/server/learning-service';
import { TeachingService } from '@/server/teaching-service';
import { formatInvite } from '@/shared/teaching';

const url = process.env.TEST_DATABASE_URL;
/** The exam the first learner sits: three courses of the second year, set by somebody who teaches her. */
const exam = ['similarity', 'pythagoras', 'probability'];

describe.skipIf(!url)('teaching on MySQL', () => {
  let db: ReturnType<typeof createDatabase>;
  let existing: Existing;
  let learning: LearningService;
  let teaching: TeachingService;
  let kept: string | null = null;
  beforeAll(async () => {
    const parsed = new URL(url!);
    if (parsed.protocol !== 'mysql:' || !parsed.pathname.endsWith('_test')) throw new Error('Use an isolated _test database.');
    db = createDatabase(url!); learning = new LearningService(db); teaching = new TeachingService(db);
    existing = await existingRows(db);
    if (!(await db.lessonVersion.findFirst({ where: { lesson: { course: { key: 'probability' } } } }))) throw new Error('Seed the test database first.');
  });
  afterAll(async () => {
    // A seeded course is not this suite's to keep back; it goes back to how every other suite expects it.
    if (kept) await db.course.update({ where: { key: kept }, data: { visibility: 'public' } });
    if (existing) await removeRowsAddedSince(db, existing);
    await db?.$disconnect();
  });
  const person = async (name: string, role?: 'admin' | 'author') => db.user.create({ data: {
    displayName: `${name} ${randomUUID().slice(0, 8)}`, learningScopes: { create: { kind: 'personal' } },
    ...(role ? { contentAuthor: { create: { role } } } : {}) } });
  const courseOf = (state: Awaited<ReturnType<LearningService['state']>>, lessonKey: string) => state.lessons.find(lesson => lesson.lessonKey === lessonKey)?.courseKey;

  it('links a learner by the code she types, and nobody else can reach her', async () => {
    const teacher = await person('teacher', 'author'), learner = await person('learner'), stranger = await person('stranger', 'author');
    expect((await teaching.view(teacher.id)).invite).toBeNull();
    const code = (await teaching.act(teacher.id, { action: 'invite.renew' })).teaching.invite!;
    // Read aloud and typed by hand: dashes, spaces and case are not part of it.
    const typed = ` ${formatInvite(code).toLowerCase()} `;
    const joined = (await learning.act(learner.id, { action: 'teaching.join', code: typed })).state;
    expect(joined.teaching.teachers).toEqual([expect.objectContaining({ kind: 'person', name: teacher.displayName })]);
    await learning.act(learner.id, { action: 'teaching.join', code });
    expect(await db.teachingLink.count({ where: { learnerUserId: learner.id } })).toBe(1);
    await expect(learning.act(learner.id, { action: 'teaching.join', code: 'ZZZZ-ZZZZ' })).rejects.toMatchObject({ status: 404 });
    await expect(learning.act(teacher.id, { action: 'teaching.join', code })).rejects.toMatchObject({ status: 409 });
    expect((await teaching.view(teacher.id)).learners.map(item => item.userId)).toEqual([learner.id]);
    // Somebody who teaches others has no way in to a learner who never linked to them.
    await expect(teaching.act(stranger.id, { action: 'course.assign', learnerUserId: learner.id, courseKey: 'similarity' })).rejects.toMatchObject({ status: 404 });
    await expect(teaching.act(stranger.id, { action: 'learner.find', query: 'learner' })).rejects.toMatchObject({ status: 403 });
    // A new code retires the old one; the link already made stays.
    const renewed = (await teaching.act(teacher.id, { action: 'invite.renew' })).teaching.invite!;
    expect(renewed).not.toBe(code);
    const late = await person('late');
    await expect(learning.act(late.id, { action: 'teaching.join', code })).rejects.toMatchObject({ status: 404 });
    // A code whose owner no longer prepares lessons here links nobody.
    await db.contentAuthor.delete({ where: { userId: teacher.id } });
    await expect(learning.act(late.id, { action: 'teaching.join', code: renewed })).rejects.toMatchObject({ status: 404 });
  });

  it('sets an exam range as where she is heading, beside what she chose herself', async () => {
    const teacher = await person('teacher', 'author'), learner = await person('learner');
    const code = (await teaching.act(teacher.id, { action: 'invite.renew' })).teaching.invite!;
    await learning.act(learner.id, { action: 'teaching.join', code });
    const alone = await learning.state(learner.id);
    for (const courseKey of exam) await teaching.act(teacher.id, { action: 'course.assign', learnerUserId: learner.id, courseKey });
    const state = await learning.state(learner.id);
    expect(state.teaching.assignedCourses.map(item => item.courseKey)).toEqual(exam);
    expect(state.teaching.assignedCourses[0].setBy).toEqual({ kind: 'person', name: teacher.displayName });
    // The way there now runs to all three, so it holds what each of them teaches.
    const taught = (courseKey: string) => state.lessons.filter(lesson => lesson.courseKey === courseKey).flatMap(lesson => lesson.conceptKeys);
    for (const courseKey of exam) for (const concept of taught(courseKey)) expect(state.plan.onTheWay).toContain(concept);
    // Asked about what the range stands on, not the whole school line.
    expect(state.diagnosticOffering!.scope).toBeLessThan(alone.diagnosticOffering!.scope);
    // The recommendation is in the range or on its way: nothing outside it comes first.
    const recommended = state.recommendations[0].lessonKey;
    const onTheWay = new Set(state.plan.onTheWay);
    expect(state.lessons.find(lesson => lesson.lessonKey === recommended)!.conceptKeys.some(key => onTheWay.has(key))).toBe(true);
    // Setting what is already set changes nothing, and another teacher cannot take it off.
    await teaching.act(teacher.id, { action: 'course.assign', learnerUserId: learner.id, courseKey: 'similarity' });
    expect(await db.assignedCourse.count({ where: { learnerUserId: learner.id } })).toBe(3);
    const other = await person('other', 'author');
    await learning.act(learner.id, { action: 'teaching.join', code: (await teaching.act(other.id, { action: 'invite.renew' })).teaching.invite! });
    await expect(teaching.act(other.id, { action: 'course.unassign', learnerUserId: learner.id, courseKey: 'similarity' })).rejects.toMatchObject({ status: 403 });
    const seenByOther = (await teaching.view(other.id)).learners[0];
    expect(seenByOther.courses.every(course => !course.mine && course.setBy.kind === 'person' && course.setBy.name === '다른 선생님')).toBe(true);
    // Taking one off moves the destination back; the history says who moved it.
    await teaching.act(teacher.id, { action: 'course.unassign', learnerUserId: learner.id, courseKey: 'probability' });
    expect((await learning.state(learner.id)).teaching.assignedCourses.map(item => item.courseKey)).toEqual(['similarity', 'pythagoras']);
    expect((await db.recommendationHistory.findMany({ where: { userId: learner.id } })).map(row => row.trigger)).toContain('teaching.assign');
  });

  it('carries an unfinished placement on into a range set after it started', async () => {
    const teacher = await person('teacher', 'author'), learner = await person('learner');
    await learning.act(learner.id, { action: 'profile.update', targetCourseKey: 'fractions', dailyMinutes: 10 });
    const started = (await learning.act(learner.id, { action: 'diagnostic.start' })).state.diagnostic!;
    await learning.act(learner.id, { action: 'teaching.join', code: (await teaching.act(teacher.id, { action: 'invite.renew' })).teaching.invite! });
    await teaching.act(teacher.id, { action: 'course.assign', learnerUserId: learner.id, courseKey: 'pythagoras' });
    const carried = (await learning.state(learner.id)).diagnostic!;
    expect(carried.scope).toBeGreaterThan(started.scope);
  });

  it('keeps a course to the learners it is set for, without taking it from anybody already in it', async () => {
    const operator = await person('operator', 'admin'), teacher = await person('teacher', 'author');
    const set = await person('set'), unset = await person('unset'), started = await person('started');
    const lessonKey = (await learning.catalog()).find(lesson => lesson.courseKey === 'probability')!.lessonKey;
    await learning.act(started.id, { action: 'enrollment.start', lessonKey });
    kept = 'probability';
    const view = (await teaching.act(operator.id, { action: 'course.visibility', courseKey: 'probability', visibility: 'assigned' })).teaching;
    expect(view.courses.find(course => course.key === 'probability')).toMatchObject({ visibility: 'assigned', mayAssign: true });
    expect((await teaching.view(teacher.id)).courses.find(course => course.key === 'probability')!.mayAssign).toBe(false);
    await expect(teaching.act(teacher.id, { action: 'course.visibility', courseKey: 'similarity', visibility: 'assigned' })).rejects.toMatchObject({ status: 403 });
    // Signed out, and signed in with nothing set: not there at all — not listed, not openable, not startable.
    expect((await learning.publicCatalog()).courses.map(course => course.key)).not.toContain('probability');
    expect((await learning.publicCatalog()).problemSets.some(item => item.courseKey === 'probability')).toBe(false);
    expect(courseOf(await learning.state(unset.id), lessonKey)).toBeUndefined();
    await expect(learning.lessonDocument(lessonKey, unset.id)).rejects.toMatchObject({ status: 404 });
    await expect(learning.act(unset.id, { action: 'enrollment.start', lessonKey })).rejects.toMatchObject({ status: 404 });
    await expect(learning.act(unset.id, { action: 'profile.update', targetCourseKey: 'probability', dailyMinutes: 10 })).rejects.toMatchObject({ status: 404 });
    // A teacher may not open it; an operator, who needs no link, may set it for anybody.
    await learning.act(set.id, { action: 'teaching.join', code: (await teaching.act(teacher.id, { action: 'invite.renew' })).teaching.invite! });
    await expect(teaching.act(teacher.id, { action: 'course.assign', learnerUserId: set.id, courseKey: 'probability' })).rejects.toMatchObject({ status: 403 });
    const found = (await teaching.act(operator.id, { action: 'learner.find', query: set.displayName })).matches!;
    expect(found.map(item => item.userId)).toEqual([set.id]);
    await teaching.act(operator.id, { action: 'course.assign', learnerUserId: set.id, courseKey: 'probability' });
    const opened = await learning.state(set.id);
    expect(courseOf(opened, lessonKey)).toBe('probability');
    expect(opened.teaching.assignedCourses).toEqual([expect.objectContaining({ courseKey: 'probability', setBy: { kind: 'operator' } })]);
    expect((await learning.publicCatalog(undefined, set.id)).problemSets.some(item => item.courseKey === 'probability')).toBe(true);
    await expect(learning.lessonDocument(lessonKey, set.id)).resolves.toBeTruthy();
    // Already in it before it was kept back: still there.
    expect(courseOf(await learning.state(started.id), lessonKey)).toBe('probability');
    // The operator keeps the learners they reached directly on their own list.
    expect((await teaching.view(operator.id)).learners.map(item => item.userId)).toContain(set.id);
  });

  it('ends a link from either side, and what was set through it goes with it', async () => {
    const operator = await person('operator', 'admin'), teacher = await person('teacher', 'author'), learner = await person('learner');
    await learning.act(learner.id, { action: 'teaching.join', code: (await teaching.act(teacher.id, { action: 'invite.renew' })).teaching.invite! });
    await teaching.act(teacher.id, { action: 'course.assign', learnerUserId: learner.id, courseKey: 'similarity' });
    await teaching.act(operator.id, { action: 'course.assign', learnerUserId: learner.id, courseKey: 'pythagoras' });
    const [link] = (await learning.state(learner.id)).teaching.teachers;
    const left = (await learning.act(learner.id, { action: 'teaching.leave', linkId: link.linkId })).state;
    expect(left.teaching.teachers).toEqual([]);
    // The operator's setting had no link to go with.
    expect(left.teaching.assignedCourses.map(item => item.courseKey)).toEqual(['pythagoras']);
    await expect(teaching.act(teacher.id, { action: 'course.assign', learnerUserId: learner.id, courseKey: 'similarity' })).rejects.toMatchObject({ status: 404 });
    // And from the teacher's side.
    await learning.act(learner.id, { action: 'teaching.join', code: (await teaching.view(teacher.id)).invite! });
    await teaching.act(teacher.id, { action: 'link.end', learnerUserId: learner.id });
    expect((await teaching.view(teacher.id)).learners).toEqual([]);
    // Nobody can end a link that is not theirs.
    const another = await person('another');
    await expect(learning.act(another.id, { action: 'teaching.leave', linkId: link.linkId })).rejects.toMatchObject({ status: 404 });
  });
});
