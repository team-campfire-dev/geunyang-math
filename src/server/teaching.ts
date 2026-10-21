import 'server-only';
import { randomInt } from 'node:crypto';
import type { Prisma } from '@prisma/client';
import { AppError } from './errors';
import { inviteAlphabet, inviteLength, normalizeInvite, type LearnerTeaching, type SetBy, type TeacherKind } from '@/shared/teaching';

type Tx = Prisma.TransactionClient;

/**
 * Who is changing a learner's teaching. An operator reaches every learner and every course; a person
 * reaches only the learners who linked themselves to them, and only the courses open to everybody.
 * A model will be the third kind: it has no account, so it acts through the link a learner made to
 * it and is held to what a person is held to.
 */
export type Teacher = { kind: 'operator'; userId: string } | { kind: 'person'; userId: string } | { kind: 'ai'; learnerUserId: string };

const notReachable = () => new AppError(404, 'learner_not_linked', '연결된 학습자가 아니에요.');

/**
 * The courses one viewer may not see. Somebody signed out sees only public courses; a learner also
 * sees the ones set for them and any they had already started — keeping a course to some learners
 * does not take away what somebody is in the middle of. Usually nothing is kept back, and then this
 * is one query that finds nothing.
 */
export async function hiddenCourses(db: Tx, viewerId: string | null): Promise<Set<string>> {
  const kept = (await db.course.findMany({ where: { visibility: { not: 'public' } }, select: { key: true } })).map((row) => row.key);
  const hidden = new Set(kept);
  if (!kept.length || !viewerId) return hidden;
  const [assigned, started] = await Promise.all([
    db.assignedCourse.findMany({ where: { learnerUserId: viewerId, courseKey: { in: kept } }, select: { courseKey: true } }),
    db.enrollment.findMany({ where: { userId: viewerId, lessonVersion: { lesson: { course: { key: { in: kept } } } } },
      select: { lessonVersion: { select: { lesson: { select: { course: { select: { key: true } } } } } } } }),
  ]);
  for (const row of assigned) hidden.delete(row.courseKey);
  for (const row of started) hidden.delete(row.lessonVersion.lesson.course.key);
  return hidden;
}

/** The courses set for a learner, oldest first: with what they chose themselves, where they are heading. */
export async function assignedCourseKeys(db: Tx, learnerUserId: string): Promise<string[]> {
  return (await db.assignedCourse.findMany({ where: { learnerUserId }, orderBy: [{ assignedAt: 'asc' }, { id: 'asc' }], select: { courseKey: true } }))
    .map((row) => row.courseKey);
}

/** Who set a course, read off the row: a link to a model, a link to a person, or no link at all. */
export const setByOf = (row: { linkId: string | null; assignedBy: { displayName: string } | null; link: { teacherKind: string } | null }): SetBy =>
  row.link?.teacherKind === 'ai' ? { kind: 'ai' }
    : row.linkId ? { kind: 'person', name: row.assignedBy?.displayName ?? '선생님' }
    : { kind: 'operator' };

/** What the learner is told about their own teaching. */
export async function learnerTeaching(db: Tx, learnerUserId: string): Promise<LearnerTeaching> {
  const [links, courses] = await Promise.all([
    db.teachingLink.findMany({ where: { learnerUserId }, orderBy: { createdAt: 'asc' }, select: { id: true, teacherKind: true, createdAt: true, teacher: { select: { displayName: true } } } }),
    db.assignedCourse.findMany({ where: { learnerUserId }, orderBy: [{ assignedAt: 'asc' }, { id: 'asc' }],
      select: { courseKey: true, assignedAt: true, linkId: true, assignedBy: { select: { displayName: true } }, link: { select: { teacherKind: true } } } }),
  ]);
  return {
    teachers: links.map((link) => ({ linkId: link.id, kind: link.teacherKind as TeacherKind,
      name: link.teacherKind === 'ai' ? 'AI 선생님' : link.teacher?.displayName ?? '선생님', since: link.createdAt.toISOString() })),
    assignedCourses: courses.map((row) => ({ courseKey: row.courseKey, setBy: setByOf(row), assignedAt: row.assignedAt.toISOString() })),
  };
}

/**
 * The link a teacher reaches this learner through: null for an operator, who needs none, and a
 * refusal for anybody the learner did not link themselves to.
 */
