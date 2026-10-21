import { AiUsageService } from '@/server/ai-usage-service';
import { getDatabase } from '@/server/db';
import { requireUser } from '@/server/auth';
import { handle, json } from '@/server/http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Model spending, for the operator. Signing in is always required: it names accounts and what they cost. */
export function GET(request: Request) {
  return handle(async () => json({ usage: await new AiUsageService(getDatabase()).view((await requireUser(request)).id) }));
}
