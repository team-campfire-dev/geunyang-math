import 'server-only';
import { createHash } from 'node:crypto';
import { lessonRecord, lessonRecords, currentDiagnostic, currentDefinitions, publishedProblemRecords } from './content-store';
import { recommend, reviewSelection, conceptReadiness, type Evidence } from '@/core/personalization';
import { assignmentWindow, parseAssignmentPolicy, parseAssignmentSchedule, recipientDates, reviewPolicy } from '@/core/assignment';
import { glossaryEntries } from '@/core/glossary';
import { conceptGraph, placementScope } from '@/core/concept-graph';
import { placement, placementProgress, type PlacementState } from '@/core/placement';
import { canExploreDefinitions, leafGlossary } from '@/shared/definition-exploration';
import { definitionRefId, mayReferenceDefinition } from '@/shared/rich-text';
import { Prisma, type PrismaClient, type Attempt } from '@prisma/client';
import { z } from 'zod';
import { blockDefinitionRefs, getActivityProblemIds, definitionReferences, toPublicLesson, type LessonMetadata, type LessonRecord, type StoredProblem } from '@/core/content';
import { gradeAnswer } from '@/core/grading';
import type { ActionResponse, AssignmentView, AttemptView, GradeResult, LearningState, PublicCatalog, PublicLesson, PublicProblem, DiagnosticAnswer, Recommendation } from '@/shared/api';
import { AppError } from './errors';

/**
 * A placement as a run keeps it: what it has to settle, what it has settled, and **the shape of the
 * catalogue it is descending.** The lessons are frozen with the run for the same reason the question
 * bank already is — a lesson published halfway through must not change which question comes next, or
 * move a learner who has stopped answering.
 */
type StoredPlacement = PlacementState & { lessons: { conceptKeys: string[]; prerequisiteConceptKeys: string[] }[] };

const id = z.string().min(1).max(191);
const definitionRef = z.object({
  conceptKey: id.max(100), scopeKind: z.enum(['global', 'lesson', 'course', 'organization']).optional(),
  scopeKey: z.string().max(100).optional(),
}).strict().refine(ref => (ref.scopeKind ?? 'global') === 'global' ? !ref.scopeKey : !!ref.scopeKey);
const explorationSchema = z.object({
  lessonKey: id.max(100), lessonVersionId: id,
  // A request budget, not recursive graph loading. Normal paths collapse on revisiting a definition.
  path: z.array(definitionRef).min(1).max(128),
}).strict();
const context = z.enum(['lesson', 'assignment']);
export const actionSchema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('recommendation.choose'), lessonKey: z.string().min(1).max(100).nullable() }).strict(),
  z.object({ action: z.literal('diagnostic.start') }).strict(),
  z.object({ action: z.literal('diagnostic.answer'), diagnosticId: id, problemVersionId: id, answer: z.string().trim().min(1).max(128).nullable() }).strict(),
  z.object({ action: z.literal('profile.update'), targetCourseKey: z.string().trim().min(1).max(100).nullable(), dailyMinutes: z.union([z.literal(5), z.literal(10), z.literal(20)]) }).strict(),
  z.object({ action: z.literal('enrollment.start'), lessonKey: id }).strict(),
  z.object({ action: z.literal('section.complete'), enrollmentId: id, sectionId: id }).strict(),
  z.object({ action: z.literal('attempt.submit'), context, contextId: id, problemVersionId: id, answer: z.string().max(128), requestId: z.string().min(8).max(100) }).strict(),
  z.object({ action: z.literal('hint.open'), context, contextId: id, problemVersionId: id }).strict(),
  z.object({ action: z.literal('lesson.complete'), enrollmentId: id }).strict(),
  z.object({ action: z.literal('assignment.submit'), recipientId: id, requestId: z.string().min(8).max(100) }).strict(),
]);
type Tx = Prisma.TransactionClient;
const asJson = (value: unknown) => JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
const notFound = () => new AppError(404, 'not_found', '학습 기록을 찾을 수 없어요.');
const conflict = (message: string) => new AppError(409, 'conflict', message);
function publicProblem(p: StoredProblem): PublicProblem {
  return { problemVersionId: p.problemVersionId, conceptKeys: p.conceptKeys, promptContent: p.promptContent, responseSpec: p.responseSpec, hintAvailable: p.hintAvailable };
}
function attemptView(a: Attempt): AttemptView {
  return { id: a.id, problemVersionId: a.problemVersionId, answer: a.answer, result: a.result as GradeResult, hintUsed: a.hintUsed };
}
/**
 * Assessable concepts in the order the catalogue teaches them: the first lesson that teaches a
 * concept places it, and concepts no published lesson teaches follow by name. Concepts have no order
 * of their own — the course's order of lessons is the only order there is.
 */