export async function reach(db: Tx, teacher: Teacher, learnerUserId: string): Promise<string | null> {
  if (!(await db.user.findUnique({ where: { id: learnerUserId }, select: { id: true } }))) throw notReachable();
  if (teacher.kind === 'operator') return null;
  const link = await db.teachingLink.findFirst({ where: teacher.kind === 'person'
    ? { learnerUserId, teacherKind: 'person', teacherUserId: teacher.userId }
    : { learnerUserId, teacherKind: 'ai' }, select: { id: true } });
  if (!link || (teacher.kind === 'ai' && teacher.learnerUserId !== learnerUserId)) throw notReachable();
  return link.id;
}

/** Whether this teacher may set the course for somebody. Only an operator opens a course kept back. */
export const mayAssign = (teacher: Teacher, visibility: string) => teacher.kind === 'operator' || visibility === 'public';

/**
 * Sets a course for a learner. A course already set — by this teacher or another — stays as it is:
 * the learner is heading there either way, and taking over another teacher's setting would let one
 * take it away from the other. Returns whether anything changed.
 */
export async function assignCourse(db: Tx, teacher: Teacher, learnerUserId: string, courseKey: string): Promise<boolean> {
  const linkId = await reach(db, teacher, learnerUserId);
  const course = await db.course.findUnique({ where: { key: courseKey }, select: { visibility: true } });
  // A course with nothing published is no destination, which is also how the placement bank's own course is kept out.
  if (!course || !(await db.lessonVersion.findFirst({ where: { lesson: { course: { key: courseKey } } }, select: { id: true } }))) {
    throw new AppError(404, 'course_missing', '코스를 찾을 수 없어요.');
  }
  if (!mayAssign(teacher, course.visibility)) throw new AppError(403, 'course_kept', '모두에게 공개된 코스만 배정할 수 있어요.');
  if (await db.assignedCourse.findUnique({ where: { learnerUserId_courseKey: { learnerUserId, courseKey } } })) return false;
  await db.assignedCourse.create({ data: { learnerUserId, courseKey, linkId,
    assignedByUserId: teacher.kind === 'ai' ? null : teacher.userId } });
  return true;
}

/** Takes a course off. An operator may take any; a teacher only what was set through their own link. */
export async function unassignCourse(db: Tx, teacher: Teacher, learnerUserId: string, courseKey: string): Promise<boolean> {
  const linkId = await reach(db, teacher, learnerUserId);
  const row = await db.assignedCourse.findUnique({ where: { learnerUserId_courseKey: { learnerUserId, courseKey } } });
  if (!row) return false;
  if (teacher.kind !== 'operator' && row.linkId !== linkId) throw new AppError(403, 'course_not_yours', '다른 사람이 배정한 코스예요.');
  await db.assignedCourse.delete({ where: { id: row.id } });
  return true;
}

/** A fresh code. Collisions are left to the primary key; the caller tries again. */
export const newInviteCode = () => Array.from({ length: inviteLength }, () => inviteAlphabet[randomInt(inviteAlphabet.length)]).join('');

/**
 * A learner entering a code: the learner saying yes to being taught by its owner. The owner has to
 * still be somebody who teaches here, and nobody can link to themselves. Entering it twice is one link.
 */
export async function joinByInvite(db: Tx, learnerUserId: string, typed: string, mayTeach: (userId: string) => Promise<boolean>) {
  const wrong = () => new AppError(404, 'invite_unknown', '맞는 초대 코드가 아니에요. 선생님께 다시 확인해 주세요.');
  const code = normalizeInvite(typed);
  if (code.length !== inviteLength) throw wrong();
  const invite = await db.teachingInvite.findUnique({ where: { code }, select: { teacherUserId: true } });
  if (!invite || !(await mayTeach(invite.teacherUserId))) throw wrong();
  if (invite.teacherUserId === learnerUserId) throw new AppError(409, 'invite_self', '내 초대 코드로는 나와 연결할 수 없어요.');
  const existing = await db.teachingLink.findFirst({ where: { learnerUserId, teacherKind: 'person', teacherUserId: invite.teacherUserId } });
  if (existing) return existing.id;
  return (await db.teachingLink.create({ data: { learnerUserId, teacherKind: 'person', teacherUserId: invite.teacherUserId } })).id;
}

/** Either side may end a link. The courses set through it go with it; what the learner did stays theirs. */
export async function endLink(db: Tx, where: { id: string; learnerUserId: string } | { learnerUserId: string; teacherUserId: string }) {
  const link = await db.teachingLink.findFirst({ where: 'id' in where ? where : { ...where, teacherKind: 'person' }, select: { id: true } });
  if (!link) throw notReachable();
  await db.teachingLink.delete({ where: { id: link.id } });
}
