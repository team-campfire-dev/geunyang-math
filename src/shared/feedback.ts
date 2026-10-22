/**
 * Feedback on a lesson, left while doing it.
 *
 * There is no mode to switch into. A reader drags over a few words, or presses the small mark on the
 * edge of a drawing, a table or a question, and says what they meant there. For now the people who
 * read it are the operators; the same rows are what a teacher will read about their own lessons.
 */

export type FeedbackStatus = 'open' | 'resolved';

/**
 * What most feedback is, said in one press. A reader who only wants to say 「헷갈려요」 should not have
 * to type it; a sentence is there for when the press is not enough. Each one is something the person
 * fixing the lesson does something different about, which is why there are only these.
 */
export type FeedbackReason = 'confusing' | 'hard' | 'wrong' | 'broken' | 'good';
export const feedbackReasons: readonly { key: FeedbackReason; label: string }[] = [
  { key: 'confusing', label: '헷갈려요' },
  { key: 'hard', label: '어려워요' },
  { key: 'wrong', label: '틀린 것 같아요' },
  { key: 'broken', label: '화면이 이상해요' },
  { key: 'good', label: '이해됐어요' },
];
export const reasonLabel = (reason: FeedbackReason | null) => feedbackReasons.find((item) => item.key === reason)?.label ?? null;

/** Where in a lesson somebody pointed. A block is absent for the step as a whole. */
export type FeedbackPlace = {
  lessonKey: string;
  lessonVersionId: string;
  sectionId: string;
  blockId: string | null;
  problemVersionId: string | null;
  quote: string | null;
};

export type FeedbackItem = FeedbackPlace & {
  id: string;
  reason: FeedbackReason | null;
  /** Empty when a quick answer said it all. */
  body: string;
  status: FeedbackStatus;
  createdAt: string;
  /** Who wrote it. Another reader's name is only ever shown to somebody who reads everybody's. */
  author: { name: string; mine: boolean };
  resolvedAt: string | null;
};

/** What the lesson screen needs: whether this lesson takes feedback, and what the viewer may see of it. */
export type LessonFeedbackView = {
  accepting: boolean;
  /** Whether the viewer reads everybody's feedback here, and settles it. */
  reviewer: boolean;
  items: FeedbackItem[];
};

/** One piece of feedback as the operator's list shows it, with the names of the places it points at. */
export type FeedbackEntry = FeedbackItem & {
  lessonTitle: string;
  courseTitle: string;
  /** The step's title in the version the reader saw, and its place in the newest version for a link. */
  sectionTitle: string;
  step: number | null;
  /** Whether what they read is still what the newest version says. */
  current: boolean;
};

export type FeedbackLesson = { lessonKey: string; title: string; courseTitle: string; accepting: boolean; open: number };

export type FeedbackInbox = { entries: FeedbackEntry[]; lessons: FeedbackLesson[] };

export const feedbackLimits = { body: 1000, quote: 500, perDay: 100 } as const;

export type FeedbackAction =
  | ({ action: 'feedback.add'; reason: FeedbackReason | null; body: string } & FeedbackPlace)
  | { action: 'feedback.remove'; feedbackId: string }
  | { action: 'feedback.resolve'; feedbackId: string }
  | { action: 'feedback.reopen'; feedbackId: string }
  | { action: 'lesson.accepting'; lessonKey: string; accepting: boolean };

/** A dragged selection as it is kept: runs of space closed up, and cut where a quote stops being one. */
export function cleanQuote(text: string): string | null {
  const flat = text.replace(/\s+/g, ' ').trim();
  if (!flat) return null;
  return flat.length > feedbackLimits.quote ? `${flat.slice(0, feedbackLimits.quote - 1)}…` : flat;
}
