import type { PublicLesson } from './api';
import type { ConfusionEvidence, ConfusionSummary } from './confusion';

/**
 * AI 맞춤 연습: a model reads a learner's record over a range — everything, one course, or one
 * lesson — says what it sees, and writes questions for it. The questions pass the same checks as
 * every generated question and are this learner's alone.
 *
 * One rule decides what falls inside a range, here, so the screen that offers the button and the
 * server that reads the record cannot disagree about whether there is enough to read.
 */
export type PracticeScope = { kind: 'all' } | { kind: 'course'; key: string } | { kind: 'lesson'; key: string };

export const aiPracticeLimits = {
  /** Questions asked for each time. */
  questions: 8,
  /** Sets a learner may ask for in a day; every request costs, including one where nothing passed. */
  daily: 3,
  /** First answers a range needs before there is anything to read. */
  minimumEvidence: 3,
  /** At most this many things to work on in one set, so each gets more than one question. */
  maxTargets: 4,
  /** A set still pending after this long was cut off (a restart); it is reported as failed. */
  staleMinutes: 10,
} as const;

export const scopeKey = (scope: PracticeScope) => (scope.kind === 'all' ? 'all' : `${scope.kind}:${scope.key}`);
export function parseScopeKey(key: string): PracticeScope | null {
  if (key === 'all') return { kind: 'all' };
  const match = /^(course|lesson):(.+)$/.exec(key);
  return match ? { kind: match[1] as 'course' | 'lesson', key: match[2] } : null;
}

/** The concepts a range teaches: every lesson's in a course, one lesson's, or none to filter by. */
export function scopeConcepts(scope: PracticeScope, lessons: Pick<PublicLesson, 'lessonKey' | 'courseKey' | 'conceptKeys'>[]): Set<string> | null {
  if (scope.kind === 'all') return null;
  const held = lessons.filter((lesson) => (scope.kind === 'course' ? lesson.courseKey === scope.key : lesson.lessonKey === scope.key));
  return new Set(held.flatMap((lesson) => lesson.conceptKeys));
}

/**
 * The first answers that belong to a range: answered in it, or about what it teaches. A question
 * answered elsewhere about a concept this lesson teaches is evidence about this lesson's concept.
 */
export function scopeEvidence(summary: ConfusionSummary, scope: PracticeScope, lessons: Pick<PublicLesson, 'lessonKey' | 'courseKey' | 'conceptKeys'>[]): ConfusionEvidence[] {
  if (scope.kind === 'all') return summary.evidence;
  const concepts = scopeConcepts(scope, lessons) ?? new Set<string>();
  const lessonKeys = new Set(lessons.filter((lesson) => (scope.kind === 'course' ? lesson.courseKey === scope.key : lesson.lessonKey === scope.key)).map((lesson) => lesson.lessonKey));
  return summary.evidence.filter((item) => (item.first.source.lessonKey && lessonKeys.has(item.first.source.lessonKey))
    || item.conceptKeys.some((key) => concepts.has(key)));
}

/** What the learner sees above an AI practice set: what was read, and why each question is there. */
export type AiPracticeNote = { scope: string; scopeLabel: string; diagnosis: string };
/** A request still being written, or the last one that failed, for the screen that asked. */
export type AiPracticeRun = { scope: string; status: 'pending' | 'failed'; startedAt: string; message?: string };
export type AiPracticeState = {
  /** Whether this deployment can write questions at all. */
  available: boolean;
  /** Requests left today. */
  remaining: number;
  runs: AiPracticeRun[];
};
