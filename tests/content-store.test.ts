import { createHash, randomUUID } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { existingRows, removeRowsAddedSince, type Existing } from './cleanup';
import { createDatabase } from '@/server/db';
import { LearningService } from '@/server/learning-service';
import { canonicalJson, parseContentBundle, validateReferences } from '@/core/content-bundle';
import { blockOf, lessonRecord, currentDiagnostic, currentDefinitions, diagnosticDefinitions, exportContent, importContent, indexLessonDocument, publishBundle, verifyContent } from '@/server/content-store';
import initial from './fixtures/fractions-v1.json';
import { diagnosticProblems, seedLessons, setsOf } from './fixtures/content';
import { storedLessonOf } from '@/core/content';

const bundle = () => parseContentBundle(structuredClone(initial));
const empty = () => ({ schemaVersion: 1 as const, courses: [], concepts: [], lessons: [], problemSets: [], diagnostics: [], definitions: [] });
/**
 * A course of the test's own for the lessons it publishes, so the seeded course is never touched. It is
 * named after the first lesson, so every version of one lesson lands in the same course.
 */
const inCourse = (...lessons: { public: { lessonKey: string } }[]) => [{ key: `course-${lessons[0].public.lessonKey}`, title: '검사 코스',
  lessons: [...new Set(lessons.map((lesson) => lesson.public.lessonKey))].map((key, index) => ({ key, order: index + 1 })), diagnostics: [] }];
/** What publishing these records takes: their course, the lessons, and the sets rebuilt from what each holds. */
const publish = (...records: (typeof seedLessons)[number][]) => ({ courses: inCourse(...records), lessons: records.map(storedLessonOf),
  problemSets: [...new Map(records.flatMap((record) => setsOf(record, inCourse(...records)[0].key)).map((set) => [set.versionId, set])).values()] });
function newLesson() {
  const key = `content-test-${randomUUID()}`;
  const c = JSON.parse(JSON.stringify(seedLessons[0]).replaceAll('fraction-meaning', key)) as typeof seedLessons[number];

  return c;
}

const definitionFixture = {
  conceptKey: 'denominator', scopeKind: 'global' as const, scopeKey: '',
  label: '분모', summary: '전체를 몇 조각으로 나누었는지 나타내는 수예요.',
  blocks: [{ blockId: 'global:denominator:b1', kind: 'core.rich_text', typeVersion: 1, required: true,
    payload: { text: '분모는 전체를 몇 조각으로 나누었는지 알려줘요.' } }],
};
/** The concept the fixture definition explains: one no question assesses, which is what most definitions are about. */
const denominatorConcept = { key: 'denominator', label: '분모', assessable: false };
/** The third lesson links a definition of a concept no question assesses. */
function withTerms() {
  const b = bundle();
  b.concepts.push({ ...denominatorConcept });
  b.definitions = [structuredClone(definitionFixture)];
  const block = b.lessons[2].sections[0].contentBlocks[0];
  b.lessons[2].sections[0].contentBlocks[0] = { ...block, typeVersion: 3,
    payload: { text: block.payload.text, definitions: [{ conceptKey: 'denominator', surface: '분모' }] } };
  return b;
}

