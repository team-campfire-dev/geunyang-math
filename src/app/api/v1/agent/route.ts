import { AgentService, agentOf } from '@/server/agent';
import { getDatabase } from '@/server/db';
import { handle, json, readJson } from '@/server/http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
/** The same bound as the editor's: an AI sends a whole lesson document, as the screen does. */
const bodyLimit = 256 * 1024;

/**
 * Lesson editing for an AI, with the code an author made for it in the editor. There is no cookie
 * and no origin to check: the code is sent by whoever holds it, in the Authorization header, which
 * no browser adds on its own.
 */
export function GET(request: Request) {
  return handle(async () => {
    const db = getDatabase();
    const agent = new AgentService(db, await agentOf(db, request));
    const params = new URL(request.url).searchParams;
    const draftId = params.get('draftId');
    if (draftId) return json({ draft: await agent.draft(draftId) });
    if (params.get('view') === 'workspace') return json({ workspace: await agent.workspace() });
    return json({ guide: await agent.guide() });
  });
}

export function POST(request: Request) {
  return handle(async () => {
    const db = getDatabase();
    const agent = new AgentService(db, await agentOf(db, request));
    return json(await agent.act(await readJson(request, bodyLimit)));
  });
}
