import 'server-only';
import { Prisma, type PrismaClient, type Attempt } from '@prisma/client';
import { z } from 'zod';
import { getActivityProblemIds, toPublicClass, validateClass, type StoredClass, type StoredProblem } from '@/core/content';
import { gradeAnswer } from '@/core/grading';
import { skillLabels } from '@/core/seed';
import type { ActionResponse, AssignmentView, AttemptView, GradeResult, LearningState, PublicProblem } from '@/shared/api';
import { AppError } from './errors';

const id = z.string().min(1).max(191);
const context = z.enum(['class', 'assignment']);
export const actionSchema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('profile.update'), goal: z.enum(['daily-math', 'foundation-recovery', 'algebra-ready']), dailyMinutes: z.union([z.literal(5), z.literal(10), z.literal(20)]) }).strict(),
  z.object({ action: z.literal('enrollment.start'), classKey: id }).strict(),
  z.object({ action: z.literal('section.complete'), enrollmentId: id, sectionId: id }).strict(),
  z.object({ action: z.literal('attempt.submit'), context, contextId: id, problemVersionId: id, answer: z.string().max(128), requestId: z.string().min(8).max(100) }).strict(),
  z.object({ action: z.literal('hint.open'), context, contextId: id, problemVersionId: id }).strict(),
  z.object({ action: z.literal('class.complete'), enrollmentId: id }).strict(),
  z.object({ action: z.literal('assignment.submit'), recipientId: id, requestId: z.string().min(8).max(100) }).strict(),
]);
type Tx = Prisma.TransactionClient;
const asJson = (value: unknown) => JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
const notFound = () => new AppError(404, 'not_found', '학습 기록을 찾을 수 없어요.');
const conflict = (message: string) => new AppError(409, 'conflict', message);
function stored(value: unknown): StoredClass { validateClass(value); return value; }
function publicProblem(p: StoredProblem): PublicProblem {
  return { problemVersionId: p.problemVersionId, skillKeys: p.skillKeys, promptContent: p.promptContent, responseSpec: p.responseSpec, hintAvailable: p.hintAvailable };
}
function attemptView(a: Attempt): AttemptView {
  return { id: a.id, problemVersionId: a.problemVersionId, answer: a.answer, result: a.result as GradeResult, hintUsed: a.hintUsed };
}

export class LearningService {
  constructor(private readonly db: PrismaClient) {}

  async catalog() {
    const rows = await this.db.classVersion.findMany({ orderBy: [{ publishedAt: 'desc' }, { id: 'asc' }] });
    const seen = new Set<string>();
    return rows.filter(row => { if (seen.has(row.classKey)) return false; seen.add(row.classKey); return true; })
      .map(row => stored(row.document).public).sort((a, b) => a.order - b.order);
  }

  async classDocument(classKey: string, userId?: string) {
    const enrollment = userId ? await this.db.enrollment.findFirst({ where: { userId, classVersion: { classKey } }, include: { classVersion: true } }) : null;
    const row = enrollment?.classVersion ?? await this.db.classVersion.findFirst({ where: { classKey }, orderBy: { publishedAt: 'desc' } });
    if (!row) throw notFound();
    return toPublicClass(stored(row.document));
  }

