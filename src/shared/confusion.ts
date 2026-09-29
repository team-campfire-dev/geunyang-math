import type { ContentBlock, PublicProblem } from './api';

export type ConfusionSignal = {
  kind: 'misconception' | 'misreading'; key: string; label: string; note: string;
};
export type ConfusionSource = {
  kind: 'lesson' | 'homework' | 'exam' | 'review' | 'practice';
  id: string; title: string; lessonKey: string | null;
};
export type ConfusionAttempt = {
  id: string; answer: string; status: 'correct' | 'incorrect'; hintUsed: boolean;
  createdAt: string; source: ConfusionSource; signal: ConfusionSignal | null;
};
export type ConfusionEvidence = {
  problemVersionId: string; conceptKeys: string[]; promptContent: ContentBlock[];
  responseSpec: PublicProblem['responseSpec'];
  first: ConfusionAttempt; corrections: ConfusionAttempt[];
};
export type ConfusionConcept = {
  key: string; label: string; state: 'unknown' | 'missed' | 'independent' | 'retained';
  description: string; lessonKey: string | null;
  evidenceIds: string[]; latestAt: string | null;
};
export type RepeatedConfusion = ConfusionSignal & {
  status: 'repeated' | 'improving'; description: string;
  evidenceIds: string[]; improvementEvidenceIds: string[]; lastSeenAt: string;
};
/** One server calculation supplies both the learner's prose and the machine-readable evidence. */
export type ConfusionSummary = {
  version: 1; latestAt: string | null;
  concepts: ConfusionConcept[]; repeated: RepeatedConfusion[]; evidence: ConfusionEvidence[];
};
export const confusionStateLabels: Record<ConfusionConcept['state'], string> = {
  unknown: '확인 전', missed: '놓침', independent: '스스로 해결', retained: '꾸준히 기억',
};