describe('content publishing contract', () => {
  it('accepts the historical fixture and compares MySQL key ordering semantically', () => {
    expect(() => validateReferences(bundle())).not.toThrow();
    expect(canonicalJson({ b: [2, 1], a: { d: 2, c: 1 } })).toBe(canonicalJson({ a: { c: 1, d: 2 }, b: [2, 1] }));
    expect(canonicalJson([1, 2])).not.toBe(canonicalJson([2, 1]));
  });
  it('rejects unknown concepts, duplicate versions, and a diagnostic whose reference does not resolve', () => {
    const a = bundle(); a.concepts = [];
    expect(() => validateReferences(a)).toThrow(/Missing concept/);
    const b = bundle(); b.lessons.push(b.lessons[0]);
    expect(() => parseContentBundle(b)).toThrow(/Duplicate/);
    const c = bundle(); c.diagnostics[0].problemSet.problemSetVersionId = 'starting-point:v9';
    expect(() => validateReferences(c)).toThrow(/Missing problem set version/);
    const d = bundle(); d.diagnostics[0].problemSet.problemVersionIds.push(d.problemSets[0].problems[0].problemVersionId);
    expect(() => validateReferences(d)).toThrow(/not in the problem set version/);
    // The set a diagnostic picks from is kept by the diagnostic's own course.
    const e = bundle(); e.courses.push({ key: 'other', title: '다른 코스', lessons: [], diagnostics: ['starting-point'] }); e.courses[0].diagnostics = [];
    expect(() => validateReferences(e)).toThrow(/belongs to another course/);
  });
  it('validates private grading, hints that match, and required blocks of the questions a diagnostic asks', () => {
    const placement = (b: ReturnType<typeof bundle>) => b.problemSets.find((set) => set.versionId === b.diagnostics[0].problemSet.problemSetVersionId)!;
    const a = bundle(); placement(a).problems[0].responseSpec.kind = 'integer';
    expect(() => parseContentBundle(a)).toThrow(/must match/);
    const b = bundle(); placement(b).problems[0].hintAvailable = true;
    expect(() => parseContentBundle(b)).toThrow(/hintAvailable/);
    const c = bundle(); placement(c).problems[0].promptContent[0].kind = 'future.graph';
    expect(() => parseContentBundle(c)).toThrow(/Unsupported block/);
    // A question without a solution is a question; whether a solution is shown is the issuer's policy.
    expect(placement(bundle()).problems.every((problem) => problem.solution.length === 0)).toBe(true);
  });
  it('rejects case-only identities that MySQL treats as equal', () => {
    const a = bundle(); a.concepts.push({ ...a.concepts[0], key: a.concepts[0].key.toUpperCase() });
    expect(() => validateReferences(a)).toThrow(/letter case/);
    const b = bundle(); b.problemSets[1].problems[0].problemVersionId = b.problemSets[0].problems[0].problemVersionId.toUpperCase();
    expect(() => validateReferences(b)).toThrow(/letter case/);
  });
  it('links lesson text to definitions and rejects a lesson that links to none', () => {
    expect(() => validateReferences(withTerms())).not.toThrow();
    const orphan = withTerms(); orphan.definitions = [];
    expect(() => validateReferences(orphan)).toThrow(/Missing definition/);
    // A definition with no body only renames the concept; there is nothing to open, so nothing to link.
    const bodiless = withTerms(); bodiless.definitions[0].blocks = [];
    expect(() => validateReferences(bodiless)).toThrow(/Missing definition/);
    const unknown = withTerms(); unknown.concepts = unknown.concepts.filter(concept => concept.key !== 'denominator');
    expect(() => validateReferences(unknown)).toThrow(/Missing concept/);
    const cased = withTerms(); cased.concepts.push({ key: 'DENOMINATOR', label: '분모', assessable: false });
    expect(() => validateReferences(cased)).toThrow(/letter case/);
    // What a lesson teaches, presumes or asks about must be a concept a question can assess.
    const taught = withTerms(); taught.lessons[2].public.conceptKeys = ['denominator'];
    expect(() => validateReferences(taught)).toThrow(/not assessable/);
  });
  it('keeps a lesson definition and a dictionary definition apart even when they explain one concept', () => {
    const b = withTerms();
    const lessonKey = b.lessons[2].public.lessonKey;
    // The same concept, kept by the lesson itself: its own name and wording, not the operator's dictionary.
    b.definitions.push({ ...structuredClone(definitionFixture), scopeKind: 'lesson', scopeKey: lessonKey,
      label: '아래 수', summary: '이 수업에서만 쓰는 설명이에요.',
      blocks: [{ ...definitionFixture.blocks[0], blockId: `lesson:${lessonKey}:denominator:b1` }] });
    const block = b.lessons[2].sections[0].contentBlocks[0];
    b.lessons[2].sections[0].contentBlocks[0] = { ...block,
      payload: { text: block.payload.text, definitions: [{ conceptKey: 'denominator', surface: '분모', scopeKind: 'lesson', scopeKey: lessonKey }] } };
    expect(() => validateReferences(b)).not.toThrow();
    // One definition per concept in each scope: a definition has no versions to pile up.
    const twice = structuredClone(b); twice.definitions.push(structuredClone(twice.definitions[1]));
    expect(() => parseContentBundle(twice)).toThrow(/Duplicate definitions per concept and scope/);
  });

  it('refuses a lesson that links a definition another lesson keeps', () => {
    const b = withTerms();
    const owner = b.lessons[0].public.lessonKey, borrower = b.lessons[2].public.lessonKey;
    b.definitions.push({ ...structuredClone(definitionFixture), scopeKind: 'lesson', scopeKey: owner,
      blocks: [{ ...definitionFixture.blocks[0], blockId: `lesson:${owner}:denominator:b1` }] });
    const block = b.lessons[2].sections[0].contentBlocks[0];
    b.lessons[2].sections[0].contentBlocks[0] = { ...block,
      payload: { text: block.payload.text, definitions: [{ conceptKey: 'denominator', surface: '분모', scopeKind: 'lesson', scopeKey: owner }] } };
    expect(borrower).not.toBe(owner);
    expect(() => validateReferences(b)).toThrow(/can only link its own definitions/);
  });

  it('refuses a scope that does not say what it belongs to', () => {
    const missingKey = { ...structuredClone(initial), definitions: [{ ...definitionFixture, scopeKind: 'lesson' as const, scopeKey: '' }] };
    expect(() => parseContentBundle(missingKey)).toThrow(/scope it belongs to/);
    const strayKey = { ...structuredClone(initial), definitions: [{ ...definitionFixture, scopeKey: 'fraction-meaning' }] };
    expect(() => parseContentBundle(strayKey)).toThrow(/scope it belongs to/);
    // A bundle written before scopes existed still imports as the shared dictionary.
    const older = { ...structuredClone(initial), definitions: [{ conceptKey: definitionFixture.conceptKey,
      label: definitionFixture.label, summary: definitionFixture.summary, blocks: definitionFixture.blocks }] };
    expect(parseContentBundle(older).definitions[0]).toMatchObject({ scopeKind: 'global', scopeKey: '' });
  });

  it('refuses a question that explains the concept it assesses', () => {
    const b = withTerms();
    const problem = b.problemSets.find(set => set.versionId === 'fraction-meaning:practice:v1')!.problems[0];
    expect(problem.conceptKeys).toContain('fraction.meaning');
    b.definitions.push({ ...structuredClone(definitionFixture), conceptKey: 'fraction.meaning', label: '분수의 의미',
      blocks: [{ ...definitionFixture.blocks[0], blockId: 'global:fraction.meaning:b1' }] });
    problem.promptContent[0] = { ...problem.promptContent[0], typeVersion: 3,
      payload: { text: '분수의 의미를 떠올려 분모가 4인 분수를 고르세요.', definitions: [{ conceptKey: 'fraction.meaning', surface: '분수의 의미' }] } };
    expect(() => validateReferences(b)).toThrow(/cannot explain the concept it assesses/);
  });
  it('allows links inside definitions while refusing embedded questions', () => {
    const withBlock = (block: unknown) => ({ ...structuredClone(initial), definitions: [{ ...definitionFixture, blocks: [block] }] });
    expect(() => parseContentBundle(withBlock({ blockId: 'definition:bad:v1', kind: 'core.problem_set', typeVersion: 2, required: true,
      payload: { problemSetId: 'x', problemSetVersionId: 'x:v1', problemVersionIds: [initial.problemSets[0].problems[0].problemVersionId] } }))).toThrow();
    expect(() => parseContentBundle(withBlock({ blockId: 'definition:bad:v1', kind: 'core.rich_text', typeVersion: 3, required: true,
      payload: { text: '분모를 설명해요.', definitions: [{ conceptKey: 'term.denominator', surface: '분모' }] } }))).not.toThrow();
    expect(() => parseContentBundle(withBlock(definitionFixture.blocks[0]))).not.toThrow();
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
  let existing: Existing;
  beforeAll(async () => {
    const parsed = new URL(url!);
    if (parsed.protocol !== 'mysql:' || !parsed.pathname.endsWith('_test')) throw new Error('Use an isolated _test database.');
    db = createDatabase(url!); service = new LearningService(db);
    existing = await existingRows(db);
    await importContent(db, bundle());
  });
  afterAll(async () => {
    // A shared database keeps whatever a run leaves behind, so this run leaves nothing.
    if (existing) await removeRowsAddedSince(db, existing);
    await db?.$disconnect();
  });
  const learner = () => db.user.create({ data: { displayName: `content ${randomUUID()}`, learningScopes: { create: { kind: 'personal' } } } });
  it('loads historical content exactly, retaining all diagnostic questions', async () => {
    for (const c of seedLessons) {
      const row = await db.lessonVersion.findUniqueOrThrow({ where: { id: c.public.versionId } });
      // What the migration installed as one document still reads back out of its rows, exactly.
      expect(await lessonRecord(db, c.public.versionId)).toEqual(c);
    }
    const diagnostic = await db.diagnosticVersion.findUniqueOrThrow({ where: { id: initial.diagnostics[0].versionId } });
    expect(diagnosticDefinitions([diagnostic])[0]).toEqual(bundle().diagnostics[0]);
    expect((await currentDiagnostic(db))?.problems).toEqual(diagnosticProblems);
    expect((await verifyContent(db)).concepts).toBeGreaterThanOrEqual(3);
  });
  it('exports and reimports without rewriting any published content, hash or timestamp', async () => {
    const before = await db.lessonVersion.findMany({ orderBy: { id: 'asc' } });
    const exported = await exportContent(db);
    const result = await importContent(db, JSON.parse(JSON.stringify(exported)));
    expect(result).toMatchObject({ newLessons: 0, newDiagnostics: 0 });
    expect(await db.lessonVersion.findMany({ orderBy: { id: 'asc' } })).toEqual(before);
  });
  it('publishes a DB-only lesson and concept atomically; dry run writes nothing and changed versions are rejected', async () => {
    const c = newLesson(), conceptKey = `test.${randomUUID()}`;
    c.public.conceptKeys = [conceptKey]; c.public.prerequisiteConceptKeys = [];
    c.problems.forEach(p => { p.conceptKeys = [conceptKey]; });
    const input = { ...empty(), ...publish(c), concepts: [{ key: conceptKey, label: 'DB에서 등록한 개념', assessable: true }] };
    expect(await importContent(db, input, true)).toMatchObject({ dryRun: true, newLessons: 1 });
    expect(await db.lessonVersion.findUnique({ where: { id: c.public.versionId } })).toBeNull();
    expect(await db.concept.findUnique({ where: { key: conceptKey } })).toBeNull();
    await importContent(db, input);
    const user = await learner();
    const state = await service.state(user.id);
    expect(state.lessons).toContainEqual({ ...c.public, courseKey: input.courses[0].key });
    expect(state.concepts).toContainEqual({ key: conceptKey, label: 'DB에서 등록한 개념', state: 'unknown' });
    expect(JSON.stringify(await service.lessonDocument(c.public.lessonKey))).not.toContain('gradingSpec');
    const edited = structuredClone(c); edited.public.title = 'Cannot overwrite';
    await expect(importContent(db, { ...input, lessons: [storedLessonOf(edited)], concepts: [{ ...input.concepts[0], label: 'Must not persist' }] })).rejects.toThrow(/immutable/);
    expect((await db.concept.findUniqueOrThrow({ where: { key: conceptKey } })).label).toBe('DB에서 등록한 개념');
  });
  it('rejects unknown references and changes to reused question versions without partial writes', async () => {
    const bad = newLesson(); bad.public.conceptKeys = ['missing.concept']; bad.problems.forEach(p => { p.conceptKeys = ['missing.concept']; });
    await expect(importContent(db, { ...empty(), ...publish(bad) })).rejects.toThrow(/Missing concept/);
    expect(await db.lessonVersion.findUnique({ where: { id: bad.public.versionId } })).toBeNull();
    const first = newLesson(); await importContent(db, { ...empty(), ...publish(first) });
    const second = structuredClone(first); second.public.versionId += '-next'; second.problems[0].promptContent[0].payload.text = 'Changed problem';
    await expect(importContent(db, { ...empty(), ...publish(second) })).rejects.toThrow(/immutable/);
    expect(await db.lessonVersion.findUnique({ where: { id: second.public.versionId } })).toBeNull();
  });
  it('selects the last newly published version while pinning existing enrollment and homework', async () => {
    const first = newLesson(); await importContent(db, { ...empty(), ...publish(first) });
    const user = await learner(), scope = await db.learningScope.findUniqueOrThrow({ where: { ownerUserId: user.id } });
    await service.act(user.id, { action: 'enrollment.start', lessonKey: first.public.lessonKey });
    const assignment = (await db.$transaction(tx => service.createPersonalAssignment(tx, user.id, scope.id, first)))!;
    const before = await db.assignmentItem.findMany({ where: { assignmentId: assignment.id }, orderBy: { id: 'asc' } });
    const second = structuredClone(first); second.public.versionId += '-2'; second.public.title = 'Second edition';
    const third = structuredClone(first); third.public.versionId += '-3'; third.public.title = 'Third edition';
    await importContent(db, { ...empty(), ...publish(second, third) });
    expect((await service.lessonDocument(first.public.lessonKey)).versionId).toBe(third.public.versionId);
    expect((await service.lessonDocument(first.public.lessonKey, user.id)).versionId).toBe(first.public.versionId);
    expect((await service.catalog()).find(c => c.lessonKey === first.public.lessonKey)?.versionId).toBe(third.public.versionId);
    expect(await db.assignmentItem.findMany({ where: { assignmentId: assignment.id }, orderBy: { id: 'asc' } })).toEqual(before);
    // The assignment stays with the problem set version it was issued from, whatever the lesson publishes next.
    expect((await db.assignment.findUniqueOrThrow({ where: { id: assignment.id } })).problemSetVersionId).toBe(first.review!.problemSetVersionId);
    const next = await learner();
    const enrollmentId = (await service.act(next.id, { action: 'enrollment.start', lessonKey: first.public.lessonKey })).enrollmentId!;
    expect((await db.enrollment.findUniqueOrThrow({ where: { id: enrollmentId } })).lessonVersionId).toBe(third.public.versionId);
  });
  it('reads new diagnostic metadata/questions from DB and resumes the original active snapshot', async () => {
    const oldUser = await learner();
    const oldState = (await service.act(oldUser.id, { action: 'diagnostic.start' })).state;
    const oldRun = await db.diagnosticRun.findUniqueOrThrow({ where: { id: oldState.diagnostic!.id } });
    const definition = bundle().diagnostics[0]; definition.versionId = `test-placement-${randomUUID()}`;
    definition.title = 'DB 진단'; definition.description = 'DB에서 제공하는 진단 설명'; definition.estimatedMinutes = 1;
    definition.problemSet = { ...definition.problemSet, problemVersionIds: [definition.problemSet.problemVersionIds[0]] };
    await importContent(db, { ...empty(), diagnostics: [definition] });
    try {
      const current = await currentDiagnostic(db);
      expect(current?.versionId).toBe(definition.versionId);
      // A diagnostic owns no question rows: it picks from the set version it names.
      expect(current?.problems).toEqual([diagnosticProblems[0]]);
      expect(await db.publishedProblem.count({ where: { ownerVersionId: definition.versionId } })).toBe(0);
      const fresh = await learner();
      const state = (await service.act(fresh.id, { action: 'diagnostic.start' })).state;
      expect(state.diagnosticOffering).toMatchObject({ title: 'DB 진단', total: 1, estimatedMinutes: 1 });
      expect(state.diagnostic).toMatchObject({ answered: 0, settled: 0, version: definition.versionId });
      expect(JSON.stringify(state)).not.toMatch(/"(?:gradingSpec|solution|hints)"/);
      const resumed = (await service.act(oldUser.id, { action: 'diagnostic.start' })).state;
      expect(resumed.diagnostic?.id).toBe(oldRun.id);
      // The run keeps asking from the bank it started with, not the single question just published.
      expect(resumed.diagnostic?.version).toBe(oldState.diagnostic!.version);
      expect(resumed.diagnostic?.currentProblem?.problemVersionId).toBe(oldState.diagnostic!.currentProblem!.problemVersionId);
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
  it('stores every published question as a row and refuses a lesson whose question went missing', async () => {
    const c = newLesson(), conceptKey = `test.${randomUUID()}`;
    c.public.conceptKeys = [conceptKey]; c.public.prerequisiteConceptKeys = [];
    c.problems.forEach(p => { p.conceptKeys = [conceptKey]; });
    await importContent(db, { ...empty(), ...publish(c), concepts: [{ key: conceptKey, label: '색인 검사 개념', assessable: true }] });
    // The questions are the problem sets' rows now, each set version holding its own in order.
    const rows = (await Promise.all(setsOf(c).map(set => db.publishedProblem.findMany({ where: { ownerKind: 'problem_set', ownerVersionId: set.versionId }, orderBy: { order: 'asc' } })))).flat();
    expect(rows.map(row => row.problemVersionId).sort()).toEqual(c.problems.map(p => p.problemVersionId).sort());
    expect(await lessonRecord(db, c.public.versionId)).toEqual(c);
    // An activity still names the question the rows lost, so the lesson no longer reads back whole.
    const [removed] = rows;
    const where = { ownerKind_ownerVersionId_problemVersionId: { ownerKind: removed.ownerKind,
      ownerVersionId: removed.ownerVersionId, problemVersionId: removed.problemVersionId } };
    try {
      await db.publishedProblem.delete({ where });
      await expect(verifyContent(db)).rejects.toThrow(/Problem is not in the problem set version/);
    } finally {
      await db.publishedProblem.create({ data: { ...removed,
        conceptKeys: removed.conceptKeys as never, responseSpec: removed.responseSpec as never, gradingSpec: removed.gradingSpec as never } });
    }
    expect((await verifyContent(db)).indexedProblems).toBeGreaterThanOrEqual(rows.length);
  });

  it('stores every section and block of a published lesson as rows that restore it unchanged', async () => {
    const c = newLesson(), conceptKey = `test.${randomUUID()}`;
    c.public.conceptKeys = [conceptKey]; c.public.prerequisiteConceptKeys = [];
    c.problems.forEach(p => { p.conceptKeys = [conceptKey]; });
    // Published content has no optional block yet, and a row that restored `fallback` as null
    // rather than as no key at all would change the version's hash. So this lesson carries one.
    c.sections[0].contentBlocks.push({ blockId: `${c.sections[0].sectionId}:optional`, kind: 'core.rich_text',
      typeVersion: 1, required: false, payload: { text: '되돌아오는지 보려고 둔 블록이에요.' },
      fallback: '그림을 볼 수 없을 때 읽는 문장이에요.' });
    await importContent(db, { ...empty(), ...publish(c), concepts: [{ key: conceptKey, label: '블록 표 검사 개념', assessable: true }] });

    const sections = await db.lessonSection.findMany({ where: { lessonVersionId: c.public.versionId }, orderBy: { order: 'asc' } });
    expect(sections.map(section => section.sectionId)).toEqual(c.sections.map(section => section.sectionId));
    expect(sections.map(section => ({ role: section.role, title: section.title })))
      .toEqual(c.sections.map(section => ({ role: section.role, title: section.title })));

    const blocksOf = (ownerKind: string, ownerVersionId: string, ownerId: string, slot: string) => db.contentBlock.findMany({
      where: { ownerKind, ownerVersionId, ownerId, slot }, orderBy: { order: 'asc' } });
    const body = await blocksOf('section', c.public.versionId, c.sections[0].sectionId, 'body');
    expect(body.map(blockOf)).toEqual(c.sections[0].contentBlocks);
    // Absent, not null: the restored block has no `fallback` key where the document had none.
    expect(Object.keys(blockOf(body[0]))).not.toContain('fallback');
    expect(body[body.length - 1].fallback).toBe('그림을 볼 수 없을 때 읽는 문장이에요.');
    // A question's blocks hang off the problem set version that holds the question.
    const problem = c.problems[0];
    const setVersion = setsOf(c).find(set => set.problems.some(p => p.problemVersionId === problem.problemVersionId))!.versionId;
    expect((await blocksOf('problem', setVersion, problem.problemVersionId, 'prompt')).map(blockOf)).toEqual(problem.promptContent);
    expect((await blocksOf('problem', setVersion, problem.problemVersionId, 'hint')).map(blockOf)).toEqual(problem.hints);
    expect((await blocksOf('problem', setVersion, problem.problemVersionId, 'solution')).map(blockOf)).toEqual(problem.solution);

    // The rows are the lesson now: one taken away is one the lesson no longer has, and writing them
    // again puts it back without touching what is already there.
    try {
      await db.contentBlock.delete({ where: { ownerKind_ownerVersionId_ownerId_slot_order: { ownerKind: 'section',
        ownerVersionId: c.public.versionId, ownerId: c.sections[0].sectionId, slot: 'body', order: 0 } } });
      expect((await lessonRecord(db, c.public.versionId))!.sections[0].contentBlocks)
        .toEqual(c.sections[0].contentBlocks.slice(1));
    } finally {
      await indexLessonDocument(db, storedLessonOf(c));
    }
    expect(await lessonRecord(db, c.public.versionId)).toEqual(c);
    expect((await verifyContent(db)).indexedBlocks).toBeGreaterThanOrEqual(c.sections[0].contentBlocks.length);
  });

  it('serves a lesson from its rows', async () => {
    const c = newLesson(), conceptKey = `test.${randomUUID()}`;
    c.public.conceptKeys = [conceptKey]; c.public.prerequisiteConceptKeys = [];
    c.problems.forEach(p => { p.conceptKeys = [conceptKey]; });
    await importContent(db, { ...empty(), ...publish(c), concepts: [{ key: conceptKey, label: '행에서 읽는 개념', assessable: true }] });
    const published = await service.lessonDocument(c.public.lessonKey);
    expect(published.sections.map(section => section.title)).toEqual(c.sections.map(section => section.title));
    expect(published.problems.map(problem => problem.problemVersionId)).toEqual(c.problems.map(problem => problem.problemVersionId));

    // Changing a row changes what a learner is served, which is what reading from rows means.
    const where = { lessonVersionId_sectionId: { lessonVersionId: c.public.versionId, sectionId: c.sections[0].sectionId } };
    try {
      await db.lessonSection.update({ where, data: { title: '행에서 고친 제목' } });
      expect((await service.lessonDocument(c.public.lessonKey)).sections[0].title).toBe('행에서 고친 제목');
    } finally {
      await db.lessonSection.update({ where, data: { title: c.sections[0].title } });
    }
    expect((await service.lessonDocument(c.public.lessonKey)).sections[0].title).toBe(c.sections[0].title);
  });

  it('reads a definition from its rows', async () => {
    const key = `rows-${randomUUID()}`;
    const definition = { ...structuredClone(definitionFixture), conceptKey: key, blocks: [{ ...definitionFixture.blocks[0], blockId: `global:${key}:b1` }] };
    await importContent(db, { ...empty(), concepts: [{ key, label: '행 검사 개념', assessable: false }], definitions: [definition] });
    const row = await db.conceptDefinition.findUniqueOrThrow({ where: { conceptKey_scopeKind_scopeKey: { conceptKey: key, scopeKind: 'global', scopeKey: '' } } });
    const where = { ownerKind_ownerVersionId_ownerId_slot_order: { ownerKind: 'definition',
      ownerVersionId: row.id, ownerId: row.id, slot: 'body', order: 0 } };
    const stored = await db.contentBlock.findUniqueOrThrow({ where });
    expect(blockOf(stored)).toEqual(definition.blocks[0]);

    const asked = [{ conceptKey: key, scopeKind: 'global' as const, scopeKey: '' }];
    try {
      await db.contentBlock.update({ where, data: { payload: { text: '행에서 고친 정의예요.' } } });
      const [read] = await currentDefinitions(db, asked);
      expect((read.blocks[0].payload as { text: string }).text).toBe('행에서 고친 정의예요.');
    } finally {
      await db.contentBlock.update({ where, data: { payload: stored.payload as never } });
    }
    expect((await currentDefinitions(db, asked))[0]).toMatchObject({ label: '분모', blocks: definition.blocks });
  });

  it('names published concepts for signed-out visitors and withholds concepts without a released lesson', async () => {
    const c = newLesson(), taught = `test.taught.${randomUUID()}`, unreleased = `test.unreleased.${randomUUID()}`;
    c.public.conceptKeys = [taught]; c.public.prerequisiteConceptKeys = [];
    c.problems.forEach(p => { p.conceptKeys = [taught]; });
    await importContent(db, { ...empty(), ...publish(c), concepts: [
      { key: taught, label: '공개 카탈로그 개념', assessable: true },
      { key: unreleased, label: '아직 수업이 없는 개념', assessable: true },
    ] });
    const catalogue = await service.publicCatalog();
    expect(catalogue.lessons.map(item => item.lessonKey)).toContain(c.public.lessonKey);
    expect(catalogue.concepts).toContainEqual({ key: taught, label: '공개 카탈로그 개념' });
    expect(catalogue.concepts.map(concept => concept.key)).not.toContain(unreleased);
    // Signed-out copy reads these labels, so the response must stay free of answers and grading rules.
    expect(JSON.stringify(catalogue)).not.toMatch(/"(?:gradingSpec|solution|hints)"/);
  });

  it('publishes definitions, explains what the lesson linked, and rewords a definition without a new lesson', async () => {
    const suffix = randomUUID();
    const earlier = `test.earlier.${suffix}`, current = `test.current.${suffix}`;
    const first = newLesson(), second = newLesson();
    first.public.conceptKeys = [earlier]; first.public.prerequisiteConceptKeys = [];
    first.problems.forEach(p => { p.conceptKeys = [earlier]; });
    second.public.conceptKeys = [current]; second.public.prerequisiteConceptKeys = [earlier];
    second.problems.forEach(p => { p.conceptKeys = [current]; });
    const earlierDefinition = { conceptKey: earlier, label: '분모', summary: '전체를 나눈 조각 수예요.', blocks: [{ blockId: `global:${earlier}:b1`,
      kind: 'core.rich_text', typeVersion: 1, required: true, payload: { text: '분모는 전체를 몇 조각으로 나누었는지 알려줘요.' } }] };
    const currentDefinition = { ...earlierDefinition, conceptKey: current, label: '통분', summary: '분모를 같게 맞추는 일이에요.',
      blocks: [{ ...earlierDefinition.blocks[0], blockId: `global:${current}:b1` }] };
    const block = second.sections[0].contentBlocks[0];
    second.sections[0].contentBlocks[0] = { ...block, typeVersion: 3, payload: { text: '분모가 다르면 통분을 해요.',
      definitions: [{ conceptKey: earlier, surface: '분모' }, { conceptKey: current, surface: '통분' }] } };
    const input = { ...empty(), ...publish(first, second), definitions: [earlierDefinition, currentDefinition],
      concepts: [{ key: earlier, label: '앞선 개념', assessable: true }, { key: current, label: '지금 개념', assessable: true }] };

    await expect(importContent(db, { ...input, definitions: [] })).rejects.toThrow(/Missing definition/);
    expect(await db.lessonVersion.findUnique({ where: { id: second.public.versionId } })).toBeNull();
    expect(await importContent(db, input, true)).toMatchObject({ dryRun: true, definitions: 2 });
    expect(await db.conceptDefinition.findFirst({ where: { conceptKey: earlier } })).toBeNull();
    await importContent(db, input);
    expect((await verifyContent(db)).definitions).toBeGreaterThanOrEqual(2);

    const document = await service.lessonDocument(second.public.lessonKey);
    // Both linked words are explained; linking them was the author's decision to explain them.
    expect(document.glossary.map(entry => entry.conceptKey).sort()).toEqual([earlier, current].sort());
    // The definition names the concept the way this scope does, and offers the lesson that teaches it.
    expect(document.glossary.find(entry => entry.conceptKey === earlier))
      .toMatchObject({ label: '분모', lessonKey: first.public.lessonKey });

    // Rewording is written in place: no lesson is republished and no new row appears.
    const lessonRows = await db.lessonVersion.findMany({ orderBy: { id: 'asc' } });
    await importContent(db, { ...empty(), definitions: [{ ...earlierDefinition, summary: '다시 쓴 설명이에요.' }] });
    expect((await service.lessonDocument(second.public.lessonKey)).glossary
      .find(entry => entry.conceptKey === earlier)!.summary).toBe('다시 쓴 설명이에요.');
    expect(await db.lessonVersion.findMany({ orderBy: { id: 'asc' } })).toEqual(lessonRows);
    expect(await db.conceptDefinition.count({ where: { conceptKey: earlier } })).toBe(1);

    // Emptying a definition a published lesson links would leave the word with nothing to open.
    await expect(importContent(db, { ...empty(), definitions: [{ ...earlierDefinition, blocks: [] }] })).rejects.toThrow(/Missing definition/);
    expect((await db.conceptDefinition.findFirstOrThrow({ where: { conceptKey: earlier } })).summary).toBe('다시 쓴 설명이에요.');
    const exported = await exportContent(db);
    expect(await importContent(db, JSON.parse(JSON.stringify(exported)))).toMatchObject({ newLessons: 0, newDiagnostics: 0 });
  });

  it('lets a lesson keep its own wording for a concept the shared dictionary already defines', async () => {
    const suffix = randomUUID();
    const earlier = `test.dict.earlier.${suffix}`, current = `test.dict.current.${suffix}`;
    const first = newLesson(), second = newLesson();
    first.public.conceptKeys = [earlier]; first.public.prerequisiteConceptKeys = [];
    first.problems.forEach(p => { p.conceptKeys = [earlier]; });
    second.public.conceptKeys = [current]; second.public.prerequisiteConceptKeys = [earlier];
    second.problems.forEach(p => { p.conceptKeys = [current]; });
    const shared = { conceptKey: earlier, label: '분모', summary: '사전이 쓴 설명이에요.',
      blocks: [{ blockId: `global:${earlier}:b1`, kind: 'core.rich_text', typeVersion: 1, required: true, payload: { text: '사전 정의' } }] };
    // The same concept, kept by the lesson: its own name and wording, written on its own.
    const mine = { ...shared, scopeKind: 'lesson' as const, scopeKey: second.public.lessonKey, label: '아래 수', summary: '이 수업이 쓴 설명이에요.',
      blocks: [{ ...shared.blocks[0], blockId: `lesson:${second.public.lessonKey}:${earlier}:b1`, payload: { text: '수업 정의' } }] };
    const block = second.sections[0].contentBlocks[0];
    second.sections[0].contentBlocks[0] = { ...block, typeVersion: 3, payload: { text: '분모가 무엇인지 떠올려 보세요.',
      definitions: [{ conceptKey: earlier, surface: '분모', scopeKind: 'lesson', scopeKey: second.public.lessonKey }] } };
    const input = { ...empty(), ...publish(first, second), definitions: [shared, mine],
      concepts: [{ key: earlier, label: '앞선 개념', assessable: true }, { key: current, label: '지금 개념', assessable: true }] };

    // The dictionary alone does not answer for a reference that named the lesson.
    await expect(importContent(db, { ...input, definitions: [shared] })).rejects.toThrow(/Missing definition/);
    await importContent(db, input);

    const document = await service.lessonDocument(second.public.lessonKey);
    expect(document.glossary).toHaveLength(1);
    expect(document.glossary[0]).toMatchObject({ conceptKey: earlier, scopeKind: 'lesson', scopeKey: second.public.lessonKey,
      label: '아래 수', summary: '이 수업이 쓴 설명이에요.' });
    // The dictionary definition was never asked for, so its text is absent from the payload.
    expect(JSON.stringify(document)).not.toContain('사전이 쓴 설명이에요.');

    // Each scope is written on its own: rewording one leaves the other where it was.
    await importContent(db, { ...empty(), definitions: [{ ...mine, summary: '수업 설명을 고쳤어요.' }] });
    expect((await service.lessonDocument(second.public.lessonKey)).glossary[0].summary).toBe('수업 설명을 고쳤어요.');
    expect((await db.conceptDefinition.findUniqueOrThrow({ where: { conceptKey_scopeKind_scopeKey: { conceptKey: earlier, scopeKind: 'global', scopeKey: '' } } })).summary)
      .toBe('사전이 쓴 설명이에요.');
    // Exporting and re-importing the whole database carries the scopes back unchanged.
    expect(await importContent(db, JSON.parse(JSON.stringify(await exportContent(db))))).toMatchObject({ newLessons: 0 });
  });

  it('publishes a reviewed bundle once and skips it while the file is unchanged', async () => {
    const suffix = randomUUID();
    const conceptKey = `test.bundle.${suffix}`;
    await db.concept.create({ data: { key: conceptKey, label: '번들 개념', assessable: false } });
    const definition = (summary: string) => ({ conceptKey, label: '번들 낱말', summary,
      blocks: [{ blockId: `global:${conceptKey}:b1`, kind: 'core.rich_text', typeVersion: 1, required: true, payload: { text: summary } }] });
    const name = `test-${suffix}.json`;
    const bundle = { ...empty(), definitions: [definition('처음 발행한 설명이에요.')] };
    const checksum = createHash('sha256').update(JSON.stringify(bundle)).digest('hex');

    expect(await publishBundle(db, name, checksum, bundle, true)).toMatchObject({ skipped: false, dryRun: true, definitions: 1 });
    expect(await db.appliedContentBundle.findUnique({ where: { name } })).toBeNull();
    expect(await publishBundle(db, name, checksum, bundle)).toMatchObject({ skipped: false, definitions: 1 });
    const applied = await db.appliedContentBundle.findUniqueOrThrow({ where: { name } });
    expect(applied.checksum).toBe(checksum);

    // An unchanged file does no database work on the next release.
    expect(await publishBundle(db, name, checksum, bundle)).toMatchObject({ skipped: true });
    expect(await db.appliedContentBundle.findUniqueOrThrow({ where: { name } })).toEqual(applied);

    // An edited file rewrites the definition in place, and the ledger follows the new checksum.
    const reworded = { ...bundle, definitions: [definition('다시 쓴 설명이에요.')] };
    const nextChecksum = createHash('sha256').update(JSON.stringify(reworded)).digest('hex');
    expect(await publishBundle(db, name, nextChecksum, reworded)).toMatchObject({ skipped: false, definitions: 1 });
    expect((await db.appliedContentBundle.findUniqueOrThrow({ where: { name } })).checksum).toBe(nextChecksum);
    expect((await db.conceptDefinition.findFirstOrThrow({ where: { conceptKey } })).summary).toBe('다시 쓴 설명이에요.');

    // A rejected bundle leaves the ledger on the last content that actually landed.
    const broken = { ...reworded, definitions: [{ ...definition('없는 개념의 설명이에요.'), conceptKey: `${conceptKey}.missing` }] };
    const badChecksum = createHash('sha256').update(JSON.stringify(broken)).digest('hex');
    await expect(publishBundle(db, name, badChecksum, broken)).rejects.toThrow(/Missing concept/);
    expect((await db.appliedContentBundle.findUniqueOrThrow({ where: { name } })).checksum).toBe(nextChecksum);
  });
});
