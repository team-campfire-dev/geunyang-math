import { describe, expect, it } from 'vitest';
import { assignmentWindow, parseAssignmentPolicy, parseAssignmentSchedule, recipientDates, reviewPolicy } from '@/core/assignment';

describe('assignment policy and schedule', () => {
  it('accepts the review policy and refuses a policy with an unknown kind or an extra field', () => {
    expect(parseAssignmentPolicy(reviewPolicy)).toEqual(reviewPolicy);
    expect(() => parseAssignmentPolicy({ ...reviewPolicy, kind: 'quiz' })).toThrow();
    expect(() => parseAssignmentPolicy({ ...reviewPolicy, adaptive: true })).toThrow();
  });
  it('accepts an empty schedule, a moment, and a due date after completion, and refuses the rest', () => {
    expect(parseAssignmentSchedule({})).toEqual({});
    expect(parseAssignmentSchedule({ opens: { kind: 'at', at: '2026-10-01T00:00:00.000Z' }, due: { kind: 'after', days: 3 } })).toMatchObject({ due: { days: 3 } });
    expect(() => parseAssignmentSchedule({ due: { kind: 'after', days: 0 } })).toThrow();
    expect(() => parseAssignmentSchedule({ due: { kind: 'at', at: 'tomorrow' } })).toThrow();
    expect(() => parseAssignmentSchedule({ opens: { kind: 'after', days: 1 } })).toThrow();
  });
  it('resolves a relative due date from completion when issuing, and leaves an absolute one to the assignment', () => {
    const completed = new Date('2026-09-17T10:00:00.000Z');
    expect(recipientDates({ due: { kind: 'after', days: 3 } }, completed)).toEqual({ opensAt: null, dueAt: new Date('2026-09-20T10:00:00.000Z') });
    expect(recipientDates({ due: { kind: 'after', days: 3 } }, null)).toEqual({ opensAt: null, dueAt: null });
    expect(recipientDates({ due: { kind: 'at', at: '2026-10-01T00:00:00.000Z' } }, completed)).toEqual({ opensAt: null, dueAt: null });
  });
  it('shows a recipient their own moment when one is set and the rule otherwise', () => {
    const schedule = { opens: { kind: 'at' as const, at: '2026-10-01T00:00:00.000Z' }, due: { kind: 'at' as const, at: '2026-10-08T00:00:00.000Z' } };
    expect(assignmentWindow(schedule, { opensAt: null, dueAt: null })).toEqual({ opensAt: new Date(schedule.opens.at), dueAt: new Date(schedule.due.at) });
    const own = new Date('2026-10-10T00:00:00.000Z');
    expect(assignmentWindow(schedule, { opensAt: null, dueAt: own })).toEqual({ opensAt: new Date(schedule.opens.at), dueAt: own });
    expect(assignmentWindow({ due: { kind: 'after', days: 2 } }, { opensAt: null, dueAt: null })).toEqual({ opensAt: null, dueAt: null });
  });
});
