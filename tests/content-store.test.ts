import { createHash, randomUUID } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createDatabase } from '@/server/db';
import { LearningService } from '@/server/learning-service';
import { canonicalJson, parseContentBundle, validateReferences } from '@/core/content-bundle';
import { blockOf, classRecord, currentDiagnostic, currentTerms, diagnosticDefinitions, exportContent, importContent, indexClassDocument, publishBundle, verifyContent } from '@/server/content-store';
import initial from './fixtures/initial-content.json';
import { seedClasses } from './fixtures/content';

const bundle = () => parseContentBundle(structuredClone(initial));
const empty = () => ({ schemaVersion: 1 as const, skills: [], classes: [], diagnostics: [], terms: [] });
function newClass() {
  const key = `content-test-${randomUUID()}`;
  const c = JSON.parse(JSON.stringify(seedClasses[0]).replaceAll('fraction-meaning', key)) as typeof seedClasses[number];
  c.public.order = 1000;
  return c;
}

const termFixture = {
  versionId: 'term.denominator:v1', termKey: 'term.denominator',
  scopeKind: 'global' as const, scopeKey: '', skillKey: 'fraction.meaning',
  label: '분모', summary: '전체를 몇 조각으로 나누었는지 나타내는 수예요.',
  blocks: [{ blockId: 'term.denominator:v1:b1', kind: 'core.rich_text', typeVersion: 1, required: true,
    payload: { text: '분모는 전체를 몇 조각으로 나누었는지 알려줘요.' } }],
};
/** The third class links a prerequisite term; its own concept must never link here. */
function withTerms() {
  const b = bundle();
  b.terms = [structuredClone(termFixture)];
  const block = b.classes[2].sections[0].contentBlocks[0];
  b.classes[2].sections[0].contentBlocks[0] = { ...block, typeVersion: 2,
    payload: { text: block.payload.text, terms: [{ termKey: 'term.denominator', surface: '분모' }] } };
  return b;
}

