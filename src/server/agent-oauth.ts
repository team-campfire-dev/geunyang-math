import 'server-only';
import { createHash, randomBytes } from 'node:crypto';
import type { AgentClient, AgentKey, PrismaClient } from '@prisma/client';
import { hashSessionToken, trustedAppOrigin } from './auth';
import { authoringRole } from './authoring';
import { AppError } from './errors';
import { agentCodePattern } from '@/shared/agent';

/**
 * How a chat app — Claude, ChatGPT, Gemini — connects to lesson editing. They speak MCP and sign in
 * with OAuth, and none of them can be told to send a header of ours, so the code an author made is
 * not sent with each request: it is typed once, on our own page, when the app asks to connect, and
 * the app is given tokens that stand for that code from then on. Revoke the code and every
 * connection made with it goes too.
 *
 * Only the parts of OAuth these apps use are here: registering an app (RFC 7591), the authorization
 * code with PKCE S256, refreshing, and the two metadata documents an app reads to find all of that
 * (RFC 8414, RFC 9728). Every app is a public client — it holds no secret — so a code is only good
 * to the app that started it, at the address it named, with the verifier only it has.
 */

export const accessTokenPrefix = 'gma_';
const refreshTokenPrefix = 'gmr_';
const authorizationCodePrefix = 'gmc_';
const tokenPattern = (prefix: string) => new RegExp(`^${prefix}[a-f0-9]{64}$`);
const accessLifetimeMs = 60 * 60_000;
const codeLifetimeMs = 10 * 60_000;
export const agentScope = 'lessons';
const secret = (prefix: string) => `${prefix}${randomBytes(32).toString('hex')}`;

/** Where this service is, as the deployment names it. Never the Host a request claims. */
export function serviceOrigin(): string {
  const origin = trustedAppOrigin();
  if (!origin) throw new AppError(503, 'origin_unset', 'APP_ORIGIN이 설정되지 않아 연결을 받을 수 없어요.');
  return origin;
}
export const mcpResource = (origin: string) => `${origin}/api/mcp`;

/** RFC 9728: what the MCP endpoint is and who signs for it. */
export const protectedResourceMetadata = (origin: string) => ({
  resource: mcpResource(origin),
  authorization_servers: [origin],
  bearer_methods_supported: ['header'],
  scopes_supported: [agentScope],
  resource_name: '그냥수학 수업 편집',
});

/** RFC 8414: where an app registers, sends the author to, and fetches its tokens. */
export const authorizationServerMetadata = (origin: string) => ({
  issuer: origin,
  authorization_endpoint: `${origin}/oauth/authorize`,
  token_endpoint: `${origin}/api/oauth/token`,
  registration_endpoint: `${origin}/api/oauth/register`,
  response_types_supported: ['code'],
  response_modes_supported: ['query'],
  grant_types_supported: ['authorization_code', 'refresh_token'],
  code_challenge_methods_supported: ['S256'],
  token_endpoint_auth_methods_supported: ['none'],
  scopes_supported: [agentScope],
  authorization_response_iss_parameter_supported: true,
});

/** An OAuth refusal, in the shape the specifications give it rather than this service's own. */
export class OAuthError extends Error {
  constructor(public status: number, public error: string, public description: string) { super(description); }
  body() { return { error: this.error, error_description: this.description }; }
}

const loopback = (hostname: string) => ['127.0.0.1', 'localhost', '[::1]'].includes(hostname);
/** An address an authorization may be sent back to: secure, or on the app's own machine. */
function redirectUriAllowed(value: unknown): value is string {
  if (typeof value !== 'string' || value.length > 2000) return false;
  try {
    const url = new URL(value);
    if (url.hash || url.username || url.password) return false;
    return url.protocol === 'https:' || (url.protocol === 'http:' && loopback(url.hostname));
  } catch { return false; }
}

const clientLimits = { maxRedirects: 10, maxName: 200, unusedForMs: 86_400_000 };

/**
 * RFC 7591. Anyone may register, which is the point: an app announces itself and the addresses it
 * will be answered at, and nothing is granted until someone with a code says yes. Registrations no
 * connection ever came of are cleared after a day, so registering does not grow the table forever.
 */
