import { getDatabase } from '@/server/db';
import { exchange, oauthHandle, oauthJson, preflight, readForm } from '@/server/agent-oauth';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** An authorization code for tokens, or a refresh token for new ones. */
export function POST(request: Request) {
  return oauthHandle(async () => oauthJson(await exchange(getDatabase(), await readForm(request))));
}
export const OPTIONS = preflight;
