import { LearningService } from '@/server/learning-service';
import { getDatabase } from '@/server/db';
import { assertSameOrigin, requireUser } from '@/server/auth';
import { handle, json, readJson } from '@/server/http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** A read-only request: opening an explanation never changes learning evidence. */
export function POST(request: Request) {
  return handle(async () => {
    assertSameOrigin(request);
    const user = await requireUser(request);
    return json(await new LearningService(getDatabase()).conceptHelp(user.id, await readJson(request)));
  });
}
