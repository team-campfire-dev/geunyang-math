import { randomBytes, randomUUID } from 'node:crypto';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { existingRows, removeRowsAddedSince, type Existing } from './cleanup';
import * as database from '@/server/db';
import { hashSessionToken } from '@/server/auth';
import { importContent } from '@/server/content-store';
import type { LessonRecord } from '@/core/content';
import { agentCodePattern, type AgentKeyResponse } from '@/shared/agent';
import type { DraftDetail } from '@/shared/authoring';
import { lessonBundle, seedLessons } from './fixtures/content';
import * as agentRoute from '@/app/api/v1/agent/route';
import * as keysRoute from '@/app/api/v1/agent-keys/route';

const url = process.env.TEST_DATABASE_URL;
const origin = 'https://math.example.com';

describe.skipIf(!url)('lesson editing for an AI holding a code', () => {
  let db: ReturnType<typeof database.createDatabase>;
  let existing: Existing;
  let lessonKey: string;

  beforeAll(async () => {
    const parsed = new URL(url!);
    if (parsed.protocol !== 'mysql:' || !parsed.pathname.endsWith('_test')) throw new Error('Use an isolated _test database.');
    db = database.createDatabase(url!);
    existing = await existingRows(db);
    // A lesson of this suite's own, so what it publishes disturbs nobody else's counting.
    lessonKey = `agent-${randomUUID()}`;
    const base = JSON.parse(JSON.stringify(seedLessons[0]).replaceAll('fraction-meaning', lessonKey)) as LessonRecord;
    await importContent(db, lessonBundle([base], { key: `course-${lessonKey}`, title: '검사 코스' }));
  });
  beforeEach(() => {
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv('APP_ORIGIN', origin);
    vi.stubEnv('GOOGLE_LOGIN_ENABLED', 'true');
    vi.stubEnv('GOOGLE_CLIENT_ID', 'fixture.apps.googleusercontent.com');
    vi.stubEnv('GOOGLE_CLIENT_SECRET', 'fixture-secret');
    vi.spyOn(database, 'getDatabase').mockImplementation(() => db);
    vi.spyOn(console, 'info').mockImplementation(() => {});
  });
  afterEach(() => { vi.unstubAllEnvs(); vi.restoreAllMocks(); });
  afterAll(async () => {
    if (existing) await removeRowsAddedSince(db, existing);
    await db?.$disconnect();
  });

  async function account(role?: 'admin' | 'author') {
    const token = randomBytes(32).toString('hex');
    const user = await db.user.create({ data: {
      displayName: `agent ${randomUUID()}`, learningScopes: { create: { kind: 'personal' } },
      sessions: { create: { tokenHash: hashSessionToken(token), authMethod: 'google', expiresAt: new Date(Date.now() + 60000) } },
    } });
    if (role) await db.contentAuthor.create({ data: { userId: user.id, role } });
    return { user, cookie: `__Host-gm_session=${token}` };
  }
  const keys = (who: { user: { id: string }; cookie: string }, body: unknown) => keysRoute.POST(new Request(`${origin}/api/v1/agent-keys`, {
    method: 'POST', headers: { origin, cookie: who.cookie, 'content-type': 'application/json', 'X-Agent-Keys-User-Id': who.user.id },
    body: JSON.stringify(body),
  }));
  async function issue(who: { user: { id: string }; cookie: string }, mayPublish = false) {
    const response = await keys(who, { action: 'key.issue', name: 'Claude', days: 7, mayPublish });
    expect(response.status).toBe(200);
    return (await response.json() as AgentKeyResponse).issued!.code;
  }
  const get = (code: string | null, query = '') => agentRoute.GET(new Request(`https://elsewhere.example/api/v1/agent${query}`, {
    headers: code ? { authorization: `Bearer ${code}` } : {},
  }));
  const post = (code: string, body: unknown) => agentRoute.POST(new Request(`https://elsewhere.example/api/v1/agent`, {
    method: 'POST', headers: { authorization: `Bearer ${code}`, 'content-type': 'application/json' }, body: JSON.stringify(body),
  }));
  const errorOf = async (response: Response) => ((await response.json()) as { error: { code: string } }).error.code;

  it('shows a code once and keeps only its hash and first characters', async () => {
    const owner = await account('author');
    const response = await keys(owner, { action: 'key.issue', name: '  Claude  ', days: 30, mayPublish: false });
    const { issued, view } = await response.json() as AgentKeyResponse;
    expect(issued!.code).toMatch(agentCodePattern);
    expect(issued!.key).toMatchObject({ name: 'Claude', hint: issued!.code.slice(0, 10), mayPublish: false });
    expect(view.keys.map((key) => key.id)).toEqual([issued!.key.id]);
    expect(JSON.stringify(view)).not.toContain(issued!.code);
    const row = await db.agentKey.findUniqueOrThrow({ where: { id: issued!.key.id } });
    expect(row.tokenHash).toBe(hashSessionToken(issued!.code));
    expect(row.expiresAt.getTime()).toBeGreaterThan(Date.now() + 29 * 86_400_000);
  });

  it('makes codes only for an account that edits, and publishing ones only for one that publishes', async () => {
    expect((await keys(await account(), { action: 'key.issue', name: 'x', days: 7, mayPublish: false })).status).toBe(403);
    const author = await account('author');
    const refused = await keys(author, { action: 'key.issue', name: 'x', days: 7, mayPublish: true });
    expect(refused.status).toBe(403);
    expect(await errorOf(refused)).toBe('not_a_publisher');
    expect((await keys(author, { action: 'key.issue', name: 'x', days: 5, mayPublish: false })).status).toBe(400);
  });

  it('refuses a request with no code, a malformed one, a revoked one or one that ran out', async () => {
    const owner = await account('author');
    const code = await issue(owner);
    expect((await get(code)).status).toBe(200);
    expect((await get(null)).status).toBe(401);
    expect((await get(`${code.slice(0, -1)}x`)).status).toBe(401);
    expect((await get(`gmk_${'0'.repeat(64)}`)).status).toBe(401);

    const key = await db.agentKey.findUniqueOrThrow({ where: { tokenHash: hashSessionToken(code) } });
    await db.agentKey.update({ where: { id: key.id }, data: { expiresAt: new Date(Date.now() - 1000) } });
    expect((await get(code)).status).toBe(401);

    const other = await issue(owner);
    const otherKey = await db.agentKey.findUniqueOrThrow({ where: { tokenHash: hashSessionToken(other) } });
    // Another account cannot revoke it; its owner can, and the code stops at once.
    await keys(await account('author'), { action: 'key.revoke', keyId: otherKey.id });
    expect((await get(other)).status).toBe(200);
    await keys(owner, { action: 'key.revoke', keyId: otherKey.id });
    expect((await get(other)).status).toBe(401);
    // The one that ran out is gone the next time its owner looks.
    await keysRoute.GET(new Request(`${origin}/api/v1/agent-keys`, { headers: { cookie: owner.cookie } }));
    expect(await db.agentKey.count({ where: { userId: owner.user.id } })).toBe(0);
  });

  it('stops working when its account loses the right to edit', async () => {
    const owner = await account('author');
    const code = await issue(owner);
    await db.contentAuthor.delete({ where: { userId: owner.user.id } });
    expect((await get(code)).status).toBe(403);
    expect((await post(code, { action: 'draft.create', lessonKey })).status).toBe(403);
  });

  it('guides the AI with its actions, the block formats and the writing guide', async () => {
    const owner = await account('author');
    const { guide } = await (await get(await issue(owner))).json();
    expect(guide.you).toMatchObject({ role: 'author', key: 'Claude', mayPublish: false, account: owner.user.displayName });
    const actions = guide.actions.map((action: { action: string }) => action.action);
    expect(actions).toEqual(expect.arrayContaining(['draft.create', 'draft.save', 'draft.validate', 'draft.review', 'draft.publish']));
    for (const fenced of ['role.grant', 'draft.delete', 'course.save', 'diagnostic.publish', 'draft.generateProblems']) expect(actions).not.toContain(fenced);
    const save = guide.actions.find((action: { action: string }) => action.action === 'draft.save');
    expect(save.schema.required).toEqual(expect.arrayContaining(['draftId', 'edit', 'baseUpdatedAt']));
    expect(guide.actions.find((action: { action: string }) => action.action === 'draft.publish').mayUse).toBe(false);
    const kinds = guide.blocks.map((block: { kind: string; typeVersion: number }) => `${block.kind}@${block.typeVersion}`);
    expect(kinds).toEqual(expect.arrayContaining(['core.rich_text@3', 'core.scene@1', 'core.table@1']));
    expect(kinds).not.toContain('math.fraction_strip@1');
    expect(guide.blocks.find((block: { kind: string }) => block.kind === 'core.table').payloadSchema.required).toEqual(expect.arrayContaining(['caption', 'columns', 'rows']));
    expect(guide.writingGuide).toContain('### 1. 어투');
  });

  it('writes a draft as its account and asks for review, but cannot publish or reach what is fenced off', async () => {
    const owner = await account('author');
    const code = await issue(owner);
    const { workspace } = await (await get(code, '?view=workspace')).json();
    expect(workspace.lessons.map((lesson: { lessonKey: string }) => lesson.lessonKey)).toContain(lessonKey);
    expect(workspace).not.toHaveProperty('accounts');

    const created = await post(code, { action: 'draft.create', lessonKey });
    const { draft, workspace: echoed } = await created.json() as { draft: DraftDetail; workspace?: unknown };
    expect(echoed).toBeUndefined();
    expect(draft.mine).toBe(true);
    expect((await db.contentDraft.findUniqueOrThrow({ where: { id: draft.id } })).authorId).toBe(owner.user.id);

    const edit = structuredClone(draft.edit);
    edit.meta.summary = 'AI가 고친 소개예요.';
    const saved = await post(code, { action: 'draft.save', draftId: draft.id, baseUpdatedAt: draft.updatedAt, edit });
    expect(saved.status).toBe(200);
    const next = (await saved.json() as { draft: DraftDetail }).draft;
    expect(next.edit.meta.summary).toBe('AI가 고친 소개예요.');
    expect((await (await get(code, `?draftId=${next.id}`)).json()).draft.updatedAt).toBe(next.updatedAt);

    // A save must say which draft it was made from.
    expect((await post(code, { action: 'draft.save', draftId: draft.id, edit })).status).toBe(400);

    expect((await post(code, { action: 'draft.validate', draftId: draft.id })).status).toBe(200);
    const reviewed = await post(code, { action: 'draft.review', draftId: draft.id, asking: true });
    expect((await reviewed.json() as { draft: DraftDetail }).draft.status).toBe('review');

    const publish = await post(code, { action: 'draft.publish', draftId: draft.id });
    expect(publish.status).toBe(403);
    expect(await errorOf(publish)).toBe('agent_publish');
    const definition = await post(code, { action: 'definition.save', edit: {} });
    expect(await errorOf(definition)).toBe('agent_publish');
    for (const fenced of [{ action: 'draft.delete', draftId: draft.id }, { action: 'role.grant', userId: owner.user.id, role: 'admin' }]) {
      const response = await post(code, fenced);
      expect(response.status).toBe(403);
      expect(await errorOf(response)).toBe('agent_action');
    }
    expect(await db.contentDraft.count({ where: { id: draft.id } })).toBe(1);
    await db.contentDraft.delete({ where: { id: draft.id } });
  });

  it('refuses a save made from a draft that changed since it was read', async () => {
    const owner = await account('author');
    const code = await issue(owner);
    const { draft } = await (await post(code, { action: 'draft.create', lessonKey })).json() as { draft: DraftDetail };
    // Somebody in the editor saves in between.
    await db.contentDraft.update({ where: { id: draft.id }, data: { title: '사람이 바꾼 제목' } });
    const edit = structuredClone(draft.edit);
    edit.meta.summary = '늦게 온 저장';
    const stale = await post(code, { action: 'draft.save', draftId: draft.id, baseUpdatedAt: draft.updatedAt, edit });
    expect(stale.status).toBe(409);
    expect(await errorOf(stale)).toBe('draft_changed');
    expect((await db.contentDraft.findUniqueOrThrow({ where: { id: draft.id } })).title).toBe('사람이 바꾼 제목');
    await db.contentDraft.delete({ where: { id: draft.id } });
  });

  it('publishes with a code made for it, as its account', async () => {
    const admin = await account('admin');
    const code = await issue(admin, true);
    const { draft } = await (await post(code, { action: 'draft.create', lessonKey })).json() as { draft: DraftDetail };
    const published = await post(code, { action: 'draft.publish', draftId: draft.id });
    expect(published.status).toBe(200);
    const { publishedVersionId } = await published.json() as { publishedVersionId: string };
    expect(publishedVersionId).toBe(draft.versionId);
    expect(await db.lessonVersion.count({ where: { id: publishedVersionId } })).toBe(1);
  });
});
