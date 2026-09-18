import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { Prisma } from '@prisma/client';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { existingRows, removeRowsAddedSince, type Existing } from './cleanup';
import * as database from '@/server/db';
import { hashSessionToken } from '@/server/auth';
import { lessonBundle, seedLessons } from './fixtures/content';
import { importContent, lessonRecord } from '@/server/content-store';
import { POST } from '@/app/api/v1/learning/route';

const testDatabaseUrl = process.env.TEST_DATABASE_URL;
const origin = 'https://math.example.com';
const profileAction = { action: 'profile.update', targetCourseKey: null, dailyMinutes: 20 };

describe.skipIf(!testDatabaseUrl)('learning HTTP account binding', () => {
  let db: ReturnType<typeof database.createDatabase>;
  let existing: Existing;
  beforeAll(async () => {
    const parsed = new URL(testDatabaseUrl!);
    if (parsed.protocol !== 'mysql:' || !decodeURIComponent(parsed.pathname.slice(1)).endsWith('_test')) throw new Error('Learning route integration requires a MySQL database ending in _test.');
    db = database.createDatabase(testDatabaseUrl!);
    existing = await existingRows(db);
    // The seeded lessons are installed by db:seed; publishing them again is a no-op that proves they read back whole.
    await importContent(db, lessonBundle([...seedLessons]));
    expect(await lessonRecord(db, seedLessons[0].public.versionId)).toEqual(seedLessons[0]);
  });
  beforeEach(() => {
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv('APP_ORIGIN', origin);
    vi.stubEnv('GOOGLE_LOGIN_ENABLED', 'true');
    vi.stubEnv('GOOGLE_CLIENT_ID', 'fixture.apps.googleusercontent.com');
    vi.stubEnv('GOOGLE_CLIENT_SECRET', 'fixture-secret');
    vi.spyOn(database, 'getDatabase').mockImplementation(() => db);
  });
  afterEach(() => { vi.unstubAllEnvs(); vi.restoreAllMocks(); });
  afterAll(async () => {
    // A shared database keeps whatever a run leaves behind, so this run leaves nothing.
    if (existing) await removeRowsAddedSince(db, existing);
    await db?.$disconnect();
  });

  async function learner() {
    const token = randomBytes(32).toString('hex');
    const user = await db.user.create({ data: {
      displayName: `route ${randomUUID()}`, learningScopes: { create: { kind: 'personal' } },
      sessions: { create: { tokenHash: hashSessionToken(token), authMethod: 'google', expiresAt: new Date(Date.now() + 60000) } },
    } });
    return { user, cookie: `__Host-gm_session=${token}` };
  }
  function post(cookie: string | undefined, expectedUserId: string | undefined, body: unknown, requestOrigin = origin) {
    return new Request(`${origin}/api/v1/learning`, { method: 'POST', headers: {
      origin: requestOrigin, 'content-type': 'application/json', ...(cookie ? { cookie } : {}),
      ...(expectedUserId !== undefined ? { 'X-Learning-User-Id': expectedUserId } : {}),
    }, body: typeof body === 'string' ? body : JSON.stringify(body) });
  }
  async function expectAccountChanged(response: Response) {
    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({ error: { code: 'account_changed' } });
  }

  it('rejects profile edits from A’s stale screen after the browser cookie switches to B', async () => {
    const a = await learner(); const b = await learner();
    await expectAccountChanged(await POST(post(b.cookie, a.user.id, profileAction)));
    for (const owner of [a, b]) expect(await db.user.findUniqueOrThrow({ where: { id: owner.user.id } })).toMatchObject({ targetCourseKey: null, dailyMinutes: 10 });
  });

  it('does not start a lesson for B from A’s stale screen', async () => {
    const a = await learner(); const b = await learner();
    await expectAccountChanged(await POST(post(b.cookie, a.user.id, { action: 'enrollment.start', lessonKey: seedLessons[0].public.lessonKey })));
    expect(await db.enrollment.count({ where: { userId: { in: [a.user.id, b.user.id] } } })).toBe(0);
  });

  it('fails closed for a legacy caller without the expected account header', async () => {
    const b = await learner();
    await expectAccountChanged(await POST(post(b.cookie, undefined, profileAction)));
    expect((await db.user.findUniqueOrThrow({ where: { id: b.user.id } })).dailyMinutes).toBe(10);
  });

  it('checks account binding before parsing or consuming the request body', async () => {
    const a = await learner(); const b = await learner();
    const incoming = post(b.cookie, a.user.id, '{malformed');
    await expectAccountChanged(await POST(incoming));
    expect(incoming.bodyUsed).toBe(false);
  });

  it('continues to save when the screen account and authenticated account match', async () => {
    const a = await learner(); const b = await learner();
    const response = await POST(post(b.cookie, b.user.id, profileAction));
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ state: { user: { id: b.user.id, dailyMinutes: 20 } } });
    expect((await db.user.findUniqueOrThrow({ where: { id: b.user.id } })).dailyMinutes).toBe(20);
    expect((await db.user.findUniqueOrThrow({ where: { id: a.user.id } })).dailyMinutes).toBe(10);
  });

  it('does not treat the expected user header as authentication', async () => {
    const b = await learner();
    const response = await POST(post(undefined, b.user.id, profileAction));
    expect(response.status).toBe(401);
    expect((await db.user.findUniqueOrThrow({ where: { id: b.user.id } })).dailyMinutes).toBe(10);
  });

  it('keeps the same-origin check ahead of the account binding guard', async () => {
    const a = await learner(); const b = await learner();
    const incoming = post(b.cookie, a.user.id, profileAction, 'https://attacker.example.com');
    expect((await POST(incoming)).status).toBe(403);
    expect(incoming.bodyUsed).toBe(false);
  });

  it('rejects ambiguous duplicate account headers', async () => {
    const b = await learner();
    const incoming = post(b.cookie, b.user.id, profileAction);
    incoming.headers.append('X-Learning-User-Id', b.user.id);
    await expectAccountChanged(await POST(incoming));
    expect((await db.user.findUniqueOrThrow({ where: { id: b.user.id } })).dailyMinutes).toBe(10);
  });
});
