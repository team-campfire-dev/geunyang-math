import 'server-only';
import { createHash } from 'node:crypto';
import { lessonRecord, lessonRecords, currentDiagnostic, currentDefinitions, generatedPrefix, publishedProblemRecords } from './content-store';
import { recommend, recommendTargetedPractice, reviewSelection, conceptReadiness, type Evidence } from '@/core/personalization';
import { assignmentWindow, parseAssignmentPolicy, parseAssignmentSchedule, practicePolicy, recipientDates, reviewPolicy } from '@/core/assignment';
import { glossaryEntries } from '@/core/glossary';
import { conceptGraph, placementScope } from '@/core/concept-graph';
import { placement, placementProgress, type PlacementState, type PlacementStretch } from '@/core/placement';
import { canExploreDefinitions, leafGlossary } from '@/shared/definition-exploration';
import { definitionRefId, mayReferenceDefinition } from '@/shared/rich-text';
import { Prisma, type PrismaClient, type Attempt } from '@prisma/client';
import { z } from 'zod';
import { blockDefinitionRefs, getActivityProblemIds, definitionReferences, toPublicLesson, type LessonMetadata, type LessonRecord, type StoredProblem } from '@/core/content';
import { gradeAnswer } from '@/core/grading';
import { summarizeConfusion, type ConfusionObservation } from '@/core/confusion';
import { misconceptionOf } from '@/shared/misconception';
import { defaultCourseTrack, isSchoolTrack, type ActionResponse, type AssignmentView, type AttemptView, type CourseStage, type CourseTrack, type GradeResult, type LearningState, type PublicCatalog, type PublicLesson, type PublicProblem, type PublicProblemSet, type DiagnosticAnswer, type Recommendation, type StandingMisconception } from '@/shared/api';
import { AppError } from './errors';
import { loadConceptHelp } from './concept-help';
import { gatheredPracticePools, gatheredQuestions } from './gathered-practice';
import { dailyGenerations, generateForLearner, type LearnerGeneration } from './learner-generation';
import { buildProfile, newSetId, openPracticeSet, planSchema, plannerRequest, settlePlan, storedGuesses, writeForPlan, type LearnerRecord, type Profile } from './ai-practice';
import { plannerSystem } from './problem-prompts';
import { budgetRefusal, usageRecorder } from './ai-budget';
import type { UsageSink } from './model-usage';
import { aiPracticeLimits, checkHypothesis, scopeKey, type AiPracticeRun, type AiPracticeState, type PracticeScope } from '@/shared/ai-practice';
import type { ProblemModel } from './problem-generation';
import { claudeProblemModel, problemWriterAvailable } from './problem-writer';
import { assignedCourseKeys, endLink, hiddenCourses, joinByInvite, learnerTeaching } from './teaching';
import { authoringRole } from './authoring';

/**
 * A placement as a run keeps it: what it has to settle, what it has settled, and **the shape of the
 * catalogue it is descending.** The lessons are frozen with the run for the same reason the question
 * bank already is — a lesson published halfway through must not change which question comes next, or
 * move a learner who has stopped answering.
 */
type StoredPlacement = PlacementState & {
  lessons: { conceptKeys: string[]; prerequisiteConceptKeys: string[] }[];
  /**
   * The scope each stretch of answers was put under, once a learner has changed what they came for.
   * Absent on every run started before they could, which is the same as one stretch from the start.
   */
  stretches?: PlacementStretch[];
};

/** How a stored run says what it was asked under, however long ago it was started. */
const stretchesOf = (held: StoredPlacement): PlacementStretch[] => held.stretches ?? [{ from: 0, scope: held.scope }];

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
  z.object({ action: z.literal('problemSet.start'), problemSetId: id }).strict(),
  z.object({ action: z.literal('solution.open'), context, contextId: id, problemVersionId: id }).strict(),
  z.object({ action: z.literal('practice.gather'), misconception: id.max(60) }).strict(),
  z.object({ action: z.literal('teaching.join'), code: z.string().trim().min(1).max(40) }).strict(),
  z.object({ action: z.literal('teaching.leave'), linkId: id }).strict(),
  z.object({ action: z.literal('practice.ai'), scope: z.discriminatedUnion('kind', [
    z.object({ kind: z.literal('all') }).strict(),
    z.object({ kind: z.literal('course'), key: id.max(100) }).strict(),
    z.object({ kind: z.literal('lesson'), key: id.max(100) }).strict(),
  ]) }).strict(),
]);
type Tx = Prisma.TransactionClient;
/** How many of a set's questions a model wrote for this learner. */
const written = (items: { problemVersionId: string }[]) => items.filter(item => item.problemVersionId.startsWith(generatedPrefix)).length;
const asJson = (value: unknown) => JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
const notFound = () => new AppError(404, 'not_found', '학습 기록을 찾을 수 없어요.');
const conflict = (message: string) => new AppError(409, 'conflict', message);
/**
 * How many different questions have to show one mistake before it is called a habit. Two, which is
 * the bar readiness already uses in the other direction: one answer is never evidence either way.
 */
const standingMisconception = 2;
function publicProblem(p: StoredProblem): PublicProblem {
  return { problemVersionId: p.problemVersionId, conceptKeys: p.conceptKeys, promptContent: p.promptContent, responseSpec: p.responseSpec,
    hintAvailable: p.hintAvailable, solutionAvailable: p.solution.length > 0 };
}
function attemptView(a: Attempt): AttemptView {
  return { id: a.id, problemVersionId: a.problemVersionId, answer: a.answer, result: a.result as GradeResult, hintUsed: a.hintUsed };
}
/**
 * What an answer is allowed to say back, given how the work it belongs to shows results.
 *
 * `results: 'after-submission'` is the exam's promise: the answers are marked as they arrive and
 * the learner is told nothing until they hand the thing in. Everything that would say how it went
 * goes — the verdict, the sentence, the kind of slip read off the number, and above all the name
 * of the mistake the question was built to catch, which is the loudest hint on the screen.
 *
 * What stays is that the answer was saved and whether it could be read at all: a learner who
 * cannot be told their answer is not a number cannot fix it, and a typo says nothing about
 * whether they were right.
 */
const shown = (result: GradeResult, hold: boolean): GradeResult => (!hold || result.status === 'invalid' ? result
  : { status: 'withheld', message: '답안을 저장했어요. 채점 결과는 제출한 뒤에 볼 수 있어요.', assisted: result.assisted });
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