function orderConcepts<T extends { key: string; label: string }>(rows: T[], lessons: PublicLesson[]): T[] {
  const position = new Map<string, number>();
  lessons.forEach((lesson, index) => { for (const key of lesson.conceptKeys) if (!position.has(key)) position.set(key, index); });
  return [...rows].sort((a, b) => (position.get(a.key) ?? Number.MAX_SAFE_INTEGER) - (position.get(b.key) ?? Number.MAX_SAFE_INTEGER)
    || a.label.localeCompare(b.label, 'ko') || a.key.localeCompare(b.key));
}

export class LearningService {
  constructor(private readonly db: PrismaClient) {}

  /** The latest version of every published lesson, in the order its course gives it. */
  async catalog(db: Tx = this.db): Promise<PublicLesson[]> {
    const rows = await db.lessonVersion.findMany({ orderBy: [{ publishedAt: 'desc' }, { id: 'desc' }],
      select: { lessonKey: true, metadata: true, lesson: { select: { order: true, course: { select: { key: true, createdAt: true } } } } } });
    const seen = new Set<string>();
    return rows.filter(row => { if (seen.has(row.lessonKey)) return false; seen.add(row.lessonKey); return true; })
      .sort((a, b) => a.lesson.course.createdAt.getTime() - b.lesson.course.createdAt.getTime()
        || a.lesson.course.key.localeCompare(b.lesson.course.key) || a.lesson.order - b.lesson.order || a.lessonKey.localeCompare(b.lessonKey))
      .map(row => ({ ...(row.metadata as { public: LessonMetadata }).public, courseKey: row.lesson.course.key }));
  }

  // Signed-out screens name the concepts the published catalogue teaches. A concept without a
  // published lesson stays out of the public response until its lesson is released.
  async publicCatalog(db: Tx = this.db): Promise<PublicCatalog> {
    const lessons = await this.catalog(db);
    const taught = new Set(lessons.flatMap(item => item.conceptKeys));
    const published = new Set(lessons.map(item => item.courseKey));
    const [rows, courses] = await Promise.all([
      db.concept.findMany({ where: { assessable: true } }),
      db.course.findMany({ orderBy: [{ createdAt: 'asc' }, { key: 'asc' }], select: { key: true, title: true, summary: true } }),
    ]);
    // A course with nothing published yet is not in the catalogue either.
    return { courses: courses.filter(course => published.has(course.key)), lessons,
      concepts: orderConcepts(rows.filter(row => taught.has(row.key)), lessons).map(row => ({ key: row.key, label: row.label })) };
  }

  async lessonDocument(lessonKey: string, userId?: string) {
    const enrollment = userId ? await this.db.enrollment.findFirst({ where: { userId, lessonVersion: { lessonKey } }, select: { lessonVersionId: true } }) : null;
    const versionId = enrollment?.lessonVersionId
      ?? (await this.db.lessonVersion.findFirst({ where: { lessonKey }, orderBy: [{ publishedAt: 'desc' }, { id: 'desc' }], select: { id: true } }))?.id;
    if (!versionId) throw notFound();
    const record = await lessonRecord(this.db, versionId);
    if (!record) throw notFound();
    // Definitions resolve at delivery so a reworded definition reaches an in-progress lesson version too.
    const [definitions, lessons, lesson] = await Promise.all([
      currentDefinitions(this.db, definitionReferences(record)), this.catalog(),
      this.db.lesson.findUnique({ where: { key: lessonKey }, select: { course: { select: { key: true } } } }),
    ]);
    if (!lesson) throw notFound();
    return toPublicLesson(record, lesson.course.key, leafGlossary(glossaryEntries(definitions, lessons, lesson.course.key)));
  }

