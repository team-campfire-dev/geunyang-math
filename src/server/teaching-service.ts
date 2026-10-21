import 'server-only';
import { Prisma, type PrismaClient } from '@prisma/client';
import { z } from 'zod';
import { AppError } from './errors';
import { authoringRole } from './authoring';
import { LearningService } from './learning-service';
import { assignCourse, endLink, mayAssign, newInviteCode, setByOf, unassignCourse, type Teacher } from './teaching';
import { courseVisibilities, type CourseVisibility, type TaughtLearner, type TeachingResponse, type TeachingView } from '@/shared/teaching';
import type { CourseStage, CourseTrack } from '@/shared/api';

type Tx = Prisma.TransactionClient;
const id = z.string().min(1).max(191);
const actionSchema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('invite.renew') }).strict(),
  z.object({ action: z.literal('learner.find'), query: z.string().trim().min(2).max(80) }).strict(),
  z.object({ action: z.literal('course.assign'), learnerUserId: id, courseKey: id.max(100) }).strict(),
  z.object({ action: z.literal('course.unassign'), learnerUserId: id, courseKey: id.max(100) }).strict(),
  z.object({ action: z.literal('link.end'), learnerUserId: id }).strict(),
  z.object({ action: z.literal('course.visibility'), courseKey: id.max(100), visibility: z.enum(courseVisibilities as [CourseVisibility, ...CourseVisibility[]]) }).strict(),
]);

const learnerRow = { id: true, displayName: true,
  assignedCourses: { orderBy: [{ assignedAt: 'asc' }, { id: 'asc' }], select: { courseKey: true, linkId: true, assignedByUserId: true,
    assignedBy: { select: { displayName: true } }, link: { select: { teacherKind: true } } } } } satisfies Prisma.UserSelect;
type LearnerRow = Prisma.UserGetPayload<{ select: typeof learnerRow }>;

/**
 * The teaching side of the editor: an invite code to hand out, the learners who linked themselves to
 * this account, and the courses set for each. Anyone who prepares lessons here may teach; an
 * operator — an administrator — also reaches learners nobody links, and decides who may see a course.
 *
 * Everything that changes a learner goes through the same few functions a model will call when it
 * teaches somebody (`./teaching`), so a teacher who is a person is not a special case to undo later.
 */
export class TeachingService {
  constructor(private readonly db: PrismaClient) {}

  private async teacher(userId: string): Promise<Teacher> {
    const role = await authoringRole(this.db, userId);
    if (!role) throw new AppError(403, 'not_a_teacher', '학습자를 가르치는 화면은 편집 권한이 있는 계정만 쓸 수 있어요.');
    return role === 'admin' ? { kind: 'operator', userId } : { kind: 'person', userId };
  }

  /** One learner as this teacher sees them: other people's settings are said to be somebody else's. */
  private learner(row: LearnerRow, teacher: Teacher & { userId: string }, link: { id: string; createdAt: Date } | undefined): TaughtLearner {
    return { userId: row.id, displayName: row.displayName, linkId: link?.id ?? null, since: link?.createdAt.toISOString() ?? null,
      courses: row.assignedCourses.map((course) => {
        const mine = teacher.kind === 'operator' || (!!link && course.linkId === link.id);
        const by = setByOf(course);
        return { courseKey: course.courseKey, mine,
          // Who else teaches this learner is the learner's to tell; an operator sees it all.
          setBy: teacher.kind === 'operator' || course.assignedByUserId === teacher.userId || by.kind !== 'person' ? by : { kind: 'person', name: '다른 선생님' } };
      }) };
  }

