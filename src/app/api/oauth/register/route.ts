import { getDatabase } from '@/server/db';
import { OAuthError, oauthHandle, oauthJson, preflight, registerClient } from '@/server/agent-oauth';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** RFC 7591: a chat app registers itself before it asks anyone to connect it. */
export function POST(request: Request) {
  return oauthHandle(async () => {
    const text = await request.text();
    if (text.length > 16 * 1024) throw new OAuthError(413, 'invalid_client_metadata', 'The registration is too large.');
    let metadata: unknown;
    try { metadata = JSON.parse(text); } catch { throw new OAuthError(400, 'invalid_client_metadata', 'The registration must be a JSON object.'); }
    return oauthJson(await registerClient(getDatabase(), metadata), 201);
  });
}
export const OPTIONS = preflight;
