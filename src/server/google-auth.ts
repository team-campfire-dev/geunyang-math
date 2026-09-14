import 'server-only';
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { Prisma, type PrismaClient } from '@prisma/client';
import { OAuth2Client } from 'google-auth-library';
import { authCookie, googleCookieName, googleLoginEnabled, hashSessionToken, oauthCookieName, readCookie, trustedAppOrigin, validToken } from './auth';
import { getDatabase } from './db';

const attemptLifetimeMs = 10 * 60 * 1000;
const sessionLifetimeMs = 7 * 86400000;
export type GoogleIdentityClaims = { subject: string; displayName: string };
export type GoogleLoginError = 'cancelled' | 'expired' | 'unavailable' | 'failed';
class LoginError extends Error {
  constructor(readonly code: GoogleLoginError) { super(code); }
}
export function googleOAuthConfig() {
  if (!googleLoginEnabled()) throw new LoginError('unavailable');
  const origin = trustedAppOrigin()!;
  return { origin, clientId: process.env.GOOGLE_CLIENT_ID!, clientSecret: process.env.GOOGLE_CLIENT_SECRET!, redirectUri: `${origin}/api/auth/google/callback` };
}
export function createGoogleClient(config: ReturnType<typeof googleOAuthConfig>) {
  const client = new OAuth2Client({ clientId: config.clientId, clientSecret: config.clientSecret, redirectUri: config.redirectUri });
  // Bound both code exchange and signing-certificate requests, including retries/redirects.
  client.transporter.interceptors.request.add({ resolved: async options => {
    options.timeout = 10_000;
    // Gaxios prepares its fetch options before interceptors. Set the actual
    // AbortSignal/redirect policy here, not just the already-processed aliases.
    const deadline = AbortSignal.timeout(10_000);
    options.signal = options.signal ? AbortSignal.any([options.signal, deadline]) : deadline;
    options.retry = false;
    options.retryConfig = { retry: 0 };
    options.redirect = 'error';
    return options;
  } });
  return client;
}
export async function verifyGoogleIdentityToken(idToken: string, nonce: string, clientId: string, client: OAuth2Client): Promise<GoogleIdentityClaims> {
  const ticket = await client.verifyIdToken({ idToken, audience: clientId });
  const claims = ticket.getPayload();
  // verifyIdToken verifies Google signature, issuer, audience, and time. Nonce and
  // verified email are application requirements; enforce strict expiry as well.
  const claimNonce = (claims as (typeof claims & { nonce?: unknown }))?.nonce;
  if (!claims || !['https://accounts.google.com', 'accounts.google.com'].includes(claims.iss)
    || claims.aud !== clientId || (claims.azp !== undefined && claims.azp !== clientId)
    || typeof claims.exp !== 'number' || !Number.isFinite(claims.exp) || claims.exp <= Math.floor(Date.now() / 1000)
    || claims.email_verified !== true || typeof claims.sub !== 'string' || !/^[\x21-\x7e]{1,255}$/.test(claims.sub)
    || typeof claimNonce !== 'string' || !validToken(claimNonce) || !validToken(nonce)
    || !timingSafeEqual(Buffer.from(claimNonce), Buffer.from(nonce))) throw new LoginError('failed');
  const displayName = typeof claims.name === 'string' ? claims.name.trim().replace(/[\u0000-\u001f\u007f]/g, '').slice(0, 80) : '';
  return { subject: claims.sub, displayName: displayName || '학습자' };
}

/** DB-backed one-use requests and identity transactions also support multiple app instances. */
export class GoogleLoginService {
  constructor(private readonly db: PrismaClient = getDatabase(), private readonly exchange?: (code: string, verifier: string, nonce: string) => Promise<GoogleIdentityClaims>) {}