  async state(userId: string): Promise<LearningState> {
    const [user, classes, enrollments, recipients] = await Promise.all([
      this.db.user.findUnique({ where: { id: userId } }), this.catalog(),
      this.db.enrollment.findMany({ where: { userId }, include: { classVersion: true, attempts: { orderBy: [{ createdAt: 'asc' }, { id: 'asc' }] } }, orderBy: { createdAt: 'asc' } }),
      this.db.assignmentRecipient.findMany({ where: { learnerUserId: userId }, include: {
        assignment: { include: { items: { orderBy: { position: 'asc' } } } },
        submissions: { orderBy: { submissionIndex: 'desc' }, include: { items: { include: { selectedAttempt: true } }, attempts: { orderBy: [{ createdAt: 'asc' }, { id: 'asc' }] } } },
      }, orderBy: { recommendedAt: 'asc' } }),
    ]);
    if (!user) throw notFound();
    const skills: LearningState['skills'] = Object.entries(skillLabels).map(([key, label]) => ({ key, label, state: 'unknown' }));
    const firstEvidence = new Map<string, { result: GradeResult; date: Date; skillKeys: string[]; delayed: boolean }>();
    for (const e of enrollments) {
      const record = stored(e.classVersion.document);
      const checks = new Set(record.sections.filter(s => s.role === 'check').flatMap(s => getActivityProblemIds(record, s.sectionId)));
      for (const a of e.attempts) {
        const result = a.result as GradeResult;
        if (result.status === 'invalid') continue;
        const p = record.problems.find(p => p.problemVersionId === a.problemVersionId);
        if (!p) continue;
        for (const skill of skills.filter(s => p.skillKeys.includes(s.key))) if (skill.state === 'unknown') skill.state = 'practicing';
        if (checks.has(p.problemVersionId) && !firstEvidence.has(p.problemVersionId)) firstEvidence.set(p.problemVersionId, { result, date: a.createdAt, skillKeys: p.skillKeys, delayed: false });
      }
    }
    const assignments: AssignmentView[] = recipients.map(r => {
      const submission = r.submissions[0];
      if (!submission) throw new Error('Missing initial submission');
      const classKey = enrollments.find(e => e.id === r.sourceEnrollmentId)?.classVersion.classKey ?? null;
      const items = r.assignment.items.map(item => {
        const p = item.problemSnapshot as unknown as StoredProblem;
        const matching = submission.attempts.filter(a => a.assignmentItemId === item.id);
        if (matching.some(a => (a.result as GradeResult).status !== 'invalid')) {
          for (const skill of skills.filter(s => p.skillKeys.includes(s.key))) if (skill.state === 'unknown') skill.state = 'practicing';
        }
        // Only finalized, server-received work contributes homework evidence.
        if (submission.status === 'submitted') {
          const first = matching.find(a => (a.result as GradeResult).status !== 'invalid');
          if (first && !firstEvidence.has(p.problemVersionId)) firstEvidence.set(p.problemVersionId, {
            result: first.result as GradeResult, date: first.createdAt, skillKeys: p.skillKeys,
            delayed: first.createdAt >= r.recommendedAt,
          });
        }
        const visibleAttempt = submission.status === 'submitted'
          ? submission.items.find(selected => selected.assignmentItemId === item.id)?.selectedAttempt
          : matching[matching.length - 1];
        return { id: item.id, problem: publicProblem(p), attempt: visibleAttempt ? attemptView(visibleAttempt) : null };
      });
      return { id: r.assignmentId, recipientId: r.id, title: r.assignment.title, classKey,
        recommendedAt: r.recommendedAt.toISOString(), policy: r.assignmentPolicy as 'adaptive' | 'fixed',
        status: r.status as 'assigned' | 'submitted', items, submissionId: submission.id };
    });
    for (const skill of skills) {
      const correct = [...firstEvidence.values()].filter(e => e.skillKeys.includes(skill.key) && e.result.status === 'correct' && !e.result.assisted);
      if (correct.length >= 2) skill.state = 'independent';
      if (correct.some(e => e.delayed) && correct.some(e => !e.delayed)) skill.state = 'retained';
    }
    const active = enrollments.find(e => e.status === 'active');
    const incomplete = classes.filter(c => !enrollments.some(e => e.classVersion.classKey === c.classKey && e.status === 'completed'));
    const goals = { 'daily-math': '생활 속 비율을 이해하기 위한', 'foundation-recovery': '기초부터 차근차근 이어가는', 'algebra-ready': '대수를 배우기 위한 기초' };
    const recommendations = active
      ? [{ classKey: active.classVersion.classKey, reason: '이전에 배우던 곳에서 이어갈 수 있어요.' }]
      : incomplete.slice(0, 2).map(c => ({ classKey: c.classKey,
        reason: user.dailyMinutes === 5 ? '짧게 시작하고, 다음에 이어서 배워도 괜찮아요.' : `${goals[user.goal as keyof typeof goals]} 수업이에요.` }));
    return {
      user: { id: user.id, displayName: user.displayName, goal: user.goal as LearningState['user']['goal'], dailyMinutes: user.dailyMinutes },
      classes, assignments, recommendations, skills,
      enrollments: enrollments.map(e => ({ id: e.id, classKey: e.classVersion.classKey, classVersionId: e.classVersionId,
        completedSectionIds: e.completedSectionIds as string[], status: e.status as 'active' | 'completed', attempts: e.attempts.map(attemptView) })),
    };
  }

  private async ownedEnrollment(tx: Tx, userId: string, enrollmentId: string) {
    const enrollment = await tx.enrollment.findFirst({ where: { id: enrollmentId, userId, scope: { ownerUserId: userId, kind: 'personal' } }, include: { classVersion: true } });
    if (!enrollment) throw notFound();
    return { enrollment, record: stored(enrollment.classVersion.document) };
  }

