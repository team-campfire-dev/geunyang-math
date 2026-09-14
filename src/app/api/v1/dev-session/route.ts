import { z } from 'zod';
import { assertSameOrigin, createDevelopmentSession, developmentLoginEnabled, sessionUser } from '@/server/auth';
import { AppError } from '@/server/errors';
import { handle, json, readJson } from '@/server/http';
export const runtime = 'nodejs';
export function POST(request: Request) {
  return handle(async () => {
    if (!developmentLoginEnabled(request)) throw new AppError(404, 'not_found', '사용할 수 없는 로그인 방식입니다.');
    assertSameOrigin(request);
    const existing = await sessionUser(request);
    if (existing) return json({ user: { id: existing.id, displayName: existing.displayName } });
    const input = z.object({ displayName: z.string().trim().min(1).max(40).optional() }).strict().parse(await readJson(request));
    const { user, cookie } = await createDevelopmentSession(input.displayName || '학습자');
    return json({ user: { id: user.id, displayName: user.displayName } }, 201, { 'Set-Cookie': cookie });
  });
}
