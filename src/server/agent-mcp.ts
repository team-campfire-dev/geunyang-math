import 'server-only';
import type { PrismaClient } from '@prisma/client';
import { AgentService, agentOf } from './agent';
import { agentScope, openCors, serviceOrigin } from './agent-oauth';
import { callTool, describeTools } from './agent-tools';
import { AppError } from './errors';

/**
 * The MCP endpoint chat apps call: Streamable HTTP, one JSON request answered with one JSON response,
 * nothing held between requests. Two generations of the protocol arrive here. Since 2026-07-28 a
 * request carries its own version and there is no handshake; before it, a client opened with
 * `initialize` and sent the version it agreed in a header. Which one a request is decides how it is
 * checked and how its answer is shaped, and both reach the same tools.
 */

const modernVersion = '2026-07-28';
const legacyVersions = ['2025-11-25', '2025-06-18', '2025-03-26'];
const metaKey = (name: string) => `io.modelcontextprotocol/${name}`;
const serverInfo = { name: 'geunyang-math-lessons', title: '그냥수학 수업 편집', version: '1.0.0' };
const bodyLimit = 256 * 1024;
/** Chat apps call from their own servers. A page in a browser may only be this service or one of them. */
const allowedOrigins = ['https://claude.ai', 'https://claude.com', 'https://chatgpt.com', 'https://gemini.google.com'];

const instructions = [
  '「그냥수학」의 수업을 이 연결의 계정으로 읽고 고치는 도구예요.',
  '처음에 get_guide를 한 번 읽고 작성 지침과 블록 형식을 따르세요.',
  '고칠 수업은 list_lessons로 찾고 open_lesson_draft로 초안을 연 뒤, 단계·블록·문항 도구로 한 곳씩 고쳐요. 바꾼 뒤에는 돌아온 개요의 이름(blockId·problemVersionId)을 쓰세요.',
  'validate_draft로 issues가 빌 때까지 고치고, 끝나면 request_review로 사람에게 검토를 요청하고 무엇을 바꿨는지 보고하세요.',
].join(' ');

type Rpc = { jsonrpc?: string; id?: string | number | null; method?: unknown; params?: Record<string, unknown> };
const rpcError = (id: Rpc['id'], code: number, message: string, data?: unknown) =>
  ({ jsonrpc: '2.0', id: id ?? null, error: { code, message, ...(data === undefined ? {} : { data }) } });
const answer = (body: unknown, status = 200, headers?: HeadersInit) =>
  Response.json(body, { status, headers: { 'Cache-Control': 'no-store', ...openCors, ...headers } });

/** A header may carry its value as `=?base64?…?=` when it is not plain ASCII. */
function headerValue(request: Request, name: string): string | null {
  const raw = request.headers.get(name);
  const encoded = raw && /^=\?base64\?(.*)\?=$/i.exec(raw);
  return encoded ? Buffer.from(encoded[1], 'base64').toString('utf8') : raw;
}

/** The 401 that sends an app to sign in: where the resource's metadata is, and what to ask for. */
export function unauthenticated(origin: string) {
  return answer({ error: 'invalid_token', error_description: 'Connect with the code from 「AI 연결」.' }, 401, {
    'WWW-Authenticate': `Bearer resource_metadata="${origin}/.well-known/oauth-protected-resource/api/mcp", scope="${agentScope}"`,
  });
}

export async function serveMcp(db: PrismaClient, request: Request): Promise<Response> {
  const origin = serviceOrigin();
  const from = request.headers.get('origin');
  if (from && from !== origin && !allowedOrigins.includes(from)) return answer(rpcError(null, -32600, 'Origin not allowed'), 403);

  let key;
  try { key = await agentOf(db, request); }
  catch (error) {
    if (error instanceof AppError && error.status === 401) return unauthenticated(origin);
    throw error;
  }

  const text = await request.text();
  if (text.length > bodyLimit) return answer(rpcError(null, -32600, 'Request too large'), 413);
  let message: Rpc;
  try { message = JSON.parse(text) as Rpc; } catch { return answer(rpcError(null, -32700, 'Parse error'), 400); }
  if (!message || typeof message !== 'object' || Array.isArray(message) || typeof message.method !== 'string') {
    return answer(rpcError(null, -32600, 'A single JSON-RPC request is expected'), 400);
  }
  const { id, method } = message;
  const params = (message.params && typeof message.params === 'object' ? message.params : {}) as Record<string, unknown>;
  // A notification asks for nothing back.
  if (id === undefined) return new Response(null, { status: 202, headers: openCors });

  const meta = (params._meta ?? {}) as Record<string, unknown>;
  const headerVersion = request.headers.get('mcp-protocol-version');
  const modern = method !== 'initialize' && (meta[metaKey('protocolVersion')] !== undefined || headerVersion === modernVersion);
  const context = { db, key, agent: new AgentService(db, key) };
  const tools = () => describeTools(key).map((tool) => ({ ...tool, securitySchemes: [{ type: 'oauth2', scopes: [agentScope] }] }));

  if (!modern) {
    // The 2025 generation: a handshake, then requests that carry only the agreed version in a header.
    // No session is minted; each request stands on its own token.
    const result = method === 'initialize'
      ? { protocolVersion: legacyVersions.includes(String(params.protocolVersion)) ? params.protocolVersion : legacyVersions[0],
        capabilities: { tools: { listChanged: false } }, serverInfo, instructions }
      : method === 'ping' ? {}
        : method === 'tools/list' ? { tools: tools() }
          : method === 'tools/call' ? await callTool(context, String(params.name ?? ''), params.arguments)
            : null;
    return answer(result === null ? rpcError(id, -32601, `Method not found: ${method}`) : { jsonrpc: '2.0', id, result });
  }

  const version = meta[metaKey('protocolVersion')];
  if (typeof version !== 'string' || typeof meta[metaKey('clientCapabilities')] !== 'object') {
    return answer(rpcError(id, -32602, `_meta must carry ${metaKey('protocolVersion')} and ${metaKey('clientCapabilities')}`), 400);
  }
  if (version !== modernVersion) {
    return answer(rpcError(id, -32022, 'Unsupported protocol version', { supported: [modernVersion, ...legacyVersions], requested: version }), 400);
  }
  if (headerVersion !== version || headerValue(request, 'mcp-method') !== method
    || (method === 'tools/call' && headerValue(request, 'mcp-name') !== params.name)) {
    return answer(rpcError(id, -32020, 'MCP-Protocol-Version, Mcp-Method and Mcp-Name must match the request body'), 400);
  }
  const done = (result: Record<string, unknown>) =>
    answer({ jsonrpc: '2.0', id, result: { resultType: 'complete', ...result, _meta: { [metaKey('serverInfo')]: serverInfo } } });
  switch (method) {
    case 'server/discover':
      return done({ supportedVersions: [modernVersion], capabilities: { tools: {} }, instructions, ttlMs: 3_600_000, cacheScope: 'private' });
    // What a key reaches depends on the key, so a list is never shared between connections.
    case 'tools/list': return done({ tools: tools(), ttlMs: 300_000, cacheScope: 'private' });
    case 'tools/call': return done(await callTool(context, String(params.name ?? ''), params.arguments));
    default: return answer(rpcError(id, -32601, `Method not found: ${method}`), 404);
  }
}
