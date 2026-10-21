/**
 * Who may see a course, who teaches a learner, and which courses somebody set for them.
 *
 * Nobody has to be taught. Every public course is open to every learner, and somebody studying on
 * their own is the ordinary case rather than one with a part missing. A teacher — a parent, a
 * teacher, and later a model for the adult who has nobody — narrows or widens that for the learners
 * who chose to be taught by them, and an operator decides which courses are public at all.
 */
import type { CourseStage, CourseTrack } from './api';

/** `public`: everybody. `assigned`: only the learners it is set for, and anybody already in it. */
export type CourseVisibility = 'public' | 'assigned';
export const courseVisibilities: readonly CourseVisibility[] = ['public', 'assigned'];
export const visibilityNames: Record<CourseVisibility, string> = { public: '모두에게 공개', assigned: '배정한 학습자에게만' };
export const isCourseVisibility = (value: unknown): value is CourseVisibility => courseVisibilities.includes(value as CourseVisibility);

/** Who is on the teaching side of a link. Only a person has an account; a model is a kind, not a user. */
export type TeacherKind = 'person' | 'ai';

/** Who set a course, as the learner is told it. */
export type SetBy = { kind: 'operator' } | { kind: 'person'; name: string } | { kind: 'ai' };
export const setByName = (by: SetBy) => (by.kind === 'person' ? by.name : by.kind === 'ai' ? 'AI 선생님' : '운영자');

/** What a learner sees of their own teaching: who teaches them, and what was set for them. */
export type LearnerTeaching = {
  teachers: { linkId: string; kind: TeacherKind; name: string; since: string }[];
  assignedCourses: { courseKey: string; setBy: SetBy; assignedAt: string }[];
};

/** An invite code as people type it: eight letters and digits that cannot be read as one another. */
export const inviteAlphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
export const inviteLength = 8;
/** What a learner typed, made into the code it means: spaces, dashes and case do not count. */
export const normalizeInvite = (typed: string) => typed.toUpperCase().replace(/[^A-Z0-9]/g, '');
/** Shown in two halves, which is how it is read aloud and copied by hand. */
export const formatInvite = (code: string) => (code.length === inviteLength ? `${code.slice(0, 4)}-${code.slice(4)}` : code);

/** One learner as the person teaching them sees it. */
export type TaughtLearner = {
  userId: string; displayName: string;
  /** The link through which this teacher reaches them; null when an operator reaches them directly. */
  linkId: string | null; since: string | null;
  courses: { courseKey: string; setBy: SetBy; mine: boolean }[];
};
/** A course as the teaching screen lists it, with whether this teacher may set it for somebody. */
export type TeachingCourse = {
  key: string; title: string; track: CourseTrack; stage: CourseStage | null;
  visibility: CourseVisibility; mayAssign: boolean;
};
export type TeachingView = {
  /** An operator sees and reaches every learner and decides who may see each course. */
  operator: boolean;
  invite: string | null;
  learners: TaughtLearner[];
  courses: TeachingCourse[];
};
export type TeachingAction =
  | { action: 'invite.renew' }
  | { action: 'learner.find'; query: string }
  | { action: 'course.assign'; learnerUserId: string; courseKey: string }
  | { action: 'course.unassign'; learnerUserId: string; courseKey: string }
  | { action: 'link.end'; learnerUserId: string }
  | { action: 'course.visibility'; courseKey: string; visibility: CourseVisibility };
export type TeachingResponse = { teaching: TeachingView; matches?: TaughtLearner[] };
