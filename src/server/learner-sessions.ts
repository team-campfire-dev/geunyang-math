import 'server-only';
import type { PrismaClient } from '@prisma/client';
import type { GradeResult } from '@/shared/api';
import { inAppNames, type ClientKind, type LearnerListing, type LearnerSessionsDetail, type LearnerSessionsList, type Sitting,
  type SittingEvent, type SittingNote, type VisitKind } from '@/shared/learner-sessions';
import { setByName } from '@/shared/teaching';
import { authoringRole } from './authoring';
import { AppError } from './errors';
import { setByOf } from './teaching';

const minute = 60_000;
const day = 24 * 60 * minute;
/** Half an hour with nothing done ends a sitting: long enough for a break inside one, short of coming back later. */
export const sittingGap = 30 * minute;
/** A step that only asks to be read, finished faster than this, was passed rather than read. */
const skimSeconds = 10;
const readingRoles = new Set(['explanation', 'worked_example']);
/** A login lasts this long, so a visit older than it says nothing about the login after it. */
const loginLifetime = 7 * day;

/** What a question asks, short enough to name it in a line: its first text, without the marks that set mathematics. */
export function promptLine(payload: unknown) {
  const text = typeof (payload as { text?: unknown } | null)?.text === 'string' ? (payload as { text: string }).text : '';
  const plain = text.replace(/\$/g, '').replace(/\\[a-z]+\s*/gi, '').replace(/[{}]/g, '').replace(/\s+/g, ' ').trim();
  return plain.length > 80 ? `${plain.slice(0, 79)}…` : plain;
}
const statusOf = (result: unknown): 'correct' | 'incorrect' | 'invalid' => {
  const status = (result as GradeResult | null)?.status;
  return status === 'correct' || status === 'incorrect' ? status : 'invalid';
};
const seconds = (from: Date, to: Date) => Math.max(0, Math.round((to.getTime() - from.getTime()) / 1000));

/**
 * One event as it is put together, with what reading it needs and the screen does not: which
 * enrollment it belongs to, which question, which login. `learner` is false for what somebody else did.
 */
export type Built = { at: Date; event: SittingEvent; learner: boolean; enrollmentId?: string; question?: string; sessionId?: string | null };
export type EnrollmentFacts = { id: string; lessonTitle: string; sections: number; completedAt: Date | null; finishedAt: Date[] };

/** Events cut where nothing was done for `sittingGap`. What somebody else did never holds a sitting open by itself. */
export function cutSittings(events: Built[]): Built[][] {
  const sorted = [...events].sort((a, b) => a.at.getTime() - b.at.getTime());
  const groups: Built[][] = [];
  let last: Date | null = null;
  for (const item of sorted) {
    if (!groups.length || !last || item.at.getTime() - last.getTime() > sittingGap) groups.push([]);
    groups[groups.length - 1].push(item);
    last = item.at;
  }
  return groups;
}

/**
 * The seconds each step and answer took, read inside its sitting: a step since the step before it
 * in the same lesson (or the lesson starting), an answer since whatever the learner last did. A
 * step whose start fell in an earlier sitting has no time here — the learner was away in between.
 */
function timed(group: Built[]) {
  const lessonMark = new Map<string, Date>();
  let previous: Date | null = null;
  for (const item of group) {
    const { event } = item;
    if (event.kind === 'lesson' && event.phase === 'start' && item.enrollmentId) lessonMark.set(item.enrollmentId, item.at);
    if (event.kind === 'section' && item.enrollmentId) {
      const mark = lessonMark.get(item.enrollmentId);
      event.seconds = mark ? seconds(mark, item.at) : null;
      lessonMark.set(item.enrollmentId, item.at);
    }
    if (event.kind === 'answer') event.seconds = previous ? seconds(previous, item.at) : null;
    if (item.learner) previous = item.at;
  }
}