describe('content publishing contract', () => {
  it('accepts the historical fixture and compares MySQL key ordering semantically', () => {
    expect(() => validateReferences(bundle())).not.toThrow();
    expect(canonicalJson({ b: [2, 1], a: { d: 2, c: 1 } })).toBe(canonicalJson({ a: { c: 1, d: 2 }, b: [2, 1] }));
    expect(canonicalJson([1, 2])).not.toBe(canonicalJson([2, 1]));
  });
  it('rejects unknown skills, duplicate versions, and shared diagnostic/class question IDs', () => {
    const a = bundle(); a.skills = [];
    expect(() => validateReferences(a)).toThrow(/Missing skill/);
    const b = bundle(); b.classes.push(b.classes[0]);
    expect(() => parseContentBundle(b)).toThrow(/Duplicate/);
    const c = bundle(); c.diagnostics[0].problems[0].problemVersionId = c.classes[0].problems[0].problemVersionId;
    expect(() => validateReferences(c)).toThrow(/overlaps class/);
  });
  it('validates private diagnostic grading and forbids hints and unsupported required blocks', () => {
    const a = bundle(); a.diagnostics[0].problems[0].responseSpec.kind = 'integer';
    expect(() => parseContentBundle(a)).toThrow(/must match/);
    const b = structuredClone(initial); b.diagnostics[0].problems[0].hintAvailable = true;
    expect(() => parseContentBundle(b)).toThrow();
    const c = bundle(); c.diagnostics[0].problems[0].promptContent[0].kind = 'future.graph';
    expect(() => parseContentBundle(c)).toThrow(/Unsupported block/);
  });
  it('rejects case-only identities that MySQL treats as equal', () => {
    const a = bundle(); a.skills.push({ ...a.skills[0], key: a.skills[0].key.toUpperCase() });
    expect(() => validateReferences(a)).toThrow(/letter case/);
    const b = bundle(); b.diagnostics[0].problems[0].problemVersionId = b.classes[0].problems[0].problemVersionId.toUpperCase();
    expect(() => validateReferences(b)).toThrow(/letter case/);
  });
  it('links class text to published terms and rejects a class that links to none', () => {
    expect(() => validateReferences(withTerms())).not.toThrow();
    const orphan = withTerms(); orphan.terms = [];
    expect(() => validateReferences(orphan)).toThrow(/Missing term/);
    const moved = withTerms(); moved.terms.push({ ...moved.terms[0], versionId: 'term.denominator:v2', skillKey: 'fraction.addition' });
    expect(() => validateReferences(moved)).toThrow(/concept cannot change/);
    const cased = withTerms(); cased.terms.push({ ...cased.terms[0], versionId: 'term.denominator:v2', termKey: 'TERM.denominator' });
    expect(() => validateReferences(cased)).toThrow(/letter case/);
  });
  it('keeps a class term and a dictionary term apart even when they share a key', () => {
    const b = withTerms();
    const classKey = b.classes[2].public.classKey;
    // The same key, kept by the class itself: its own wording, not the operator's dictionary.
    b.terms.push({ ...structuredClone(termFixture), versionId: `${classKey}:term.denominator:v1`,
      scopeKind: 'class', scopeKey: classKey, summary: '이 수업에서만 쓰는 설명이에요.',
      blocks: [{ ...termFixture.blocks[0], blockId: `${classKey}:term.denominator:v1:b1` }] });
    const block = b.classes[2].sections[0].contentBlocks[0];
    b.classes[2].sections[0].contentBlocks[0] = { ...block,
      payload: { text: block.payload.text, terms: [{ termKey: 'term.denominator', surface: '분모', scopeKind: 'class', scopeKey: classKey }] } };
    expect(() => validateReferences(b)).not.toThrow();
    // Each scope keeps its own concept history, so one may be reworded without disturbing the other.
    const moved = structuredClone(b);
    moved.terms.push({ ...moved.terms[1], versionId: `${classKey}:term.denominator:v2`, skillKey: 'fraction.addition' });
    expect(() => validateReferences(moved)).toThrow(/concept cannot change/);
    const globalMoved = structuredClone(b);
    globalMoved.terms.push({ ...globalMoved.terms[0], versionId: 'term.denominator:v2', skillKey: 'fraction.addition' });
    expect(() => validateReferences(globalMoved)).toThrow(/concept cannot change/);
  });

  it('refuses a class that links a term another class keeps', () => {
    const b = withTerms();
    const owner = b.classes[0].public.classKey, borrower = b.classes[2].public.classKey;
    b.terms.push({ ...structuredClone(termFixture), versionId: `${owner}:term.denominator:v1`,
      scopeKind: 'class', scopeKey: owner,
      blocks: [{ ...termFixture.blocks[0], blockId: `${owner}:term.denominator:v1:b1` }] });
    const block = b.classes[2].sections[0].contentBlocks[0];
    b.classes[2].sections[0].contentBlocks[0] = { ...block,
      payload: { text: block.payload.text, terms: [{ termKey: 'term.denominator', surface: '분모', scopeKind: 'class', scopeKey: owner }] } };
    expect(borrower).not.toBe(owner);
    expect(() => validateReferences(b)).toThrow(/can only link its own terms/);
  });

  it('refuses a scope that does not say what it belongs to', () => {
    const missingKey = { ...structuredClone(initial), terms: [{ ...termFixture, scopeKind: 'class' as const, scopeKey: '' }] };
    expect(() => parseContentBundle(missingKey)).toThrow(/scope it belongs to/);
    const strayKey = { ...structuredClone(initial), terms: [{ ...termFixture, scopeKey: 'fraction-meaning' }] };
    expect(() => parseContentBundle(strayKey)).toThrow(/scope it belongs to/);
    // A bundle written before scopes existed still imports as the shared dictionary.
    const older = { ...structuredClone(initial), terms: [{ versionId: termFixture.versionId, termKey: termFixture.termKey,
      skillKey: termFixture.skillKey, label: termFixture.label, summary: termFixture.summary, blocks: termFixture.blocks }] };
    expect(parseContentBundle(older).terms[0]).toMatchObject({ scopeKind: 'global', scopeKey: '' });
  });

  it('refuses a question that explains the concept it assesses', () => {
    const b = withTerms();
    const problem = b.classes[0].problems[0];
    problem.promptContent[0] = { ...problem.promptContent[0], typeVersion: 2,
      payload: { text: '분모가 4인 분수를 고르세요.', terms: [{ termKey: 'term.denominator', surface: '분모' }] } };
    expect(problem.skillKeys).toContain('fraction.meaning');
    expect(() => validateReferences(b)).toThrow(/cannot explain the concept it assesses/);
  });
  it('keeps term definitions free of questions and of further term links', () => {
    const withBlock = (block: unknown) => ({ ...structuredClone(initial), terms: [{ ...termFixture, blocks: [block] }] });
    expect(() => parseContentBundle(withBlock({ blockId: 'term:bad:v1', kind: 'core.problem_set', typeVersion: 1, required: true,
      payload: { problemVersionIds: [initial.classes[0].problems[0].problemVersionId] } }))).toThrow();
    expect(() => parseContentBundle(withBlock({ blockId: 'term:bad:v1', kind: 'core.rich_text', typeVersion: 2, required: true,
      payload: { text: '분모를 설명해요.', terms: [{ termKey: 'term.denominator', surface: '분모' }] } }))).toThrow();
    expect(() => parseContentBundle(withBlock(termFixture.blocks[0]))).not.toThrow();
  });
  it('keeps fixture imports outside runtime and migrator code', () => {
    function visit(dir: string): string[] { return readdirSync(dir, { withFileTypes: true }).flatMap(e => e.isDirectory() ? visit(`${dir}/${e.name}`) : /\.[cm]?[jt]sx?$/.test(e.name) ? [`${dir}/${e.name}`] : []); }
    for (const path of [...visit('src'), ...visit('scripts'), 'prisma/seed.ts']) {
      expect(readFileSync(path, 'utf8'), path).not.toMatch(/(?:from\s*|import\s*\()["'][^"']*(?:fixtures|core\/seed|core\/diagnostic|initial-content)/);
    }
  });
});

const url = process.env.TEST_DATABASE_URL;
describe.skipIf(!url)('DB content publishing and learner snapshot preservation', () => {
  let db: ReturnType<typeof createDatabase>, service: LearningService;
  beforeAll(() => {
    const parsed = new URL(url!);
    if (parsed.protocol !== 'mysql:' || !parsed.pathname.endsWith('_test')) throw new Error('Use an isolated _test database.');
    db = createDatabase(url!); service = new LearningService(db);
  });
  afterAll(async () => { await db?.$disconnect(); });
  const learner = () => db.user.create({ data: { displayName: `content ${randomUUID()}`, scopes: { create: { kind: 'personal' } } } });
  it('loads migration content exactly, retaining legacy hashes and all diagnostic questions', async () => {
    for (const c of seedClasses) {
      const row = await db.classVersion.findUniqueOrThrow({ where: { id: c.public.versionId } });
      // What the migration installed as one document still reads back out of its rows, exactly.
      expect(await classRecord(db, c.public.versionId)).toEqual(c);
      expect(row.contentHash).toBe(createHash('sha256').update(JSON.stringify(c)).digest('hex'));
    }
    const diagnostic = await db.diagnosticVersion.findUniqueOrThrow({ where: { id: initial.diagnostics[0].versionId } });
    expect((await diagnosticDefinitions(db, [diagnostic]))[0].problems).toEqual(initial.diagnostics[0].problems);
    expect((await verifyContent(db)).skills).toBeGreaterThanOrEqual(3);
  });
  it('exports and reimports without rewriting any published content, hash or timestamp', async () => {
    const before = await db.classVersion.findMany({ orderBy: { id: 'asc' } });
    const exported = await exportContent(db);
    const result = await importContent(db, JSON.parse(JSON.stringify(exported)));
    expect(result).toMatchObject({ newClasses: 0, newDiagnostics: 0 });
    expect(await db.classVersion.findMany({ orderBy: { id: 'asc' } })).toEqual(before);
  });
  it('publishes a DB-only class and skill atomically; dry run writes nothing and changed versions are rejected', async () => {
    const c = newClass(), skillKey = `test.${randomUUID()}`;
    c.public.skillKeys = [skillKey]; c.public.prerequisiteSkillKeys = [];
    c.problems.forEach(p => { p.skillKeys = [skillKey]; });
    const input = { ...empty(), classes: [c], skills: [{ key: skillKey, label: 'DB에서 등록한 개념', order: 999 }] };
    expect(await importContent(db, input, true)).toMatchObject({ dryRun: true, newClasses: 1 });
    expect(await db.classVersion.findUnique({ where: { id: c.public.versionId } })).toBeNull();
    expect(await db.skill.findUnique({ where: { key: skillKey } })).toBeNull();
    await importContent(db, input);
    const user = await learner();
    const state = await service.state(user.id);
    expect(state.classes).toContainEqual(c.public);
    expect(state.skills).toContainEqual({ key: skillKey, label: 'DB에서 등록한 개념', state: 'unknown' });
    expect(JSON.stringify(await service.classDocument(c.public.classKey))).not.toContain('gradingSpec');
    const edited = structuredClone(c); edited.public.title = 'Cannot overwrite';
    await expect(importContent(db, { ...input, classes: [edited], skills: [{ ...input.skills[0], label: 'Must not persist' }] })).rejects.toThrow(/immutable/);
    expect((await db.skill.findUniqueOrThrow({ where: { key: skillKey } })).label).toBe('DB에서 등록한 개념');
  });
  it('rejects unknown references and changes to reused question versions without partial writes', async () => {
    const bad = newClass(); bad.public.skillKeys = ['missing.skill']; bad.problems.forEach(p => { p.skillKeys = ['missing.skill']; });
    await expect(importContent(db, { ...empty(), classes: [bad] })).rejects.toThrow(/Missing skill/);
    expect(await db.classVersion.findUnique({ where: { id: bad.public.versionId } })).toBeNull();
    const first = newClass(); await importContent(db, { ...empty(), classes: [first] });
    const second = structuredClone(first); second.public.versionId += '-next'; second.problems[0].promptContent[0].payload.text = 'Changed problem';
    await expect(importContent(db, { ...empty(), classes: [second] })).rejects.toThrow(/Problem version is immutable/);
    expect(await db.classVersion.findUnique({ where: { id: second.public.versionId } })).toBeNull();
  });
  it('selects the last newly published version while pinning existing enrollment and homework', async () => {
    const first = newClass(); await importContent(db, { ...empty(), classes: [first] });
    const user = await learner(), scope = await db.scope.findUniqueOrThrow({ where: { ownerUserId: user.id } });
    await service.act(user.id, { action: 'enrollment.start', classKey: first.public.classKey });
    const assignment = await db.$transaction(tx => service.createPersonalAssignment(tx, user.id, scope.id, first));
    const before = await db.assignmentItem.findMany({ where: { assignmentId: assignment.id }, orderBy: { id: 'asc' } });
    const second = structuredClone(first); second.public.versionId += '-2'; second.public.title = 'Second edition';
    const third = structuredClone(first); third.public.versionId += '-3'; third.public.title = 'Third edition';
    await importContent(db, { ...empty(), classes: [second, third] });
    expect((await service.classDocument(first.public.classKey)).versionId).toBe(third.public.versionId);
    expect((await service.classDocument(first.public.classKey, user.id)).versionId).toBe(first.public.versionId);
    expect((await service.catalog()).find(c => c.classKey === first.public.classKey)?.versionId).toBe(third.public.versionId);
    expect(await db.assignmentItem.findMany({ where: { assignmentId: assignment.id }, orderBy: { id: 'asc' } })).toEqual(before);
    const next = await learner();
    const enrollmentId = (await service.act(next.id, { action: 'enrollment.start', classKey: first.public.classKey })).enrollmentId!;
    expect((await db.enrollment.findUniqueOrThrow({ where: { id: enrollmentId } })).classVersionId).toBe(third.public.versionId);
  });
  it('reads new diagnostic metadata/questions from DB and resumes the original active snapshot', async () => {
    const oldUser = await learner();
    const oldState = (await service.act(oldUser.id, { action: 'diagnostic.start' })).state;
    const oldRun = await db.diagnosticRun.findUniqueOrThrow({ where: { id: oldState.diagnostic!.id } });
    const definition = bundle().diagnostics[0]; definition.versionId = `test-placement-${randomUUID()}`;
    definition.title = 'DB 진단'; definition.description = 'DB에서 제공하는 진단 설명'; definition.estimatedMinutes = 1;
    definition.problems = [definition.problems[0]];
    await importContent(db, { ...empty(), diagnostics: [definition] });
    try {
      expect((await currentDiagnostic(db))?.versionId).toBe(definition.versionId);
      // A diagnostic question is a prompt and nothing else, and that prompt is rows like any other.
      expect((await db.contentBlock.findMany({ where: { ownerKind: 'problem', ownerVersionId: definition.versionId },
        orderBy: { order: 'asc' } })).map(blockOf)).toEqual(definition.problems[0].promptContent);
      const fresh = await learner();
      const state = (await service.act(fresh.id, { action: 'diagnostic.start' })).state;
      expect(state.diagnosticOffering).toMatchObject({ title: 'DB 진단', total: 1, estimatedMinutes: 1 });
      expect(state.diagnostic).toMatchObject({ total: 1, version: definition.versionId });
      expect(JSON.stringify(state)).not.toMatch(/"(?:gradingSpec|solution|hints)"/);
      const resumed = (await service.act(oldUser.id, { action: 'diagnostic.start' })).state;
      expect(resumed.diagnostic?.id).toBe(oldRun.id);
      expect(resumed.diagnostic?.total).toBe(6);
      expect(await db.diagnosticRun.findUniqueOrThrow({ where: { id: oldRun.id } })).toEqual(oldRun);
      const completed = await service.act(fresh.id, { action: 'diagnostic.answer', diagnosticId: state.diagnostic!.id,
        problemVersionId: state.diagnostic!.currentProblem!.problemVersionId, answer: '4/9' });
      expect(completed.state.diagnostic).toMatchObject({ status: 'completed', answered: 1 });
      const changed = structuredClone(definition); changed.title = 'Cannot rewrite';
      await expect(importContent(db, { ...empty(), diagnostics: [changed] })).rejects.toThrow(/immutable/);
    } finally {
      // Remove only this test's offer so other suites still start the baseline diagnostic.
      // Runs have their own immutable snapshot, with no FK to the live offer.
      // The rows a version is read from belong to it, so they go with it or verification fails.
      await db.contentBlock.deleteMany({ where: { ownerVersionId: definition.versionId } });
      await db.publishedProblem.deleteMany({ where: { ownerKind: 'diagnostic', ownerVersionId: definition.versionId } });
      await db.diagnosticVersion.delete({ where: { id: definition.versionId } });
    }
  });
  it('stores every published question as a row and refuses a class whose question went missing', async () => {
    const c = newClass(), skillKey = `test.${randomUUID()}`;
    c.public.skillKeys = [skillKey]; c.public.prerequisiteSkillKeys = [];
    c.problems.forEach(p => { p.skillKeys = [skillKey]; });
    await importContent(db, { ...empty(), classes: [c], skills: [{ key: skillKey, label: '색인 검사 개념', order: 998 }] });
    const rows = await db.publishedProblem.findMany({ where: { ownerKind: 'class', ownerVersionId: c.public.versionId }, orderBy: { order: 'asc' } });
    expect(rows.map(row => row.problemVersionId)).toEqual(c.problems.map(p => p.problemVersionId));
    expect(await classRecord(db, c.public.versionId)).toEqual(c);
    // An activity still names the question the rows lost, so the class no longer reads back whole.
    const [removed] = rows;
    const where = { ownerKind_ownerVersionId_problemVersionId: { ownerKind: removed.ownerKind,
      ownerVersionId: removed.ownerVersionId, problemVersionId: removed.problemVersionId } };
    try {
      await db.publishedProblem.delete({ where });
      await expect(verifyContent(db)).rejects.toThrow(/Missing immutable problem version/);
    } finally {
      await db.publishedProblem.create({ data: { ...removed,
        skillKeys: removed.skillKeys as never, responseSpec: removed.responseSpec as never, gradingSpec: removed.gradingSpec as never } });
    }
    expect((await verifyContent(db)).indexedProblems).toBeGreaterThanOrEqual(rows.length);
  });

  it('stores every section and block of a published class as rows that restore it unchanged', async () => {
    const c = newClass(), skillKey = `test.${randomUUID()}`;
    c.public.skillKeys = [skillKey]; c.public.prerequisiteSkillKeys = [];
    c.problems.forEach(p => { p.skillKeys = [skillKey]; });
    // Published content has no optional block yet, and a row that restored `fallback` as null
    // rather than as no key at all would change the version's hash. So this class carries one.
    c.sections[0].contentBlocks.push({ blockId: `${c.sections[0].sectionId}:optional`, kind: 'core.rich_text',
      typeVersion: 1, required: false, payload: { text: '되돌아오는지 보려고 둔 블록이에요.' },
      fallback: '그림을 볼 수 없을 때 읽는 문장이에요.' });
    await importContent(db, { ...empty(), classes: [c], skills: [{ key: skillKey, label: '블록 표 검사 개념', order: 997 }] });

    const sections = await db.classSection.findMany({ where: { classVersionId: c.public.versionId }, orderBy: { order: 'asc' } });
    expect(sections.map(section => section.sectionId)).toEqual(c.sections.map(section => section.sectionId));
    expect(sections.map(section => ({ role: section.role, title: section.title })))
      .toEqual(c.sections.map(section => ({ role: section.role, title: section.title })));

    const blocksOf = (ownerKind: string, ownerId: string, slot: string) => db.contentBlock.findMany({
      where: { ownerKind, ownerVersionId: c.public.versionId, ownerId, slot }, orderBy: { order: 'asc' } });
    const body = await blocksOf('section', c.sections[0].sectionId, 'body');
    expect(body.map(blockOf)).toEqual(c.sections[0].contentBlocks);
    // Absent, not null: the restored block has no `fallback` key where the document had none.
    expect(Object.keys(blockOf(body[0]))).not.toContain('fallback');
    expect(body[body.length - 1].fallback).toBe('그림을 볼 수 없을 때 읽는 문장이에요.');
    const problem = c.problems[0];
    expect((await blocksOf('problem', problem.problemVersionId, 'prompt')).map(blockOf)).toEqual(problem.promptContent);
    expect((await blocksOf('problem', problem.problemVersionId, 'hint')).map(blockOf)).toEqual(problem.hints);
    expect((await blocksOf('problem', problem.problemVersionId, 'solution')).map(blockOf)).toEqual(problem.solution);

    // The rows are the class now: one taken away is one the class no longer has, and writing them
    // again puts it back without touching what is already there.
    try {
      await db.contentBlock.delete({ where: { ownerKind_ownerVersionId_ownerId_slot_order: { ownerKind: 'section',
        ownerVersionId: c.public.versionId, ownerId: c.sections[0].sectionId, slot: 'body', order: 0 } } });
      expect((await classRecord(db, c.public.versionId))!.sections[0].contentBlocks)
        .toEqual(c.sections[0].contentBlocks.slice(1));
    } finally {
      await indexClassDocument(db, c);
    }
    expect(await classRecord(db, c.public.versionId)).toEqual(c);
    expect((await verifyContent(db)).indexedBlocks).toBeGreaterThanOrEqual(c.sections[0].contentBlocks.length);
  });

  it('serves a class from its rows', async () => {
    const c = newClass(), skillKey = `test.${randomUUID()}`;
    c.public.skillKeys = [skillKey]; c.public.prerequisiteSkillKeys = [];
    c.problems.forEach(p => { p.skillKeys = [skillKey]; });
    await importContent(db, { ...empty(), classes: [c], skills: [{ key: skillKey, label: '행에서 읽는 개념', order: 996 }] });
    const published = await service.classDocument(c.public.classKey);
    expect(published.sections.map(section => section.title)).toEqual(c.sections.map(section => section.title));
    expect(published.problems.map(problem => problem.problemVersionId)).toEqual(c.problems.map(problem => problem.problemVersionId));

    // Changing a row changes what a learner is served, which is what reading from rows means.
    const where = { classVersionId_sectionId: { classVersionId: c.public.versionId, sectionId: c.sections[0].sectionId } };
    try {
      await db.classSection.update({ where, data: { title: '행에서 고친 제목' } });
      expect((await service.classDocument(c.public.classKey)).sections[0].title).toBe('행에서 고친 제목');
    } finally {
      await db.classSection.update({ where, data: { title: c.sections[0].title } });
    }
    expect((await service.classDocument(c.public.classKey)).sections[0].title).toBe(c.sections[0].title);
  });

  it('reads a definition from its rows', async () => {
    const key = `term.rows.${randomUUID()}`;
    const term = { ...structuredClone(termFixture), versionId: `${key}:v1`, termKey: key };
    term.blocks = [{ ...term.blocks[0], blockId: `${key}:v1:b1` }];
    await importContent(db, { ...empty(), terms: [term] });
    const where = { ownerKind_ownerVersionId_ownerId_slot_order: { ownerKind: 'term',
      ownerVersionId: term.versionId, ownerId: term.versionId, slot: 'body', order: 0 } };
    const stored = await db.contentBlock.findUniqueOrThrow({ where });
    expect(blockOf(stored)).toEqual(term.blocks[0]);

    const asked = [{ termKey: key, scopeKind: 'global' as const, scopeKey: '' }];
    try {
      await db.contentBlock.update({ where, data: { payload: { text: '행에서 고친 정의예요.' } } });
      const [definition] = await currentTerms(db, asked);
      expect((definition.blocks[0].payload as { text: string }).text).toBe('행에서 고친 정의예요.');
    } finally {
      await db.contentBlock.update({ where, data: { payload: stored.payload as never } });
    }
    expect((await currentTerms(db, asked))[0].blocks).toEqual(term.blocks);
  });

  it('names published concepts for signed-out visitors and withholds skills without a released class', async () => {
    const c = newClass(), taught = `test.taught.${randomUUID()}`, unreleased = `test.unreleased.${randomUUID()}`;
    c.public.skillKeys = [taught]; c.public.prerequisiteSkillKeys = [];
    c.problems.forEach(p => { p.skillKeys = [taught]; });
    await importContent(db, { ...empty(), classes: [c], skills: [
      { key: taught, label: '공개 카탈로그 개념', order: 990 },
      { key: unreleased, label: '아직 수업이 없는 개념', order: 991 },
    ] });
    const catalogue = await service.publicCatalog();
    expect(catalogue.classes.map(item => item.classKey)).toContain(c.public.classKey);
    expect(catalogue.skills).toContainEqual({ key: taught, label: '공개 카탈로그 개념' });
    expect(catalogue.skills.map(skill => skill.key)).not.toContain(unreleased);
    // Signed-out copy reads these labels, so the response must stay free of answers and grading rules.
    expect(JSON.stringify(catalogue)).not.toMatch(/"(?:gradingSpec|solution|hints)"/);
  });

  it('publishes terms, explains what the lesson linked, and rewords a definition without a new class', async () => {
    const suffix = randomUUID();
    const earlier = `test.earlier.${suffix}`, current = `test.current.${suffix}`;
    const first = newClass(), second = newClass();
    first.public.order = 1001; first.public.skillKeys = [earlier]; first.public.prerequisiteSkillKeys = [];
    first.problems.forEach(p => { p.skillKeys = [earlier]; });
    second.public.order = 1002; second.public.skillKeys = [current]; second.public.prerequisiteSkillKeys = [earlier];
    second.problems.forEach(p => { p.skillKeys = [current]; });
    const earlierTerm = { versionId: `term.earlier.${suffix}:v1`, termKey: `term.earlier.${suffix}`, skillKey: earlier,
      label: '분모', summary: '전체를 나눈 조각 수예요.', blocks: [{ blockId: `term.earlier.${suffix}:v1:b1`,
        kind: 'core.rich_text', typeVersion: 1, required: true, payload: { text: '분모는 전체를 몇 조각으로 나누었는지 알려줘요.' } }] };
    const currentTerm = { ...earlierTerm, versionId: `term.current.${suffix}:v1`, termKey: `term.current.${suffix}`,
      skillKey: current, label: '통분', summary: '분모를 같게 맞추는 일이에요.',
      blocks: [{ ...earlierTerm.blocks[0], blockId: `term.current.${suffix}:v1:b1` }] };
    const block = second.sections[0].contentBlocks[0];
    second.sections[0].contentBlocks[0] = { ...block, typeVersion: 2, payload: { text: '분모가 다르면 통분을 해요.',
      terms: [{ termKey: earlierTerm.termKey, surface: '분모' }, { termKey: currentTerm.termKey, surface: '통분' }] } };
    const input = { ...empty(), classes: [first, second], terms: [earlierTerm, currentTerm],
      skills: [{ key: earlier, label: '앞선 개념', order: 1001 }, { key: current, label: '지금 개념', order: 1002 }] };

    await expect(importContent(db, { ...input, terms: [] })).rejects.toThrow(/Missing term/);
    expect(await db.classVersion.findUnique({ where: { id: second.public.versionId } })).toBeNull();
    expect(await importContent(db, input, true)).toMatchObject({ dryRun: true, newTerms: 2 });
    expect(await db.termVersion.findUnique({ where: { id: earlierTerm.versionId } })).toBeNull();
    await importContent(db, input);
    expect((await verifyContent(db)).termVersions).toBeGreaterThanOrEqual(2);

    const document = await service.classDocument(second.public.classKey);
    // Both linked words are explained; linking them was the author's decision to explain them.
    expect(document.glossary.map(entry => entry.termKey).sort()).toEqual([earlierTerm.termKey, currentTerm.termKey].sort());
    expect(document.glossary.find(entry => entry.termKey === earlierTerm.termKey))
      .toMatchObject({ label: '분모', skillKey: earlier, classKey: first.public.classKey });

    const reworded = { ...currentTerm, versionId: `term.earlier.${suffix}:v2`, termKey: earlierTerm.termKey,
      skillKey: earlier, label: '분모', summary: '다시 쓴 설명이에요.', blocks: [{ ...earlierTerm.blocks[0], blockId: `term.earlier.${suffix}:v2:b1` }] };
    const classRows = await db.classVersion.findMany({ orderBy: { id: 'asc' } });
    await importContent(db, { ...empty(), terms: [reworded] });
    expect((await service.classDocument(second.public.classKey)).glossary
      .find(entry => entry.termKey === earlierTerm.termKey)!.summary).toBe('다시 쓴 설명이에요.');
    expect(await db.classVersion.findMany({ orderBy: { id: 'asc' } })).toEqual(classRows);

    const edited = { ...earlierTerm, summary: 'Cannot overwrite' };
    await expect(importContent(db, { ...empty(), terms: [edited] })).rejects.toThrow(/Published term is immutable/);
    expect((await db.termVersion.findUniqueOrThrow({ where: { id: earlierTerm.versionId } })).summary).toBe(earlierTerm.summary);
    const exported = await exportContent(db);
    expect(await importContent(db, JSON.parse(JSON.stringify(exported)))).toMatchObject({ newTerms: 0, newClasses: 0 });
  });

  it('lets a class keep its own wording for a word the shared dictionary already defines', async () => {
    const suffix = randomUUID();
    const earlier = `test.dict.earlier.${suffix}`, current = `test.dict.current.${suffix}`;
    const first = newClass(), second = newClass();
    first.public.order = 1101; first.public.skillKeys = [earlier]; first.public.prerequisiteSkillKeys = [];
    first.problems.forEach(p => { p.skillKeys = [earlier]; });
    second.public.order = 1102; second.public.skillKeys = [current]; second.public.prerequisiteSkillKeys = [earlier];
    second.problems.forEach(p => { p.skillKeys = [current]; });
    const termKey = `term.shared.${suffix}`;
    const shared = { versionId: `${termKey}:v1`, termKey, skillKey: earlier, label: '분모', summary: '사전이 쓴 설명이에요.',
      blocks: [{ blockId: `${termKey}:v1:b1`, kind: 'core.rich_text', typeVersion: 1, required: true, payload: { text: '사전 정의' } }] };
    // Same key, kept by the class: its own wording, published and versioned on its own.
    const mine = { ...shared, versionId: `${second.public.classKey}:${termKey}:v1`,
      scopeKind: 'class' as const, scopeKey: second.public.classKey, summary: '이 수업이 쓴 설명이에요.',
      blocks: [{ ...shared.blocks[0], blockId: `${second.public.classKey}:${termKey}:v1:b1`, payload: { text: '수업 정의' } }] };
    const block = second.sections[0].contentBlocks[0];
    second.sections[0].contentBlocks[0] = { ...block, typeVersion: 2, payload: { text: '분모가 무엇인지 떠올려 보세요.',
      terms: [{ termKey, surface: '분모', scopeKind: 'class', scopeKey: second.public.classKey }] } };
    const input = { ...empty(), classes: [first, second], terms: [shared, mine],
      skills: [{ key: earlier, label: '앞선 개념', order: 1101 }, { key: current, label: '지금 개념', order: 1102 }] };

    // The dictionary alone does not answer for a reference that named the class.
    await expect(importContent(db, { ...input, terms: [shared] })).rejects.toThrow(/Missing term/);
    await importContent(db, input);

    const document = await service.classDocument(second.public.classKey);
    expect(document.glossary).toHaveLength(1);
    expect(document.glossary[0]).toMatchObject({ termKey, scopeKind: 'class', scopeKey: second.public.classKey, summary: '이 수업이 쓴 설명이에요.' });
    // The dictionary definition was never asked for, so its text is absent from the payload.
    expect(JSON.stringify(document)).not.toContain('사전이 쓴 설명이에요.');

    // Each scope is versioned on its own: rewording one leaves the other where it was.
    const reworded = { ...mine, versionId: `${second.public.classKey}:${termKey}:v2`, summary: '수업 설명을 고쳤어요.',
      blocks: [{ ...mine.blocks[0], blockId: `${second.public.classKey}:${termKey}:v2:b1` }] };
    await importContent(db, { ...empty(), terms: [reworded] });
    expect((await service.classDocument(second.public.classKey)).glossary[0].summary).toBe('수업 설명을 고쳤어요.');
    expect((await db.termVersion.findUniqueOrThrow({ where: { id: shared.versionId } })).summary).toBe('사전이 쓴 설명이에요.');
    // Exporting and re-importing the whole database carries the scopes back unchanged.
    expect(await importContent(db, JSON.parse(JSON.stringify(await exportContent(db))))).toMatchObject({ newTerms: 0, newClasses: 0 });
  });

  it('publishes a reviewed bundle once and skips it while the file is unchanged', async () => {
    const suffix = randomUUID();
    const skillKey = `test.bundle.${suffix}`;
    await db.skill.create({ data: { key: skillKey, label: '번들 개념', order: 3000 } });
    const term = (id: string, summary: string) => ({ versionId: `term.bundle.${suffix}:${id}`, termKey: `term.bundle.${suffix}`,
      skillKey, label: '번들 용어', summary, blocks: [{ blockId: `term.bundle.${suffix}:${id}:b1`, kind: 'core.rich_text',
        typeVersion: 1, required: true, payload: { text: summary } }] });
    const name = `test-${suffix}.json`;
    const bundle = { ...empty(), terms: [term('v1', '처음 발행한 설명이에요.')] };
    const checksum = createHash('sha256').update(JSON.stringify(bundle)).digest('hex');

    expect(await publishBundle(db, name, checksum, bundle, true)).toMatchObject({ skipped: false, dryRun: true, newTerms: 1 });
    expect(await db.appliedContentBundle.findUnique({ where: { name } })).toBeNull();
    expect(await publishBundle(db, name, checksum, bundle)).toMatchObject({ skipped: false, newTerms: 1 });
    const applied = await db.appliedContentBundle.findUniqueOrThrow({ where: { name } });
    expect(applied.checksum).toBe(checksum);

    // An unchanged file does no database work on the next release.
    expect(await publishBundle(db, name, checksum, bundle)).toMatchObject({ skipped: true });
    expect(await db.appliedContentBundle.findUniqueOrThrow({ where: { name } })).toEqual(applied);

    // An edited file publishes only what it adds, and the ledger follows the new checksum.
    const extended = { ...bundle, terms: [...bundle.terms, term('v2', '다시 쓴 설명이에요.')] };
    const nextChecksum = createHash('sha256').update(JSON.stringify(extended)).digest('hex');
    expect(await publishBundle(db, name, nextChecksum, extended)).toMatchObject({ skipped: false, newTerms: 1 });
    expect((await db.appliedContentBundle.findUniqueOrThrow({ where: { name } })).checksum).toBe(nextChecksum);

    // A rejected bundle leaves the ledger on the last content that actually landed.
    const edited = structuredClone(extended); edited.terms[0].summary = 'Cannot overwrite';
    const badChecksum = createHash('sha256').update(JSON.stringify(edited)).digest('hex');
    await expect(publishBundle(db, name, badChecksum, edited)).rejects.toThrow(/immutable/);
    expect((await db.appliedContentBundle.findUniqueOrThrow({ where: { name } })).checksum).toBe(nextChecksum);
  });
});