  /** Resolve only a path rooted in this reader's published lesson prose, never in a question. */
  async exploreDefinition(input: unknown, userId?: string) {
    const request = explorationSchema.parse(input);
    const enrollment = userId ? await this.db.enrollment.findFirst({ where: { userId, lessonVersion: { lessonKey: request.lessonKey } }, select: { lessonVersionId: true } }) : null;
    const versionId = enrollment?.lessonVersionId ?? (await this.db.lessonVersion.findFirst({
      where: { lessonKey: request.lessonKey }, orderBy: [{ publishedAt: 'desc' }, { id: 'desc' }], select: { id: true },
    }))?.id;
    if (!versionId || versionId !== request.lessonVersionId) throw conflict('수업이 바뀌었어요. 수업을 다시 연 뒤 뜻풀이를 확인해 주세요.');
    const record = await lessonRecord(this.db, versionId);
    const lesson = await this.db.lesson.findUnique({ where: { key: request.lessonKey }, select: { course: { select: { key: true } } } });
    if (!record || !lesson) throw notFound();
    const refs = request.path;
    const roots = blockDefinitionRefs(record.sections.filter(section => canExploreDefinitions(section.role)).flatMap(section => section.contentBlocks));
    const unavailable = () => new AppError(404, 'definition_unavailable', '이 경로의 뜻풀이를 사용할 수 없어요. 이전 설명이나 수업으로 돌아가 주세요.');
    if (!roots.some(root => definitionRefId(root) === definitionRefId(refs[0]))) throw unavailable();
    if (!mayReferenceDefinition({ conceptKey: '', scopeKind: 'lesson', scopeKey: request.lessonKey }, refs[0])) throw unavailable();
    // Fetch the path in one batch, then validate every current edge. Mutable definitions cannot
    // grant access through a stale client path, another lesson, an unpublished root, or a question.
    const entries = new Map((await currentDefinitions(this.db, refs)).map(entry => [definitionRefId(entry), entry]));
    for (let index = 0; index < refs.length; index++) {
      if (!entries.has(definitionRefId(refs[index]))) throw unavailable();
      if (!index) continue;
      const parent = entries.get(definitionRefId(refs[index - 1]))!;
      if (!mayReferenceDefinition(parent, refs[index]) || !blockDefinitionRefs(parent.blocks).some(ref => definitionRefId(ref) === definitionRefId(refs[index]))) throw unavailable();
    }
    const selected = entries.get(definitionRefId(refs.at(-1)!))!;
    return glossaryEntries([selected], await this.catalog(), lesson.course.key)[0];
  }

