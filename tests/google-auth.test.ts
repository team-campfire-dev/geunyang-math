import { generateKeyPairSync, sign } from 'node:crypto';
import { OAuth2Client } from 'google-auth-library';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { assertSameOrigin, authCookie, googleLoginEnabled, readCookie, trustedAppOrigin } from '@/server/auth';
import { createGoogleClient, googleFailure, googleOAuthConfig, verifyGoogleIdentityToken } from '@/server/google-auth';

const clientId = 'fixture.apps.googleusercontent.com';
const nonce = 'a'.repeat(64);
const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
const certificate = publicKey.export({ type: 'spki', format: 'pem' }).toString();
const encode = (value: unknown) => Buffer.from(JSON.stringify(value)).toString('base64url');
function token(overrides: Record<string, unknown> = {}) {
  const now = Math.floor(Date.now() / 1000);
  const data = `${encode({ alg: 'RS256', kid: 'fixture' })}.${encode({ iss: 'https://accounts.google.com', aud: clientId,
    sub: 'GoogleSubject123', iat: now - 10, exp: now + 600, nonce, email_verified: true, name: '수학 학습자', ...overrides })}`;
  return `${data}.${sign('RSA-SHA256', Buffer.from(data), privateKey).toString('base64url')}`;
}
function verifier() {
  const client = new OAuth2Client();
  vi.spyOn(client, 'getFederatedSignonCertsAsync').mockResolvedValue({ certs: { fixture: certificate }, format: 'PEM' } as Awaited<ReturnType<OAuth2Client['getFederatedSignonCertsAsync']>>);
  return client;
}
function production() {
  vi.stubEnv('NODE_ENV', 'production');
  vi.stubEnv('APP_ORIGIN', 'https://math.example.com');
  vi.stubEnv('GOOGLE_LOGIN_ENABLED', 'true');
  vi.stubEnv('GOOGLE_CLIENT_ID', clientId);
  vi.stubEnv('GOOGLE_CLIENT_SECRET', 'fixture-secret');
}
afterEach(() => { vi.unstubAllEnvs(); vi.restoreAllMocks(); });

describe('Google ID token trust boundary', () => {
  it('runs the official signature verifier before extracting only a stable identity and name', async () => {
    await expect(verifyGoogleIdentityToken(token(), nonce, clientId, verifier())).resolves.toEqual({ subject: 'GoogleSubject123', displayName: '수학 학습자' });
  });
  it('rejects a forged signature using the official verifier', async () => {
    const valid = token();
    const forged = `${valid.slice(0, valid.lastIndexOf('.') + 1)}${Buffer.alloc(256).toString('base64url')}`;
    await expect(verifyGoogleIdentityToken(forged, nonce, clientId, verifier())).rejects.toThrow();
  });
  it.each([
    ['wrong audience', { aud: 'attacker.apps.googleusercontent.com' }],
    ['wrong issuer', { iss: 'https://attacker.example.com' }],
    ['expired even within library clock skew', { exp: Math.floor(Date.now() / 1000) - 1 }],
    ['future issued token', { iat: Math.floor(Date.now() / 1000) + 3600 }],
    ['missing nonce', { nonce: undefined }],
    ['wrong nonce', { nonce: 'b'.repeat(64) }],
    ['non-ASCII nonce', { nonce: '한'.repeat(64) }],
    ['wrong authorized party', { azp: 'attacker.apps.googleusercontent.com' }],
    ['unverified email', { email_verified: false }],
    ['string verified email', { email_verified: 'true' }],
    ['missing subject', { sub: undefined }],
    ['non-ASCII subject', { sub: '한글' }],
  ])('rejects %s', async (_description, claims) => {
    await expect(verifyGoogleIdentityToken(token(claims), nonce, clientId, verifier())).rejects.toThrow();
  });
});

