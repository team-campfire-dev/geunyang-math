import 'server-only';
import type { Prisma, PrismaClient } from '@prisma/client';
import { z } from 'zod';
import { AppError } from './errors';
import { authoringRole, openAuthoring } from './authoring';
import { LearningService } from './learning-service';
import { cleanQuote, feedbackLimits, feedbackReasons, type FeedbackEntry, type FeedbackInbox, type FeedbackItem, type FeedbackReason, type FeedbackStatus, type LessonFeedbackView } from '@/shared/feedback';

const id = z.string().min(1).max(191);
const actionSchema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('feedback.add'), lessonKey: id.max(100), lessonVersionId: id, sectionId: id,
    blockId: id.nullable(), problemVersionId: id.nullable(), quote: z.string().max(feedbackLimits.quote * 4).nullable(),
    reason: z.enum(feedbackReasons.map((item) => item.key) as [FeedbackReason, ...FeedbackReason[]]).nullable(),
    body: z.string().trim().max(feedbackLimits.body) }).strict(),
  z.object({ action: z.literal('feedback.remove'), feedbackId: id }).strict(),
  z.object({ action: z.literal('feedback.resolve'), feedbackId: id }).strict(),
  z.object({ action: z.literal('feedback.reopen'), feedbackId: id }).strict(),
  z.object({ action: z.literal('lesson.accepting'), lessonKey: id.max(100), accepting: z.boolean() }).strict(),
]);

const itemRow = { id: true, lessonKey: true, lessonVersionId: true, sectionId: true, blockId: true, problemVersionId: true,
  quote: true, reason: true, body: true, status: true, createdAt: true, resolvedAt: true, authorUserId: true,
  author: { select: { displayName: true } } } satisfies Prisma.LessonFeedbackSelect;
type ItemRow = Prisma.LessonFeedbackGetPayload<{ select: typeof itemRow }>;

const missing = () => new AppError(404, 'feedback_missing', '의견을 찾을 수 없어요.');

/**
 * Feedback left on a lesson while doing it. Anybody signed in who may read a lesson may say something
 * about a place in it, and sees what they said; a reviewer — an operator today — reads everybody's,
 * settles it, and decides which lessons take it at all.
 *
 * Who reads whose is one decision, `reviewer` below. A teacher reading what their own learners said
 * is the next answer to it, and nothing else here needs to change for that.
 */
export class FeedbackService {
  constructor(private readonly db: PrismaClient) {}

  /**
   * Reading everybody's feedback names learners, so it needs an operator's own account: the shared
   * open editor makes every visitor an administrator, and that is not somebody to show it to.
   */
  async reviewer(userId: string | null): Promise<boolean> {
    if (!userId || openAuthoring()) return false;
    return (await authoringRole(this.db, userId)) === 'admin';
  }

  private item(row: ItemRow, viewerId: string | null): FeedbackItem {
    return { id: row.id, lessonKey: row.lessonKey, lessonVersionId: row.lessonVersionId, sectionId: row.sectionId,
      blockId: row.blockId, problemVersionId: row.problemVersionId, quote: row.quote, reason: row.reason as FeedbackReason | null, body: row.body,
      status: row.status as FeedbackStatus, createdAt: row.createdAt.toISOString(), resolvedAt: row.resolvedAt?.toISOString() ?? null,
      author: { name: row.author.displayName, mine: row.authorUserId === viewerId } };
  }

