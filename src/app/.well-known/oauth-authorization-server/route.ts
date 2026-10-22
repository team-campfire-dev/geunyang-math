import { authorizationServerMetadata, oauthHandle, oauthJson, preflight, serviceOrigin } from '@/server/agent-oauth';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** RFC 8414: where an app registers, sends the author to, and fetches its tokens. */
export function GET() {
  return oauthHandle(async () => oauthJson(authorizationServerMetadata(serviceOrigin())));
}
export const OPTIONS = preflight;