  async view(userId: string, db: Tx = this.db): Promise<TeachingView> {
    const teacher = await this.teacher(userId) as Teacher & { userId: string };
    const operator = teacher.kind === 'operator';
    const [invite, links, direct, courses, published] = await Promise.all([
      db.teachingInvite.findUnique({ where: { teacherUserId: userId }, select: { code: true } }),
      db.teachingLink.findMany({ where: { teacherKind: 'person', teacherUserId: userId }, orderBy: { createdAt: 'asc' }, select: { id: true, learnerUserId: true, createdAt: true } }),
      // An operator also keeps the learners they set something for directly, with no link between them.
      operator ? db.assignedCourse.findMany({ where: { linkId: null }, select: { learnerUserId: true }, distinct: ['learnerUserId'] }) : Promise.resolve([]),
      db.course.findMany({ orderBy: [{ order: 'asc' }, { createdAt: 'asc' }, { key: 'asc' }], select: { key: true, title: true, track: true, stage: true, visibility: true } }),
      db.lesson.findMany({ where: { versions: { some: {} } }, select: { course: { select: { key: true } } } }),
    ]);
    const learnerIds = [...new Set([...links.map((link) => link.learnerUserId), ...direct.map((row) => row.learnerUserId)])];
    const rows = await db.user.findMany({ where: { id: { in: learnerIds } }, select: learnerRow });
    const linkOf = new Map(links.map((link) => [link.learnerUserId, link]));
    const taught = new Set(published.map((row) => row.course.key));
    return {
      operator, invite: invite?.code ?? null,
      learners: learnerIds.flatMap((learnerId) => {
        const row = rows.find((item) => item.id === learnerId);
        return row ? [this.learner(row, teacher, linkOf.get(learnerId))] : [];
      }),
      // A course with nothing published is nowhere a learner can be sent, and the placement bank's own course is one.
      courses: courses.filter((course) => taught.has(course.key)).map((course) => ({
        key: course.key, title: course.title, track: course.track as CourseTrack, stage: course.stage as CourseStage | null,
        visibility: course.visibility as CourseVisibility, mayAssign: mayAssign(teacher, course.visibility) })),
    };
  }

  async act(userId: string, input: unknown): Promise<TeachingResponse> {
    const action = actionSchema.parse(input);
    const teacher = await this.teacher(userId);
    const learning = new LearningService(this.db);
    switch (action.action) {
      case 'invite.renew': {
        // Making a new code retires the old one: a code that went somewhere it should not stops working.
        for (let attempt = 0; attempt < 5; attempt++) {
          try {
            await this.db.$transaction([
              this.db.teachingInvite.deleteMany({ where: { teacherUserId: userId } }),
              this.db.teachingInvite.create({ data: { code: newInviteCode(), teacherUserId: userId } }),
            ]);
            return { teaching: await this.view(userId) };
          } catch (error) {
            if (!(error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002')) throw error;
          }
        }
        throw new AppError(503, 'invite_busy', '초대 코드를 만들지 못했어요. 다시 해 보세요.');
      }
      case 'learner.find': {
        if (teacher.kind !== 'operator') throw new AppError(403, 'not_an_operator', '학습자 찾기는 운영자만 할 수 있어요.');
        const found = await this.db.user.findMany({ where: { displayName: { contains: action.query }, id: { not: 'open-authoring' } },
          orderBy: { createdAt: 'asc' }, take: 20, select: learnerRow });
        const links = await this.db.teachingLink.findMany({ where: { teacherKind: 'person', teacherUserId: userId, learnerUserId: { in: found.map((row) => row.id) } },
          select: { id: true, learnerUserId: true, createdAt: true } });
        return { teaching: await this.view(userId),
          matches: found.map((row) => this.learner(row, teacher as Teacher & { userId: string }, links.find((link) => link.learnerUserId === row.id))) };
      }
      case 'course.assign':
      case 'course.unassign': {
        await this.db.$transaction(async (tx) => {
          const changed = action.action === 'course.assign'
            ? await assignCourse(tx, teacher, action.learnerUserId, action.courseKey)
            : await unassignCourse(tx, teacher, action.learnerUserId, action.courseKey);
          if (changed) await learning.retarget(tx, action.learnerUserId, `teaching.${action.action === 'course.assign' ? 'assign' : 'unassign'}`);
        }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable, maxWait: 10000, timeout: 20000 });
        return { teaching: await this.view(userId) };
      }
      case 'link.end': {
        await this.db.$transaction(async (tx) => {
          await endLink(tx, { learnerUserId: action.learnerUserId, teacherUserId: userId });
          await learning.retarget(tx, action.learnerUserId, 'teaching.end');
        }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable, maxWait: 10000, timeout: 20000 });
        return { teaching: await this.view(userId) };
      }
      case 'course.visibility': {
        if (teacher.kind !== 'operator') throw new AppError(403, 'not_an_operator', '공개 범위는 운영자만 바꿀 수 있어요.');
        const updated = await this.db.course.updateMany({ where: { key: action.courseKey }, data: { visibility: action.visibility } });
        if (!updated.count) throw new AppError(404, 'course_missing', '코스를 찾을 수 없어요.');
        return { teaching: await this.view(userId) };
      }
    }
  }
}
