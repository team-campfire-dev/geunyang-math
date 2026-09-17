import { LearningService } from '@/server/learning-service';
import { getDatabase } from '@/server/db';
import { assertSameOrigin, sessionUser } from '@/server/auth';
import { handle, json, readJson } from '@/server/http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Read-only POST keeps the bounded navigation path out of URLs/history and works for public previews. */
export function POST(request: Request) {
  return handle(async () => {
    assertSameOrigin(request);
    return json(await new LearningService(getDatabase()).exploreDefinition(await readJson(request, 64_000), (await sessionUser(request))?.id));
  });
}
