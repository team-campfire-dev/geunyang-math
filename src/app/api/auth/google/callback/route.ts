import { authCookie, oauthCookieName, trustedAppOrigin } from '@/server/auth';
import { GoogleLoginService, googleFailure, googleOAuthConfig, googleRedirect } from '@/server/google-auth';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export async function GET(request: Request) {
  try {
    googleOAuthConfig();
    const login = await new GoogleLoginService().complete(request);
    return googleRedirect(`${trustedAppOrigin()}/`, [login.cookie, authCookie(oauthCookieName(), '', 0)]);
  } catch (error) { return googleFailure(error); }
}
