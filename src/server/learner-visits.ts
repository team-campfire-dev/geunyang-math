import 'server-only';
import type { PrismaClient } from '@prisma/client';
import type { ClientKind, VisitKind } from '@/shared/learner-sessions';

/**
 * What a browser is, as coarsely as an operator needs to read a sitting back: the kind of device,
 * its system, the browser, and above all whether it is an app's own browser — Instagram's, KakaoTalk's
 * — which is where a login quietly stops and a page keeps opening from the top.
 *
 * Only these kinds are kept. The browser's own string names a phone's model and build, which says
 * more about a person than reading their sitting needs, so it is read here and dropped.
 */
export function clientKind(userAgent: string | null): ClientKind {
  const ua = userAgent ?? '';
  if (!ua) return { device: 'unknown', os: 'other', browser: 'other', inApp: null };
  const os: ClientKind['os'] = /Android/.test(ua) ? 'android'
    : /iPhone|iPad|iPod/.test(ua) ? 'ios'
    : /Windows/.test(ua) ? 'windows'
    : /Mac OS X|Macintosh/.test(ua) ? 'macos'
    : /Linux|CrOS/.test(ua) ? 'linux' : 'other';
  const device: ClientKind['device'] = /iPad|Tablet/.test(ua) || (os === 'android' && !/Mobile/.test(ua)) ? 'tablet'
    : /iPhone|iPod|Mobile/.test(ua) ? 'phone' : 'desktop';
  const inApp: ClientKind['inApp'] = /Instagram/.test(ua) ? 'instagram'
    : /KAKAOTALK/i.test(ua) ? 'kakaotalk'
    : /FBAN|FBAV|FB_IAB/.test(ua) ? 'facebook'
    : /NAVER\(inapp|NAVER/.test(ua) ? 'naver'
    : /\bLine\//.test(ua) ? 'line'
    // Android marks a page shown inside an app with `wv`; iOS has no such mark, so one there goes unnamed.
    : /; wv\)/.test(ua) ? 'webview' : null;
  const browser: ClientKind['browser'] = /SamsungBrowser/.test(ua) ? 'samsung'
    : /Whale/.test(ua) ? 'whale'
    : /Edg(A|iOS)?\//.test(ua) ? 'edge'
    : /Firefox|FxiOS/.test(ua) ? 'firefox'
    : /CriOS|Chrome/.test(ua) ? 'chrome'
    : /Safari/.test(ua) ? 'safari' : 'other';
  return { device, os, browser, inApp };
}

const visitEcho = 2000;

/**
 * Notes that a learner came, and in what. A visit is what an operator reads afterwards, never what
 * the page needs now, so failing to write one is said in the log and goes no further: nobody is kept
 * from their lesson because this could not be written.
 */
export async function recordVisit(db: PrismaClient, visit: { userId: string; sessionId: string | null; kind: VisitKind; userAgent: string | null }) {
  try {
    // One page load can ask twice — React mounts twice in development, a browser may send it again —
    // and a page opened twice in the same breath was opened once.
    const echo = await db.learnerVisit.findFirst({ where: { userId: visit.userId, sessionId: visit.sessionId, kind: visit.kind,
      createdAt: { gte: new Date(Date.now() - visitEcho) } }, select: { id: true } });
    if (echo) return;
    await db.learnerVisit.create({ data: { userId: visit.userId, sessionId: visit.sessionId, kind: visit.kind, ...clientKind(visit.userAgent) } });
  } catch (error) {
    console.warn(JSON.stringify({ event: 'visit_not_recorded', kind: visit.kind, message: error instanceof Error ? error.message : String(error) }));
  }
}
