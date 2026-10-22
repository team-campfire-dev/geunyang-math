import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { existingRows, removeRowsAddedSince, type Existing } from './cleanup';
import * as database from '@/server/db';
import { hashSessionToken } from '@/server/auth';
import { importContent } from '@/server/content-store';
import type { LessonRecord } from '@/core/content';
import type { AgentKeyResponse } from '@/shared/agent';
import { lessonBundle, seedLessons } from './fixtures/content';
import * as keysRoute from '@/app/api/v1/agent-keys/route';
import * as mcpRoute from '@/app/api/mcp/route';
import * as registerRoute from '@/app/api/oauth/register/route';
import * as tokenRoute from '@/app/api/oauth/token/route';
import * as authorizeRoute from '@/app/api/oauth/authorize/route';
import * as resourceMetadata from '@/app/.well-known/oauth-protected-resource/api/mcp/route';
import * as serverMetadata from '@/app/.well-known/oauth-authorization-server/route';

const url = process.env.TEST_DATABASE_URL;
const origin = 'https://math.example.com';
const callback = 'https://claude.ai/api/mcp/auth_callback';
type Json = Record<string, any>;

describe.skipIf(!url)('chat apps connecting with a code and editing lessons over MCP', () => {
  let db: ReturnType<typeof database.createDatabase>;
  let existing: Existing;
  let lessonKey: string;

  beforeAll(async () => {
    const parsed = new URL(url!);
    if (parsed.protocol !== 'mysql:' || !parsed.pathname.endsWith('_test')) throw new Error('Use an isolated _test database.');
    db = database.createDatabase(url!);
    existing = await existingRows(db);
    lessonKey = `mcp-${randomUUID()}`;
    const base = JSON.parse(JSON.stringify(seedLessons[0]).replaceAll('fraction-meaning', lessonKey)) as LessonRecord;
    await importContent(db, lessonBundle([base], { key: `course-${lessonKey}`, title: '검사 코스' }));
  });
  beforeEach(() => {
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv('APP_ORIGIN', origin);
    vi.stubEnv('GOOGLE_LOGIN_ENABLED', 'true');
    vi.stubEnv('GOOGLE_CLIENT_ID', 'fixture.apps.googleusercontent.com');
    vi.stubEnv('GOOGLE_CLIENT_SECRET', 'fixture-secret');
    vi.spyOn(database, 'getDatabase').mockImplementation(() => db);
    vi.spyOn(console, 'info').mockImplementation(() => {});
  });
  afterEach(() => { vi.unstubAllEnvs(); vi.restoreAllMocks(); });
  afterAll(async () => {
    if (existing) {
      // Registrations belong to no account, so they are not swept with the accounts this suite made.
      await db.agentClient.deleteMany({ where: { redirectUris: { equals: [callback] } } });
      await removeRowsAddedSince(db, existing);
    }
    await db?.$disconnect();
  });

  async function author(role: 'admin' | 'author' = 'author', mayPublish = false) {
    const token = randomBytes(32).toString('hex');
    const user = await db.user.create({ data: {
      displayName: `mcp ${randomUUID()}`, learningScopes: { create: { kind: 'personal' } },
      sessions: { create: { tokenHash: hashSessionToken(token), authMethod: 'google', expiresAt: new Date(Date.now() + 60000) } },
    } });
    await db.contentAuthor.create({ data: { userId: user.id, role } });
    const response = await keysRoute.POST(new Request(`${origin}/api/v1/agent-keys`, { method: 'POST',
      headers: { origin, cookie: `__Host-gm_session=${token}`, 'content-type': 'application/json', 'X-Agent-Keys-User-Id': user.id },
      body: JSON.stringify({ action: 'key.issue', name: 'Claude', days: 7, mayPublish }) }));
    return { user, code: (await response.json() as AgentKeyResponse).issued!.code };
  }

  const register = async (body: unknown) => registerRoute.POST(new Request(`${origin}/api/oauth/register`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }));
  const pkce = () => {
    const verifier = randomBytes(32).toString('base64url');
    return { verifier, challenge: createHash('sha256').update(verifier).digest('base64url') };
  };
  const authorize = (fields: Record<string, string>) => authorizeRoute.POST(new Request(`${origin}/api/oauth/authorize`, {
    method: 'POST', headers: { origin, 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams(fields).toString() }));
  const token = (fields: Record<string, string>) => tokenRoute.POST(new Request(`${origin}/api/oauth/token`, {
    method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams(fields).toString() }));

  /** The whole connection, the way Claude makes it: register, send the author to sign in, exchange. */
  async function connect(code: string) {
    const { client_id: clientId } = await (await register({ client_name: 'Claude', redirect_uris: [callback], application_type: 'web' })).json();
    const { verifier, challenge } = pkce();
    const request = { response_type: 'code', client_id: clientId, redirect_uri: callback, code_challenge: challenge,
      code_challenge_method: 'S256', state: 'xyz', scope: 'lessons', resource: `${origin}/api/mcp` };
    const approved = await authorize({ ...request, agent_code: code, decision: 'allow' });
    expect(approved.status).toBe(303);
    const back = new URL(approved.headers.get('location')!);
    expect(`${back.origin}${back.pathname}`).toBe(callback);
    expect(back.searchParams.get('state')).toBe('xyz');
    expect(back.searchParams.get('iss')).toBe(origin);
    const tokens = await (await token({ grant_type: 'authorization_code', code: back.searchParams.get('code')!, redirect_uri: callback,
      client_id: clientId, code_verifier: verifier, resource: `${origin}/api/mcp` })).json();
    return { clientId, request, tokens: tokens as { access_token: string; refresh_token: string; expires_in: number } };
  }

  let rpcId = 0;
  const legacy = async (access: string | null, method: string, params: Json = {}) => {
    const response = await mcpRoute.POST(new Request(`${origin}/api/mcp`, { method: 'POST', headers: {
      'content-type': 'application/json', accept: 'application/json, text/event-stream', 'mcp-protocol-version': '2025-11-25',
      ...(access ? { authorization: `Bearer ${access}` } : {}) }, body: JSON.stringify({ jsonrpc: '2.0', id: ++rpcId, method, params }) }));
    return { status: response.status, body: await response.json().catch(() => null) as Json, headers: response.headers };
  };
  const modern = async (access: string, method: string, params: Json = {}, headers: Record<string, string> = {}) => {
    const meta = { 'io.modelcontextprotocol/protocolVersion': '2026-07-28', 'io.modelcontextprotocol/clientCapabilities': {} };
    const response = await mcpRoute.POST(new Request(`${origin}/api/mcp`, { method: 'POST', headers: {
      'content-type': 'application/json', accept: 'application/json, text/event-stream', authorization: `Bearer ${access}`,
      'mcp-protocol-version': '2026-07-28', 'mcp-method': method, ...(params.name ? { 'mcp-name': params.name } : {}), ...headers },
      body: JSON.stringify({ jsonrpc: '2.0', id: ++rpcId, method, params: { ...params, _meta: meta } }) }));
    return { status: response.status, body: await response.json() as Json };
  };
  /** A tool's answer, read back from its text. */
  const call = async (access: string, name: string, args: Json) => {
    const { body } = await legacy(access, 'tools/call', { name, arguments: args });
    const result = body.result as { content: { text: string }[]; isError?: boolean };
    return { isError: !!result.isError, text: result.content[0].text, value: result.isError ? null : JSON.parse(result.content[0].text) as Json };
  };

  it('tells an app where to sign in, and sends it there when it has no token', async () => {
    expect(await (await resourceMetadata.GET()).json()).toMatchObject({ resource: `${origin}/api/mcp`, authorization_servers: [origin] });
    expect(await (await serverMetadata.GET()).json()).toMatchObject({ issuer: origin, authorization_endpoint: `${origin}/oauth/authorize`,
      token_endpoint: `${origin}/api/oauth/token`, registration_endpoint: `${origin}/api/oauth/register`,
      code_challenge_methods_supported: ['S256'], token_endpoint_auth_methods_supported: ['none'], authorization_response_iss_parameter_supported: true });
    const refused = await legacy(null, 'initialize', { protocolVersion: '2025-11-25', capabilities: {}, clientInfo: { name: 't', version: '1' } });
    expect(refused.status).toBe(401);
    expect(refused.headers.get('www-authenticate')).toBe(`Bearer resource_metadata="${origin}/.well-known/oauth-protected-resource/api/mcp", scope="lessons"`);
    expect((await mcpRoute.GET()).status).toBe(405);
  });

  it('registers only apps that will be answered at a secure address', async () => {
    expect((await register({ redirect_uris: ['http://evil.example/cb'] })).status).toBe(400);
    expect((await register({ redirect_uris: [] })).status).toBe(400);
    const local = await register({ client_name: 'Inspector', redirect_uris: ['http://localhost:6274/oauth/callback'] });
    expect(local.status).toBe(201);
    await db.agentClient.delete({ where: { clientId: (await local.json()).client_id } });
  });

  it('connects only with a working code, the PKCE verifier and a code used once', async () => {
    const { code } = await author();
    const { client_id: clientId } = await (await register({ client_name: 'Claude', redirect_uris: [callback] })).json();
    const { verifier, challenge } = pkce();
    const request = { response_type: 'code', client_id: clientId, redirect_uri: callback, code_challenge: challenge, code_challenge_method: 'S256', state: 's1' };

    const wrong = await authorize({ ...request, agent_code: `gmk_${'0'.repeat(64)}`, decision: 'allow' });
    expect(wrong.headers.get('location')).toMatch(/^\/oauth\/authorize\?.*failed=1/);
    const denied = new URL((await authorize({ ...request, agent_code: '', decision: 'deny' })).headers.get('location')!);
    expect(denied.searchParams.get('error')).toBe('access_denied');
    expect(denied.searchParams.get('iss')).toBe(origin);
    // An address the app did not register is never answered.
    expect((await authorize({ ...request, redirect_uri: 'https://evil.example/cb', agent_code: code, decision: 'allow' })).headers.get('location'))
      .toMatch(/^\/oauth\/authorize\?/);
    // Without PKCE the app is told so at its own address.
    const noPkce = new URL((await authorize({ ...request, code_challenge: '', agent_code: code, decision: 'allow' })).headers.get('location')!);
    expect(noPkce.searchParams.get('error')).toBe('invalid_request');

    const issued = new URL((await authorize({ ...request, agent_code: code, decision: 'allow' })).headers.get('location')!).searchParams.get('code')!;
    const exchange = { grant_type: 'authorization_code', code: issued, redirect_uri: callback, client_id: clientId };
    expect((await (await token({ ...exchange, code_verifier: pkce().verifier })).json()).error).toBe('invalid_grant');
    const granted = await token({ ...exchange, code_verifier: verifier });
    expect(granted.status).toBe(200);
    expect(await granted.json()).toMatchObject({ token_type: 'Bearer', scope: 'lessons' });
    expect((await (await token({ ...exchange, code_verifier: verifier })).json()).error).toBe('invalid_grant');
  });

  it('serves both generations of the protocol, and checks what the newer one requires', async () => {
    const { code } = await author();
    const { tokens: { access_token: access } } = await connect(code);
    const opened = await legacy(access, 'initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 't', version: '1' } });
    expect(opened.body.result).toMatchObject({ protocolVersion: '2025-06-18', capabilities: { tools: {} }, serverInfo: { name: 'geunyang-math-lessons' } });
    expect(opened.headers.get('mcp-session-id')).toBeNull();
    const tools = (await legacy(access, 'tools/list')).body.result.tools as Json[];
    const names = tools.map((tool) => tool.name);
    expect(names).toEqual(expect.arrayContaining(['get_guide', 'list_lessons', 'open_lesson_draft', 'add_block', 'update_block', 'add_problem', 'request_review']));
    expect(names).not.toContain('publish_draft');
    expect(tools.every((tool) => tool.inputSchema.type === 'object')).toBe(true);

    const discovered = await modern(access, 'server/discover');
    expect(discovered.body.result).toMatchObject({ resultType: 'complete', supportedVersions: ['2026-07-28'], cacheScope: 'private' });
    expect((await modern(access, 'tools/list')).body.result.tools.length).toBe(tools.length);
    const guide = await modern(access, 'tools/call', { name: 'get_guide', arguments: {} });
    expect(guide.body.result.resultType).toBe('complete');
    expect(JSON.parse(guide.body.result.content[0].text).writingGuide).toContain('### 1. 어투');
    expect((await modern(access, 'tools/call', { name: 'get_guide', arguments: {} }, { 'mcp-name': 'list_lessons' })).body.error.code).toBe(-32020);
    const old = await modern(access, 'server/discover', {}, { 'mcp-protocol-version': '2027-01-01' });
    expect(old.status).toBe(400);
    expect((await modern(access, 'nothing/here')).status).toBe(404);
  });

  it('writes a lesson a piece at a time and asks for review, as the code\'s account', async () => {
    const { user, code } = await author();
    const { tokens: { access_token: access } } = await connect(code);
    const lessons = (await call(access, 'list_lessons', {})).value as unknown as Json[];
    expect(lessons.flatMap((course) => course.lessons.map((lesson: Json) => lesson.lessonKey))).toContain(lessonKey);

    const opened = (await call(access, 'open_lesson_draft', { lessonKey })).value!;
    expect(opened.opened).toBe('new');
    const draftId = opened.draftId as string;
    expect((await db.contentDraft.findUniqueOrThrow({ where: { id: draftId } })).authorId).toBe(user.id);
    // Opening it again finds the same draft rather than making another.
    expect((await call(access, 'open_lesson_draft', { lessonKey })).value!.draftId).toBe(draftId);

    const first = opened.sections[0];
    const added = (await call(access, 'add_block', { draftId, sectionId: first.sectionId, kind: 'core.rich_text', typeVersion: 3,
      payload: { text: '사과 12개를 바구니 3개에 똑같이 나눠요.', definitions: [] } })).value!;
    const block = added.sections[0].blocks.at(-1);
    expect(block.gist).toBe('사과 12개를 바구니 3개에 똑같이 나눠요.');
    await call(access, 'update_block', { draftId, blockId: block.blockId, payload: { text: '한 바구니에 $12 \\div 3 = 4$개예요.', definitions: [] } });
    const read = (await call(access, 'read_draft', { draftId })).value!;
    expect(JSON.stringify(read.edit)).toContain('12 \\\\div 3 = 4');

    const activity = added.sections.flatMap((section: Json) => section.blocks).find((item: Json) => item.kind === 'core.problem_set@2');
    const withProblem = (await call(access, 'add_problem', { draftId, activityBlockId: activity.blockId, prompt: '$12 \\div 3$은 얼마예요?',
      gradingSpec: { kind: 'integer', value: 4 }, hints: ['12를 3묶음으로 나눠 보세요.'], solution: ['$12 \\div 3 = 4$예요.'] })).value!;
    const problemVersionId = withProblem.sections.flatMap((section: Json) => section.blocks).find((item: Json) => item.blockId === activity.blockId)
      .problems.at(-1).problemVersionId;
    expect((await call(access, 'try_answer', { draftId, problemVersionId, answer: '4' })).value!.status).toBe('correct');
    expect((await call(access, 'try_answer', { draftId, problemVersionId, answer: '36' })).value!.status).toBe('incorrect');

    // A name that is not in the draft is a result the model repairs from, not a failure of the call.
    const missing = await call(access, 'update_block', { draftId, blockId: 'nope', payload: { text: 'x', definitions: [] } });
    expect(missing.isError).toBe(true);
    expect(missing.text).toContain('read_draft');
    // A block kind the guide does not list is refused before anything is saved.
    expect((await call(access, 'add_block', { draftId, sectionId: first.sectionId, kind: 'math.fraction_strip', typeVersion: 1 })).isError).toBe(true);

    expect((await call(access, 'validate_draft', { draftId })).value!.issues).toEqual([]);
    expect((await call(access, 'request_review', { draftId, asking: true })).value!.status).toBe('review');
    expect((await call(access, 'publish_draft', { draftId })).text).toContain('없는 도구');
    await db.contentDraft.delete({ where: { id: draftId } });
  });

  it('drops an activity\'s questions with it, and refuses a save over a newer one', async () => {
    const { code } = await author();
    const { tokens: { access_token: access } } = await connect(code);
    const opened = (await call(access, 'open_lesson_draft', { lessonKey })).value!;
    const activity = opened.sections.flatMap((section: Json) => section.blocks).find((item: Json) => item.kind === 'core.problem_set@2');
    const held = activity.problems.map((problem: Json) => problem.problemVersionId);
    await call(access, 'remove_block', { draftId: opened.draftId, blockId: activity.blockId });
    const after = (await call(access, 'read_draft', { draftId: opened.draftId })).value!;
    expect(after.edit.problems.map((problem: Json) => problem.problemVersionId).filter((id: string) => held.includes(id))).toEqual([]);
    await db.contentDraft.delete({ where: { id: opened.draftId } });
  });

  it('publishes only through a code made for it', async () => {
    const { code } = await author('admin', true);
    const { tokens: { access_token: access } } = await connect(code);
    expect(((await legacy(access, 'tools/list')).body.result.tools as Json[]).map((tool) => tool.name)).toContain('publish_draft');
    const { draftId } = (await call(access, 'open_lesson_draft', { lessonKey })).value!;
    const published = await call(access, 'publish_draft', { draftId });
    expect(published.isError).toBe(false);
    expect(await db.lessonVersion.count({ where: { id: published.value!.publishedVersionId } })).toBe(1);
  });

  it('rotates refresh tokens, and ends every connection when the code is revoked', async () => {
    const { user, code } = await author();
    const { clientId, tokens } = await connect(code);
    const renewed = await (await token({ grant_type: 'refresh_token', refresh_token: tokens.refresh_token, client_id: clientId })).json();
    expect(renewed.access_token).toMatch(/^gma_/);
    expect((await (await token({ grant_type: 'refresh_token', refresh_token: tokens.refresh_token, client_id: clientId })).json()).error).toBe('invalid_grant');
    expect((await legacy(tokens.access_token, 'tools/list')).status).toBe(401);
    expect((await legacy(renewed.access_token, 'tools/list')).status).toBe(200);

    const key = await db.agentKey.findFirstOrThrow({ where: { userId: user.id }, include: { grants: { include: { client: true } } } });
    expect(key.grants.map((grant) => grant.client.name)).toEqual(['Claude']);
    await db.agentKey.delete({ where: { id: key.id } });
    expect((await legacy(renewed.access_token, 'tools/list')).status).toBe(401);
    expect((await (await token({ grant_type: 'refresh_token', refresh_token: renewed.refresh_token, client_id: clientId })).json()).error).toBe('invalid_grant');
  });
});