/** What a sitting says when read through — the things an operator would otherwise find by reading every line. */
export function notesOf(group: Built[], allVisits: Built[], enrollments: Map<string, EnrollmentFacts>): SittingNote[] {
  const notes: SittingNote[] = [];
  const visits = group.filter((item) => item.event.kind === 'visit');
  const end = group[group.length - 1].at;

  const apps = [...new Set(visits.flatMap((item) => (item.event.kind === 'visit' && item.event.client.inApp ? [item.event.client.inApp] : [])))];
  if (apps.length) notes.push({ kind: 'in-app', text: `${apps.map((app) => inAppNames[app]).join('·')} 앱 안 브라우저로 들어왔어요. 앱 안 브라우저에서는 로그인이 풀리기 쉬워요.` });

  // A login while an earlier one was never signed out of: that one stopped working, or this is another browser.
  for (const login of visits.filter((item) => item.event.kind === 'visit' && item.event.visit === 'login')) {
    const before = allVisits.filter((item) => item.at < login.at && item.sessionId && item.sessionId !== login.sessionId && login.at.getTime() - item.at.getTime() < loginLifetime);
    const earlier = before[before.length - 1];
    if (!earlier) continue;
    const signedOut = allVisits.some((item) => item.sessionId === earlier.sessionId && item.event.kind === 'visit' && item.event.visit === 'logout');
    if (!signedOut) notes.push({ kind: 'relogin', text: `로그아웃하지 않았는데 다시 로그인했어요. 앞의 로그인이 풀렸거나 다른 브라우저로 들어온 거예요.` });
  }

  const opens = visits.filter((item) => item.event.kind === 'visit' && item.event.visit === 'open').length;
  if (opens >= 3) notes.push({ kind: 'reopened', text: `페이지를 ${opens}번 처음부터 다시 열었어요.` });

  for (const item of group) {
    if (item.event.kind === 'section' && readingRoles.has(item.event.role) && item.event.seconds !== null && item.event.seconds < skimSeconds) {
      notes.push({ kind: 'skimmed', text: `「${item.event.sectionTitle}」를 ${item.event.seconds}초 만에 넘겼어요.` });
    }
  }

  const answers = group.filter((item) => item.event.kind === 'answer');
  const wrong = new Map<string, { prompt: string; times: number }>();
  for (const item of answers) {
    if (item.event.kind !== 'answer' || item.event.status !== 'incorrect' || !item.question) continue;
    const entry = wrong.get(item.question) ?? { prompt: item.event.prompt, times: 0 };
    entry.times += 1; wrong.set(item.question, entry);
  }
  for (const { prompt, times } of wrong.values()) if (times >= 2) notes.push({ kind: 'struggled', text: `「${prompt.length > 30 ? `${prompt.slice(0, 29)}…` : prompt}」에서 ${times}번 틀렸어요.` });

  const hints = group.filter((item) => item.event.kind === 'hint').length;
  if (hints) notes.push({ kind: 'hints', text: `힌트를 ${hints}번 열었어요.` });
  if (answers.length >= 3 && !hints && answers.every((item) => item.event.kind === 'answer' && item.event.status === 'correct' && item.event.attempt === 1 && !item.event.hint)) {
    notes.push({ kind: 'clean', text: `답 ${answers.length}개를 모두 한 번에, 힌트 없이 맞혔어요.` });
  }

  // A lesson worked on here and not finished by the time the learner left.
  for (const enrollmentId of new Set(group.flatMap((item) => (item.enrollmentId ? [item.enrollmentId] : [])))) {
    const facts = enrollments.get(enrollmentId);
    if (!facts || (facts.completedAt && facts.completedAt <= end)) continue;
    const done = facts.finishedAt.filter((at) => at <= end).length;
    notes.push({ kind: 'stopped', text: `「${facts.lessonTitle}」를 ${facts.sections}단계 중 ${done}단계까지 하고 멈췄어요.` });
  }
  return notes;
}

/** The kinds a sitting came in, each once, in the order they first appeared. */
function clientsOf(group: Built[]) {
  const seen = new Map<string, ClientKind>();
  for (const item of group) if (item.event.kind === 'visit') seen.set(JSON.stringify(item.event.client), item.event.client);
  return [...seen.values()];
}

