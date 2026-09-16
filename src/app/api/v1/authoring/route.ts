import { AuthoringService, openAuthoring, openAuthoringAccount } from '@/server/authoring';
import { getDatabase } from '@/server/db';
import { assertSameOrigin, requireUser, sessionUser } from '@/server/auth';
import { handle, json, readJson } from '@/server/http';
import { AppError } from '@/server/errors';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
/** A lesson document is far longer than a learning action, but still a bounded form submission. */
const bodyLimit = 256 * 1024;

/** With the editor open, a visitor writes as the shared account; otherwise sign-in decides. */
async function author(request: Request) {
  if (!openAuthoring()) return { user: await requireUser(request), signedIn: true };
  const account = await sessionUser(request);
  return account ? { user: account, signedIn: true } : { user: await openAuthoringAccount(getDatabase()), signedIn: false };
}

export function GET(request: Request) {
  return handle(async () => {
    const service = new AuthoringService(getDatabase());
    const { user } = await author(request);
    const draftId = new URL(request.url).searchParams.get('draftId');
    if (draftId) return json({ draft: await service.draft(user.id, draftId) });
    return json({ workspace: await service.workspace(user.id) });
  });
}

export function POST(request: Request) {
  return handle(async () => {
    assertSameOrigin(request);
    const { user, signedIn } = await author(request);
    // Same binding as the learning route: the screen states the account it was showing. With no
    // sign-in there is no account to confuse, so there is nothing to bind.
    if (signedIn && request.headers.get('X-Authoring-User-Id') !== user.id) {
      throw new AppError(409, 'account_changed', '로그인 계정이 바뀌었어요. 화면을 새로 불러온 뒤 다시 시도해 주세요.');
    }
    return json(await new AuthoringService(getDatabase()).act(user.id, await readJson(request, bodyLimit)));
  });
}
