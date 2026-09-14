import { LearningService } from '@/server/learning-service';
import { getDatabase } from '@/server/db';
import { assertSameOrigin, requireUser, sessionUser } from '@/server/auth';
import { handle, json, readJson } from '@/server/http';
import { AppError } from '@/server/errors';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export function GET(request: Request) {
  return handle(async () => {
    const service = new LearningService(getDatabase());
    const params = new URL(request.url).searchParams;
    if (params.get('catalog') === '1') return json(await service.publicCatalog());
    const classKey = params.get('classKey');
    if (classKey) return json(await service.classDocument(classKey, (await sessionUser(request))?.id));
    return json(await service.state((await requireUser(request)).id));
  });
}
export function POST(request: Request) {
  return handle(async () => {
    assertSameOrigin(request);
    const user = await requireUser(request);
    // Bind the mutation to the account displayed when the user initiated it.
    // Cookies may have switched accounts in another tab since that screen loaded.
    if (request.headers.get('X-Learning-User-Id') !== user.id) {
      throw new AppError(409, 'account_changed', '로그인 계정이 바뀌었어요. 화면을 새로 불러온 뒤 다시 시도해 주세요.');
    }
    return json(await new LearningService(getDatabase()).act(user.id, await readJson(request)));
  });
}