describe('OAuth configuration and browser boundaries', () => {
  beforeEach(production);
  it('requires explicit enabling, credentials, and a trusted HTTPS origin', () => {
    expect(googleLoginEnabled()).toBe(true);
    for (const origin of ['http://math.example.com', 'https://user:pass@math.example.com', 'https://math.example.com/path', 'https://math.example.com?next=evil', 'https://math.example.com#fragment']) {
      vi.stubEnv('APP_ORIGIN', origin);
      expect(googleLoginEnabled()).toBe(false);
    }
    vi.stubEnv('APP_ORIGIN', 'https://math.example.com');
    vi.stubEnv('GOOGLE_LOGIN_ENABLED', 'false');
    expect(googleLoginEnabled()).toBe(false);
    vi.stubEnv('GOOGLE_LOGIN_ENABLED', 'true');
    vi.stubEnv('GOOGLE_CLIENT_SECRET', '');
    expect(googleLoginEnabled()).toBe(false);
  });
  it('permits only loopback origins outside production', () => {
    vi.stubEnv('NODE_ENV', 'development');
    expect(trustedAppOrigin()).toBeNull();
    vi.stubEnv('APP_ORIGIN', 'http://127.0.0.1:3017');
    expect(trustedAppOrigin()).toBe('http://127.0.0.1:3017');
  });
  it('creates host-only secure cookies and rejects cookie shadowing', () => {
    const cookie = authCookie('__Host-gm_session', nonce, 604800);
    expect(cookie).toContain('Secure'); expect(cookie).toContain('HttpOnly'); expect(cookie).toContain('SameSite=Lax');
    expect(cookie).not.toContain('Domain=');
    expect(readCookie(new Request('https://math.example.com', { headers: { cookie: `__Host-gm_session=${nonce}; __Host-gm_session=${nonce}` } }), '__Host-gm_session')).toBeNull();
  });
  it('rejects logout CSRF and ignores request host headers when choosing the expected origin', () => {
    for (const origin of ['', 'https://attacker.example.com']) expect(() => assertSameOrigin(new Request('https://attacker.example.com', { headers: { origin } }))).toThrow();
    expect(() => assertSameOrigin(new Request('http://internal:3000', { headers: { origin: 'https://math.example.com' } }))).not.toThrow();
  });
  it('returns fixed safe errors without reflecting OAuth data or an attacker URL', () => {
    const response = googleFailure(new Error('access_token=secret&next=https://attacker.example.com'));
    expect(response.headers.get('location')).toBe('https://math.example.com/?authError=failed');
    expect(response.headers.get('cache-control')).toBe('no-store');
    vi.stubEnv('APP_ORIGIN', 'bad');
    expect(googleFailure(new Error('secret')).status).toBe(503);
  });
  it('never retries a failed authorization code exchange', async () => {
    const client = createGoogleClient(googleOAuthConfig());
    const fetch = vi.fn(async () => { throw new Error('Fixture network failure'); });
    client.transporter.defaults.fetchImplementation = fetch;
    await expect(client.getToken({ code: 'one-use-code', codeVerifier: 'private-verifier' })).rejects.toThrow();
    expect(fetch).toHaveBeenCalledTimes(1);
  });
  it('bounds official Google network requests and sends the PKCE verifier only to the token endpoint', async () => {
    const client = createGoogleClient(googleOAuthConfig());
    let captured: Record<string, unknown> | undefined;
    client.transporter.interceptors.request.add({ resolved: options => { captured = options as unknown as Record<string, unknown>; throw new Error('Stop before network'); } });
    await expect(client.getToken({ code: 'one-use-code', codeVerifier: 'private-verifier' })).rejects.toThrow('Stop before network');
    expect(String(captured?.url)).toBe('https://oauth2.googleapis.com/token');
    expect(captured).toMatchObject({ timeout: 10_000, retry: false, retryConfig: { retry: 0 }, redirect: 'error' });
    expect(captured?.signal).toBeInstanceOf(AbortSignal);
    expect((captured?.data as URLSearchParams).get('code_verifier')).toBe('private-verifier');
  });
});
