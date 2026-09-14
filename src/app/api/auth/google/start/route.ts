import { GoogleLoginService, googleFailure, googleOAuthConfig, googleRedirect } from '@/server/google-auth';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export async function GET(request: Request) {
  try {
    googleOAuthConfig();
    const login = await new GoogleLoginService().start(request);
    return googleRedirect(login.location, [login.cookie]);
  } catch (error) { return googleFailure(error); }
}