  async start(request: Request) {
    const config = googleOAuthConfig();
    const state = randomBytes(32).toString('hex');
    const browser = randomBytes(32).toString('hex');
    const codeVerifier = randomBytes(48).toString('base64url');
    const nonce = randomBytes(32).toString('hex');
    const previousBrowser = readCookie(request, oauthCookieName());
    await this.db.oAuthAttempt.deleteMany({ where: { OR: [
      { expiresAt: { lte: new Date() } },
      ...(validToken(previousBrowser) ? [{ browserHash: hashSessionToken(previousBrowser) }] : []),
    ] } });
    await this.db.oAuthAttempt.create({ data: {
      stateHash: hashSessionToken(state), browserHash: hashSessionToken(browser), codeVerifier, nonce,
      expiresAt: new Date(Date.now() + attemptLifetimeMs),
    } });
    const target = new URL('https://accounts.google.com/o/oauth2/v2/auth');
    target.search = new URLSearchParams({ client_id: config.clientId, redirect_uri: config.redirectUri,
      response_type: 'code', scope: 'openid email profile', state, nonce,
      code_challenge: createHash('sha256').update(codeVerifier).digest('base64url'), code_challenge_method: 'S256',
      access_type: 'online', prompt: 'select_account',
    }).toString();
    return { location: target.toString(), cookie: authCookie(oauthCookieName(), browser, attemptLifetimeMs / 1000) };
  }

  async complete(request: Request) {
    const config = googleOAuthConfig();
    const params = new URL(request.url).searchParams;
    const state = params.get('state');
    const browser = readCookie(request, oauthCookieName());
    if (!validToken(state) || !validToken(browser) || params.getAll('state').length !== 1) throw new LoginError('expired');
    const key = { stateHash: hashSessionToken(state), browserHash: hashSessionToken(browser), expiresAt: { gt: new Date() } };
    const attempt = await this.db.oAuthAttempt.findFirst({ where: key });
    if (!attempt) throw new LoginError('expired');
    // The conditional delete elects one callback before any network or account mutation.
    const consumed = await this.db.oAuthAttempt.deleteMany({ where: key });
    if (consumed.count !== 1) throw new LoginError('expired');
    if (params.has('error')) throw new LoginError(params.get('error') === 'access_denied' ? 'cancelled' : 'failed');
    const code = params.get('code');
    if (!code || code.length > 4096 || params.getAll('code').length !== 1) throw new LoginError('failed');
    let identity: GoogleIdentityClaims;
    if (this.exchange) identity = await this.exchange(code, attempt.codeVerifier, attempt.nonce);
    else {
      const client = createGoogleClient(config);
      const { tokens } = await client.getToken({ code, codeVerifier: attempt.codeVerifier, redirect_uri: config.redirectUri });
      if (!tokens.id_token) throw new LoginError('failed');
      identity = await verifyGoogleIdentityToken(tokens.id_token, attempt.nonce, config.clientId, client);
    }
    const previousToken = readCookie(request, googleCookieName());
    const token = randomBytes(32).toString('hex');
    // A unique subject owns exactly one User and personal Scope. A losing create
    // transaction rolls back all nested records before retrying the existing identity.
    for (let retry = 0; ; retry++) {
      try {
        const user = await this.db.$transaction(async tx => {
          let account = await tx.googleIdentity.findUnique({ where: { subject: identity.subject }, include: { user: true } });
          if (!account) account = await tx.googleIdentity.create({ data: { subject: identity.subject,
            user: { create: { displayName: identity.displayName, scopes: { create: { kind: 'personal' } } } },
          }, include: { user: true } });
          if (validToken(previousToken)) await tx.session.deleteMany({ where: { tokenHash: hashSessionToken(previousToken), authMethod: 'google' } });
          await tx.session.create({ data: { userId: account.userId, tokenHash: hashSessionToken(token), authMethod: 'google', expiresAt: new Date(Date.now() + sessionLifetimeMs) } });
          return account.user;
        });
        return { user, cookie: authCookie(googleCookieName(), token, sessionLifetimeMs / 1000) };
      } catch (error) {
        if (retry < 2 && error instanceof Prisma.PrismaClientKnownRequestError && ['P2002', 'P2034'].includes(error.code)) continue;
        throw error;
      }
    }
  }
}

export function googleRedirect(location: string, cookies: string[] = []) {
  const headers = new Headers({ Location: location, 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer' });
  for (const cookie of cookies) headers.append('Set-Cookie', cookie);
  return new Response(null, { status: 303, headers });
}
export function googleFailure(error: unknown) {
  const origin = trustedAppOrigin();
  if (!origin) return new Response('로그인을 사용할 수 없습니다.', { status: 503, headers: { 'Cache-Control': 'no-store' } });
  const code = error instanceof LoginError ? error.code : 'failed';
  // Never log OAuth codes, provider errors, ID tokens, or client secrets.
  return googleRedirect(`${origin}/?authError=${code}`, [authCookie(oauthCookieName(), '', 0)]);
}
