import 'server-only';
import { Prisma, type PrismaClient } from '@prisma/client';
import { AppError } from './errors';

type Tx = Prisma.TransactionClient;

/**
 * Removing a person from the service. A deletion request is to be gone, so this deletes rather than
 * anonymises: a record kept under a stand-in name is still a record, and saying it was deleted would
 * not be true. Published lessons are untouched because they carry no author — `LessonVersion` keeps
 * no user, so what a person wrote for everyone survives them leaving, and what the service knew
 * about them does not.
 *
 * There is no undo and no backup to restore from, so the screen says so before it is called.
 */
export type DeletionReport = {
  attempts: number; enrollments: number; assignments: number; submissions: number;
  hints: number; diagnostics: number; recommendations: number;
};

/**
 * What stops a deletion. Someone who writes content has drafts hanging from their account and the
 * schema cascades those away with them — so the content role comes off, and whatever is unfinished
 * is handed over or discarded, before the account can go. The person is told which it is rather
 * than finding their drafts gone.
 */
async function assertDeletable(db: Tx, userId: string) {
  const [author, drafts] = await Promise.all([
    db.contentAuthor.findUnique({ where: { userId }, select: { role: true } }),
    db.contentDraft.count({ where: { authorId: userId } }),
  ]);
  if (author) {
    throw new AppError(409, 'content_role_held',
      '콘텐츠 편집 권한이 있는 계정이에요. 관리자가 「편집 권한」에서 역할을 거둔 뒤에 지울 수 있어요.');
  }
  if (drafts > 0) {
    throw new AppError(409, 'drafts_held',
      `아직 발행하지 않은 초안이 ${drafts}개 있어요. 지우면 초안도 함께 사라지므로, 관리자와 정리한 뒤에 다시 시도해 주세요.`);
  }
}

/**
 * Deletes one person's account and everything the service learned about them, in one transaction.
 * The order is the foreign keys' own: a row is removed only after everything pointing at it is
 * gone. Six tables ride along on the account itself (`onDelete: Cascade`) — sessions, the Google
 * identity, diagnostic runs, recommendation history, and the content rows the check above rules out.
 */
export async function deleteAccount(db: PrismaClient, userId: string): Promise<DeletionReport> {
  return db.$transaction(async (tx) => {
    await assertDeletable(tx, userId);

    const scopes = (await tx.learningScope.findMany({ where: { ownerUserId: userId }, select: { id: true } })).map((scope) => scope.id);
    const attempts = (await tx.attempt.findMany({ where: { userId }, select: { id: true } })).map((attempt) => attempt.id);
    const recipients = (await tx.assignmentRecipient.findMany({ where: { learnerUserId: userId }, select: { id: true } })).map((recipient) => recipient.id);
    const submissions = (await tx.submission.findMany({ where: { recipientId: { in: recipients } }, select: { id: true } })).map((submission) => submission.id);

    // A judgement about an attempt, and the attempt a submission settled on, both name an attempt.
    await tx.assessmentRevision.deleteMany({ where: { attemptId: { in: attempts } } });
    await tx.submissionItem.deleteMany({ where: { OR: [{ submissionId: { in: submissions } }, { selectedAttemptId: { in: attempts } }] } });
    await tx.submission.deleteMany({ where: { id: { in: submissions } } });
    const removedAttempts = await tx.attempt.deleteMany({ where: { userId } });
    await tx.assignmentRecipient.deleteMany({ where: { id: { in: recipients } } });

    // An assignment is only this person's to remove once nobody else is waiting on it. Today every
    // assignment is personal, but the model allows one that is not, and that one stays.
    const orphaned = (await tx.assignment.findMany({
      where: { ownerScopeId: { in: scopes }, recipients: { none: {} } }, select: { id: true },
    })).map((assignment) => assignment.id);
    await tx.assignmentItem.deleteMany({ where: { assignmentId: { in: orphaned } } });
    const removedAssignments = await tx.assignment.deleteMany({ where: { id: { in: orphaned } } });

    const removedEnrollments = await tx.enrollment.deleteMany({ where: { userId } });
    const removedHints = await tx.hintUse.deleteMany({ where: { userId } });
    const diagnostics = await tx.diagnosticRun.count({ where: { userId } });
    const recommendations = await tx.recommendationHistory.count({ where: { userId } });
    await tx.learningScope.deleteMany({ where: { ownerUserId: userId } });
    await tx.user.delete({ where: { id: userId } });

    return {
      attempts: removedAttempts.count, enrollments: removedEnrollments.count,
      assignments: removedAssignments.count, submissions: submissions.length,
      hints: removedHints.count, diagnostics, recommendations,
    };
  });
}
