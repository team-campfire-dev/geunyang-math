/**
 * Feedback on a lesson, left while doing it.
 *
 * There is no mode to switch into. A reader drags over a few words, or presses the small mark on the
 * edge of a drawing, a table or a question, and says what they meant there. For now the people who
 * read it are the operators; the same rows are what a teacher will read about their own lessons.
 */

export type FeedbackStatus = 'open' | 'resolved';

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
  | ({ action: 'feedback.add'; body: string } & FeedbackPlace)
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