  private async activity(tx: Tx, userId: string, kind: 'class' | 'assignment', contextId: string, problemId: string) {
    if (kind === 'class') {
      const { enrollment, record } = await this.ownedEnrollment(tx, userId, contextId);
      if (enrollment.status !== 'active') throw conflict('완료한 수업의 기록은 바꿀 수 없어요. 복습 과제를 이용해 주세요.');
      const section = record.sections.find(s => getActivityProblemIds(record, s.sectionId).includes(problemId));
      if (!section || !['practice', 'check'].includes(section.role)) throw notFound();
      const index = record.sections.indexOf(section);
      if (record.sections.slice(0, index).some(s => !(enrollment.completedSectionIds as string[]).includes(s.sectionId))) throw conflict('앞의 학습 단계부터 이어가 주세요.');
      if ((enrollment.completedSectionIds as string[]).includes(section.sectionId)) throw conflict('완료한 단계의 시도는 바꿀 수 없어요.');
      return { problem: record.problems.find(p => p.problemVersionId === problemId)!, scopeId: enrollment.scopeId, enrollmentId: enrollment.id, submissionId: undefined, assignmentItemId: undefined };
    }
    const recipient = await tx.assignmentRecipient.findFirst({ where: { id: contextId, learnerUserId: userId, assignment: { scope: { ownerUserId: userId, kind: 'personal' } } }, include: { assignment: { include: { items: true } }, submissions: { orderBy: { submissionIndex: 'desc' } } } });
    if (!recipient) throw notFound();
    const submission = recipient.submissions[0];
    if (!submission || submission.status !== 'draft') throw conflict('제출이 완료된 과제는 수정할 수 없어요.');
    const item = recipient.assignment.items.find(item => item.problemVersionId === problemId);
    if (!item) throw notFound();
    return { problem: item.problemSnapshot as unknown as StoredProblem, scopeId: recipient.assignment.ownerScopeId, enrollmentId: undefined, submissionId: submission.id, assignmentItemId: item.id };
  }

