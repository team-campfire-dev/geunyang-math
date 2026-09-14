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
};
export type LearningState = {
  user: { id: string; displayName: string; goal: Goal; dailyMinutes: number };
  classes: PublicClass[];
  enrollments: EnrollmentView[];
  assignments: AssignmentView[];
  recommendations: { classKey: string; reason: string }[];
  skills: { key: string; label: string; state: 'unknown' | 'practicing' | 'independent' | 'retained' }[];
};
export type LearningAction =
  | { action: 'profile.update'; goal: Goal; dailyMinutes: number }
  | { action: 'enrollment.start'; classKey: string }
  | { action: 'section.complete'; enrollmentId: string; sectionId: string }
  | { action: 'attempt.submit'; context: 'class' | 'assignment'; contextId: string; problemVersionId: string; answer: string; requestId: string }
  | { action: 'hint.open'; context: 'class' | 'assignment'; contextId: string; problemVersionId: string }
  | { action: 'class.complete'; enrollmentId: string }
  | { action: 'assignment.submit'; recipientId: string; requestId: string };
export type ActionResponse = { state: LearningState; result?: GradeResult; hint?: ContentBlock[]; enrollmentId?: string };