/** Learners with questions being written for them. One at a time each: a second press would pay twice. */
const filling = new Set<string>();
/** Learners with an AI practice set being written. */
const writing = new Set<string>();
const dayAgo = () => new Date(Date.now() - 24 * 60 * 60 * 1000);
/** The AI practice note an assignment carries, read defensively: it is JSON the database hands back. */
function aiNoteOf(snapshot: unknown) {
  const ai = (snapshot as { ai?: unknown } | null)?.ai as { scope?: unknown; scopeLabel?: unknown; diagnosis?: unknown; reasons?: unknown } | undefined;
  if (!ai || typeof ai.scope !== 'string' || typeof ai.diagnosis !== 'string') return null;
  const reasons = ai.reasons && typeof ai.reasons === 'object' ? Object.fromEntries(Object.entries(ai.reasons).filter(([, v]) => typeof v === 'string')) as Record<string, string> : {};
  // A set from before guesses were kept has none, and says only what it saw.
  const { hypotheses, predictions } = storedGuesses(ai);
  return { scope: ai.scope, scopeLabel: typeof ai.scopeLabel === 'string' ? ai.scopeLabel : '', diagnosis: ai.diagnosis, reasons, hypotheses, predictions };
}

export class LearningService {
  /** `writer` writes questions a gathered set lacks, or null where this deployment has no model. */
  constructor(private readonly db: PrismaClient,
    private readonly writer: (onUsage?: UsageSink) => ProblemModel | null = (onUsage) => (problemWriterAvailable() ? claudeProblemModel(onUsage) : null)) {}

  /** AI practice runs still writing, so a test (or a shutdown) can wait for them. */
  private readonly running = new Set<Promise<void>>();
  async settled() { await Promise.all([...this.running]); }

  /**
   * AI 맞춤 연습, asked for. Writing takes up to a minute — longer than a proxy will hold a request —
   * so this checks what can be checked at once, records the request as pending, starts the work and
   * returns. The screen watches the learning state until the set is there. A set for the same range
   * that is still open is opened instead: coming back means 「이어서」.
   */
  private async startAiPractice(userId: string, scope: PracticeScope): Promise<string | undefined> {
    if (!this.writer()?.plan) throw new AppError(503, 'generation_unavailable', '지금은 AI 맞춤 연습을 쓸 수 없어요.');
    const key = scopeKey(scope);
    const open = await this.db.assignmentRecipient.findFirst({ where: { learnerUserId: userId, status: 'assigned',
      assignment: { issuerType: 'self', policySnapshot: { path: '$.ai.scope', equals: key } } }, orderBy: { recommendedAt: 'desc' } });
    if (open) return open.id;
    await this.expireStaleRuns(userId);
    if (writing.has(userId) || await this.db.generatedProblemSet.findFirst({ where: { userId, status: 'pending' } })) {
      throw conflict('AI가 문제를 만들고 있어요. 끝나면 바로 열 수 있어요.');
    }
    const used = await this.db.generatedProblemSet.count({ where: { userId, scope: { not: null }, createdAt: { gte: dayAgo() } } });
    if (used >= aiPracticeLimits.daily) throw conflict('오늘은 AI 맞춤 연습을 더 만들 수 없어요. 내일 다시 해 보세요.');
    const refused = await budgetRefusal(this.db, userId);
    if (refused) throw conflict(refused);
    writing.add(userId);
    try {
      const state = await this.state(userId);
      if (scope.kind === 'lesson' && !state.lessons.some(lesson => lesson.lessonKey === scope.key)) throw notFound();
      const seen = new Set(state.lessons.map(lesson => lesson.courseKey));
      const courses = (await this.db.course.findMany({ select: { key: true, title: true, stage: true } }))
        .filter(course => seen.has(course.key)).map(course => ({ ...course, stage: course.stage as CourseStage | null }));
      if (scope.kind === 'course' && !courses.some(course => course.key === scope.key)) throw notFound();
      const record: LearnerRecord = { userId, summary: state.confusion, concepts: state.concepts, lessons: state.lessons, courses };
      const profile = await buildProfile(this.db, record, scope);
      if (!profile) throw conflict('이 범위에는 아직 기록이 부족해요. 문제를 몇 개 더 풀면 만들 수 있어요.');
      const setId = newSetId();
      // Every call the run makes is written down for this learner and this set as it returns.
      const recorder = usageRecorder(this.db, userId, 'ai-practice', setId);
      const model = this.writer(recorder.sink)!;
      await this.db.generatedProblemSet.create({ data: { id: setId, userId, scope: key, model: model.name,
        requested: aiPracticeLimits.questions, kept: 0, status: 'pending' } });
      const run = this.writeAiPractice(model, userId, setId, scope, profile, record)
        .then(recorder.settled).finally(() => { writing.delete(userId); this.running.delete(run); });
      this.running.add(run);
      return undefined;
    } catch (reason) { writing.delete(userId); throw reason; }
  }

  /** The work itself, after the request has returned. Whatever happens, the set ends done or failed. */
  private async writeAiPractice(model: ProblemModel, userId: string, setId: string, scope: PracticeScope, profile: Profile, record: LearnerRecord) {
    try {
      const plan = settlePlan(planSchema.parse(await model.plan!(plannerSystem, plannerRequest(profile))), profile);
      const written = await writeForPlan(model, plan, profile, record, setId);
      if (!written.problems.length) throw new AppError(502, 'generation_empty', '검증을 통과한 문제가 없었어요. 다시 해 보세요.');
      await openPracticeSet(this.db, userId, setId, scope, profile.scopeLabel, plan, written);
      console.info(JSON.stringify({ event: 'ai_practice', scope: scope.kind, targets: plan.targets.length, kept: written.problems.length }));
    } catch (reason) {
      const message = reason instanceof AppError ? reason.message : 'AI 맞춤 연습을 만들지 못했어요. 잠시 뒤에 다시 해 보세요.';
      console.warn(JSON.stringify({ event: 'ai_practice_failed', reason: reason instanceof Error ? reason.message : String(reason) }));
      await this.db.generatedProblemSet.update({ where: { id: setId }, data: { status: 'failed', plan: { error: message } } }).catch(() => undefined);
    }
  }

  /** A run left pending by a restart never finishes; after a while it is said to have failed. */
  private async expireStaleRuns(userId: string) {
    await this.db.generatedProblemSet.updateMany({ where: { userId, status: 'pending',
      createdAt: { lt: new Date(Date.now() - aiPracticeLimits.staleMinutes * 60_000) } },
      data: { status: 'failed', plan: { error: '시간이 너무 오래 걸려 멈췄어요. 다시 해 보세요.' } } });
  }