  async state(userId: string, db: Tx = this.db): Promise<LearningState> {
    const [user, lessons, enrollments, recipients, diagnostic, history, assessable, offering] = await Promise.all([
      db.user.findUnique({ where: { id: userId } }), this.catalog(db),
      db.enrollment.findMany({ where: { userId }, include: { lessonVersion: { select: { id: true, lessonKey: true } },
        attempts: { orderBy: [{ createdAt: 'asc' }, { id: 'asc' }] } }, orderBy: { createdAt: 'asc' } }),
      db.assignmentRecipient.findMany({ where: { learnerUserId: userId }, include: {
        assignment: { include: { items: { orderBy: { position: 'asc' } } } },
        submissions: { orderBy: { submissionIndex: 'desc' }, include: { items: { include: { selectedAttempt: true } }, attempts: { orderBy: [{ createdAt: 'asc' }, { id: 'asc' }] } } },
      }, orderBy: { recommendedAt: 'asc' } }),
      db.diagnosticRun.findFirst({ where: { userId }, orderBy: { createdAt: 'desc' } }),
      db.recommendationHistory.findMany({ where: { userId }, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], take: 10 }),
      db.concept.findMany({ where: { assessable: true } }), currentDiagnostic(db),
    ]);
    if (!user) throw notFound();
    // Only what a published lesson teaches. A concept with nowhere to learn it can never be settled
    // by a placement or by any work, so listing it forever as「아직 확인 전」says nothing true.
    const taughtKeys = new Set(lessons.flatMap(lesson => lesson.conceptKeys));
    const conceptRows = orderConcepts(assessable.filter(row => taughtKeys.has(row.key)), lessons);
    const conceptLabels = Object.fromEntries(conceptRows.map(s => [s.key, s.label]));
    const concepts: LearningState['concepts'] = Object.entries(conceptLabels).map(([key, label]) => ({ key, label, state: 'unknown' }));
    const firstEvidence = new Map<string, { result: GradeResult; date: Date; conceptKeys: string[]; delayed: boolean }>();
    const evidence: Evidence[] = [];
    const observedIds = new Set<string>();
    const records = await lessonRecords(db, enrollments.map(e => e.lessonVersionId));
    for (const e of enrollments) {
      const record = records.get(e.lessonVersionId);
      if (!record) throw notFound();
      const checks = new Set(record.sections.filter(s => s.role === 'check').flatMap(s => getActivityProblemIds(record, s.sectionId)));
      for (const a of e.attempts) {
        const result = a.result as GradeResult;
        if (result.status === 'invalid') continue;
        const p = record.problems.find(p => p.problemVersionId === a.problemVersionId);
        if (!p) continue;
        if (!observedIds.has(p.problemVersionId)) {
          observedIds.add(p.problemVersionId);
          evidence.push({ problemVersionId: p.problemVersionId, conceptKeys: p.conceptKeys, result, date: a.createdAt, check: checks.has(p.problemVersionId), assessmentId: e.id });
        }
        for (const concept of concepts.filter(s => p.conceptKeys.includes(s.key))) if (concept.state === 'unknown') concept.state = 'practicing';
        if (checks.has(p.problemVersionId) && !firstEvidence.has(p.problemVersionId)) firstEvidence.set(p.problemVersionId, { result, date: a.createdAt, conceptKeys: p.conceptKeys, delayed: false });
      }
    }
    // An item names a question in the assignment's frozen problem set version, so the content is read there.
    const assignmentProblems = await publishedProblemRecords(db, recipients.flatMap(r => r.assignment.items.map(item => item.problemVersionId)));
    const assignmentTerms = await currentDefinitions(db, blockDefinitionRefs([...assignmentProblems.values()].flatMap(p => [...p.promptContent, ...p.hints])));
    const assignments: AssignmentView[] = recipients.map(r => {
      const submission = r.submissions[0];
      if (!submission) throw new Error('Missing initial submission');
      const lessonKey = enrollments.find(e => e.id === r.sourceEnrollmentId)?.lessonVersion.lessonKey ?? null;
      const policy = parseAssignmentPolicy(r.assignment.policy);
      const window = assignmentWindow(parseAssignmentSchedule(r.assignment.schedule), r);
      const items = r.assignment.items.map(item => {
        const p = assignmentProblems.get(item.problemVersionId);
        if (!p) throw new Error(`Missing published problem ${item.problemVersionId}`);
        const matching = submission.attempts.filter(a => a.assignmentItemId === item.id);
        if (matching.some(a => (a.result as GradeResult).status !== 'invalid')) {
          for (const concept of concepts.filter(s => p.conceptKeys.includes(s.key))) if (concept.state === 'unknown') concept.state = 'practicing';
        }
        // Only finalized, server-received work contributes homework evidence.
        if (submission.status === 'submitted') {
          const first = matching.find(a => (a.result as GradeResult).status !== 'invalid');
          if (first && !observedIds.has(p.problemVersionId)) {
            observedIds.add(p.problemVersionId);
            evidence.push({ problemVersionId: p.problemVersionId, conceptKeys: p.conceptKeys, result: first.result as GradeResult, date: first.createdAt, check: true, assessmentId: r.id });
          }
          if (first && !firstEvidence.has(p.problemVersionId)) firstEvidence.set(p.problemVersionId, {
            result: first.result as GradeResult, date: first.createdAt, conceptKeys: p.conceptKeys,
            delayed: first.createdAt >= r.recommendedAt,
          });
        }
        const visibleAttempt = submission.status === 'submitted'
          ? submission.items.find(selected => selected.assignmentItemId === item.id)?.selectedAttempt
          : matching[matching.length - 1];
        // A policy without hints hides them the way a question without hints does.
        return { id: item.id, problem: { ...publicProblem(p), hintAvailable: policy.hints && p.hintAvailable }, attempt: visibleAttempt ? attemptView(visibleAttempt) : null };
      });
      return { id: r.assignmentId, recipientId: r.id, title: r.assignment.title, lessonKey,
        recommendedAt: r.recommendedAt.toISOString(), opensAt: window.opensAt?.toISOString() ?? null, dueAt: window.dueAt?.toISOString() ?? null,
        policy, status: r.status as 'assigned' | 'submitted', items, submissionId: submission.id,
        glossary: leafGlossary(glossaryEntries(assignmentTerms, lessons)),
        reason: typeof (r.assignment.policySnapshot as { reviewReason?: string }).reviewReason === 'string' ? (r.assignment.policySnapshot as { reviewReason: string }).reviewReason : undefined };
    });
    for (const concept of concepts) {
      const correct = [...firstEvidence.values()].filter(e => e.conceptKeys.includes(concept.key) && e.result.status === 'correct' && !e.result.assisted);
      if (correct.length >= 2) concept.state = 'independent';
      if (correct.some(e => e.delayed) && correct.some(e => !e.delayed)) concept.state = 'retained';
    }
    const diagnosticBank = diagnostic?.document as unknown as StoredProblem[] | undefined;
    const diagnosticAnswers = (diagnostic?.answers ?? []) as unknown as DiagnosticAnswer[];
    const completedDiagnostic = diagnostic?.status === 'completed';
    const stored = (diagnostic?.placement ?? null) as StoredPlacement | null;
    const asking = stored && diagnosticBank ? placement(conceptGraph(stored.lessons), stored.scope, diagnosticBank, diagnosticAnswers) : null;
    const readiness = conceptReadiness(conceptLabels, completedDiagnostic ? stored : null, evidence);
    const { recommendations, plan } = recommend({ lessons, enrollments: enrollments.map(e => ({ lessonKey: e.lessonVersion.lessonKey, status: e.status })),
      assignments, readiness, dailyMinutes: user.dailyMinutes, targetCourseKey: user.targetCourseKey, now: new Date(), preferredLessonKey: user.preferredLessonKey });
    return {
      user: { id: user.id, displayName: user.displayName, targetCourseKey: user.targetCourseKey, dailyMinutes: user.dailyMinutes },
      lessons, assignments, recommendations, concepts, plan,
      diagnosticOffering: offering ? { version: offering.versionId, title: offering.title, description: offering.description,
        scope: placementScope(conceptGraph(lessons), lessons.filter(l => l.courseKey === user.targetCourseKey).flatMap(l => l.conceptKeys)).length,
        estimatedMinutes: offering.estimatedMinutes } : null,
      diagnostic: diagnostic && diagnosticBank && stored ? { id: diagnostic.id, version: diagnostic.version, status: diagnostic.status as 'active' | 'completed',
        completedAt: diagnostic.completedAt?.toISOString() ?? null, answered: diagnosticAnswers.length,
        ...placementProgress({ scope: stored.scope, placed: stored.placed, source: stored.source }),
        currentProblem: !completedDiagnostic && asking?.next ? publicProblem(diagnosticBank.find(p => p.problemVersionId === asking.next!.problemVersionId)!) : null,
        results: completedDiagnostic ? diagnosticAnswers : [] } : null,
      recommendationHistory: history.map(h => ({ id: h.id, createdAt: h.createdAt.toISOString(), trigger: h.trigger,
        recommendations: (h.snapshot as unknown as { recommendations: Recommendation[] }).recommendations })),
      enrollments: enrollments.map(e => ({ id: e.id, lessonKey: e.lessonVersion.lessonKey, lessonVersionId: e.lessonVersionId,
        completedSectionIds: e.completedSectionIds as string[], status: e.status as 'active' | 'completed', attempts: e.attempts.map(attemptView) })),
    };
  }

  private async ownedEnrollment(tx: Tx, userId: string, enrollmentId: string) {
    const enrollment = await tx.enrollment.findFirst({ where: { id: enrollmentId, userId, learningScope: { ownerUserId: userId, kind: 'personal' } },
      include: { lessonVersion: { select: { id: true, lessonKey: true } } } });
    if (!enrollment) throw notFound();
    const record = await lessonRecord(tx, enrollment.lessonVersionId);
    if (!record) throw notFound();
    return { enrollment, record };
  }

  private async activity(tx: Tx, userId: string, kind: 'lesson' | 'assignment', contextId: string, problemId: string) {
    if (kind === 'lesson') {
      const { enrollment, record } = await this.ownedEnrollment(tx, userId, contextId);
      if (enrollment.status !== 'active') throw conflict('완료한 수업의 기록은 바꿀 수 없어요. 복습 과제를 이용해 주세요.');
      const section = record.sections.find(s => getActivityProblemIds(record, s.sectionId).includes(problemId));
      if (!section || !['practice', 'check'].includes(section.role)) throw notFound();
      const index = record.sections.indexOf(section);
      if (record.sections.slice(0, index).some(s => !(enrollment.completedSectionIds as string[]).includes(s.sectionId))) throw conflict('앞의 학습 단계부터 이어가 주세요.');
      if ((enrollment.completedSectionIds as string[]).includes(section.sectionId)) throw conflict('완료한 단계의 시도는 바꿀 수 없어요.');
      return { problem: record.problems.find(p => p.problemVersionId === problemId)!, scopeId: enrollment.scopeId, enrollmentId: enrollment.id, submissionId: undefined, assignmentItemId: undefined, hints: true };
    }
    const recipient = await tx.assignmentRecipient.findFirst({ where: { id: contextId, learnerUserId: userId, assignment: { learningScope: { ownerUserId: userId, kind: 'personal' } } }, include: { assignment: { include: { items: true } }, submissions: { orderBy: { submissionIndex: 'desc' } } } });
    if (!recipient) throw notFound();
    const submission = recipient.submissions[0];
    if (!submission || submission.status !== 'draft') throw conflict('제출이 완료된 과제는 수정할 수 없어요.');
    const item = recipient.assignment.items.find(item => item.problemVersionId === problemId);
    if (!item) throw notFound();
    const problem = (await publishedProblemRecords(tx, [item.problemVersionId])).get(item.problemVersionId);
    if (!problem) throw notFound();
    return { problem, scopeId: recipient.assignment.ownerScopeId, enrollmentId: undefined, submissionId: submission.id, assignmentItemId: item.id,
      hints: parseAssignmentPolicy(recipient.assignment.policy).hints };
  }

  async act(userId: string, input: unknown): Promise<ActionResponse> {
    const action = actionSchema.parse(input);
    let extra: Omit<ActionResponse, 'state'> = {};
    for (let retry = 0; retry < 4; retry++) {
      try {
        extra = await this.db.$transaction(async tx => {
          const scope = await tx.learningScope.findUnique({ where: { ownerUserId: userId } });
          if (!scope || scope.kind !== 'personal') throw notFound();
          const outcome = await (async (): Promise<Omit<ActionResponse, 'state'>> => {
          switch (action.action) {
            case 'recommendation.choose': {
              if (action.lessonKey && !await tx.lessonVersion.findFirst({ where: { lessonKey: action.lessonKey } })) throw notFound();
              await tx.user.update({ where: { id: userId }, data: { preferredLessonKey: action.lessonKey } });
              return {};
            }
            case 'diagnostic.start': {
              // A published bank never replaces an in-progress learner snapshot.
              const open = await tx.diagnosticRun.findFirst({ where: { userId, status: 'active' } });
              // A run started before placement descended a graph cannot be continued — its questions
              // were chosen by walking the bank, and this one chooses them. Rather than keep a second
              // way of running a placement forever, an unfinished one of those starts again. There
              // are none in production; a finished run is never touched.
              if (open && !open.placement) await tx.diagnosticRun.delete({ where: { id: open.id } });
              else if (open) return {};
              const definition = await currentDiagnostic(tx);
              if (!definition) throw new AppError(503, 'content_unavailable', '시작점 확인을 준비하고 있어요. 잠시 후 다시 시도해 주세요.');
              // Only what the course they came for stands on. Without one it is the whole catalogue,
              // which is the length this was replacing — so the question is worth asking first.
              const published = await this.catalog(tx);
              const shapes = published.map(l => ({ conceptKeys: l.conceptKeys, prerequisiteConceptKeys: l.prerequisiteConceptKeys }));
              const learner = await tx.user.findUniqueOrThrow({ where: { id: userId }, select: { targetCourseKey: true } });
              const wanted = published.filter(l => l.courseKey === learner.targetCourseKey).flatMap(l => l.conceptKeys);
              const scope = placementScope(conceptGraph(shapes), wanted);
              await tx.diagnosticRun.upsert({ where: { userId_version: { userId, version: definition.versionId } }, update: {},
                create: { userId, version: definition.versionId, document: asJson(definition.problems), answers: [],
                  placement: asJson({ scope, lessons: shapes, placed: {}, source: {} } satisfies StoredPlacement) } });
              return {};
            }
            case 'diagnostic.answer': {
              const run = await tx.diagnosticRun.findFirst({ where: { id: action.diagnosticId, userId } });
              if (!run) throw notFound();
              const bank = run.document as unknown as StoredProblem[];
              const answers = run.answers as unknown as DiagnosticAnswer[];
              const previous = answers.find(a => a.problemVersionId === action.problemVersionId);
              if (previous) {
                if (previous.answer !== action.answer) throw conflict('이미 저장한 진단 답안은 바꿀 수 없어요. 이후 수업에서 새 풀이를 반영해요.');
                return {};
              }
              if (run.status !== 'active') throw conflict('이미 마친 진단이에요.');
              const held = run.placement as StoredPlacement | null;
              if (!held) throw conflict('예전 방식으로 시작한 시작점 확인이에요. 새로 시작해 주세요.');
              const graph = conceptGraph(held.lessons);
              const asked = placement(graph, held.scope, bank, answers).next;
              if (!asked || asked.problemVersionId !== action.problemVersionId) throw conflict('현재 진단 문제부터 확인해 주세요.');
              const problem = bank.find(p => p.problemVersionId === asked.problemVersionId)!;
              const result = action.answer === null ? null : gradeAnswer(action.answer, problem.gradingSpec, false);
              if (result?.status === 'invalid') return { result };
              const next: DiagnosticAnswer[] = [...answers, { problemVersionId: problem.problemVersionId, answer: action.answer, status: result?.status ?? 'skipped' }];
              // A placement ends when the descent has nothing left it can ask, not at a fixed length.
              const after = placement(graph, held.scope, bank, next);
              const completed = !after.next;
              await tx.diagnosticRun.update({ where: { id: run.id }, data: { answers: asJson(next),
                placement: asJson({ ...held, placed: after.state.placed, source: after.state.source } satisfies StoredPlacement),
                status: completed ? 'completed' : 'active', completedAt: completed ? new Date() : null } });
              return {};
            }
            case 'profile.update': {
              // A course with nothing published in it is not a destination — the placement's own
              // course holds the question bank and no lessons. Clearing it is always allowed.
              if (action.targetCourseKey && !(await tx.lessonVersion.findFirst({ where: { lesson: { course: { key: action.targetCourseKey } } } }))) throw notFound();
              await tx.user.update({ where: { id: userId }, data: { targetCourseKey: action.targetCourseKey, dailyMinutes: action.dailyMinutes } });
              return {};
            }
            case 'enrollment.start': {
              const version = await tx.lessonVersion.findFirst({ where: { lessonKey: action.lessonKey }, orderBy: [{ publishedAt: 'desc' }, { id: 'desc' }] });
              if (!version) throw notFound();
              const existing = await tx.enrollment.findFirst({ where: { userId, lessonVersion: { lessonKey: action.lessonKey } } });
              if (existing) return { enrollmentId: existing.id };
              const enrollment = await tx.enrollment.create({ data: { userId, scopeId: scope.id, lessonVersionId: version.id, completedSectionIds: [] } });
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
              if (!target.hints) throw conflict('이 과제는 힌트 없이 풀어요.');
              await tx.hintUse.upsert({ where: { userId_contextKind_contextId_problemVersionId: { userId, contextKind: action.context, contextId: action.contextId, problemVersionId: action.problemVersionId } },
                create: { userId, contextKind: action.context, contextId: action.contextId, problemVersionId: action.problemVersionId }, update: {} });
              return { hint: target.problem.hints };
            }
            case 'attempt.submit': {
              const previous = await tx.attempt.findUnique({ where: { userId_requestId: { userId, requestId: action.requestId } }, include: { submission: true } });
              if (previous) {
                const previousContextId = previous.enrollmentId ?? previous.submission?.recipientId;
                const previousKind = previous.enrollmentId ? 'lesson' : 'assignment';
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
            case 'lesson.complete': {
              const { enrollment, record } = await this.ownedEnrollment(tx, userId, action.enrollmentId);
              if (enrollment.status === 'completed') return {};
              if (record.sections.some(s => !(enrollment.completedSectionIds as string[]).includes(s.sectionId))) throw conflict('남은 학습 단계를 마무리해 주세요.');
              await tx.enrollment.update({ where: { id: enrollment.id }, data: { status: 'completed', completedAt: new Date() } });
              await this.createPersonalAssignment(tx, userId, scope.id, record, enrollment.id);
              await tx.user.updateMany({ where: { id: userId, preferredLessonKey: record.public.lessonKey }, data: { preferredLessonKey: null } });
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
          })();
          const nextState = await this.state(userId, tx);
          const snapshot = { recommendations: nextState.recommendations, plan: nextState.plan };
          const fingerprint = createHash('sha256').update(JSON.stringify(snapshot)).digest('hex');
          const previous = await tx.recommendationHistory.findFirst({ where: { userId }, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }] });
          if (previous?.fingerprint !== fingerprint) await tx.recommendationHistory.create({ data: { userId, fingerprint, trigger: action.action, snapshot: asJson(snapshot) } });
          return outcome;
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
  async createPersonalAssignment(tx: Tx, userId: string, scopeId: string, record: LessonRecord, sourceEnrollmentId?: string) {
    // A lesson that sets no review pool asks for no review.
    if (!record.review) return null;
    const scope = await tx.learningScope.findFirst({ where: { id: scopeId, ownerUserId: userId, kind: 'personal' } });
    if (!scope) throw notFound();
    const user = await tx.user.findUniqueOrThrow({ where: { id: userId } });
    const attempts = sourceEnrollmentId ? await tx.attempt.findMany({ where: { userId, enrollmentId: sourceEnrollmentId }, orderBy: [{ createdAt: 'asc' }, { id: 'asc' }] }) : [];
    const checkIds = new Set(record.sections.filter(s => s.role === 'check').flatMap(s => getActivityProblemIds(record, s.sectionId)));
    const seen = new Set<string>();
    const evidence: Evidence[] = [];
    for (const attempt of attempts) {
      const p = record.problems.find(p => p.problemVersionId === attempt.problemVersionId);
      const result = attempt.result as GradeResult;
      if (!p || result.status === 'invalid' || seen.has(p.problemVersionId)) continue;
      seen.add(p.problemVersionId);
      evidence.push({ problemVersionId: p.problemVersionId, conceptKeys: p.conceptKeys, responseKind: p.responseSpec.kind, result, date: attempt.createdAt, check: checkIds.has(p.problemVersionId) });
    }
    const selection = reviewSelection(record.review.problemVersionIds.map(id => record.problems.find(p => p.problemVersionId === id)!), evidence, user.dailyMinutes);
    // A review has a recommended moment, not a window: the schedule is empty and the recipient's dates stay so.
    const schedule = {};
    return tx.assignment.create({ data: {
      ownerScopeId: scopeId, title: `${record.public.title} · 다시 풀기`, sourceLessonVersionId: record.public.versionId,
      problemSetId: record.review.problemSetId, problemSetVersionId: record.review.problemSetVersionId,
      policy: reviewPolicy, schedule, issuedAt: new Date(),
      policySnapshot: { version: 1, audience: 'self-study', reviewVersion: selection.version, reviewReason: selection.reason, dailyMinutes: user.dailyMinutes, intervalDays: selection.intervalDays },
      items: { create: selection.items.map((problem, position) => ({ problemVersionId: problem.problemVersionId, position })) },
      recipients: { create: { learnerUserId: userId, sourceEnrollmentId, recommendedAt: new Date(Date.now() + selection.intervalDays * 86400000),
        ...recipientDates(schedule, new Date()), submissions: { create: { submissionIndex: 1 } } } },
    } });
  }
}
