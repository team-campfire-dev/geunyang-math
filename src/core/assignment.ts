import { z } from 'zod';
import type { AssignmentPolicy, AssignmentSchedule } from '@/shared/api';

export type { AssignmentPolicy, AssignmentSchedule } from '@/shared/api';

export const assignmentPolicySchema = z.object({
  kind: z.enum(['homework', 'exam', 'review']),
  hints: z.boolean(),
  results: z.enum(['per-item', 'after-submission']),
  solutions: z.enum(['never', 'after-submission']),
}).strict();

const moment = z.object({ kind: z.literal('at'), at: z.string().datetime() }).strict();
const afterCompletion = z.object({ kind: z.literal('after'), days: z.number().int().positive() }).strict();
export const assignmentScheduleSchema = z.object({ opens: moment.optional(), due: z.union([moment, afterCompletion]).optional() }).strict();

/** The review a lesson issues for itself: hints allowed, each answer graded as it is saved, solutions kept back. */
export const reviewPolicy: AssignmentPolicy = { kind: 'review', hints: true, results: 'per-item', solutions: 'never' };

export function parseAssignmentPolicy(value: unknown): AssignmentPolicy {
  return assignmentPolicySchema.parse(value);
}
export function parseAssignmentSchedule(value: unknown): AssignmentSchedule {
  return assignmentScheduleSchema.parse(value);
}

type Window = { opensAt: Date | null; dueAt: Date | null };

/**
 * The assignment keeps the rule and the recipient keeps the moment. A relative due date is
 * resolved once, when the work is issued, from when this person finished what it follows; an
 * absolute one stays on the assignment and the recipient's own column stays empty.
 */
export function recipientDates(schedule: AssignmentSchedule, completedAt: Date | null): Window {
  const due = schedule.due?.kind === 'after' && completedAt ? new Date(completedAt.getTime() + schedule.due.days * 86_400_000) : null;
  return { opensAt: null, dueAt: due };
}

/** What this recipient sees: their own moment when one was set, otherwise the assignment's rule. */
export function assignmentWindow(schedule: AssignmentSchedule, recipient: Window): Window {
  return {
    opensAt: recipient.opensAt ?? (schedule.opens ? new Date(schedule.opens.at) : null),
    dueAt: recipient.dueAt ?? (schedule.due?.kind === 'at' ? new Date(schedule.due.at) : null),
  };
}
