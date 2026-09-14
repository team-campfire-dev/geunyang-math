// Public HTTP DTOs. Never import server content or grading answers into this module.
export type Goal = 'daily-math' | 'foundation-recovery' | 'algebra-ready';
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
  skillKeys: string[];
  promptContent: ContentBlock[];
  responseSpec: { kind: 'integer' | 'rational'; requiredForm?: string };
  hintAvailable: boolean;
};
export type ClassSection = {
  sectionId: string;
  role: 'explanation' | 'worked_example' | 'practice' | 'check' | 'summary';
  title: string;
  contentBlocks: ContentBlock[];
};
export type PublicClass = {
  classKey: string;
  versionId: string;
  title: string;
  summary: string;
  estimatedMinutes: number;
  skillKeys: string[];
  prerequisiteSkillKeys: string[];
  sectionCount: number;
  order: number;
};
export type ClassDocument = PublicClass & { sections: ClassSection[]; problems: PublicProblem[] };
export type AttemptView = {
  id: string; problemVersionId: string; answer: string; result: GradeResult; hintUsed: boolean;
};
export type EnrollmentView = {
  id: string; classKey: string; classVersionId: string; completedSectionIds: string[];
  status: 'active' | 'completed'; attempts: AttemptView[];
};
export type AssignmentView = {
  id: string; recipientId: string; title: string; classKey: string | null;
  recommendedAt: string; policy: 'adaptive' | 'fixed'; status: 'assigned' | 'submitted';
  items: { id: string; problem: PublicProblem; attempt: AttemptView | null }[];
  submissionId: string;
  reason?: string;
};
export type DiagnosticAnswer = { problemVersionId: string; answer: string | null; status: 'correct' | 'incorrect' | 'skipped' };
export type DiagnosticView = {
  id: string; version: string; status: 'active' | 'completed'; completedAt: string | null;
  total: number; answered: number; currentProblem: PublicProblem | null;
  // Only released after completion. Diagnostic items never expose hints or grading specifications.
  results: DiagnosticAnswer[];
};
export type SkillReadiness = { key: string; label: string; readiness: 'unknown' | 'needs-practice' | 'ready'; source: 'none' | 'diagnostic' | 'learning' };
export type Recommendation = { classKey: string; reason: string; kind: 'start' | 'continue' | 'revisit'; suggestedMinutes: number };
export type PersonalPlan = {
  version: string;
  readiness: SkillReadiness[];
  review: { recipientId: string; reason: string } | null;
  sessionMinutes: number;
  preferredClassKey: string | null;
};
export type RecommendationHistoryView = { id: string; createdAt: string; trigger: string; recommendations: Recommendation[] };
export type LearningState = {
  user: { id: string; displayName: string; goal: Goal; dailyMinutes: number };
  classes: PublicClass[];
  enrollments: EnrollmentView[];
  assignments: AssignmentView[];
  recommendations: Recommendation[];
  diagnostic: DiagnosticView | null;
  plan: PersonalPlan;
  recommendationHistory: RecommendationHistoryView[];
  skills: { key: string; label: string; state: 'unknown' | 'practicing' | 'independent' | 'retained' }[];
};
export type LearningAction =
  | { action: 'recommendation.choose'; classKey: string | null }
  | { action: 'diagnostic.start' }
  | { action: 'diagnostic.answer'; diagnosticId: string; problemVersionId: string; answer: string | null }
  | { action: 'profile.update'; goal: Goal; dailyMinutes: number }
  | { action: 'enrollment.start'; classKey: string }
  | { action: 'section.complete'; enrollmentId: string; sectionId: string }
  | { action: 'attempt.submit'; context: 'class' | 'assignment'; contextId: string; problemVersionId: string; answer: string; requestId: string }
  | { action: 'hint.open'; context: 'class' | 'assignment'; contextId: string; problemVersionId: string }
  | { action: 'class.complete'; enrollmentId: string }
  | { action: 'assignment.submit'; recipientId: string; requestId: string };
export type ActionResponse = { state: LearningState; result?: GradeResult; hint?: ContentBlock[]; enrollmentId?: string };
