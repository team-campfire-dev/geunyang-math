import { getDatabase } from '@/server/db';
import { handle } from '@/server/http';
import { openCors, preflight } from '@/server/agent-oauth';
import { serveMcp } from '@/server/agent-mcp';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Lesson editing for chat apps — Claude, ChatGPT, Gemini — as an MCP server. Signing in is OAuth
 * with the code an author made in 「AI 연결」; a tool that can send a header may send the code itself.
 */
export function POST(request: Request) {
  return handle(() => serveMcp(getDatabase(), request));
}

/** Nothing streams from this server, and there is no session to end. */
const notAllowed = () => new Response(null, { status: 405, headers: { Allow: 'POST, OPTIONS', ...openCors } });
export const GET = notAllowed;
export const DELETE = notAllowed;
export const OPTIONS = preflight;
