import { matchMisreading, type AnswerSpec } from './answer';
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
export type PracticeScope = { kind: 'all' } | { kind: 'course'; key: string } | { kind: 'lesson'; key: string }
  /** Several courses read as one range: where the learner is heading — the courses they chose or were set, an exam's worth. */
  | { kind: 'courses'; keys: string[] };

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

/** The most courses one range reads, so its name fits where a set's range is kept. */
export const maxScopeCourses = 4;
/** A range's name. Several courses are named in order, so the same courses are the same range however they were listed. */
export const scopeKey = (scope: PracticeScope) => (scope.kind === 'all' ? 'all'
  : scope.kind === 'courses' ? `courses:${[...new Set(scope.keys)].sort().join(',')}` : `${scope.kind}:${scope.key}`);
export function parseScopeKey(key: string): PracticeScope | null {
  if (key === 'all') return { kind: 'all' };
  const several = /^courses:(.+)$/.exec(key);
  if (several) return { kind: 'courses', keys: several[1].split(',') };
  const match = /^(course|lesson):(.+)$/.exec(key);
  return match ? { kind: match[1] as 'course' | 'lesson', key: match[2] } : null;
}

/** Several courses said in a few words: all of them up to three, then the first and how many more. */
export const coursesLabel = (titles: string[]) => (titles.length <= 3 ? titles.join(' · ') : `${titles[0]} 외 ${titles.length - 1}개 과정`);

/** Whether a lesson is inside a range. Everything is inside the whole record. */
export function scopeHolds(scope: PracticeScope, lesson: Pick<PublicLesson, 'lessonKey' | 'courseKey'>): boolean {
  if (scope.kind === 'all') return true;
  if (scope.kind === 'lesson') return lesson.lessonKey === scope.key;
  if (scope.kind === 'course') return lesson.courseKey === scope.key;
  return scope.keys.includes(lesson.courseKey);
}

/** The concepts a range teaches: every lesson's in a course, one lesson's, or none to filter by. */
export function scopeConcepts(scope: PracticeScope, lessons: Pick<PublicLesson, 'lessonKey' | 'courseKey' | 'conceptKeys'>[]): Set<string> | null {
  if (scope.kind === 'all') return null;
  return new Set(lessons.filter((lesson) => scopeHolds(scope, lesson)).flatMap((lesson) => lesson.conceptKeys));
}

/**
 * The first answers that belong to a range: answered in it, or about what it teaches. A question
 * answered elsewhere about a concept this lesson teaches is evidence about this lesson's concept.
 */
export function scopeEvidence(summary: ConfusionSummary, scope: PracticeScope, lessons: Pick<PublicLesson, 'lessonKey' | 'courseKey' | 'conceptKeys'>[]): ConfusionEvidence[] {
  if (scope.kind === 'all') return summary.evidence;
  const concepts = scopeConcepts(scope, lessons) ?? new Set<string>();
  const lessonKeys = new Set(lessons.filter((lesson) => scopeHolds(scope, lesson)).map((lesson) => lesson.lessonKey));
  return summary.evidence.filter((item) => (item.first.source.lessonKey && lessonKeys.has(item.first.source.lessonKey))
    || item.conceptKeys.some((key) => concepts.has(key)));
}

/**
 * A mistake the model guessed from the record. `name` is what the learner did, said the way the
 * catalogue says it (「닮음비를 넓이의 비에 그대로 쓰기」); `how` says how it makes the wrong answer, for
 * the writer. `key` names it inside one set only; `misconception` is the catalogue's name for the
 * same thing when there is one. `evidence` is the questions it was guessed from.
 */
export type Hypothesis = {
  key: string; name: string; how: string; confidence: 'low' | 'medium' | 'high';
  misconception: string; evidence: string[]; conceptKeys: string[];
};
/** The wrong answer a guessed mistake would give on one of the set's questions. */
export type Prediction = { answer: string; hypothesis: string };
/**
 * What the questions written to check a guess found, counted on first answers: the predicted wrong
 * answer, the right one, or some other. A guess is never marked true or false here — the counts go
 * to the learner and to the next plan, and each reads them its own way.
 */
export type HypothesisCheck = { asked: number; answered: number; predicted: number; correct: number; other: number };

export function checkHypothesis(key: string, predictions: Record<string, Prediction[]>,
  firsts: Map<string, { answer: string; status: 'correct' | 'incorrect'; spec: AnswerSpec }>): HypothesisCheck {
  const check: HypothesisCheck = { asked: 0, answered: 0, predicted: 0, correct: 0, other: 0 };
  for (const [problemVersionId, list] of Object.entries(predictions)) {
    const mine = list.filter((item) => item.hypothesis === key);
    if (!mine.length) continue;
    check.asked += 1;
    const first = firsts.get(problemVersionId);
    if (!first) continue;
    check.answered += 1;
    if (first.status === 'correct') check.correct += 1;
    else if (matchMisreading(first.answer, first.spec, mine.map((item) => ({ answer: item.answer, misconception: key })))) check.predicted += 1;
    else check.other += 1;
  }
  return check;
}

/** What the learner sees above an AI practice set: what was read, what was guessed, and what the questions found. */
export type AiPracticeNote = { scope: string; scopeLabel: string; diagnosis: string;
  hypotheses?: { name: string; check: HypothesisCheck }[] };
/** A request still being written, or the last one that failed, for the screen that asked. */
export type AiPracticeRun = { scope: string; status: 'pending' | 'failed'; startedAt: string; message?: string };
export type AiPracticeState = {
  /** Whether this deployment can write questions at all. */
  available: boolean;
  /** Requests left today. */
  remaining: number;
  /** Why none may be asked for now although the count allows it — what the service pays for has run out. */
  refused?: string;
  runs: AiPracticeRun[];
};
