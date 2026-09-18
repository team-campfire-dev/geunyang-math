// Public HTTP DTOs. Never import server content or grading answers into this module.
import type { ConceptScope, DefinitionRef } from './rich-text';
export type GradeResult = { status: 'correct' | 'incorrect' | 'invalid'; message: string; assisted: boolean };
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
  responseSpec: { kind: 'integer' | 'rational'; requiredForm?: string };
  hintAvailable: boolean;
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
export type PublicCourse = { key: string; title: string; summary: string };
export type PublicCatalog = { courses: PublicCourse[]; lessons: PublicLesson[]; concepts: PublicConcept[] };
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
  kind: 'homework' | 'exam' | 'review';
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
  recommendedAt: string; opensAt: string | null; dueAt: string | null;
  policy: AssignmentPolicy; status: 'assigned' | 'submitted';
  items: { id: string; problem: PublicProblem; attempt: AttemptView | null }[];
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
  | { action: 'assignment.submit'; recipientId: string; requestId: string };
export type ActionResponse = { state: LearningState; result?: GradeResult; hint?: ContentBlock[]; enrollmentId?: string };
