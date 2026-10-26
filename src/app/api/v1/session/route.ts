import { assertSameOrigin, currentSession, developmentLoginEnabled, googleLoginEnabled, revokeSession } from '@/server/auth';
import { getDatabase } from '@/server/db';
import { handle, json } from '@/server/http';
import { recordVisit } from '@/server/learner-visits';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
/** The learning screen says `?visit=open` as it loads and `?visit=return` as the browser brings it back; nothing else does. */
const visits = new Set(['open', 'return']);
export function GET(request: Request) {
  return handle(async () => {
    const session = await currentSession(request);
    const visit = new URL(request.url).searchParams.get('visit');
    if (session && visit && visits.has(visit)) {
      await recordVisit(getDatabase(), { userId: session.user.id, sessionId: session.id, kind: visit as 'open' | 'return', userAgent: request.headers.get('user-agent') });
    }
    const user = session?.user ?? null;
    return json({ user: user ? { id: user.id, displayName: user.displayName } : null, developmentLogin: developmentLoginEnabled(request), googleLogin: googleLoginEnabled() });
  });
}
export function DELETE(request: Request) {
  return handle(async () => {
    assertSameOrigin(request);
    const session = await currentSession(request);
    if (session) await recordVisit(getDatabase(), { userId: session.user.id, sessionId: session.id, kind: 'logout', userAgent: request.headers.get('user-agent') });
    return Response.json({ user: null }, { headers: await revokeSession(request) });
  });
}
