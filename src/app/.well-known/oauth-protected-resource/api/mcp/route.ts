import { oauthHandle, oauthJson, preflight, protectedResourceMetadata, serviceOrigin } from '@/server/agent-oauth';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** The same document at the path RFC 9728 inserts the resource's own path into. */
export function GET() {
  return oauthHandle(async () => oauthJson(protectedResourceMetadata(serviceOrigin())));
}
export const OPTIONS = preflight;
