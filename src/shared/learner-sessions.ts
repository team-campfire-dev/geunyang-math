/**
 * A learner's sittings, read back for the operator: when they came, in what, and what they did from
 * one moment to the next — the reading that used to take a database query and the proxy's logs.
 * Only an operator reads it, because it names people and holds what they answered.
 */

export const visitKinds = ['login', 'open', 'return', 'logout'] as const;
export type VisitKind = typeof visitKinds[number];

export type ClientKind = {
  device: 'phone' | 'tablet' | 'desktop' | 'unknown';
  os: 'android' | 'ios' | 'windows' | 'macos' | 'linux' | 'other';
  browser: 'chrome' | 'safari' | 'samsung' | 'edge' | 'firefox' | 'whale' | 'other';
  inApp: 'instagram' | 'kakaotalk' | 'facebook' | 'naver' | 'line' | 'webview' | null;
};

const deviceNames: Record<ClientKind['device'], string> = { phone: '폰', tablet: '태블릿', desktop: '컴퓨터', unknown: '알 수 없는 기기' };
const osNames: Record<ClientKind['os'], string> = { android: '안드로이드', ios: 'iOS', windows: 'Windows', macos: 'macOS', linux: 'Linux', other: '' };
const browserNames: Record<ClientKind['browser'], string> = { chrome: 'Chrome', safari: 'Safari', samsung: '삼성 인터넷', edge: 'Edge', firefox: 'Firefox', whale: '웨일', other: '브라우저' };
export const inAppNames: Record<NonNullable<ClientKind['inApp']>, string> = {
  instagram: '인스타그램', kakaotalk: '카카오톡', facebook: '페이스북', naver: '네이버', line: '라인', webview: '어떤 앱',
};

/** A browser said the way an operator would: 「안드로이드 폰 · 인스타그램 앱 안 브라우저」. */
export function clientLabel(client: ClientKind) {
  const device = [osNames[client.os], deviceNames[client.device]].filter(Boolean).join(' ');
  return `${device} · ${client.inApp ? `${inAppNames[client.inApp]} 앱 안 브라우저` : browserNames[client.browser]}`;
}

/** One thing in a sitting, in the order it happened. Whatever is not the learner's own doing says who did it. */
export type SittingEvent =
  | { kind: 'joined'; at: string }
  | { kind: 'visit'; at: string; visit: VisitKind; client: ClientKind }
  /** A course somebody set for the learner — the operator or a teacher. Not the learner's doing. */
  | { kind: 'course'; at: string; courseTitle: string; by: string }
  | { kind: 'lesson'; at: string; phase: 'start' | 'complete'; lessonTitle: string; courseTitle: string }
  /** A step finished. `seconds` is since the step before it ended, or since the lesson started. */
  | { kind: 'section'; at: string; lessonTitle: string; sectionTitle: string; role: string; position: number; of: number; seconds: number | null }
  /** `seconds` is since the learner's previous doing in the same sitting; `attempt` counts tries at this question here. */
  | { kind: 'answer'; at: string; prompt: string; answer: string; status: 'correct' | 'incorrect' | 'invalid'; hint: boolean;
      where: string; attempt: number; seconds: number | null }
  | { kind: 'hint'; at: string; prompt: string }
  | { kind: 'assignment'; at: string; phase: 'given' | 'submitted'; title: string }
  | { kind: 'diagnostic'; at: string; phase: 'start' | 'complete' }
  | { kind: 'feedback'; at: string; lessonTitle: string; reason: string | null; body: string; quote: string | null }
  | { kind: 'practice'; at: string; scope: string; status: string };

/** What a sitting says about itself when read through, written as the operator would say it. */
export type SittingNote = { kind: 'in-app' | 'relogin' | 'skimmed' | 'reopened' | 'stopped' | 'struggled' | 'hints' | 'clean'; text: string };

export type Sitting = {
  startedAt: string; endedAt: string;
  /** Whether the learner did anything in it, or it only holds what somebody else did for them. */
  learnerActive: boolean;
  clients: ClientKind[];
  notes: SittingNote[];
  events: SittingEvent[];
};

export type LearnerListing = {
  userId: string; displayName: string; joinedAt: string;
  lastActiveAt: string | null;
  /** Sittings in the last thirty days. */
  recentSittings: number;
  lessonsCompleted: number; answers: number;
  /** What they came in last, when a visit has been kept. */
  lastClient: ClientKind | null;
};

export type LearnerSessionsList = { learners: LearnerListing[] };
export type LearnerSessionsDetail = { learner: LearnerListing; sittings: Sitting[] };
