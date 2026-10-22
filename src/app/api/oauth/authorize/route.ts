import { getDatabase } from '@/server/db';
import { assertSameOrigin } from '@/server/auth';
import { handle } from '@/server/http';
import { answerUrl, approve, keyOfCode, readAuthorization, serviceOrigin } from '@/server/agent-oauth';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** The fields the connect page passes through untouched, so the request is read again here rather than trusted from the page. */
const passed = ['response_type', 'client_id', 'redirect_uri', 'code_challenge', 'code_challenge_method', 'state', 'scope', 'resource'];
const see = (location: string) => new Response(null, { status: 303, headers: { Location: location, 'Cache-Control': 'no-store' } });

/**
 * The connect page's answer. The code is typed here, on this service's own page, and never reaches
 * the app: the app receives a one-time authorization code it can only exchange with the verifier it
 * kept, at the token endpoint.
 */
export function POST(request: Request) {
  return handle(async () => {
    assertSameOrigin(request);
    const origin = serviceOrigin();
    const text = await request.text();
    const form = new URLSearchParams(text.length > 16 * 1024 ? '' : text);
    const params = new URLSearchParams(passed.flatMap((name) => { const value = form.get(name); return value === null ? [] : [[name, value]]; }));
    const db = getDatabase();
    const read = await readAuthorization(db, params, origin);
    if ('show' in read) return see(`/oauth/authorize?${params}`);
    if ('redirect' in read) return see(read.redirect);
    if (form.get('decision') === 'deny') {
      return see(answerUrl(read.ok.redirectUri, { error: 'access_denied', error_description: 'The author declined to connect.', state: read.ok.state }, origin));
    }
    const key = await keyOfCode(db, form.get('agent_code') ?? '');
    if (!key) { params.set('failed', '1'); return see(`/oauth/authorize?${params}`); }
    console.info(JSON.stringify({ event: 'agent_connected', keyId: key.id, client: read.ok.client.clientId }));
    return see(await approve(db, read.ok, key, origin));
  });
}
