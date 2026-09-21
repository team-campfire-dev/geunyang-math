// Public HTTP DTOs. Never import server content or grading answers into this module.
import type { ConceptScope, DefinitionRef } from './rich-text';
import type { Misreading } from './misreading';
/**
 * What the marker decided, and — when it could read one — what kind of slip the answer looks like.
 * `misreading` is the part a report can add up: the message is written for the one moment after an
 * answer, while the name behind it is the same name in every course and every set.
 */
export type GradeResult = { status: 'correct' | 'incorrect' | 'invalid'; message: string; assisted: boolean; misreading?: Misreading };
export type ContentBlock = {
  blockId: string;
  kind: string;
  typeVersion: number;
  required: boolean;
  payload: Record<string, unknown>;
  fallback?: string;
};
export type PublicProblem = {
  problemVersionId: string;
  conceptKeys: string[];
  promptContent: ContentBlock[];
  // What answering looks like. A written answer says how it is read; a picked one carries the
  // options to pick from — and never which of them is right, which stays with the question.
  responseSpec: { kind: 'integer' | 'rational' | 'choice'; requiredForm?: string; options?: { id: string; text: string }[] };
  hintAvailable: boolean;
  /**
   * Whether this question has a worked solution to ask for. A hint is for while you are stuck; a
   * solution is for after you have answered, so saying it exists is safe and asking for it is not
   * always allowed — the server decides that when it is asked.
   */
  solutionAvailable: boolean;
};
/** How a lesson names questions: a problem set, a frozen version of it, and the questions it picked. */
export type ProblemSetRef = { problemSetId: string; problemSetVersionId: string; problemVersionIds: string[] };
export type LessonSection = {
  sectionId: string;
  role: 'explanation' | 'worked_example' | 'practice' | 'check' | 'summary';
  title: string;
  contentBlocks: ContentBlock[];
};
export type PublicLesson = {
  lessonKey: string;
  versionId: string;
  title: string;
  summary: string;
  estimatedMinutes: number;
  conceptKeys: string[];
  prerequisiteConceptKeys: string[];
  sectionCount: number;
  // The course that keeps this lesson. Read from the lesson's identity, never from the version.
  courseKey: string;
};
/**
 * A definition the learner may open while reading: the one the author linked, in the scope the
 * author named. The server sends every linked definition and withholds none.
 */
export type GlossaryEntry = {
  conceptKey: string; scopeKind: ConceptScope; scopeKey: string;
  label: string; summary: string;
  usageNote?: string;
  revision?: string;
  blocks: ContentBlock[];
  // The lesson that teaches this concept, when one is published.
  lessonKey: string | null;
};
export type DefinitionRequest = { lessonKey: string; lessonVersionId: string; path: DefinitionRef[] };
export type LessonDocument = PublicLesson & { sections: LessonSection[]; problems: PublicProblem[]; glossary: GlossaryEntry[] };
// Display-only concept names for the signed-out catalogue. Never carries answers or grading rules.
export type PublicConcept = { key: string; label: string };
// A course as the catalogue lists it. Lessons arrive in the order the course gives them.
/**
 * Which line of study a course belongs to, and where in it.
 *
 * The catalogue is one ordered line — 기초 · 중학교 · 고등학교 — and a learner who has chosen nothing
 * is recommended along it. A course beside that line is something somebody comes for on purpose: it
 * is listed apart, it is never what a learner is handed next, and a placement asks about it only
 * when it is the course they said they wanted.
 *
 * The line is cut into schools rather than left as one heap because a learner arrives knowing what
 * they last sat through. 「중2까지 했어요」 names a place in the catalogue; 「수학 과정」 does not.
 */
export type CourseTrack = 'basics' | 'middle' | 'high' | 'ncs';
export const courseTracks: CourseTrack[] = ['basics', 'middle', 'high', 'ncs'];
/** The line the catalogue is ordered along. An unchosen placement asks about these and no more. */
export const schoolTracks: CourseTrack[] = ['basics', 'middle', 'high'];
export const isSchoolTrack = (track: CourseTrack) => schoolTracks.includes(track);
/** What a course is on when it says nothing — including one an older server called 「math」. */
export const defaultCourseTrack: CourseTrack = 'middle';
export const courseTrackLabels: Record<CourseTrack, string> = {
  basics: '기초 과정', middle: '중학교 과정', high: '고등학교 과정', ncs: 'NCS 수리영역',
};
/**
 * The school year inside a track. Only the two school tracks have them — 기초 과정 is where a
 * learner starts whatever their year, and NCS is not a school year at all.
 */
export type CourseStage = 'middle-1' | 'middle-2' | 'middle-3' | 'high-1' | 'high-2' | 'high-3';
export const courseStages: CourseStage[] = ['middle-1', 'middle-2', 'middle-3', 'high-1', 'high-2', 'high-3'];
export const courseStageLabels: Record<CourseStage, string> = {
  'middle-1': '중1', 'middle-2': '중2', 'middle-3': '중3', 'high-1': '고1', 'high-2': '고2', 'high-3': '고3',
};
export const stagesOf = (track: CourseTrack): CourseStage[] => courseStages.filter((stage) => stage.startsWith(`${track}-`));
export type PublicCourse = { key: string; title: string; summary: string; track: CourseTrack; stage?: CourseStage | null };
/**
 * A problem set a learner can pick and solve on its own, without opening the lesson that uses it.
 *
 * Only sets a course keeps under a name are listed — a name is the declaration that the set is meant
 * to be used on its own (docs/glossary.md) — and never the bank a placement asks from. Nothing here
 * carries an answer: the count and the concepts are all a chooser needs.
 */