/**
 * Reading a learner back, for the operator: who has been learning lately, and for one of them every
 * sitting — when they came, in what, and what they did from one moment to the next, with what that
 * says written beside it. Only an operator reads it: it names people and holds what they answered.
 *
 * Everything here is read from records the service already keeps for the learner, plus the visits
 * the learning screen reports; nothing is written. A step finished before step times were kept has
 * no time, and a visit before visits were kept is simply not there.
 */
export class LearnerSessionsService {
  constructor(private readonly db: PrismaClient) {}

  private async operator(userId: string) {
    if (await authoringRole(this.db, userId) !== 'admin') throw new AppError(403, 'not_an_operator', '운영자만 볼 수 있어요.');
  }

  async list(userId: string): Promise<LearnerSessionsList> {
    await this.operator(userId);
    const since = new Date(Date.now() - 30 * day);
    const [users, attempts, visits, enrollments, hints, lastAttempt, lastVisit, lastEnrollment] = await Promise.all([
      this.db.user.findMany({ where: { id: { not: 'open-authoring' } }, select: { id: true, displayName: true, createdAt: true,
        _count: { select: { attempts: true, enrollments: { where: { status: 'completed' } } } } } }),
      this.db.attempt.findMany({ where: { createdAt: { gte: since } }, select: { userId: true, createdAt: true } }),
      this.db.learnerVisit.findMany({ where: { createdAt: { gte: since } }, orderBy: { createdAt: 'asc' }, select: { userId: true, createdAt: true, device: true, os: true, browser: true, inApp: true } }),
      this.db.enrollment.findMany({ where: { OR: [{ createdAt: { gte: since } }, { completedAt: { gte: since } }] }, select: { userId: true, createdAt: true, completedAt: true } }),
      this.db.hintUse.findMany({ where: { createdAt: { gte: since } }, select: { userId: true, createdAt: true } }),
      this.db.attempt.groupBy({ by: ['userId'], _max: { createdAt: true } }),
      this.db.learnerVisit.groupBy({ by: ['userId'], _max: { createdAt: true } }),
      this.db.enrollment.groupBy({ by: ['userId'], _max: { createdAt: true, completedAt: true } }),
    ]);
    const times = new Map<string, Date[]>();
    const add = (id: string, at: Date | null) => { if (at && at >= since) times.set(id, [...(times.get(id) ?? []), at]); };
    for (const row of attempts) add(row.userId, row.createdAt);
    for (const row of visits) add(row.userId, row.createdAt);
    for (const row of enrollments) { add(row.userId, row.createdAt); add(row.userId, row.completedAt); }
    for (const row of hints) add(row.userId, row.createdAt);
    const latest = new Map<string, number>();
    const bump = (id: string, at: Date | null | undefined) => { if (at) latest.set(id, Math.max(latest.get(id) ?? 0, at.getTime())); };
    for (const row of lastAttempt) bump(row.userId, row._max.createdAt);
    for (const row of lastVisit) bump(row.userId, row._max.createdAt);
    for (const row of lastEnrollment) { bump(row.userId, row._max.createdAt); bump(row.userId, row._max.completedAt); }
    const lastClient = new Map(visits.map((row) => [row.userId, { device: row.device, os: row.os, browser: row.browser, inApp: row.inApp } as ClientKind]));
    const learners: LearnerListing[] = users.map((user) => {
      const marks = (times.get(user.id) ?? []).sort((a, b) => a.getTime() - b.getTime());
      const sittings = marks.filter((at, index) => index === 0 || at.getTime() - marks[index - 1].getTime() > sittingGap).length;
      return { userId: user.id, displayName: user.displayName, joinedAt: user.createdAt.toISOString(),
        lastActiveAt: latest.has(user.id) ? new Date(latest.get(user.id)!).toISOString() : null,
        recentSittings: sittings, lessonsCompleted: user._count.enrollments, answers: user._count.attempts, lastClient: lastClient.get(user.id) ?? null };
    });
    // Whoever learned most recently first; nobody who never did anything is hidden, they come last by when they joined.
    learners.sort((a, b) => (b.lastActiveAt ?? '').localeCompare(a.lastActiveAt ?? '') || b.joinedAt.localeCompare(a.joinedAt));
    return { learners };
  }

