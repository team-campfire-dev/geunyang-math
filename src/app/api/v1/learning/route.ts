import { LearningService } from '@/server/learning-service';
import { getDatabase } from '@/server/db';
import { assertSameOrigin, requireUser, sessionUser } from '@/server/auth';
import { handle, json, readJson } from '@/server/http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export function GET(request: Request) {
  return handle(async () => {
    const service = new LearningService(getDatabase());
    const params = new URL(request.url).searchParams;
    if (params.get('catalog') === '1') return json({ classes: await service.catalog() });
    const classKey = params.get('classKey');
    if (classKey) return json(await service.classDocument(classKey, (await sessionUser(request))?.id));
    return json(await service.state((await requireUser(request)).id));
  });
}
export function POST(request: Request) {
  return handle(async () => {
    assertSameOrigin(request);
    const user = await requireUser(request);
    return json(await new LearningService(getDatabase()).act(user.id, await readJson(request)));
  });
}