export type PublicProblemSet = {
  problemSetId: string; versionId: string; name: string; courseKey: string;
  // The lesson that shows this set, when a published one does. Sets arrive in the order a learner
  // would meet them, so a screen can group them by lesson without working the order out again.
  lessonKey: string | null;
  questionCount: number; conceptKeys: string[];
};
export type PublicCatalog = { courses: PublicCourse[]; lessons: PublicLesson[]; concepts: PublicConcept[]; problemSets: PublicProblemSet[] };
export type AttemptView = {
  id: string; problemVersionId: string; answer: string; result: GradeResult; hintUsed: boolean;
};
export type EnrollmentView = {
  id: string; lessonKey: string; lessonVersionId: string; completedSectionIds: string[];
  status: 'active' | 'completed'; attempts: AttemptView[];
};
/**
 * What an assignment is for and how it is taken. Homework, exam and review are not kinds of
 * thing but values here (docs/glossary.md): the same problem set can be issued under any of them.
 */
export type AssignmentPolicy = {
  kind: 'homework' | 'exam' | 'review' | 'practice';
  hints: boolean;
  results: 'per-item' | 'after-submission';
  solutions: 'never' | 'after-submission';
};
/** When an assignment opens and is due: at a moment, or (for the due date) so many days after the recipient's completion. */
export type AssignmentSchedule = {
  opens?: { kind: 'at'; at: string };
  due?: { kind: 'at'; at: string } | { kind: 'after'; days: number };
};
export type AssignmentView = {
  id: string; recipientId: string; title: string; lessonKey: string | null;
  // The set the questions were taken from, so a screen can say which one this is without matching
  // on its title. Two courses may name a set the same thing; only the id is the set.
  problemSetId: string;
  recommendedAt: string; opensAt: string | null; dueAt: string | null;
  policy: AssignmentPolicy; status: 'assigned' | 'submitted';
  /**
   * Each question, and how this learner got there rather than only where they arrived: `tries`
   * counts the answers they sent and `firstResult` is the first one that was a real answer. A
   * report about a finished set is about the working, so the last answer alone would not do.
   */
  items: { id: string; problem: PublicProblem; attempt: AttemptView | null; tries: number; firstResult: GradeResult | null }[];
  submissionId: string;
  reason?: string;
  glossary: GlossaryEntry[];
};
export type DiagnosticAnswer = { problemVersionId: string; answer: string | null; status: 'correct' | 'incorrect' | 'skipped' };
// `scope` is how many concepts this learner's placement would settle, not how many questions it
// would ask — a placement chooses those as it goes, so the bank's size promises nothing useful.
export type DiagnosticOffering = { version: string; title: string; description: string; scope: number; estimatedMinutes: number };
export type DiagnosticView = {
  id: string; version: string; status: 'active' | 'completed'; completedAt: string | null;
  // A placement asks only what it has to, so its length is not known when it starts. What a screen
  // can say instead is how many concepts it has to settle and how many of those it already has —
  // `asked` for the ones put to the learner, `inferred` for the ones an answer settled on its own.
  scope: number; settled: number; asked: number; inferred: number;
  answered: number; currentProblem: PublicProblem | null;
  // Only released after completion. Diagnostic items never expose hints or grading specifications.
  results: DiagnosticAnswer[];
};
// `inferred`: the placement did not ask about this concept, it followed from an answer above or below it.
export type ConceptReadiness = { key: string; label: string; readiness: 'unknown' | 'needs-practice' | 'ready'; source: 'none' | 'diagnostic' | 'inferred' | 'learning' };
export type Recommendation = { lessonKey: string; reason: string; kind: 'start' | 'continue' | 'revisit'; suggestedMinutes: number };
export type PersonalPlan = {
  version: string;
  readiness: ConceptReadiness[];
  review: { recipientId: string; reason: string } | null;
  sessionMinutes: number;
  preferredLessonKey: string | null;
};
export type RecommendationHistoryView = { id: string; createdAt: string; trigger: string; recommendations: Recommendation[] };
export type LearningState = {
  user: { id: string; displayName: string; targetCourseKey: string | null; dailyMinutes: number };
  lessons: PublicLesson[];
  enrollments: EnrollmentView[];
  assignments: AssignmentView[];
  recommendations: Recommendation[];
  diagnostic: DiagnosticView | null;
  diagnosticOffering: DiagnosticOffering | null;
  plan: PersonalPlan;
  recommendationHistory: RecommendationHistoryView[];
  concepts: { key: string; label: string; state: 'unknown' | 'practicing' | 'independent' | 'retained' }[];
};
export type LearningAction =
  | { action: 'recommendation.choose'; lessonKey: string | null }
  | { action: 'diagnostic.start' }
  | { action: 'diagnostic.answer'; diagnosticId: string; problemVersionId: string; answer: string | null }
  | { action: 'profile.update'; targetCourseKey: string | null; dailyMinutes: number }
  | { action: 'enrollment.start'; lessonKey: string }
  | { action: 'section.complete'; enrollmentId: string; sectionId: string }
  | { action: 'attempt.submit'; context: 'lesson' | 'assignment'; contextId: string; problemVersionId: string; answer: string; requestId: string }
  | { action: 'hint.open'; context: 'lesson' | 'assignment'; contextId: string; problemVersionId: string }
  | { action: 'lesson.complete'; enrollmentId: string }
  | { action: 'assignment.submit'; recipientId: string; requestId: string }
  | { action: 'problemSet.start'; problemSetId: string }
  | { action: 'solution.open'; context: 'lesson' | 'assignment'; contextId: string; problemVersionId: string };
export type ActionResponse = { state: LearningState; result?: GradeResult; hint?: ContentBlock[]; solution?: ContentBlock[]; enrollmentId?: string; recipientId?: string };