  async act(userId: string, input: unknown): Promise<ActionResponse> {
    const action = actionSchema.parse(input);
    let extra: Omit<ActionResponse, 'state'> = {};
    for (let retry = 0; retry < 4; retry++) {
      try {
        extra = await this.db.$transaction(async tx => {
          const scope = await tx.scope.findUnique({ where: { ownerUserId: userId } });
          if (!scope || scope.kind !== 'personal') throw notFound();
          switch (action.action) {
            case 'profile.update':
              await tx.user.update({ where: { id: userId }, data: { goal: action.goal, dailyMinutes: action.dailyMinutes } }); return {};
            case 'enrollment.start': {
              const version = await tx.classVersion.findFirst({ where: { classKey: action.classKey }, orderBy: { publishedAt: 'desc' } });
              if (!version) throw notFound();
              const existing = await tx.enrollment.findFirst({ where: { userId, classVersion: { classKey: action.classKey } } });
              if (existing) return { enrollmentId: existing.id };
              const enrollment = await tx.enrollment.create({ data: { userId, scopeId: scope.id, classVersionId: version.id, completedSectionIds: [] } });
              return { enrollmentId: enrollment.id };
            }
            case 'section.complete': {
              const { enrollment, record } = await this.ownedEnrollment(tx, userId, action.enrollmentId);
              const done = enrollment.completedSectionIds as string[];
              if (done.includes(action.sectionId)) return {};
              if (enrollment.status !== 'active') throw conflict('이미 완료한 수업이에요.');
              const index = record.sections.findIndex(s => s.sectionId === action.sectionId);
              if (index < 0) throw notFound();
              if (record.sections.slice(0, index).some(s => !done.includes(s.sectionId))) throw conflict('앞의 학습 단계부터 이어가 주세요.');
              const problemIds = getActivityProblemIds(record, action.sectionId);
              for (const problemVersionId of problemIds) {
                const attempts = await tx.attempt.findMany({ where: { userId, enrollmentId: enrollment.id, problemVersionId } });
                if (!attempts.some(a => (a.result as GradeResult).status !== 'invalid')) throw conflict('문제를 먼저 풀어 주세요. 틀려도 다음 단계로 갈 수 있어요.');
              }
              await tx.enrollment.update({ where: { id: enrollment.id }, data: { completedSectionIds: [...done, action.sectionId] } }); return {};
            }
            case 'hint.open': {
              const target = await this.activity(tx, userId, action.context, action.contextId, action.problemVersionId);
              await tx.hintUse.upsert({ where: { userId_contextKind_contextId_problemVersionId: { userId, contextKind: action.context, contextId: action.contextId, problemVersionId: action.problemVersionId } },
                create: { userId, contextKind: action.context, contextId: action.contextId, problemVersionId: action.problemVersionId }, update: {} });
              return { hint: target.problem.hints };
            }
            case 'attempt.submit': {
              const previous = await tx.attempt.findUnique({ where: { userId_requestId: { userId, requestId: action.requestId } }, include: { submission: true } });
              if (previous) {
                const previousContextId = previous.enrollmentId ?? previous.submission?.recipientId;
                const previousKind = previous.enrollmentId ? 'class' : 'assignment';
                if (previousContextId !== action.contextId || previousKind !== action.context || previous.answer !== action.answer || previous.problemVersionId !== action.problemVersionId) throw conflict('동일 요청 ID로 다른 답안을 보낼 수 없어요.');
                return { result: previous.result as GradeResult };
              }
              const target = await this.activity(tx, userId, action.context, action.contextId, action.problemVersionId);
              const hint = await tx.hintUse.findUnique({ where: { userId_contextKind_contextId_problemVersionId: { userId, contextKind: action.context, contextId: action.contextId, problemVersionId: action.problemVersionId } } });
              const result = gradeAnswer(action.answer, target.problem.gradingSpec, Boolean(hint));
              await tx.attempt.create({ data: { userId, scopeId: target.scopeId, enrollmentId: target.enrollmentId, submissionId: target.submissionId, assignmentItemId: target.assignmentItemId,
                problemVersionId: action.problemVersionId, answer: action.answer, result: asJson(result), hintUsed: Boolean(hint), requestId: action.requestId } });
              return { result };
            }
            case 'class.complete': {
              const { enrollment, record } = await this.ownedEnrollment(tx, userId, action.enrollmentId);
              if (enrollment.status === 'completed') return {};
              if (record.sections.some(s => !(enrollment.completedSectionIds as string[]).includes(s.sectionId))) throw conflict('남은 학습 단계를 마무리해 주세요.');
              await tx.enrollment.update({ where: { id: enrollment.id }, data: { status: 'completed', completedAt: new Date() } });
              await this.createPersonalAssignment(tx, userId, scope.id, record, enrollment.id);
              return {};
            }
            case 'assignment.submit': {
              const recipient = await tx.assignmentRecipient.findFirst({ where: { id: action.recipientId, learnerUserId: userId, assignment: { ownerScopeId: scope.id } }, include: { assignment: { include: { items: true } }, submissions: { orderBy: { submissionIndex: 'desc' }, include: { attempts: { orderBy: [{ createdAt: 'desc' }, { id: 'desc' }] } } } } });
              if (!recipient) throw notFound();
              const submission = recipient.submissions[0];
              if (submission.status === 'submitted') return {};
              for (const item of recipient.assignment.items) {
                const attempt = submission.attempts.find(a => a.assignmentItemId === item.id && (a.result as GradeResult).status !== 'invalid');
                if (!attempt) throw conflict('모든 문제에 답한 뒤 제출해 주세요.');
                await tx.submissionItem.create({ data: { submissionId: submission.id, assignmentItemId: item.id, selectedAttemptId: attempt.id } });
              }
              await tx.submission.update({ where: { id: submission.id }, data: { status: 'submitted', finalizedAt: new Date(), requestId: action.requestId } });
              await tx.assignmentRecipient.update({ where: { id: recipient.id }, data: { status: 'submitted' } }); return {};
            }
          }
        }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable, maxWait: 10000, timeout: 20000 });
        break;
      } catch (error) {
        if (retry < 3 && error instanceof Prisma.PrismaClientKnownRequestError && ['P2034', 'P2002'].includes(error.code)) continue;
        throw error;
      }
    }
    return { state: await this.state(userId), ...extra };
  }

  // Independent assignment boundary. The web API currently calls this only for self-study.
  async createPersonalAssignment(tx: Tx, userId: string, scopeId: string, record: StoredClass, sourceEnrollmentId?: string) {
    validateClass(record);
    const scope = await tx.scope.findFirst({ where: { id: scopeId, ownerUserId: userId, kind: 'personal' } });
    if (!scope) throw notFound();
    return tx.assignment.create({ data: {
      ownerScopeId: scopeId, title: `${record.public.title} · 다시 풀기`, sourceClassVersionId: record.public.versionId,
      policySnapshot: { version: 1, audience: 'self-study', hints: 'on-request-assisted', results: 'after-item-attempt', solutions: 'not-exposed' },
      items: { create: record.homeworkProblemIds.map((problemVersionId, position) => ({ problemVersionId, position, problemSnapshot: asJson(record.problems.find(p => p.problemVersionId === problemVersionId)!) })) },
      recipients: { create: { learnerUserId: userId, sourceEnrollmentId, recommendedAt: new Date(Date.now() + 86400000),
        submissions: { create: { submissionIndex: 1 } } } },
    } });
  }
}
