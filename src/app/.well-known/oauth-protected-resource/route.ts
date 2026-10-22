import { oauthHandle, oauthJson, preflight, protectedResourceMetadata, serviceOrigin } from '@/server/agent-oauth';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** RFC 9728: an app that reaches /api/mcp without a token is pointed here, and from here to sign-in. */
export function GET() {
  return oauthHandle(async () => oauthJson(protectedResourceMetadata(serviceOrigin())));
}
export const OPTIONS = preflight;
