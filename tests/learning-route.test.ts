import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { Prisma } from '@prisma/client';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import * as database from '@/server/db';
import { hashSessionToken } from '@/server/auth';
import { seedClasses } from './fixtures/content';
import { indexClassDocument } from '@/server/content-store';
import { POST } from '@/app/api/v1/learning/route';

const testDatabaseUrl = process.env.TEST_DATABASE_URL;
const origin = 'https://math.example.com';
const profileAction = { action: 'profile.update', goal: 'daily-math', dailyMinutes: 20 };

describe.skipIf(!testDatabaseUrl)('learning HTTP account binding', () => {
  let db: ReturnType<typeof database.createDatabase>;
  beforeAll(async () => {
    const parsed = new URL(testDatabaseUrl!);
    if (parsed.protocol !== 'mysql:' || !decodeURIComponent(parsed.pathname.slice(1)).endsWith('_test')) throw new Error('Learning route integration requires a MySQL database ending in _test.');
    db = database.createDatabase(testDatabaseUrl!);
    const document = seedClasses[0];
    const serialized = JSON.stringify(document);
    const contentHash = createHash('sha256').update(serialized).digest('hex');
    const previous = await db.classVersion.findUnique({ where: { id: document.public.versionId } });
    if (previous) expect(previous.contentHash).toBe(contentHash);
    else await db.classVersion.create({ data: {
      id: document.public.versionId, classKey: document.public.classKey, title: document.public.title,
      order: document.public.order, document: JSON.parse(serialized) as Prisma.InputJsonValue, contentHash,
    } });
    await indexClassDocument(db, document);
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
  afterAll(async () => { await db?.$disconnect(); });

  async function learner() {
    const token = randomBytes(32).toString('hex');
    const user = await db.user.create({ data: {
      displayName: `route ${randomUUID()}`, scopes: { create: { kind: 'personal' } },
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
    for (const owner of [a, b]) expect(await db.user.findUniqueOrThrow({ where: { id: owner.user.id } })).toMatchObject({ goal: 'foundation-recovery', dailyMinutes: 10 });
  });

  it('does not start a class for B from A’s stale screen', async () => {
    const a = await learner(); const b = await learner();
    await expectAccountChanged(await POST(post(b.cookie, a.user.id, { action: 'enrollment.start', classKey: seedClasses[0].public.classKey })));
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
