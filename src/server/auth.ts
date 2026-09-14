import 'server-only';
import { createHash, randomBytes } from 'node:crypto';
import { getDatabase } from './db';
import { AppError } from './errors';

export const hashSessionToken = (token: string) => createHash('sha256').update(token).digest('hex');
export const validToken = (value: string | null): value is string => value !== null && /^[a-f0-9]{64}$/.test(value);
const loopback = (hostname: string) => ['127.0.0.1', 'localhost', '[::1]'].includes(hostname);

/** Canonical configured origin only: never trust a proxy Host or callback parameter. */
export function trustedAppOrigin(): string | null {
  try {
    const raw = process.env.APP_ORIGIN;
    if (!raw || raw !== raw.trim()) return null;
    const parsed = new URL(raw);
    if (parsed.username || parsed.password || parsed.search || parsed.hash || parsed.pathname !== '/') return null;
    if (process.env.NODE_ENV === 'production') {
      if (parsed.protocol !== 'https:') return null;
    } else if (!loopback(parsed.hostname) || !['http:', 'https:'].includes(parsed.protocol)) return null;
    return parsed.origin;
  } catch { return null; }
}
export function googleLoginEnabled() {
  return process.env.GOOGLE_LOGIN_ENABLED === 'true' && !!trustedAppOrigin()
    && /^[a-zA-Z0-9_-]+\.apps\.googleusercontent\.com$/.test(process.env.GOOGLE_CLIENT_ID || '')
    && !!process.env.GOOGLE_CLIENT_SECRET?.trim();
}
export function googleCookieName() {
  return process.env.NODE_ENV === 'production' ? '__Host-gm_session' : 'gm_google_session_local';
}
export function oauthCookieName() {
  return process.env.NODE_ENV === 'production' ? '__Host-gm_oauth' : 'gm_oauth_local';
}
export function authCookie(name: string, value: string, maxAge: number) {
  const secure = name.startsWith('__Host-') || process.env.NODE_ENV === 'production';
  return `${name}=${value}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${maxAge}${secure ? '; Secure' : ''}`;
}
export function readCookie(request: Request, name: string): string | null {
  const entries = request.headers.get('cookie')?.split(';').map(part => part.trim()).filter(part => part.startsWith(`${name}=`)) || [];
  // Duplicate values are ambiguous and may indicate a cookie shadowing attempt.
  return entries.length === 1 ? entries[0].slice(name.length + 1) : null;
}
export function readSessionToken(request: Request) {
  return readCookie(request, googleCookieName()) ?? (developmentLoginEnabled(request) ? readCookie(request, 'gm_session') : null);
}
export async function sessionUser(request: Request) {
  const googleToken = googleLoginEnabled() ? readCookie(request, googleCookieName()) : null;
  const developmentToken = developmentLoginEnabled(request) ? readCookie(request, 'gm_session') : null;
  const token = googleToken ?? developmentToken;
  if (!validToken(token)) return null;
  const session = await getDatabase().session.findUnique({ where: { tokenHash: hashSessionToken(token) }, include: { user: true } });
  const method = googleToken !== null ? 'google' : 'development';
  return session && session.authMethod === method && session.expiresAt > new Date() ? session.user : null;
}
export async function requireUser(request: Request) {
  const user = await sessionUser(request);
  if (!user) throw new AppError(401, 'unauthenticated', '학습을 저장하려면 먼저 로그인해 주세요.');
  return user;
}
export function assertSameOrigin(request: Request) {
  const expected = trustedAppOrigin() ?? (developmentLoginEnabled(request) ? new URL(request.url).origin : null);
  if (!expected || request.headers.get('origin') !== expected) throw new AppError(403, 'origin_denied', '허용되지 않은 요청입니다.');
}
export function developmentLoginEnabled(request: Request) {
  return process.env.NODE_ENV === 'development' && process.env.DEV_LOGIN_ENABLED === 'true'
    && loopback(new URL(request.url).hostname);
}
export async function createDevelopmentSession(displayName: string) {
  const token = randomBytes(32).toString('hex');
  const user = await getDatabase().user.create({ data: {
    displayName, scopes: { create: { kind: 'personal' } },
    sessions: { create: { tokenHash: hashSessionToken(token), authMethod: 'development', expiresAt: new Date(Date.now() + 7 * 86400000) } },
  } });
  return { user, cookie: authCookie('gm_session', token, 604800) };
}
export async function revokeSession(request: Request) {
  const names = ['__Host-gm_session', 'gm_google_session_local', 'gm_session'];
  const hashes = names.map(name => readCookie(request, name)).filter(validToken).map(hashSessionToken);
  if (hashes.length) await getDatabase().session.deleteMany({ where: { tokenHash: { in: hashes } } });
  const headers = new Headers({ 'Cache-Control': 'no-store' });
  for (const name of [...names, '__Host-gm_oauth', 'gm_oauth_local']) headers.append('Set-Cookie', authCookie(name, '', 0));
  const browser = readCookie(request, oauthCookieName());
  if (validToken(browser)) await getDatabase().oAuthAttempt.deleteMany({ where: { browserHash: hashSessionToken(browser) } });
  return headers;
}
