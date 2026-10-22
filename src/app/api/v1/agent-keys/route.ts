import { AgentKeyService } from '@/server/agent';
import { getDatabase } from '@/server/db';
import { assertSameOrigin, requireUser } from '@/server/auth';
import { handle, json, readJson } from '@/server/http';
import { AppError } from '@/server/errors';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** The codes this account has given an AI. Signing in is always required: a code writes as somebody, never as the shared editor. */
export function GET(request: Request) {
  return handle(async () => json({ view: await new AgentKeyService(getDatabase()).view((await requireUser(request)).id) }));
}

export function POST(request: Request) {
  return handle(async () => {
    assertSameOrigin(request);
    const user = await requireUser(request);
    // Same binding as the other routes: the screen states the account it was showing.
    if (request.headers.get('X-Agent-Keys-User-Id') !== user.id) {
      throw new AppError(409, 'account_changed', '로그인 계정이 바뀌었어요. 화면을 새로 불러온 뒤 다시 시도해 주세요.');
    }
    return json(await new AgentKeyService(getDatabase()).act(user.id, await readJson(request)));
  });
}
