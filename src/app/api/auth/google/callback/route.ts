import { authCookie, oauthCookieName, trustedAppOrigin } from '@/server/auth';
import { getDatabase } from '@/server/db';
import { GoogleLoginService, googleFailure, googleOAuthConfig, googleRedirect } from '@/server/google-auth';
import { recordVisit } from '@/server/learner-visits';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export async function GET(request: Request) {
  try {
    googleOAuthConfig();
    const login = await new GoogleLoginService().complete(request);
    await recordVisit(getDatabase(), { userId: login.user.id, sessionId: login.sessionId, kind: 'login', userAgent: request.headers.get('user-agent') });
    return googleRedirect(`${trustedAppOrigin()}/`, [login.cookie, authCookie(oauthCookieName(), '', 0)]);
  } catch (error) { return googleFailure(error); }
}
