import { FeedbackService } from '@/server/feedback-service';
import { getDatabase } from '@/server/db';
import { assertSameOrigin, requireUser, sessionUser } from '@/server/auth';
import { handle, json, readJson } from '@/server/http';
import { AppError } from '@/server/errors';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Feedback on lessons. `?lessonKey=` is one lesson as its screen draws it, and asks nobody to sign in —
 * signed out simply has nothing there. Without it, it is the operator's list of everything said.
 */
export function GET(request: Request) {
  return handle(async () => {
    const service = new FeedbackService(getDatabase());
    const lessonKey = new URL(request.url).searchParams.get('lessonKey');
    if (lessonKey) return json({ feedback: await service.lesson(lessonKey, (await sessionUser(request))?.id ?? null) });
    return json({ inbox: await service.inbox((await requireUser(request)).id) });
  });
}

export function POST(request: Request) {
  return handle(async () => {
    assertSameOrigin(request);
    const user = await requireUser(request);
    // Same binding as the other routes: the screen states the account it was showing.
    if (request.headers.get('X-Feedback-User-Id') !== user.id) {
      throw new AppError(409, 'account_changed', '로그인 계정이 바뀌었어요. 화면을 새로 불러온 뒤 다시 시도해 주세요.');
    }
    return json(await new FeedbackService(getDatabase()).act(user.id, await readJson(request)));
  });
}
