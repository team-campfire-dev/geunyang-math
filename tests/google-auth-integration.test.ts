import { randomUUID } from 'node:crypto';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { existingRows, removeRowsAddedSince, type Existing } from './cleanup';
import * as database from '@/server/db';
import { googleCookieName, hashSessionToken, sessionUser } from '@/server/auth';
import { GoogleLoginService, googleFailure } from '@/server/google-auth';
import { DELETE as logout } from '@/app/api/v1/session/route';

const testDatabaseUrl = process.env.TEST_DATABASE_URL;
const origin = 'https://math.example.com';
const cookiePair = (cookie: string) => cookie.split(';', 1)[0];
const request = (path: string, cookie?: string) => new Request(`${origin}${path}`, { headers: cookie ? { cookie } : {} });

describe.skipIf(!testDatabaseUrl)('MySQL Google login identity, one-use state, and session isolation', () => {
  let db: ReturnType<typeof database.createDatabase>;
  let existing: Existing;
  beforeAll(async () => {
    const parsed = new URL(testDatabaseUrl!);
    if (parsed.protocol !== 'mysql:' || !decodeURIComponent(parsed.pathname.slice(1)).endsWith('_test')) throw new Error('OAuth integration requires a MySQL database ending in _test.');
    db = database.createDatabase(testDatabaseUrl!);
    existing = await existingRows(db);
  });
  beforeEach(() => {
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv('APP_ORIGIN', origin);
    vi.stubEnv('GOOGLE_LOGIN_ENABLED', 'true');
    vi.stubEnv('GOOGLE_CLIENT_ID', 'fixture.apps.googleusercontent.com');
    vi.stubEnv('GOOGLE_CLIENT_SECRET', 'fixture-secret');
    vi.spyOn(database, 'getDatabase').mockImplementation(() => db);
  });
  afterEach(() => { vi.unstubAllEnvs(); vi.restoreAllMocks(); });
  afterAll(async () => {
    // A shared database keeps whatever a run leaves behind, so this run leaves nothing.
    if (existing) await removeRowsAddedSince(db, existing);
    await db?.$disconnect();
  });

  function service(subject = `test-${randomUUID()}`, displayName = `oauth ${randomUUID()}`) {
    const exchange = vi.fn(async () => ({ subject, displayName }));
    return { subject, displayName, exchange, login: new GoogleLoginService(db, exchange) };
  }
  async function begin(login: GoogleLoginService, existingCookie?: string) {
    const started = await login.start(request('/api/auth/google/start', existingCookie));
    const target = new URL(started.location);
    const state = target.searchParams.get('state')!;
    const cookie = cookiePair(started.cookie);
    const callback = (extra = 'code=fixture-code', sessionCookie?: string) => request(`/api/auth/google/callback?state=${state}&${extra}`, [cookie, sessionCookie].filter(Boolean).join('; '));
    return { started, target, state, cookie, callback };
  }

  it('uses a fixed callback, minimal scopes, S256 PKCE and browser-bound random state without provider tokens', async () => {
    const { login, exchange } = service();
    const { target, state, cookie } = await begin(login);
    expect(target.origin).toBe('https://accounts.google.com');
    expect(target.searchParams.get('redirect_uri')).toBe(`${origin}/api/auth/google/callback`);
    expect(target.searchParams.get('scope')).toBe('openid email profile');
    expect(target.searchParams.get('access_type')).toBe('online');
    expect(target.searchParams.get('code_challenge_method')).toBe('S256');
    const stored = await db.oAuthAttempt.findUniqueOrThrow({ where: { stateHash: hashSessionToken(state) } });
    expect(stored.browserHash).toBe(hashSessionToken(cookie.split('=')[1]));
    expect(stored.nonce).toBe(target.searchParams.get('nonce'));
    expect(stored.expiresAt.getTime() - Date.now()).toBeGreaterThan(590_000);
    expect(exchange).not.toHaveBeenCalled();
  });

  it('rejects forged state or a foreign browser without consuming the legitimate attempt', async () => {
    const { login, exchange } = service();
    const flow = await begin(login);
    await expect(login.complete(request(`/api/auth/google/callback?state=${flow.state}&code=x`))).rejects.toMatchObject({ code: 'expired' });
    await expect(login.complete(request(`/api/auth/google/callback?state=${'f'.repeat(64)}&code=x`, flow.cookie))).rejects.toMatchObject({ code: 'expired' });
    expect(exchange).not.toHaveBeenCalled();
    const result = await login.complete(flow.callback());
    expect(result.user.id).toBeTruthy();
    expect(exchange).toHaveBeenCalledTimes(1);
  });

  it('expires attempts and invalidates an earlier browser attempt when starting again', async () => {
    const { login, exchange } = service();
    const expired = await begin(login);
    await db.oAuthAttempt.update({ where: { stateHash: hashSessionToken(expired.state) }, data: { expiresAt: new Date(Date.now() - 1) } });
    await expect(login.complete(expired.callback())).rejects.toMatchObject({ code: 'expired' });
    const previous = await begin(login);
    await begin(login, previous.cookie);
    await expect(login.complete(previous.callback())).rejects.toMatchObject({ code: 'expired' });
    expect(exchange).not.toHaveBeenCalled();
  });

  it('consumes cancellation and malformed responses, and hides raw provider errors', async () => {
    const { login, exchange } = service();
    const cancelled = await begin(login);
    await expect(login.complete(cancelled.callback('error=access_denied'))).rejects.toMatchObject({ code: 'cancelled' });
    await expect(login.complete(cancelled.callback())).rejects.toMatchObject({ code: 'expired' });
    const malformed = await begin(login);
    await expect(login.complete(malformed.callback('code=a&code=b'))).rejects.toMatchObject({ code: 'failed' });
    await expect(login.complete(malformed.callback())).rejects.toMatchObject({ code: 'expired' });
    const provider = await begin(login);
    const error = await login.complete(provider.callback('error=private-provider-error&error_description=secret')).catch(error => error);
    expect(googleFailure(error).headers.get('location')).toBe(`${origin}/?authError=failed`);
    expect(exchange).not.toHaveBeenCalled();
  });

  it('does not issue a session or allow replay after a failed provider verification', async () => {
    const exchange = vi.fn(async () => { throw new Error('untrusted provider payload'); });
    const login = new GoogleLoginService(db, exchange);
    const flow = await begin(login);
    await expect(login.complete(flow.callback())).rejects.toThrow('untrusted provider payload');
    await expect(login.complete(flow.callback())).rejects.toMatchObject({ code: 'expired' });
    expect(exchange).toHaveBeenCalledTimes(1);
    expect(await db.oAuthAttempt.findUnique({ where: { stateHash: hashSessionToken(flow.state) } })).toBeNull();
  });

  it('allows exactly one concurrent callback to consume state and create a session', async () => {
    const { login, exchange, subject } = service();
    const flow = await begin(login);
    const results = await Promise.allSettled(Array.from({ length: 4 }, () => login.complete(flow.callback())));
    expect(results.filter(result => result.status === 'fulfilled')).toHaveLength(1);
    expect(results.filter(result => result.status === 'rejected')).toHaveLength(3);
    expect(exchange).toHaveBeenCalledTimes(1);
    const account = await db.googleIdentity.findUniqueOrThrow({ where: { subject } });
    expect(await db.session.count({ where: { userId: account.userId } })).toBe(1);
  });

  it('rolls back losing concurrent identity creation without orphaning users or personal scopes', async () => {
    const { login, subject, displayName } = service();
    const flows = await Promise.all(Array.from({ length: 4 }, () => begin(login)));
    const results = await Promise.all(flows.map(flow => login.complete(flow.callback())));
    const ids = new Set(results.map(result => result.user.id));
    expect(ids.size).toBe(1);
    const account = await db.googleIdentity.findUniqueOrThrow({ where: { subject } });
    expect(await db.user.count({ where: { displayName } })).toBe(1);
    expect(await db.scope.count({ where: { ownerUserId: account.userId, kind: 'personal' } })).toBe(1);
    expect(await db.session.count({ where: { userId: account.userId, authMethod: 'google' } })).toBe(4);
  });

  it('matches subjects case-sensitively and never attaches an unrelated development account', async () => {
    const name = `same name ${randomUUID()}`;
    const development = await db.user.create({ data: { displayName: name, scopes: { create: { kind: 'personal' } } } });
    const upper = service(`CASE-${randomUUID()}`, name);
    const lower = service(upper.subject.toLowerCase(), name);
    const first = await upper.login.complete((await begin(upper.login)).callback());
    const second = await lower.login.complete((await begin(lower.login)).callback());
    expect(new Set([development.id, first.user.id, second.user.id]).size).toBe(3);
  });

  it('reuses the Google identity and learning profile, rotates the browser session, and revokes logout', async () => {
    const { login } = service();
    const first = await login.complete((await begin(login)).callback());
    const oldCookie = cookiePair(first.cookie);
    await db.user.update({ where: { id: first.user.id }, data: { dailyMinutes: 20 } });
    const nextFlow = await begin(login);
    const next = await login.complete(nextFlow.callback('code=relogin-code', oldCookie));
    expect(next.user.id).toBe(first.user.id);
    expect(next.user.dailyMinutes).toBe(20);
    expect(next.cookie).not.toBe(first.cookie);
    expect(await sessionUser(request('/api/v1/session', oldCookie))).toBeNull();
    const newCookie = cookiePair(next.cookie);
    expect((await sessionUser(request('/api/v1/session', newCookie)))?.id).toBe(first.user.id);
    const stored = await db.session.findUniqueOrThrow({ where: { tokenHash: hashSessionToken(newCookie.split('=')[1]) } });
    expect(stored.expiresAt.getTime() - Date.now()).toBeGreaterThan(7 * 86400000 - 10_000);
    const denied = await logout(new Request(`${origin}/api/v1/session`, { method: 'DELETE', headers: { cookie: newCookie, origin: 'https://attacker.example.com' } }));
    expect(denied.status).toBe(403);
    expect(await sessionUser(request('/api/v1/session', newCookie))).not.toBeNull();
    const response = await logout(new Request(`${origin}/api/v1/session`, { method: 'DELETE', headers: { cookie: newCookie, origin } }));
    expect(response.status).toBe(200);
    expect(response.headers.getSetCookie()).toContain('__Host-gm_session=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0; Secure');
    expect(await sessionUser(request('/api/v1/session', newCookie))).toBeNull();
  });

  it('rejects legacy development sessions even when copied into the production cookie, and rejects expiry', async () => {
    const token = randomUUID().replaceAll('-', '').repeat(2);
    await db.user.create({ data: { displayName: 'legacy auth fixture', sessions: { create: { tokenHash: hashSessionToken(token), expiresAt: new Date(Date.now() + 60000) } } } });
    expect(await sessionUser(request('/api/v1/session', `gm_session=${token}`))).toBeNull();
    expect(await sessionUser(request('/api/v1/session', `${googleCookieName()}=${token}`))).toBeNull();
    await db.session.update({ where: { tokenHash: hashSessionToken(token) }, data: { authMethod: 'google', expiresAt: new Date(Date.now() - 1) } });
    expect(await sessionUser(request('/api/v1/session', `${googleCookieName()}=${token}`))).toBeNull();
  });
});