export async function registerClient(db: PrismaClient, input: unknown) {
  const metadata = (input && typeof input === 'object' ? input : {}) as Record<string, unknown>;
  const uris = metadata.redirect_uris;
  if (!Array.isArray(uris) || !uris.length || uris.length > clientLimits.maxRedirects || !uris.every(redirectUriAllowed)) {
    throw new OAuthError(400, 'invalid_redirect_uri', 'redirect_uris must list 1 to 10 https addresses (http only for localhost), without fragments.');
  }
  const grantTypes = metadata.grant_types;
  if (grantTypes !== undefined && (!Array.isArray(grantTypes) || !grantTypes.includes('authorization_code'))) {
    throw new OAuthError(400, 'invalid_client_metadata', 'Only the authorization_code grant (with refresh_token) is offered.');
  }
  const name = typeof metadata.client_name === 'string' && metadata.client_name.trim()
    ? metadata.client_name.trim().slice(0, clientLimits.maxName) : new URL(uris[0] as string).host;
  await db.agentClient.deleteMany({ where: { createdAt: { lt: new Date(Date.now() - clientLimits.unusedForMs) }, grants: { none: {} } } });
  const clientId = `gmapp_${randomBytes(16).toString('hex')}`;
  const client = await db.agentClient.create({ data: { clientId, name, redirectUris: uris } });
  return {
    client_id: client.clientId, client_id_issued_at: Math.floor(client.createdAt.getTime() / 1000),
    client_name: client.name, redirect_uris: uris,
    grant_types: ['authorization_code', 'refresh_token'], response_types: ['code'], token_endpoint_auth_method: 'none',
  };
}

export type AuthorizationRequest = {
  client: AgentClient; redirectUri: string; codeChallenge: string; state: string | null; resource: string;
};

/**
 * Reads an authorization request. What cannot be trusted to send an answer back — an app nobody
 * registered, an address it did not register — is refused on our own page (`show`); anything else
 * wrong is told to the app at its address (`redirect`), as RFC 6749 §4.1.2.1 asks.
 */
export async function readAuthorization(db: PrismaClient, params: URLSearchParams, origin: string):
  Promise<{ ok: AuthorizationRequest } | { show: string } | { redirect: string }> {
  const clientId = params.get('client_id');
  const client = clientId ? await db.agentClient.findUnique({ where: { clientId } }) : null;
  if (!client) return { show: '등록되지 않은 앱이에요. 채팅 앱에서 연결을 처음부터 다시 시작해 주세요.' };
  const registered = client.redirectUris as string[];
  const asked = params.get('redirect_uri');
  // With one address registered it may be left out; with more, the app must say which.
  const redirectUri = asked ?? (registered.length === 1 ? registered[0] : null);
  if (!redirectUri || !registered.includes(redirectUri)) return { show: '이 앱이 등록한 주소가 아니에요. 채팅 앱에서 연결을 처음부터 다시 시작해 주세요.' };
  const state = params.get('state');
  const refuse = (error: string, description: string) => ({ redirect: answerUrl(redirectUri, { error, error_description: description, state }, origin) });
  if (params.get('response_type') !== 'code') return refuse('unsupported_response_type', 'Only response_type=code is offered.');
  const codeChallenge = params.get('code_challenge');
  if (!codeChallenge || params.get('code_challenge_method') !== 'S256' || !/^[A-Za-z0-9_-]{43,128}$/.test(codeChallenge)) {
    return refuse('invalid_request', 'PKCE with code_challenge_method=S256 is required.');
  }
  const scope = params.get('scope');
  if (scope && !scope.split(' ').every((part) => part === agentScope || part === '')) return refuse('invalid_scope', `The only scope is ${agentScope}.`);
  const resource = params.get('resource') ?? mcpResource(origin);
  if (!resourceMatches(resource, origin)) return refuse('invalid_target', `The resource is ${mcpResource(origin)}.`);
  return { ok: { client, redirectUri, codeChallenge, state, resource: mcpResource(origin) } };
}

/** The MCP endpoint, however an app spells it: some name the endpoint, some the service. */
function resourceMatches(resource: string, origin: string) {
  const trimmed = resource.replace(/\/+$/, '');
  return trimmed === mcpResource(origin) || trimmed === origin;
}

