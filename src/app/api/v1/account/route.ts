import { deleteAccount } from '@/server/account-service';
import { getDatabase } from '@/server/db';
import { assertSameOrigin, requireUser, revokeSession } from '@/server/auth';
import { handle } from '@/server/http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Deletes the signed-in account. Only the person themselves, on their own session — there is no id
 * in the request, so nothing here can be pointed at someone else. The session goes with it: the
 * cookies are cleared on the way out, and the row they named is gone in any case.
 */
export function DELETE(request: Request) {
  return handle(async () => {
    assertSameOrigin(request);
    const user = await requireUser(request);
    const removed = await deleteAccount(getDatabase(), user.id);
    console.log(JSON.stringify({ event: 'account_deleted', ...removed }));
    return Response.json({ removed }, { headers: await revokeSession(request) });
  });
}
