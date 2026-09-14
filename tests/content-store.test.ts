import { createHash, randomUUID } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createDatabase } from '@/server/db';
import { LearningService } from '@/server/learning-service';
import { canonicalJson, parseContentBundle, validateReferences } from '@/core/content-bundle';
import { currentDiagnostic, exportContent, importContent, verifyContent } from '@/server/content-store';
import initial from './fixtures/initial-content.json';
import { seedClasses } from './fixtures/content';

const bundle = () => parseContentBundle(structuredClone(initial));
const empty = () => ({ schemaVersion: 1 as const, skills: [], classes: [], diagnostics: [] });
function newClass() {
  const key = `content-test-${randomUUID()}`;
  const c = JSON.parse(JSON.stringify(seedClasses[0]).replaceAll('fraction-meaning', key)) as typeof seedClasses[number];
  c.public.order = 1000;
  return c;
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
      expect(row.document).toEqual(c);
      expect(row.contentHash).toBe(createHash('sha256').update(JSON.stringify(c)).digest('hex'));
    }
    const diagnostic = await db.diagnosticVersion.findUniqueOrThrow({ where: { id: initial.diagnostics[0].versionId } });
    expect(diagnostic.document).toEqual(initial.diagnostics[0].problems);
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
      await db.diagnosticVersion.delete({ where: { id: definition.versionId } });
    }
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
});
