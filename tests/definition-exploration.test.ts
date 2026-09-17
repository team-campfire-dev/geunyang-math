import { randomUUID } from 'node:crypto';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { parseContentBundle, validateReferences, type DefinitionRecord } from '@/core/content-bundle';
import { definitionPath, leafGlossary } from '@/shared/definition-exploration';
import { definitionRefId, mayReferenceDefinition, type DefinitionRef } from '@/shared/rich-text';
import { glossaryEntries } from '@/core/glossary';
import type { ContentBlock, GlossaryEntry } from '@/shared/api';
import * as database from '@/server/db';
import { LearningService } from '@/server/learning-service';
import { importContent, indexDefinitionBlocks } from '@/server/content-store';
import { POST } from '@/app/api/v1/definitions/route';
import { existingRows, removeRowsAddedSince, type Existing } from './cleanup';
import { lessonBundle, seedLessons } from './fixtures/content';
import dictionary from '../content/glossary-v3.json';
import previousDictionary from '../content/glossary-v2.json';

const block = (name: string, targets: DefinitionRef[] = []): ContentBlock => ({
  blockId: `${name}:body`, kind: 'core.rich_text', typeVersion: 3, required: true,
  payload: { text: targets.length ? targets.map((_, index) => `개념${index}`).join(' 그리고 ') : '수학적 조건을 보존한 설명입니다.',
    definitions: targets.map((ref, index) => ({ ...ref, surface: `개념${index}` })) },
});
const definition = (ref: DefinitionRef, targets: DefinitionRef[] = []): DefinitionRecord & { label: string } => ({
  ...ref, scopeKind: ref.scopeKind ?? 'global', scopeKey: ref.scopeKey ?? '', label: ref.conceptKey,
  usageNote: ref.scopeKind === 'lesson' ? '복소수 벡터공간' : '실수 좌표벡터', blocks: [block(definitionRefId(ref), targets)],
});

describe('definition exploration contract', () => {
  const a = { conceptKey: 'vector', scopeKind: 'lesson' as const, scopeKey: 'linear-algebra' };
  const b = { conceptKey: 'scalar', scopeKind: 'lesson' as const, scopeKey: 'linear-algebra' };
  it('collapses a cycle without confusing a shared definition with a lesson definition', () => {
    expect(definitionPath([a, b], a)).toEqual([a]);
    expect(definitionPath<DefinitionRef>([a, b], { conceptKey: 'vector' })).toHaveLength(3);
    expect(definitionPath([a], { ...a, scopeKey: 'another-lesson' })).toHaveLength(2);
  });
  it('allows shared and same-scope edges, but refuses a shared definition pointing into a lesson', () => {
    expect(mayReferenceDefinition(a, b)).toBe(true);
    expect(mayReferenceDefinition(a, { conceptKey: 'scalar' })).toBe(true);
    expect(mayReferenceDefinition({ conceptKey: 'vector' }, b)).toBe(false);
    expect(mayReferenceDefinition(a, { ...b, scopeKey: 'private' })).toBe(false);
  });
  it('removes outgoing links and assessed concepts from problem responses without mutating stored content', () => {
    const entries: GlossaryEntry[] = [a, b].map(ref => ({ ...definition(ref, [a, b]), summary: '', lessonKey: null }));
    const result = leafGlossary(entries, ['scalar']);
    expect(result).toHaveLength(1);
    expect(result[0].blocks[0].payload.definitions).toEqual([]);
    expect(entries[0].blocks[0].payload.definitions).toHaveLength(2);
    expect(result[0].usageNote).toBe('복소수 벡터공간');
  });
  it('validates real dictionary links and keeps mathematical context through export parsing', () => {
    const bundle = parseContentBundle({ ...dictionary, concepts: [...previousDictionary.concepts, ...dictionary.concepts] });
    expect(() => validateReferences(bundle)).not.toThrow();
    expect(bundle.definitions.find(item => item.conceptKey === 'fraction')?.blocks[0].payload.definitions).toContainEqual({ conceptKey: 'integer', surface: '정수' });
    expect(bundle.definitions.find(item => item.conceptKey === 'integer')?.usageNote).toBe('수의 범위');
    const missing = structuredClone(bundle); missing.definitions = missing.definitions.filter(item => item.conceptKey !== 'integer');
    expect(() => validateReferences(missing)).toThrow(/Missing definition/);
  });
  it('accepts a cycle at publish time, but refuses missing and cross-scope links', () => {
    const base = { schemaVersion: 1, concepts: [a, b].map(ref => ({ key: ref.conceptKey, label: ref.conceptKey, assessable: true })),
      lessons: [], diagnostics: [], definitions: [definition(a, [b]), definition(b, [a])] };
    expect(() => validateReferences(parseContentBundle(base))).not.toThrow();
    expect(() => validateReferences(parseContentBundle({ ...base, definitions: [definition({ conceptKey: a.conceptKey }, [b]), definition(b)] }))).toThrow(/own scope/);
    expect(() => validateReferences(parseContentBundle({ ...base, definitions: [definition(a, [b])] }))).toThrow(/Missing definition/);
  });
  it('chooses a related lesson in the current course, not the first unrelated course', () => {
    const unrelated = { ...seedLessons[0].public, courseKey: 'other', conceptKeys: ['vector'] };
    const relevant = { ...seedLessons[1].public, courseKey: 'linear-algebra', conceptKeys: ['vector'] };
    expect(glossaryEntries([{ ...definition(a), summary: '' }], [unrelated, relevant], 'linear-algebra')[0].lessonKey).toBe(relevant.lessonKey);
    expect(glossaryEntries([{ ...definition(a), summary: '' }], [unrelated], 'linear-algebra')[0].lessonKey).toBeNull();
  });
});