  async detail(userId: string, learnerId: string): Promise<LearnerSessionsDetail> {
    await this.operator(userId);
    const listing = (await this.list(userId)).learners.find((learner) => learner.userId === learnerId);
    const user = listing && await this.db.user.findUnique({ where: { id: learnerId }, select: { createdAt: true } });
    if (!listing || !user) throw new AppError(404, 'learner_missing', '학습자를 찾을 수 없어요.');
    const [visits, assigned, enrollments, attempts, hints, recipients, diagnostics, feedback, practice] = await Promise.all([
      this.db.learnerVisit.findMany({ where: { userId: learnerId }, orderBy: { createdAt: 'asc' } }),
      this.db.assignedCourse.findMany({ where: { learnerUserId: learnerId }, select: { courseKey: true, assignedAt: true, linkId: true,
        assignedBy: { select: { displayName: true } }, link: { select: { teacherKind: true } } } }),
      this.db.enrollment.findMany({ where: { userId: learnerId }, select: { id: true, lessonVersionId: true, completedSectionIds: true, sectionTimes: true,
        status: true, createdAt: true, completedAt: true, lessonVersion: { select: { title: true, lesson: { select: { course: { select: { title: true } } } } } } } }),
      this.db.attempt.findMany({ where: { userId: learnerId }, orderBy: [{ createdAt: 'asc' }, { id: 'asc' }], select: { createdAt: true, problemVersionId: true,
        answer: true, result: true, hintUsed: true, enrollmentId: true, submissionId: true,
        enrollment: { select: { lessonVersion: { select: { title: true } } } },
        submission: { select: { recipient: { select: { assignment: { select: { title: true } } } } } } } }),
      this.db.hintUse.findMany({ where: { userId: learnerId }, select: { createdAt: true, problemVersionId: true } }),
      this.db.assignmentRecipient.findMany({ where: { learnerUserId: learnerId }, select: { assignment: { select: { title: true, issuedAt: true } },
        submissions: { select: { finalizedAt: true } } } }),
      this.db.diagnosticRun.findMany({ where: { userId: learnerId }, select: { createdAt: true, completedAt: true } }),
      this.db.lessonFeedback.findMany({ where: { authorUserId: learnerId }, select: { createdAt: true, lessonVersionId: true, reason: true, body: true, quote: true } }),
      this.db.generatedProblemSet.findMany({ where: { userId: learnerId, status: { not: 'done' } }, select: { createdAt: true, scope: true, status: true } }),
    ]);
    const questionIds = [...new Set([...attempts.map((row) => row.problemVersionId), ...hints.map((row) => row.problemVersionId)])];
    const [courses, sections, prompts, feedbackTitles] = await Promise.all([
      this.db.course.findMany({ where: { key: { in: assigned.map((row) => row.courseKey) } }, select: { key: true, title: true } }),
      this.db.lessonSection.findMany({ where: { lessonVersionId: { in: enrollments.map((row) => row.lessonVersionId) } }, orderBy: { order: 'asc' } }),
      this.db.contentBlock.findMany({ where: { ownerKind: 'problem', ownerId: { in: questionIds }, slot: 'prompt' }, orderBy: { order: 'asc' }, select: { ownerId: true, payload: true } }),
      this.db.lessonVersion.findMany({ where: { id: { in: feedback.map((row) => row.lessonVersionId) } }, select: { id: true, title: true } }),
    ]);
    const prompt = new Map<string, string>();
    for (const row of prompts) if (!prompt.has(row.ownerId)) prompt.set(row.ownerId, promptLine(row.payload));
    const promptOf = (id: string) => prompt.get(id) || id;

    const events: Built[] = [{ at: user.createdAt, event: { kind: 'joined', at: '' }, learner: true }];
    const visitEvents: Built[] = visits.map((row) => ({ at: row.createdAt, learner: true, sessionId: row.sessionId,
      event: { kind: 'visit', at: '', visit: row.kind as VisitKind, client: { device: row.device, os: row.os, browser: row.browser, inApp: row.inApp } as ClientKind } }));
    events.push(...visitEvents);
    for (const row of assigned) {
      events.push({ at: row.assignedAt, learner: false, event: { kind: 'course', at: '', courseTitle: courses.find((course) => course.key === row.courseKey)?.title ?? row.courseKey, by: setByName(setByOf(row)) } });
    }
    const facts = new Map<string, EnrollmentFacts>();
    for (const row of enrollments) {
      const lessonTitle = row.lessonVersion.title, courseTitle = row.lessonVersion.lesson.course.title;
      const own = sections.filter((section) => section.lessonVersionId === row.lessonVersionId);
      const stamps = (row.sectionTimes ?? {}) as Record<string, string>;
      const finishedAt = (row.completedSectionIds as string[]).flatMap((id) => (stamps[id] ? [new Date(stamps[id])] : []));
      facts.set(row.id, { id: row.id, lessonTitle, sections: own.length, completedAt: row.completedAt, finishedAt });
      events.push({ at: row.createdAt, learner: true, enrollmentId: row.id, event: { kind: 'lesson', at: '', phase: 'start', lessonTitle, courseTitle } });
      own.forEach((section, index) => {
        const at = stamps[section.sectionId];
        if (at) events.push({ at: new Date(at), learner: true, enrollmentId: row.id, event: { kind: 'section', at: '', lessonTitle,
          sectionTitle: section.title, role: section.role, position: index + 1, of: own.length, seconds: null } });
      });
      if (row.completedAt) events.push({ at: row.completedAt, learner: true, enrollmentId: row.id, event: { kind: 'lesson', at: '', phase: 'complete', lessonTitle, courseTitle } });
    }
    const tries = new Map<string, number>();
    for (const row of attempts) {
      const where = row.enrollmentId ? row.enrollment?.lessonVersion.title ?? '수업' : row.submission?.recipient.assignment.title ?? '과제';
      const key = `${row.enrollmentId ?? row.submissionId}:${row.problemVersionId}`;
      tries.set(key, (tries.get(key) ?? 0) + 1);
      events.push({ at: row.createdAt, learner: true, enrollmentId: row.enrollmentId ?? undefined, question: key, event: { kind: 'answer', at: '',
        prompt: promptOf(row.problemVersionId), answer: row.answer, status: statusOf(row.result), hint: row.hintUsed, where, attempt: tries.get(key)!, seconds: null } });
    }
    for (const row of hints) events.push({ at: row.createdAt, learner: true, event: { kind: 'hint', at: '', prompt: promptOf(row.problemVersionId) } });
    for (const row of recipients) {
      if (row.assignment.issuedAt) events.push({ at: row.assignment.issuedAt, learner: false, event: { kind: 'assignment', at: '', phase: 'given', title: row.assignment.title } });
      for (const submission of row.submissions) if (submission.finalizedAt) events.push({ at: submission.finalizedAt, learner: true, event: { kind: 'assignment', at: '', phase: 'submitted', title: row.assignment.title } });
    }
    for (const row of diagnostics) {
      events.push({ at: row.createdAt, learner: true, event: { kind: 'diagnostic', at: '', phase: 'start' } });
      if (row.completedAt) events.push({ at: row.completedAt, learner: true, event: { kind: 'diagnostic', at: '', phase: 'complete' } });
    }
    for (const row of feedback) events.push({ at: row.createdAt, learner: true, event: { kind: 'feedback', at: '',
      lessonTitle: feedbackTitles.find((version) => version.id === row.lessonVersionId)?.title ?? '수업', reason: row.reason, body: row.body, quote: row.quote } });
    for (const row of practice) events.push({ at: row.createdAt, learner: true, event: { kind: 'practice', at: '', scope: row.scope ?? '', status: row.status } });

    for (const item of events) item.event.at = item.at.toISOString();
    const sittings: Sitting[] = cutSittings(events).map((group) => {
      timed(group);
      const learnerActive = group.some((item) => item.learner && item.event.kind !== 'joined');
      return { startedAt: group[0].event.at, endedAt: group[group.length - 1].event.at, learnerActive, clients: clientsOf(group),
        notes: learnerActive ? notesOf(group, visitEvents, facts) : [], events: group.map((item) => item.event) };
    });
    return { learner: listing, sittings: sittings.reverse() };
  }
}