  /** What the screen needs to offer AI practice: whether it can, how often more today, and what is under way. */
  private async aiPracticeState(db: Tx, userId: string, refused: string | null): Promise<AiPracticeState> {
    const sets = await db.generatedProblemSet.findMany({ where: { userId, scope: { not: null }, createdAt: { gte: dayAgo() } },
      orderBy: { createdAt: 'desc' }, select: { scope: true, status: true, plan: true, createdAt: true } });
    const latest = new Map<string, (typeof sets)[number]>();
    for (const set of sets) if (!latest.has(set.scope!)) latest.set(set.scope!, set);
    const stale = Date.now() - aiPracticeLimits.staleMinutes * 60_000;
    const runs: AiPracticeRun[] = [...latest.values()].flatMap((set): AiPracticeRun[] => {
      const startedAt = set.createdAt.toISOString();
      if (set.status === 'pending' && set.createdAt.getTime() >= stale) return [{ scope: set.scope!, status: 'pending', startedAt }];
      // A failure is said until the learner asks again; half an hour later it is old news.
      if ((set.status === 'failed' || set.status === 'pending') && set.createdAt.getTime() >= Date.now() - 30 * 60_000) {
        const message = (set.plan as { error?: unknown } | null)?.error;
        return [{ scope: set.scope!, status: 'failed', startedAt, message: typeof message === 'string' ? message : '시간이 너무 오래 걸려 멈췄어요. 다시 해 보세요.' }];
      }
      return [];
    });
    return { available: !!this.writer()?.plan, remaining: refused ? 0 : Math.max(0, aiPracticeLimits.daily - sets.length), runs,
      ...(refused ? { refused } : {}) };
  }

  /**
   * Before a set is gathered for one mistake: when the catalogue holds fewer questions for it than a
   * set does, a model writes the rest from this learner's own wrong answers. It runs outside the
   * gathering transaction — writing and checking takes half a minute — and what it keeps is frozen
   * as this learner's own questions, which the gathering then finds like any other.
   */
  private async fillGathering(userId: string, misconception: string): Promise<LearnerGeneration['reason']> {
    if (!this.writer() || !misconceptionOf(misconception) || filling.has(userId)) return undefined;
    const open = await this.db.assignmentRecipient.findFirst({ where: { learnerUserId: userId, status: 'assigned',
      assignment: { issuerType: 'self', problemSetVersionId: null, policySnapshot: { path: '$.misconception', equals: misconception } } } });
    if (open) return undefined;
    const visible = new Set((await this.catalog(this.db, userId)).map(lesson => lesson.courseKey));
    const pool = (await gatheredPracticePools(this.db, userId, [misconception], visible)).get(misconception)!;
    if (pool.length >= gatheredQuestions) return undefined;
    if (await budgetRefusal(this.db, userId)) return 'limit';
    filling.add(userId);
    const recorder = usageRecorder(this.db, userId, 'gathered');
    try {
      return (await generateForLearner(this.db, this.writer(recorder.sink)!, userId, misconception, gatheredQuestions - pool.length, pool)).reason;
    } finally { filling.delete(userId); await recorder.settled(); }
  }

  /**
   * The concepts a placement should cover for one learner: what the courses they are heading for
   * stand on, or — when there are none — everything on the line the catalogue is ordered along. A
   * course on a track beside that line is never asked about by accident. Somebody who came for it
   * says so, and only then does the descent start from its concepts.
   */
  private async placementTargets(db: Tx, lessons: PublicLesson[], courseKeys: string[]): Promise<string[]> {
    const chosen = lessons.filter(lesson => courseKeys.includes(lesson.courseKey)).flatMap(lesson => lesson.conceptKeys);
    if (chosen.length) return chosen;
    const tracks = new Map((await db.course.findMany({ select: { key: true, track: true } })).map(row => [row.key, row.track]));
    return lessons.filter(lesson => isSchoolTrack((tracks.get(lesson.courseKey) ?? defaultCourseTrack) as CourseTrack))
      .flatMap(lesson => lesson.conceptKeys);
  }

  /**
   * Where a learner is heading: the course they said they came for, and the courses somebody set
   * for them. Either may be missing, and both may be — a learner nobody teaches and who has not said
   * is placed and recommended along the whole school line, as before there were teachers.
   */
  private async targetCourses(db: Tx, userId: string, targetCourseKey: string | null): Promise<string[]> {
    return [...new Set([...(targetCourseKey ? [targetCourseKey] : []), ...await assignedCourseKeys(db, userId)])];
  }

  /**
   * After somebody else changed where this learner is heading — a teacher set or took off a course,
   * or a link ended. The placement carries on as it does when the learner changes it themselves, and
   * the recommendation history says what moved it.
   */
  async retarget(tx: Tx, userId: string, trigger: string) {
    await this.carryPlacementOn(tx, userId);
    await this.recordHistory(tx, userId, trigger);
  }

