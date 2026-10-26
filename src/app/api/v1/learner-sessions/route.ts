import { LearnerSessionsService } from '@/server/learner-sessions';
import { getDatabase } from '@/server/db';
import { requireUser } from '@/server/auth';
import { handle, json } from '@/server/http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Learners' sittings, for the operator: the list, or one learner's with `?userId=`. Signing in is always required. */
export function GET(request: Request) {
  return handle(async () => {
    const operator = (await requireUser(request)).id;
    const learnerId = new URL(request.url).searchParams.get('userId');
    const service = new LearnerSessionsService(getDatabase());
    return json(learnerId ? { detail: await service.detail(operator, learnerId) } : { list: await service.list(operator) });
  });
}