const url = process.env.TEST_DATABASE_URL;
describe.skipIf(!url)('definition exploration API on MySQL', () => {
  let db: ReturnType<typeof database.createDatabase>, service: LearningService, existing: Existing;
  const suffix = randomUUID();
  const lessonKey = `exploration-${suffix}`;
  const record = JSON.parse(JSON.stringify(seedLessons[0]).replaceAll('fraction-meaning', lessonKey)) as typeof seedLessons[number];
  const root: DefinitionRef = { conceptKey: `vector-${suffix}`, scopeKind: 'lesson', scopeKey: lessonKey };
  const child: DefinitionRef = { conceptKey: `scalar-${suffix}`, scopeKind: 'lesson', scopeKey: lessonKey };
  const common: DefinitionRef = { conceptKey: child.conceptKey };
  const hidden: DefinitionRef = { conceptKey: `hidden-${suffix}` };
  const question: DefinitionRef = { conceptKey: `question-${suffix}` };
  const defs = [definition(root, [child, common]), definition(child, [root]), definition(common), definition(hidden), definition(question, [hidden])];
  record.sections[0].contentBlocks[0] = block(`${lessonKey}:intro`, [root]);
  record.problems[0].promptContent = [block(`${lessonKey}:question`, [question])];
  const bundle = lessonBundle([record], { key: `course-${suffix}`, title: '개념 탐색 검사' });
  bundle.concepts.push(...[root, child, hidden, question].map(ref => ({ key: ref.conceptKey, label: ref.conceptKey, assessable: true })));
  bundle.definitions = defs;
  const request = (path: DefinitionRef[]) => ({ lessonKey, lessonVersionId: record.public.versionId, path });
  const revisions = () => db.$transaction([db.attempt.count(), db.hintUse.count(), db.enrollment.count(), db.recommendationHistory.count()]);
  beforeAll(async () => {
    const parsed = new URL(url!);
    if (parsed.protocol !== 'mysql:' || !parsed.pathname.endsWith('_test')) throw new Error('Use an isolated _test database.');
    db = database.createDatabase(url!); service = new LearningService(db); existing = await existingRows(db);
    await importContent(db, bundle);
  });
  afterEach(async () => {
    vi.restoreAllMocks(); vi.unstubAllEnvs();
    await importContent(db, { schemaVersion: 1, concepts: [], lessons: [], diagnostics: [], definitions: defs });
  });
  afterAll(async () => { if (existing) await removeRowsAddedSince(db, existing); await db?.$disconnect(); });

  it('loads one selected explanation, honors scoped meanings, and makes no learning records', async () => {
    const before = await revisions();
    const entry = await service.exploreDefinition(request([root, child]));
    expect(entry).toMatchObject({ conceptKey: child.conceptKey, scopeKind: 'lesson', usageNote: '복소수 벡터공간' });
    expect(entry.revision).toEqual(expect.any(String));
    expect(await service.exploreDefinition(request([root, common]))).toMatchObject({ scopeKind: 'global', usageNote: '실수 좌표벡터' });
    expect(await revisions()).toEqual(before);
  });
  it('does not preload linked bodies or links into the legacy/problem glossary', async () => {
    const document = await service.lessonDocument(lessonKey);
    expect(document.glossary.map(entry => entry.conceptKey).sort()).toEqual([root.conceptKey, question.conceptKey].sort());
    for (const entry of document.glossary) expect(entry.blocks[0].payload.definitions).toEqual([]);
    expect(JSON.stringify(document.glossary)).not.toContain(child.conceptKey);
    expect(JSON.stringify(document.glossary)).not.toContain(hidden.conceptKey);
  });
  it('rejects arbitrary roots, skipped edges, another scope, and question-rooted exploration', async () => {
    for (const path of [[hidden], [root, hidden], [common], [question], [question, hidden], [root, { ...child, scopeKey: 'other' }]]) {
      await expect(service.exploreDefinition(request(path))).rejects.toMatchObject({ status: 404 });
    }
    await expect(service.exploreDefinition({ ...request([root]), lessonVersionId: 'unpublished-version' })).rejects.toMatchObject({ status: 409 });
  });
  it('rechecks mutable edges, including returning to a previously visited definition', async () => {
    await service.exploreDefinition(request([root, child]));
    await importContent(db, { schemaVersion: 1, concepts: [], lessons: [], diagnostics: [], definitions: [definition(root, [common])] });
    await expect(service.exploreDefinition(request([root, child]))).rejects.toMatchObject({ status: 404 });
    expect(await service.exploreDefinition(request([root, common]))).toMatchObject({ scopeKind: 'global' });
  });
  it('rejects a cross-scope edge even if invalid rows bypassed the publisher', async () => {
    const row = await db.conceptDefinition.findUniqueOrThrow({ where: { conceptKey_scopeKind_scopeKey: { conceptKey: child.conceptKey, scopeKind: 'global', scopeKey: '' } } });
    await indexDefinitionBlocks(db, row.id, [block('forged-global-edge', [child])]);
    await expect(service.exploreDefinition(request([root, common, child]))).rejects.toMatchObject({ status: 404 });
  });
  it('serves a public preview over HTTP, rejects malformed/foreign requests, and never caches the response', async () => {
    vi.stubEnv('APP_ORIGIN', 'http://localhost:3017');
    vi.spyOn(database, 'getDatabase').mockReturnValue(db);
    const incoming = (body: unknown, origin = 'http://localhost:3017') => new Request('http://localhost:3017/api/v1/definitions', {
      method: 'POST', headers: { origin, 'content-type': 'application/json' }, body: JSON.stringify(body),
    });
    const response = await POST(incoming(request([root, child])));
    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(await response.json()).toMatchObject({ conceptKey: child.conceptKey, usageNote: '복소수 벡터공간' });
    expect((await POST(incoming({ ...request([root]), path: [] }))).status).toBe(400);
    expect((await POST(incoming(request([root]), 'https://foreign.invalid'))).status).toBe(403);
  });
});