  private async recordHistory(tx: Tx, userId: string, trigger: string) {
    const nextState = await this.state(userId, tx);
    const snapshot = { recommendations: nextState.recommendations, plan: nextState.plan };
    const fingerprint = createHash('sha256').update(JSON.stringify(snapshot)).digest('hex');
    const previous = await tx.recommendationHistory.findFirst({ where: { userId }, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }] });
    if (previous?.fingerprint !== fingerprint) await tx.recommendationHistory.create({ data: { userId, fingerprint, trigger, snapshot: asJson(snapshot) } });
  }

  /**
   * Carrying a placement on after the learner changes what they came for.
   *
   * The scope cannot simply be replaced. Every verdict in a run is derived by replaying its answers,
   * and the descent chooses each question by what it would settle among everything still open — so a
   * different scope makes it choose differently, and the answers already stored stop matching what
   * it would have asked. Measured on the published bank, even a scope that strictly contains the old
   * one disagrees from the third answer on.
   *
   * So the scope is appended to rather than replaced, and each answer keeps the scope it was given
   * under. Nothing already decided is unasked, no question is ever put twice, and the run simply
   * carries on into what the new course needs. A run that had finished can find it has something
   * left to ask — that is the point of it, not a mistake — and one whose new way is already settled
   * finds nothing and stays finished, which is what 「좁아지면 아무것도 하지 않는다」 comes to here.
   *
   * There is no new place to raise a verdict from: a concept is settled once and never revisited, so
   * changing course repeatedly buys questions about concepts nobody has answered for, and nothing else.
   */
  private async carryPlacementOn(tx: Tx, userId: string) {
    const definition = await currentDiagnostic(tx);
    if (!definition) return;
    const run = await tx.diagnosticRun.findUnique({ where: { userId_version: { userId, version: definition.versionId } } });
    const held = run?.placement as StoredPlacement | null;
    if (!run || !held) return;
    const published = await this.catalog(tx, userId);
    const learner = await tx.user.findUniqueOrThrow({ where: { id: userId }, select: { targetCourseKey: true } });
    // Against the catalogue this run froze, not today's: a run is replayed on the shape it started
    // with, and a concept the catalogue only learned about afterwards has no question in its bank.
    const graph = conceptGraph(held.lessons);
    const scope = placementScope(graph, await this.placementTargets(tx, published, await this.targetCourses(tx, userId, learner.targetCourseKey)));
    const stretches = stretchesOf(held);
    if (stretches[stretches.length - 1].scope.join('\u0000') === scope.join('\u0000')) return;
    const answers = run.answers as unknown as DiagnosticAnswer[];
    // A stretch that never had an answer put under it is replaced rather than kept: somebody who
    // changes their mind twice before answering once chose twice, not three times.
    const next: PlacementStretch[] = [...stretches.filter((stretch) => stretch.from < answers.length), { from: answers.length, scope }];
    const after = placement(graph, next, run.document as unknown as StoredProblem[], answers);
    const completed = !after.next;
    await tx.diagnosticRun.update({ where: { id: run.id }, data: {
      placement: asJson({ ...held, scope: after.state.scope, stretches: next, placed: after.state.placed, source: after.state.source } satisfies StoredPlacement),
      status: completed ? 'completed' : 'active', completedAt: completed ? run.completedAt ?? new Date() : null } });
  }

  /**
   * The latest version of every published lesson this viewer may see, in the order its course gives
   * it. Signed out is `null`, which sees only what is open to everybody. Everything a learner is
   * offered — the lessons, the shelf, the placement, the recommendation — is drawn from this, so a
   * course kept to some learners is kept out of all of it at once.
   */
  async catalog(db: Tx = this.db, viewerId: string | null = null): Promise<PublicLesson[]> {
    const [rows, hidden] = await Promise.all([db.lessonVersion.findMany({ orderBy: [{ publishedAt: 'desc' }, { id: 'desc' }],
      select: { lessonKey: true, metadata: true, lesson: { select: { order: true, course: { select: { key: true, order: true, createdAt: true } } } } } }),
      hiddenCourses(db, viewerId)]);
    const seen = new Set<string>();
    return rows.filter(row => { if (hidden.has(row.lesson.course.key) || seen.has(row.lessonKey)) return false; seen.add(row.lessonKey); return true; })
      .sort((a, b) => a.lesson.course.order - b.lesson.course.order
        || a.lesson.course.createdAt.getTime() - b.lesson.course.createdAt.getTime()
        || a.lesson.course.key.localeCompare(b.lesson.course.key) || a.lesson.order - b.lesson.order || a.lessonKey.localeCompare(b.lessonKey))
      .map(row => ({ ...(row.metadata as { public: LessonMetadata }).public, courseKey: row.lesson.course.key }));
  }

  // Signed-out screens name the concepts the published catalogue teaches. A concept without a
  // published lesson stays out of the public response until its lesson is released.
  async publicCatalog(db: Tx = this.db, viewerId: string | null = null): Promise<PublicCatalog> {
    const lessons = await this.catalog(db, viewerId);
    const taught = new Set(lessons.flatMap(item => item.conceptKeys));
    const published = new Set(lessons.map(item => item.courseKey));
    const [rows, courses] = await Promise.all([
      db.concept.findMany({ where: { assessable: true } }),
      db.course.findMany({ orderBy: [{ order: 'asc' }, { createdAt: 'asc' }, { key: 'asc' }], select: { key: true, title: true, summary: true, track: true, stage: true } }),
    ]);
    // A course with nothing published yet is not in the catalogue either.
    return { courses: courses.filter(course => published.has(course.key))
      .map(course => ({ ...course, track: course.track as CourseTrack, stage: course.stage as CourseStage | null })), lessons,
      concepts: orderConcepts(rows.filter(row => taught.has(row.key)), lessons).map(row => ({ key: row.key, label: row.label })),
      problemSets: await this.publicProblemSets(db, lessons) };
  }

  /**
   * The problem sets a learner may pick and solve on their own, newest version of each.
   *
   * A set is listed when its course has something published, when it carries a name — the
   * declaration that it is meant to be used on its own — and when no diagnostic asks from it. That
   * last rule is what keeps a placement bank off the practice shelf: its questions are for finding
   * out where somebody is, and a learner who has rehearsed them has made that answer worthless.
   *
   * They come back in the order a learner would meet them: the course's order, then the lesson's
   * place in it, then the order that lesson shows them — practice before check, with the review pool
   * last because no step shows it. That order is read from the lessons, not guessed from names.
   */
  async publicProblemSets(db: Tx = this.db, lessons?: PublicLesson[]): Promise<PublicProblemSet[]> {
    const catalogue = lessons ?? await this.catalog(db);
    const courses = [...new Set(catalogue.map(lesson => lesson.courseKey))];
    const versionIds = catalogue.map(lesson => lesson.versionId);
    const [sets, diagnostics, sections, blocks, versions] = await Promise.all([
      db.problemSet.findMany({ where: { course: { key: { in: courses } }, NOT: { name: null } },
        select: { id: true, name: true, course: { select: { key: true } },
          versions: { orderBy: [{ publishedAt: 'desc' }, { id: 'desc' }], take: 1, select: { id: true } } } }),
      db.diagnosticVersion.findMany({ select: { problemSetId: true } }),
      db.lessonSection.findMany({ where: { lessonVersionId: { in: versionIds } }, select: { lessonVersionId: true, sectionId: true, order: true } }),
      db.contentBlock.findMany({ where: { ownerKind: 'section', ownerVersionId: { in: versionIds }, kind: 'core.problem_set' },
        select: { ownerVersionId: true, ownerId: true, order: true, payload: true } }),
      db.lessonVersion.findMany({ where: { id: { in: versionIds } }, select: { id: true, lessonKey: true, metadata: true } }),
    ]);
    const lessonAt = new Map(catalogue.map((lesson, index) => [lesson.versionId, { index, key: lesson.lessonKey }]));
    const sectionAt = new Map(sections.map(row => [`${row.lessonVersionId}:${row.sectionId}`, row.order]));
    // Lesson, then where in the lesson. A review pool is shown by no step, so it sorts after them all.
    const place = new Map<string, { lesson: number; step: number; order: number; lessonKey: string }>();
    const put = (setId: string, versionId: string, step: number, order: number) => {
      const lesson = lessonAt.get(versionId);
      if (!lesson || place.has(setId)) return;
      place.set(setId, { lesson: lesson.index, step, order, lessonKey: lesson.key });
    };
    for (const block of blocks) {
      const setId = (block.payload as { problemSetId?: unknown }).problemSetId;
      if (typeof setId === 'string') put(setId, block.ownerVersionId, sectionAt.get(`${block.ownerVersionId}:${block.ownerId}`) ?? 0, block.order);
    }
    for (const version of versions) {
      const review = (version.metadata as { review?: { problemSetId?: unknown } }).review;
      if (review && typeof review.problemSetId === 'string') put(review.problemSetId, version.id, Number.MAX_SAFE_INTEGER, 0);
    }
    const asked = new Set(diagnostics.map(row => row.problemSetId));
    const listed = sets.filter(set => set.versions.length && !asked.has(set.id));
    // Questions hang off the version by id rather than by a relation, so they are read in one pass.
    const problems = await db.publishedProblem.findMany({
      where: { ownerKind: 'problem_set', ownerVersionId: { in: listed.map(set => set.versions[0].id) } },
      orderBy: { order: 'asc' }, select: { ownerVersionId: true, conceptKeys: true },
    });
    const byVersion = new Map<string, string[][]>();
    for (const row of problems) byVersion.set(row.ownerVersionId, [...(byVersion.get(row.ownerVersionId) ?? []), row.conceptKeys as string[]]);
    // A named set no published lesson shows is still a set somebody may pick; it follows the rest.
    const unplaced = { lesson: Number.MAX_SAFE_INTEGER, step: 0, order: 0, lessonKey: '' };
    return listed.map(set => {
      const keys = byVersion.get(set.versions[0].id) ?? [];
      const at = place.get(set.id) ?? unplaced;
      return { problemSetId: set.id, versionId: set.versions[0].id, name: set.name!, courseKey: set.course.key,
        lessonKey: at.lessonKey || null, questionCount: keys.length, conceptKeys: [...new Set(keys.flat())], at };
    }).filter(set => set.questionCount > 0)
      .sort((a, b) => a.at.lesson - b.at.lesson || a.at.step - b.at.step || a.at.order - b.at.order || a.problemSetId.localeCompare(b.problemSetId))
      .map(({ at: _at, ...set }) => set);
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
      currentDefinitions(this.db, definitionReferences(record)), this.catalog(this.db, userId ?? null),
      this.db.lesson.findUnique({ where: { key: lessonKey }, select: { course: { select: { key: true } } } }),
    ]);
    // A lesson in a course kept from this reader is a lesson that is not there for them.
    if (!lesson || !lessons.some(item => item.lessonKey === lessonKey)) throw notFound();
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
    return glossaryEntries([selected], await this.catalog(this.db, userId ?? null), lesson.course.key)[0];
  }

  async conceptHelp(userId: string, input: unknown) {
    const { attemptId } = z.object({ attemptId: id }).strict().parse(input);
    return loadConceptHelp(this.db, userId, attemptId, () => this.catalog(this.db, userId));
  }

  async state(userId: string, db: Tx = this.db): Promise<LearningState> {
    const [user, lessons, enrollments, recipients, diagnostic, history, assessable, offering] = await Promise.all([
      db.user.findUnique({ where: { id: userId } }), this.catalog(db, userId),
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
    const evidence: Evidence[] = [];
    const confusionObservations: ConfusionObservation[] = [];
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
        confusionObservations.push({ ...a, result, problem: p, check: checks.has(p.problemVersionId), delayed: false,
          source: { kind: 'lesson', id: e.id, title: record.public.title, lessonKey: e.lessonVersion.lessonKey } });
        if (!observedIds.has(p.problemVersionId)) {
          observedIds.add(p.problemVersionId);
          evidence.push({ problemVersionId: p.problemVersionId, conceptKeys: p.conceptKeys, result, date: a.createdAt, check: checks.has(p.problemVersionId), assessmentId: e.id });
        }
        for (const concept of concepts.filter(s => p.conceptKeys.includes(s.key))) if (concept.state === 'unknown') concept.state = 'practicing';
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
      // All submitted sittings belong in the history. Draft work cannot reveal results through
      // the summary, even when the caller asks for it from a different screen.
      for (const sitting of r.submissions.filter(item => item.status === 'submitted')) {
        for (const attempt of sitting.attempts) {
          if (!r.assignment.items.some(item => item.id === attempt.assignmentItemId && item.problemVersionId === attempt.problemVersionId)) continue;
          const problem = assignmentProblems.get(attempt.problemVersionId);
          if (!problem) continue;
          confusionObservations.push({ ...attempt, result: attempt.result as GradeResult, problem, check: true,
            delayed: policy.kind === 'review' && attempt.createdAt >= r.recommendedAt,
            source: { kind: policy.kind, id: r.id, title: r.assignment.title, lessonKey } });
        }
      }
      const ai = aiNoteOf(r.assignment.policySnapshot);
      /** First answers the learner has been told the result of, for what an AI set's guesses predicted. */
      const firsts = new Map<string, { answer: string; status: 'correct' | 'incorrect'; spec: StoredProblem['gradingSpec'] }>();
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
        }
        const visibleAttempt = submission.status === 'submitted'
          ? submission.items.find(selected => selected.assignmentItemId === item.id)?.selectedAttempt
          : matching[matching.length - 1];
        // A policy without hints hides them the way a question without hints does, and a policy
        // that never shows a worked solution does not offer one either.
        // Every answer sent, oldest first, so a report can tell a first try from a correction.
        const real = [...matching].sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime() || (a.id < b.id ? -1 : 1))
          .filter(a => (a.result as GradeResult).status !== 'invalid');
        // An exam marks as it goes and says nothing until it is handed in.
        const hold = policy.results === 'after-submission' && submission.status !== 'submitted';
        const firstResult = real.length ? real[0].result as GradeResult : null;
        if (!hold && firstResult && (firstResult.status === 'correct' || firstResult.status === 'incorrect')) {
          firsts.set(item.problemVersionId, { answer: real[0].answer, status: firstResult.status, spec: p.gradingSpec });
        }
        return { id: item.id, problem: { ...publicProblem(p), hintAvailable: policy.hints && p.hintAvailable,
          solutionAvailable: policy.solutions !== 'never' && p.solution.length > 0 },
          attempt: visibleAttempt ? { ...attemptView(visibleAttempt), result: shown(visibleAttempt.result as GradeResult, hold) } : null,
          tries: real.length, firstResult: real.length ? shown(real[0].result as GradeResult, hold) : null,
          ...(ai?.reasons[item.problemVersionId] ? { reason: ai.reasons[item.problemVersionId] } : {}) };
      });
      const focus = (r.assignment.policySnapshot as { misconception?: unknown } | null)?.misconception;
      const misconception = r.assignment.issuerType === 'self' && policy.kind === 'practice' && !r.assignment.problemSetId
        && typeof focus === 'string' && misconceptionOf(focus) ? focus : undefined;
      return { id: r.assignmentId, recipientId: r.id, title: r.assignment.title, lessonKey, problemSetId: r.assignment.problemSetId, misconception,
        recommendedAt: r.recommendedAt.toISOString(), opensAt: window.opensAt?.toISOString() ?? null, dueAt: window.dueAt?.toISOString() ?? null,
        policy, status: r.status as 'assigned' | 'submitted', items, submissionId: submission.id,
        glossary: leafGlossary(glossaryEntries(assignmentTerms, lessons)),
        reason: typeof (r.assignment.policySnapshot as { reviewReason?: string }).reviewReason === 'string' ? (r.assignment.policySnapshot as { reviewReason: string }).reviewReason : undefined,
        ...(written(r.assignment.items) ? { generated: written(r.assignment.items) } : {}),
        ...(ai ? { ai: { scope: ai.scope, scopeLabel: ai.scopeLabel, diagnosis: ai.diagnosis,
          ...(ai.hypotheses.length ? { hypotheses: ai.hypotheses.map(hypothesis => ({ name: hypothesis.name, check: checkHypothesis(hypothesis.key, ai.predictions, firsts) })) } : {}) } } : {}) };
    });
    const confusion = summarizeConfusion(confusionObservations, conceptRows, lessons);
    // The course overview and the detailed summary must agree about earned understanding.
    for (const concept of concepts) {
      const state = confusion.concepts.find(item => item.key === concept.key)!.state;
      if (state === 'independent' || state === 'retained') concept.state = state;
    }
    /**
     * The mistakes this learner keeps making, counted over different questions.
     *
     * `evidence` already holds one entry per question, taken from the first real answer to it, so
     * counting `misconception` over it is counting **questions** and not answers — somebody who
     * tried the same question four times has shown one thing once. Two is the bar, the same bar
     * readiness uses: one wrong answer is a slip, and the same step wrong in two questions is a
     * habit. A name the vocabulary no longer knows is dropped rather than shown as a key.
     */
    const slips = new Map<string, number>();
    for (const item of evidence) if (item.result.misconception) slips.set(item.result.misconception, (slips.get(item.result.misconception) ?? 0) + 1);
    const misconceptions: StandingMisconception[] = [...slips.entries()]
      .filter(([, problems]) => problems >= standingMisconception)
      .flatMap(([key, problems]) => { const record = misconceptionOf(key); return record ? [{ ...record, problems }] : []; })
      .sort((a, b) => b.problems - a.problems || a.label.localeCompare(b.label));
    const diagnosticBank = diagnostic?.document as unknown as StoredProblem[] | undefined;
    const diagnosticAnswers = (diagnostic?.answers ?? []) as unknown as DiagnosticAnswer[];
    const completedDiagnostic = diagnostic?.status === 'completed';
    const stored = (diagnostic?.placement ?? null) as StoredPlacement | null;
    const asking = stored && diagnosticBank ? placement(conceptGraph(stored.lessons), stretchesOf(stored), diagnosticBank, diagnosticAnswers) : null;
    const readiness = conceptReadiness(conceptLabels, completedDiagnostic ? stored : null, evidence);
    const repeatedKeys = confusion.repeated.filter(item => item.kind === 'misconception' && item.status === 'repeated').map(item => item.key);
    const pools = await gatheredPracticePools(db, userId, lessons.some(lesson => lesson.lessonKey === user.preferredLessonKey) ? [] : repeatedKeys,
      new Set(lessons.map(lesson => lesson.courseKey)));
    // Whether a model may write for this learner now: none at all, or past what the service pays for.
    const refused = this.writer() ? await budgetRefusal(db, userId) : null;
    const mayWrite = repeatedKeys.length > 0 && this.writer() !== null && !refused
      && await db.generatedProblemSet.count({ where: { userId, createdAt: { gte: new Date(Date.now() - 24 * 60 * 60 * 1000) } } }) < dailyGenerations;
    const targetedPractice = recommendTargetedPractice(confusion, repeatedKeys.map(key => {
      const gathered = recipients.filter(recipient => recipient.assignment.issuerType === 'self' && !recipient.assignment.problemSetVersionId
        && (recipient.assignment.policySnapshot as { misconception?: string }).misconception === key);
      const open = gathered.slice().reverse().find(recipient => recipient.status === 'assigned' && recipient.submissions[0]?.status === 'draft');
      const completedAt = gathered.flatMap(recipient => recipient.submissions.filter(sitting => sitting.status === 'submitted' && sitting.finalizedAt)
        .map(sitting => sitting.finalizedAt!.toISOString())).sort().at(-1) ?? null;
      // Where a model may write what the catalogue lacks, a set comes to its full size.
      return { key, recipientId: open?.id ?? null, problemCount: open?.assignment.items.length ?? (mayWrite ? gatheredQuestions : pools.get(key)?.length ?? 0), completedAt };
    }));
    const teaching = await learnerTeaching(db, userId);
    // Only what this learner can see: a course kept back since it was set leads nowhere they can go.
    const targetCourseKeys = (await this.targetCourses(db, userId, user.targetCourseKey)).filter(key => lessons.some(lesson => lesson.courseKey === key));
    const { recommendations, plan } = recommend({ lessons, enrollments: enrollments.map(e => ({ lessonKey: e.lessonVersion.lessonKey, status: e.status })),
      assignments, readiness, targetedPractice, dailyMinutes: user.dailyMinutes, targetCourseKeys, now: new Date(), preferredLessonKey: user.preferredLessonKey });
    return {
      user: { id: user.id, displayName: user.displayName, targetCourseKey: user.targetCourseKey, dailyMinutes: user.dailyMinutes },
      lessons, assignments, recommendations, concepts, misconceptions, plan, teaching,
      confusion, aiPractice: await this.aiPracticeState(db, userId, refused),
      diagnosticOffering: offering ? { version: offering.versionId, title: offering.title, description: offering.description,
        scope: placementScope(conceptGraph(lessons), await this.placementTargets(db, lessons, targetCourseKeys)).length,
        estimatedMinutes: offering.estimatedMinutes } : null,
      diagnostic: diagnostic && diagnosticBank && stored ? { id: diagnostic.id, version: diagnostic.version, status: diagnostic.status as 'active' | 'completed',
        completedAt: diagnostic.completedAt?.toISOString() ?? null, answered: diagnosticAnswers.length,
        ...placementProgress({ scope: stored.scope, placed: stored.placed, source: stored.source }),
        currentProblem: !completedDiagnostic && asking?.next ? publicProblem(diagnosticBank.find(p => p.problemVersionId === asking.next!.problemVersionId)!) : null,
        results: completedDiagnostic ? diagnosticAnswers : [] } : null,
      recommendationHistory: history.map(h => ({ id: h.id, createdAt: h.createdAt.toISOString(), trigger: h.trigger,
        recommendations: (h.snapshot as unknown as { recommendations: Recommendation[] }).recommendations,
        targetedPractice: (h.snapshot as unknown as { plan?: LearningState['plan'] }).plan?.targetedPractice ?? null })),
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
      // A lesson is not an exam: it tells the learner how it went as they go, always.
      return { problem: record.problems.find(p => p.problemVersionId === problemId)!, scopeId: enrollment.scopeId, enrollmentId: enrollment.id, submissionId: undefined, assignmentItemId: undefined, hints: true, hold: false };
    }
    const recipient = await tx.assignmentRecipient.findFirst({ where: { id: contextId, learnerUserId: userId, assignment: { learningScope: { ownerUserId: userId, kind: 'personal' } } }, include: { assignment: { include: { items: true } }, submissions: { orderBy: { submissionIndex: 'desc' } } } });
    if (!recipient) throw notFound();
    const submission = recipient.submissions[0];
    if (!submission || submission.status !== 'draft') throw conflict('제출이 완료된 과제는 수정할 수 없어요.');
    const item = recipient.assignment.items.find(item => item.problemVersionId === problemId);
    if (!item) throw notFound();
    const problem = (await publishedProblemRecords(tx, [item.problemVersionId])).get(item.problemVersionId);
    if (!problem) throw notFound();
    const policy = parseAssignmentPolicy(recipient.assignment.policy);
    return { problem, scopeId: recipient.assignment.ownerScopeId, enrollmentId: undefined, submissionId: submission.id, assignmentItemId: item.id,
      hints: policy.hints, hold: policy.results === 'after-submission' };
  }

  /**
   * The question whose worked solution this learner may now read.
   *
   * Not the same door as answering, and deliberately the opposite one. `activity` turns away a
   * finished lesson and a handed-in set, which is exactly when somebody wants the solution; what
   * this asks for instead is that the work is done. In a lesson that means the learner has answered
   * this question — a solution before an answer is not a solution, it is the answer. In an
   * assignment it means the policy allows it and the set has been handed in, because everything in
   * a set is still answerable until then.
   */
  private async solvable(tx: Tx, userId: string, kind: 'lesson' | 'assignment', contextId: string, problemId: string) {
    if (kind === 'lesson') {
      const { enrollment, record } = await this.ownedEnrollment(tx, userId, contextId);
      const problem = record.problems.find(p => p.problemVersionId === problemId);
      if (!problem) throw notFound();
      const attempts = await tx.attempt.findMany({ where: { userId, enrollmentId: enrollment.id, problemVersionId: problemId } });
      if (!attempts.some(a => (a.result as GradeResult).status !== 'invalid')) throw conflict('먼저 답을 써 보고 나서 풀이를 볼 수 있어요.');
      return problem;
    }
    const recipient = await tx.assignmentRecipient.findFirst({ where: { id: contextId, learnerUserId: userId, assignment: { learningScope: { ownerUserId: userId, kind: 'personal' } } },
      include: { assignment: { include: { items: true } }, submissions: { orderBy: { submissionIndex: 'desc' } } } });
    if (!recipient) throw notFound();
    if (parseAssignmentPolicy(recipient.assignment.policy).solutions === 'never') throw conflict('이 과제는 풀이를 보여 주지 않아요.');
    if (recipient.submissions[0]?.status !== 'submitted') throw conflict('다 풀고 마무리한 뒤에 풀이를 볼 수 있어요.');
    const item = recipient.assignment.items.find(item => item.problemVersionId === problemId);
    if (!item) throw notFound();
    const problem = (await publishedProblemRecords(tx, [item.problemVersionId])).get(item.problemVersionId);
    if (!problem) throw notFound();
    return problem;
  }

  async act(userId: string, input: unknown): Promise<ActionResponse> {
    const action = actionSchema.parse(input);
    if (action.action === 'practice.ai') {
      const recipientId = await this.startAiPractice(userId, action.scope);
      return { state: await this.state(userId), ...(recipientId ? { recipientId } : {}) };
    }
    const filled = action.action === 'practice.gather' ? await this.fillGathering(userId, action.misconception) : undefined;
    let extra: Omit<ActionResponse, 'state'> = {};
    for (let retry = 0; retry < 4; retry++) {
      try {
        extra = await this.db.$transaction(async tx => {
          const scope = await tx.learningScope.findUnique({ where: { ownerUserId: userId } });
          if (!scope || scope.kind !== 'personal') throw notFound();
          const outcome = await (async (): Promise<Omit<ActionResponse, 'state'>> => {
          switch (action.action) {
            case 'recommendation.choose': {
              if (action.lessonKey && !(await this.catalog(tx, userId)).some(lesson => lesson.lessonKey === action.lessonKey)) throw notFound();
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
              // Only what the course they came for stands on. Without one it is the line the
              // catalogue is ordered along, which is the length this was replacing — so the
              // question is worth asking first.
              const published = await this.catalog(tx, userId);
              const shapes = published.map(l => ({ conceptKeys: l.conceptKeys, prerequisiteConceptKeys: l.prerequisiteConceptKeys }));
              const learner = await tx.user.findUniqueOrThrow({ where: { id: userId }, select: { targetCourseKey: true } });
              const wanted = await this.placementTargets(tx, published, await this.targetCourses(tx, userId, learner.targetCourseKey));
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
              const stretches = stretchesOf(held);
              const asked = placement(graph, stretches, bank, answers).next;
              if (!asked || asked.problemVersionId !== action.problemVersionId) throw conflict('현재 진단 문제부터 확인해 주세요.');
              const problem = bank.find(p => p.problemVersionId === asked.problemVersionId)!;
              const result = action.answer === null ? null : gradeAnswer(action.answer, problem.gradingSpec, false);
              if (result?.status === 'invalid') return { result };
              // A placement marks in the open and withholds nothing, so the only statuses it ever
              // writes are the two it asked about and the one for a question passed over.
              const settled = result?.status === 'correct' ? 'correct' as const : result ? 'incorrect' as const : 'skipped' as const;
              const next: DiagnosticAnswer[] = [...answers, { problemVersionId: problem.problemVersionId, answer: action.answer, status: settled }];
              // A placement ends when the descent has nothing left it can ask, not at a fixed length.
              const after = placement(graph, stretches, bank, next);
              const completed = !after.next;
              await tx.diagnosticRun.update({ where: { id: run.id }, data: { answers: asJson(next),
                placement: asJson({ ...held, scope: after.state.scope, placed: after.state.placed, source: after.state.source } satisfies StoredPlacement),
                status: completed ? 'completed' : 'active', completedAt: completed ? new Date() : null } });
              return {};
            }
            case 'profile.update': {
              // A course with nothing published in it is not a destination — the placement's own
              // course holds the question bank and no lessons. Clearing it is always allowed.
              if (action.targetCourseKey && !(await this.catalog(tx, userId)).some(lesson => lesson.courseKey === action.targetCourseKey)) throw notFound();
              const before = await tx.user.findUniqueOrThrow({ where: { id: userId }, select: { targetCourseKey: true } });
              await tx.user.update({ where: { id: userId }, data: { targetCourseKey: action.targetCourseKey, dailyMinutes: action.dailyMinutes } });
              if (before.targetCourseKey !== action.targetCourseKey) await this.carryPlacementOn(tx, userId);
              return {};
            }
            case 'enrollment.start': {
              const version = await tx.lessonVersion.findFirst({ where: { lessonKey: action.lessonKey }, orderBy: [{ publishedAt: 'desc' }, { id: 'desc' }] });
              if (!version) throw notFound();
              const existing = await tx.enrollment.findFirst({ where: { userId, lessonVersion: { lessonKey: action.lessonKey } } });
              if (existing) return { enrollmentId: existing.id };
              if (!(await this.catalog(tx, userId)).some(lesson => lesson.lessonKey === action.lessonKey)) throw notFound();
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
            case 'solution.open': {
              const problem = await this.solvable(tx, userId, action.context, action.contextId, action.problemVersionId);
              // Asking for a solution is reading, not learning: nothing about it is recorded, and a
              // question without one says so rather than handing back an empty page.
              if (!problem.solution.length) throw notFound();
              return { solution: problem.solution };
            }
            case 'attempt.submit': {
              const previous = await tx.attempt.findUnique({ where: { userId_requestId: { userId, requestId: action.requestId } }, include: { submission: true } });
              if (previous) {
                const previousContextId = previous.enrollmentId ?? previous.submission?.recipientId;
                const previousKind = previous.enrollmentId ? 'lesson' : 'assignment';
                if (previousContextId !== action.contextId || previousKind !== action.context || previous.answer !== action.answer || previous.problemVersionId !== action.problemVersionId) throw conflict('동일 요청 ID로 다른 답안을 보낼 수 없어요.');
                // A repeated send is the same send, so it may say exactly what the first one did.
                const repeated = await this.activity(tx, userId, action.context, action.contextId, action.problemVersionId);
                return { result: shown(previous.result as GradeResult, repeated.hold) };
              }
              const target = await this.activity(tx, userId, action.context, action.contextId, action.problemVersionId);
              const hint = await tx.hintUse.findUnique({ where: { userId_contextKind_contextId_problemVersionId: { userId, contextKind: action.context, contextId: action.contextId, problemVersionId: action.problemVersionId } } });
              const result = gradeAnswer(action.answer, target.problem.gradingSpec, Boolean(hint), target.problem.misreadings);
              await tx.attempt.create({ data: { userId, scopeId: target.scopeId, enrollmentId: target.enrollmentId, submissionId: target.submissionId, assignmentItemId: target.assignmentItemId,
                problemVersionId: action.problemVersionId, answer: action.answer, result: asJson(result), hintUsed: Boolean(hint), requestId: action.requestId } });
              // The record keeps what the marker decided; what comes back is what this work may say.
              return { result: shown(result, target.hold) };
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
            case 'problemSet.start': return { recipientId: await this.startProblemSet(tx, userId, scope.id, action.problemSetId) };
            case 'practice.gather': return { recipientId: await this.gatherPractice(tx, userId, scope.id, action.misconception, filled) };
            case 'teaching.join': {
              await joinByInvite(tx, userId, action.code, async teacher => (await authoringRole(this.db, teacher)) !== null);
              await this.carryPlacementOn(tx, userId);
              return {};
            }
            case 'teaching.leave': {
              await endLink(tx, { id: action.linkId, learnerUserId: userId });
              await this.carryPlacementOn(tx, userId);
              return {};
            }
          }
          })();
          await this.recordHistory(tx, userId, action.action);
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

  /**
   * A problem set the learner picked, opened as work of their own.
   *
   * It is an assignment nobody assigned: same items, same attempts, same submission, so solving and
   * submitting are the paths that already exist. Starting the same set again while it is unsubmitted
   * returns the run already open rather than a second copy — a learner who navigates away and comes
   * back means「이어서」, not「처음부터」. After submitting, starting it again is a new sitting.
   */
  async startProblemSet(tx: Tx, userId: string, scopeId: string, problemSetId: string) {
    const listed = await this.publicProblemSets(tx, await this.catalog(tx, userId));
    const set = listed.find(item => item.problemSetId === problemSetId);
    // Not found rather than forbidden: what is not on the shelf is not a set this learner can pick.
    if (!set) throw notFound();
    const open = await tx.assignmentRecipient.findFirst({
      where: { learnerUserId: userId, status: 'assigned',
        assignment: { ownerScopeId: scopeId, issuerType: 'self', problemSetVersionId: set.versionId } },
      orderBy: { recommendedAt: 'desc' },
    });
    if (open) return open.id;
    const problems = await tx.publishedProblem.findMany({
      where: { ownerKind: 'problem_set', ownerVersionId: set.versionId }, orderBy: { order: 'asc' }, select: { problemVersionId: true },
    });
    if (!problems.length) throw notFound();
    const now = new Date();
    // No schedule and no interval: the learner opened this now, so now is when it is recommended.
    const recipient = await tx.assignment.create({ data: {
      ownerScopeId: scopeId, title: set.name, issuerType: 'self',
      problemSetId: set.problemSetId, problemSetVersionId: set.versionId,
      policy: practicePolicy, schedule: {}, issuedAt: now,
      policySnapshot: { version: 1, audience: 'self-study', chosenBy: 'learner' },
      items: { create: problems.map((problem, position) => ({ problemVersionId: problem.problemVersionId, position })) },
      recipients: { create: { learnerUserId: userId, recommendedAt: now, submissions: { create: { submissionIndex: 1 } } } },
    }, select: { recipients: { select: { id: true } } } });
    return recipient.recipients[0].id;
  }

  /**
   * The questions built to catch one mistake, gathered into a set of this learner's own.
   *
   * Chosen, not written. A question that names this misconception was made to catch it by whoever
   * wrote it, and it is already published, already marked, already validated — so a set for one
   * learner costs nothing but the choosing. Which is also why this comes before anything that
   * writes a lesson: it is the same idea with none of the risk.
   *
   * Three rules about what goes in. A question from a placement bank never does, for the same
   * reason it is off the practice shelf — rehearsing it spends the one thing it is for. A question
   * this learner has already answered right, first time and unaided, does not either; they have
   * shown that one. And it is short, because a set that is not finished says nothing.
   */
  async gatherPractice(tx: Tx, userId: string, scopeId: string, misconception: string, filled?: LearnerGeneration['reason']) {
    const record = misconceptionOf(misconception);
    if (!record) throw notFound();
    const open = await tx.assignmentRecipient.findFirst({
      where: { learnerUserId: userId, status: 'assigned',
        assignment: { ownerScopeId: scopeId, issuerType: 'self', problemSetVersionId: null,
          policySnapshot: { path: '$.misconception', equals: misconception } } },
      orderBy: { recommendedAt: 'desc' },
    });
    if (open) return open.id;
    const visible = new Set((await this.catalog(tx, userId)).map(lesson => lesson.courseKey));
    const items = (await gatheredPracticePools(tx, userId, [misconception], visible)).get(misconception)!;
    if (!items.length) throw conflict(filled === 'limit' ? '오늘은 새 문제를 더 만들 수 없어요. 내일 다시 해 보세요.'
      : filled === 'failed' ? '이 착각을 다루는 문항을 만들지 못했어요. 잠시 뒤에 다시 해 보세요.' : '이 착각을 다루는 문항이 아직 없어요.');
    const now = new Date();
    const recipient = await tx.assignment.create({ data: {
      ownerScopeId: scopeId, title: `「${record.label}」 모아 풀기`, issuerType: 'self',
      policy: practicePolicy, schedule: {}, issuedAt: now,
      policySnapshot: { version: 1, audience: 'self-study', chosenBy: 'learner', misconception },
      items: { create: items.map((problemVersionId, position) => ({ problemVersionId, position })) },
      recipients: { create: { learnerUserId: userId, recommendedAt: now, submissions: { create: { submissionIndex: 1 } } } },
    }, select: { recipients: { select: { id: true } } } });
    return recipient.recipients[0].id;
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
