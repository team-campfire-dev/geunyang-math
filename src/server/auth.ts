import 'server-only';
import { createHash, randomBytes } from 'node:crypto';
import { getDatabase } from './db';
import { AppError } from './errors';

const cookieName = 'gm_session';
export const hashSessionToken = (token: string) => createHash('sha256').update(token).digest('hex');
export function readSessionToken(request: Request) {
  // Future native bearer authentication plugs into this resolver with revocable sessions.
  const entry = request.headers.get('cookie')?.split(';').map(x => x.trim()).find(x => x.startsWith(`${cookieName}=`));
  return entry?.slice(cookieName.length + 1) ?? null;
}
export async function sessionUser(request: Request) {
  // This milestone issues development sessions only. Never accept them after a
  // deployment or environment switch; production OAuth needs its own issuer.
  if (!developmentLoginEnabled(request)) return null;
  const token = readSessionToken(request);
  if (!token || !/^[a-f0-9]{64}$/.test(token)) return null;
  const session = await getDatabase().session.findUnique({ where: { tokenHash: hashSessionToken(token) }, include: { user: true } });
  return session && session.expiresAt > new Date() ? session.user : null;
}
export async function requireUser(request: Request) {
  const user = await sessionUser(request);
  if (!user) throw new AppError(401, 'unauthenticated', '학습을 저장하려면 먼저 로그인해 주세요.');
  return user;
}
export function assertSameOrigin(request: Request) {
  const expected = process.env.APP_ORIGIN || new URL(request.url).origin;
  if (request.headers.get('origin') !== expected) throw new AppError(403, 'origin_denied', '허용되지 않은 요청입니다.');
}
export function developmentLoginEnabled(request: Request) {
  return process.env.NODE_ENV === 'development' && process.env.DEV_LOGIN_ENABLED === 'true'
    && ['127.0.0.1', 'localhost', '[::1]'].includes(new URL(request.url).hostname);
}
export async function createDevelopmentSession(displayName: string) {
  const db = getDatabase();
  const token = randomBytes(32).toString('hex');
  const user = await db.user.create({ data: {
    displayName, scopes: { create: { kind: 'personal' } },
    sessions: { create: { tokenHash: hashSessionToken(token), expiresAt: new Date(Date.now() + 7 * 86400000) } },
  } });
  return { user, cookie: `${cookieName}=${token}; HttpOnly; SameSite=Lax; Path=/; Max-Age=604800` };
}
export async function revokeSession(request: Request) {
  const token = readSessionToken(request);
  if (token) await getDatabase().session.deleteMany({ where: { tokenHash: hashSessionToken(token) } });
  return `${cookieName}=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0`;
}