export function answerUrl(redirectUri: string, values: Record<string, string | null>, origin: string) {
  const url = new URL(redirectUri);
  for (const [name, value] of Object.entries({ ...values, iss: origin })) if (value !== null) url.searchParams.set(name, value);
  return url.toString();
}

/** The key behind a code typed on the connect page, if it is one that still works. */
export async function keyOfCode(db: PrismaClient, code: string): Promise<AgentKey | null> {
  const trimmed = code.trim();
  if (!agentCodePattern.test(trimmed)) return null;
  const key = await db.agentKey.findUnique({ where: { tokenHash: hashSessionToken(trimmed) } });
  if (!key || key.expiresAt <= new Date()) return null;
  return (await authoringRole(db, key.userId)) ? key : null;
}

/** The author said yes: a one-time code for the app, good for ten minutes. */
export async function approve(db: PrismaClient, request: AuthorizationRequest, key: AgentKey, origin: string) {
  // Codes nobody came back for are of no use to anyone.
  await db.agentGrant.deleteMany({ where: { accessHash: null, codeExpiresAt: { lt: new Date() } } });
  const code = secret(authorizationCodePrefix);
  await db.agentGrant.create({ data: {
    keyId: key.id, clientId: request.client.id, resource: request.resource, codeHash: hashSessionToken(code),
    codeChallenge: request.codeChallenge, redirectUri: request.redirectUri, codeExpiresAt: new Date(Date.now() + codeLifetimeMs),
  } });
  return answerUrl(request.redirectUri, { code, state: request.state }, origin);
}

const challengeOf = (verifier: string) => createHash('sha256').update(verifier).digest('base64url');

async function issueTokens(db: PrismaClient, grantId: string, key: AgentKey) {
  const access = secret(accessTokenPrefix);
  const refresh = secret(refreshTokenPrefix);
  // An access token never outlives the code it stands for.
  const accessExpiresAt = new Date(Math.min(Date.now() + accessLifetimeMs, key.expiresAt.getTime()));
  await db.agentGrant.update({ where: { id: grantId }, data: {
    accessHash: hashSessionToken(access), accessExpiresAt, refreshHash: hashSessionToken(refresh),
  } });
  return {
    access_token: access, token_type: 'Bearer', expires_in: Math.max(1, Math.floor((accessExpiresAt.getTime() - Date.now()) / 1000)),
    refresh_token: refresh, scope: agentScope,
  };
}

/** The token endpoint: an authorization code for tokens, or a refresh token for new ones. */
export async function exchange(db: PrismaClient, form: URLSearchParams) {
  const grantType = form.get('grant_type');
  const clientId = form.get('client_id');
  const invalid = (description: string) => new OAuthError(400, 'invalid_grant', description);
  const resource = form.get('resource');
  if (resource !== null && !resourceMatches(resource, serviceOrigin())) throw new OAuthError(400, 'invalid_target', `The resource is ${mcpResource(serviceOrigin())}.`);
  if (grantType === 'authorization_code') {
    const code = form.get('code') ?? '';
    const verifier = form.get('code_verifier') ?? '';
    if (!tokenPattern(authorizationCodePrefix).test(code)) throw invalid('The authorization code is not one this server issued.');
    if (!/^[A-Za-z0-9._~-]{43,128}$/.test(verifier)) throw new OAuthError(400, 'invalid_request', 'code_verifier is required.');
    const grant = await db.agentGrant.findUnique({ where: { codeHash: hashSessionToken(code) }, include: { client: true, key: true } });
    if (!grant || !grant.codeExpiresAt || grant.codeExpiresAt <= new Date()) throw invalid('The authorization code has expired or was already used.');
    if (clientId && grant.client.clientId !== clientId) throw invalid('The authorization code was issued to another client.');
    const redirectUri = form.get('redirect_uri');
    if (redirectUri !== null && redirectUri !== grant.redirectUri) throw invalid('redirect_uri does not match the authorization request.');
    if (challengeOf(verifier) !== grant.codeChallenge) throw invalid('code_verifier does not match the code_challenge.');
    // Spent the moment it is exchanged, by whichever request gets there first.
    const spent = await db.agentGrant.updateMany({ where: { id: grant.id, codeHash: grant.codeHash }, data: { codeHash: null, codeChallenge: null, codeExpiresAt: null } });
    if (spent.count !== 1) throw invalid('The authorization code was already used.');
    if (grant.key.expiresAt <= new Date()) throw invalid('The code this connection was made with has expired.');
    return issueTokens(db, grant.id, grant.key);
  }
  if (grantType === 'refresh_token') {
    const refresh = form.get('refresh_token') ?? '';
    if (!tokenPattern(refreshTokenPrefix).test(refresh)) throw invalid('The refresh token is not one this server issued.');
    const grant = await db.agentGrant.findUnique({ where: { refreshHash: hashSessionToken(refresh) }, include: { client: true, key: true } });
    if (!grant) throw invalid('The refresh token has been replaced or revoked.');
    if (clientId && grant.client.clientId !== clientId) throw invalid('The refresh token was issued to another client.');
    if (grant.key.expiresAt <= new Date()) throw invalid('The code this connection was made with has expired. Connect again with a new code.');
    return issueTokens(db, grant.id, grant.key);
  }
  throw new OAuthError(400, 'unsupported_grant_type', 'Use authorization_code or refresh_token.');
}