  /** One lesson as its screen draws it. Signed out sees nothing and may leave nothing. */
  async lesson(lessonKey: string, viewerId: string | null): Promise<LessonFeedbackView> {
    const lesson = await this.db.lesson.findUnique({ where: { key: lessonKey }, select: { feedbackOpen: true } });
    if (!lesson) throw new AppError(404, 'lesson_missing', '수업을 찾을 수 없어요.');
    if (!viewerId) return { accepting: false, reviewer: false, items: [] };
    const reviewer = await this.reviewer(viewerId);
    const rows = await this.db.lessonFeedback.findMany({
      where: { lessonKey, ...(reviewer ? {} : { authorUserId: viewerId }) },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }], select: itemRow });
    return { accepting: lesson.feedbackOpen, reviewer, items: rows.map((row) => this.item(row, viewerId)) };
  }

  /**
   * Everything said, newest first, with the names of the places it points at. Whether a piece still
   * matches is asked of the newest version: the block they meant may since have been rewritten, and
   * the person fixing it should know they are reading about words that are no longer there.
   */
  async inbox(viewerId: string): Promise<FeedbackInbox> {
    if (!await this.reviewer(viewerId)) throw new AppError(403, 'not_a_reviewer', '수업 의견은 운영자 계정으로 볼 수 있어요.');
    const [rows, lessons, counts] = await Promise.all([
      this.db.lessonFeedback.findMany({ orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], take: 500, select: itemRow }),
      this.db.lesson.findMany({ where: { versions: { some: {} } }, orderBy: [{ course: { order: 'asc' } }, { order: 'asc' }, { key: 'asc' }],
        select: { key: true, feedbackOpen: true, course: { select: { title: true } },
          versions: { orderBy: [{ publishedAt: 'desc' }, { id: 'desc' }], take: 1, select: { id: true, title: true } } } }),
      this.db.lessonFeedback.groupBy({ by: ['lessonKey'], where: { status: 'open' }, _count: { _all: true } }),
    ]);
    const newest = new Map(lessons.map((lesson) => [lesson.key, lesson.versions[0]?.id]));
    const read = [...new Set(rows.map((row) => row.lessonVersionId))];
    const versions = [...new Set([...read, ...newest.values()].filter((value): value is string => !!value))];
    const [sections, blocks] = await Promise.all([
      this.db.lessonSection.findMany({ where: { lessonVersionId: { in: versions } }, select: { lessonVersionId: true, sectionId: true, title: true, order: true } }),
      this.db.contentBlock.findMany({ where: { ownerKind: 'section', ownerVersionId: { in: versions }, blockId: { in: [...new Set(rows.flatMap((row) => row.blockId ? [row.blockId] : []))] } },
        select: { ownerVersionId: true, ownerId: true, blockId: true, kind: true, payload: true } }),
    ]);
    const blockText = (versionId: string | undefined, sectionId: string, blockId: string) => {
      const block = blocks.find((row) => row.ownerVersionId === versionId && row.ownerId === sectionId && row.blockId === blockId);
      return block ? JSON.stringify([block.kind, block.payload]) : undefined;
    };
    const stepOf = (versionId: string | undefined, sectionId: string) => {
      const steps = sections.filter((row) => row.lessonVersionId === versionId).sort((a, b) => a.order - b.order);
      const at = steps.findIndex((row) => row.sectionId === sectionId);
      return at < 0 ? null : at + 1;
    };
    const lessonOf = new Map(lessons.map((lesson) => [lesson.key, lesson]));
    const entries: FeedbackEntry[] = rows.map((row) => {
      const lesson = lessonOf.get(row.lessonKey);
      const latest = newest.get(row.lessonKey);
      const seen = sections.find((section) => section.lessonVersionId === row.lessonVersionId && section.sectionId === row.sectionId);
      const step = stepOf(latest, row.sectionId);
      const now = row.blockId ? blockText(latest, row.sectionId, row.blockId) : undefined;
      const current = row.lessonVersionId === latest
        || (step !== null && (!row.blockId || (now !== undefined && now === blockText(row.lessonVersionId, row.sectionId, row.blockId))));
      return { ...this.item(row, viewerId), lessonTitle: lesson?.versions[0]?.title ?? row.lessonKey, courseTitle: lesson?.course.title ?? '',
        sectionTitle: seen?.title ?? '', step, current };
    });
    const open = new Map(counts.map((count) => [count.lessonKey, count._count._all]));
    return { entries, lessons: lessons.map((lesson) => ({ lessonKey: lesson.key, title: lesson.versions[0]?.title ?? lesson.key,
      courseTitle: lesson.course.title, accepting: lesson.feedbackOpen, open: open.get(lesson.key) ?? 0 })) };
  }

  /** Checks that a place is one this reader was shown, then keeps what they said about it. */
  private async add(userId: string, input: Extract<z.infer<typeof actionSchema>, { action: 'feedback.add' }>) {
    // A quick answer may stand alone; with neither, nothing was said.
    if (!input.reason && !input.body) throw new AppError(400, 'feedback_empty', '무엇이 있었는지 골라 주거나 적어 주세요.');
    const lesson = await this.db.lesson.findUnique({ where: { key: input.lessonKey }, select: { feedbackOpen: true } });
    // A lesson in a course kept from this reader is a lesson that is not there for them.
    const visible = lesson && (await new LearningService(this.db).catalog(this.db, userId)).some((item) => item.lessonKey === input.lessonKey);
    if (!lesson || !visible) throw new AppError(404, 'lesson_missing', '수업을 찾을 수 없어요.');
    if (!lesson.feedbackOpen) throw new AppError(409, 'feedback_closed', '이 수업은 지금 의견을 받지 않아요.');
    const [version, section] = await Promise.all([
      this.db.lessonVersion.findFirst({ where: { id: input.lessonVersionId, lessonKey: input.lessonKey }, select: { id: true } }),
      this.db.lessonSection.findUnique({ where: { lessonVersionId_sectionId: { lessonVersionId: input.lessonVersionId, sectionId: input.sectionId } }, select: { sectionId: true } }),
    ]);
    if (!version || !section) throw new AppError(404, 'place_missing', '의견을 남길 자리를 찾을 수 없어요. 수업을 새로 열어 주세요.');
    if (input.blockId) {
      const block = await this.db.contentBlock.findFirst({ where: { ownerKind: 'section', ownerVersionId: input.lessonVersionId, ownerId: input.sectionId, blockId: input.blockId },
        select: { payload: true } });
      if (!block) throw new AppError(404, 'place_missing', '의견을 남길 자리를 찾을 수 없어요. 수업을 새로 열어 주세요.');
      const asked = (block.payload as { problemVersionIds?: unknown }).problemVersionIds;
      if (input.problemVersionId && !(Array.isArray(asked) && asked.includes(input.problemVersionId))) {
        throw new AppError(404, 'place_missing', '의견을 남길 문제를 찾을 수 없어요. 수업을 새로 열어 주세요.');
      }
    } else if (input.problemVersionId) throw new AppError(400, 'invalid_input', '입력 형식을 확인해 주세요.');
    const since = new Date(Date.now() - 24 * 60 * 60 * 1000);
    if (await this.db.lessonFeedback.count({ where: { authorUserId: userId, createdAt: { gte: since } } }) >= feedbackLimits.perDay) {
      throw new AppError(429, 'feedback_limit', '오늘은 의견을 충분히 남겼어요. 내일 다시 남겨 주세요.');
    }
    await this.db.lessonFeedback.create({ data: { authorUserId: userId, lessonKey: input.lessonKey, lessonVersionId: input.lessonVersionId,
      sectionId: input.sectionId, blockId: input.blockId, problemVersionId: input.problemVersionId,
      quote: input.quote === null ? null : cleanQuote(input.quote), reason: input.reason, body: input.body } });
  }

  async act(userId: string, input: unknown): Promise<{ feedback: LessonFeedbackView }> {
    const action = actionSchema.parse(input);
    if (action.action === 'feedback.add') {
      await this.add(userId, action);
      return { feedback: await this.lesson(action.lessonKey, userId) };
    }
    const reviewer = await this.reviewer(userId);
    if (action.action === 'lesson.accepting') {
      if (!reviewer) throw new AppError(403, 'not_a_reviewer', '의견을 받을지는 운영자가 정해요.');
      const updated = await this.db.lesson.updateMany({ where: { key: action.lessonKey }, data: { feedbackOpen: action.accepting } });
      if (!updated.count) throw new AppError(404, 'lesson_missing', '수업을 찾을 수 없어요.');
      return { feedback: await this.lesson(action.lessonKey, userId) };
    }
    const row = await this.db.lessonFeedback.findUnique({ where: { id: action.feedbackId }, select: { lessonKey: true, authorUserId: true } });
    // Somebody else's feedback is not there for a reader who only sees their own.
    if (!row || (!reviewer && row.authorUserId !== userId)) throw missing();
    switch (action.action) {
      case 'feedback.remove':
        await this.db.lessonFeedback.delete({ where: { id: action.feedbackId } });
        break;
      case 'feedback.resolve':
      case 'feedback.reopen': {
        if (!reviewer) throw new AppError(403, 'not_a_reviewer', '의견을 처리하는 것은 운영자가 해요.');
        const resolving = action.action === 'feedback.resolve';
        await this.db.lessonFeedback.update({ where: { id: action.feedbackId },
          data: resolving ? { status: 'resolved', resolvedAt: new Date(), resolvedByUserId: userId } : { status: 'open', resolvedAt: null, resolvedByUserId: null } });
        break;
      }
    }
    return { feedback: await this.lesson(row.lessonKey, userId) };
  }
}
