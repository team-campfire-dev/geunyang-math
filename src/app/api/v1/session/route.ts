import { assertSameOrigin, developmentLoginEnabled, revokeSession, sessionUser } from '@/server/auth';
import { handle, json } from '@/server/http';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export function GET(request: Request) {
  return handle(async () => {
    const user = await sessionUser(request);
    return json({ user: user ? { id: user.id, displayName: user.displayName } : null, developmentLogin: developmentLoginEnabled(request) });
  });
}
export function DELETE(request: Request) {
  return handle(async () => { assertSameOrigin(request); return json({ user: null }, 200, { 'Set-Cookie': await revokeSession(request) }); });
}