/** How often a connection's last use is written down; the owner wants "today", not the second. */
const usageGranularityMs = 60_000;

/**
 * The key an access token stands for, or null. A connection is refused once its token expires, once
 * its code runs out, or once its code is revoked — the last because the row is gone with the key.
 */
export async function keyOfAccessToken(db: PrismaClient, token: string): Promise<AgentKey | null> {
  if (!tokenPattern(accessTokenPrefix).test(token)) return null;
  const grant = await db.agentGrant.findUnique({ where: { accessHash: hashSessionToken(token) }, include: { key: true } });
  const now = new Date();
  if (!grant?.accessExpiresAt || grant.accessExpiresAt <= now || grant.key.expiresAt <= now) return null;
  if (!grant.lastUsedAt || now.getTime() - grant.lastUsedAt.getTime() > usageGranularityMs) {
    await db.agentGrant.update({ where: { id: grant.id }, data: { lastUsedAt: now } });
  }
  return grant.key;
}

/**
 * Apps call these endpoints from wherever they run, some from a browser page. Nothing here reads a
 * cookie — every answer depends on a token or code in the request itself — so any origin may ask.
 */
export const openCors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'authorization, content-type, accept, mcp-protocol-version, mcp-session-id, last-event-id',
  'Access-Control-Expose-Headers': 'www-authenticate, mcp-session-id, mcp-protocol-version',
  'Access-Control-Max-Age': '86400',
};
export const preflight = () => new Response(null, { status: 204, headers: openCors });

/** An OAuth answer: JSON, never cached, open to any origin. */
export function oauthJson(body: unknown, status = 200) {
  return Response.json(body, { status, headers: { 'Cache-Control': 'no-store', Pragma: 'no-cache', ...openCors } });
}

/** A form post, bounded like every other body this service reads. JSON is taken too, as some apps send it. */
export async function readForm(request: Request, limit = 16 * 1024): Promise<URLSearchParams> {
  const text = await request.text();
  if (text.length > limit) throw new OAuthError(413, 'invalid_request', 'The request body is too large.');
  if (request.headers.get('content-type')?.includes('application/json')) {
    try {
      const value = JSON.parse(text) as Record<string, unknown>;
      return new URLSearchParams(Object.entries(value).filter(([, item]) => typeof item === 'string') as [string, string][]);
    } catch { throw new OAuthError(400, 'invalid_request', 'The request body is not valid JSON.'); }
  }
  return new URLSearchParams(text);
}

/** Runs an OAuth endpoint, turning its refusals into the shapes the specifications give them. */
export async function oauthHandle(work: () => Promise<Response>) {
  try { return await work(); }
  catch (error) {
    if (error instanceof OAuthError) return oauthJson(error.body(), error.status);
    if (error instanceof AppError) return oauthJson({ error: 'server_error', error_description: error.message }, error.status);
    console.error(JSON.stringify({ event: 'oauth_failed', type: error instanceof Error ? error.name : 'unknown' }));
    return oauthJson({ error: 'server_error', error_description: 'The request could not be completed.' }, 500);
  }
}
