import 'server-only';
import { createHash } from 'node:crypto';
import { Prisma, type PrismaClient, type DiagnosticVersion, type TermVersion } from '@prisma/client';
import { canonicalJson, ContentError, diagnosticDefinitionSchema, parseContentBundle, termDefinitionSchema, validateReferences, type ContentBundle, type DiagnosticDefinition, type TermDefinition } from '@/core/content-bundle';
import type { StoredLesson, StoredProblem } from '@/core/content';
import type { ContentBlock } from '@/shared/api';
import { termRefId, type TermRef, type ConceptScope } from '@/shared/rich-text';

type Db = Prisma.TransactionClient;
const json = (value: unknown) => JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
const hash = (value: unknown) => createHash('sha256').update(canonicalJson(value)).digest('hex');
type IndexedProblem = StoredProblem | DiagnosticDefinition['problems'][number];
/**
 * A published question as a row: what it is apart from its blocks. The blocks are rows of their own,
 * so reading a question back joins the two.
 */
const problemRows = (ownerKind: 'lesson' | 'diagnostic', ownerVersionId: string, problems: IndexedProblem[]) =>
  problems.map((problem, order) => ({ ownerKind, ownerVersionId, problemVersionId: problem.problemVersionId,
    order, skillKeys: json(problem.skillKeys), responseSpec: json(problem.responseSpec),
    gradingSpec: json(problem.gradingSpec), hintAvailable: problem.hintAvailable }));
type BlockRow = { ownerKind: string; ownerVersionId: string; ownerId: string; slot: string; order: number;
  blockId: string; kind: string; typeVersion: number; required: boolean; payload: Prisma.InputJsonValue; fallback: string | null };
/**
 * A block as a row. `fallback` is absent from a document rather than empty, so it travels as null
 * and comes back as no key at all — a row that restored it as null would change the content hash.
 */
const blockRows = (ownerKind: 'section' | 'problem' | 'term', ownerVersionId: string, ownerId: string, slot: string, blocks: ContentBlock[]): BlockRow[] =>
  blocks.map((block, order) => ({ ownerKind, ownerVersionId, ownerId, slot, order,
    blockId: block.blockId, kind: block.kind, typeVersion: block.typeVersion, required: block.required,
    payload: json(block.payload), fallback: block.fallback ?? null }));
type StoredBlockRow = { blockId: string; kind: string; typeVersion: number; required: boolean; payload: unknown; fallback: string | null };
export const blockOf = (row: StoredBlockRow): ContentBlock => ({
  blockId: row.blockId, kind: row.kind, typeVersion: row.typeVersion, required: row.required,
  payload: row.payload as Record<string, unknown>, ...(row.fallback === null ? {} : { fallback: row.fallback }),
});
/** Everything a lesson says about itself that is not a section, a block or a question. */
export const lessonMetadata = (record: StoredLesson) => ({ public: record.public, homeworkProblemIds: record.homeworkProblemIds });
/** Every section and block a published lesson holds, in the order the document holds them. */
const lessonRows = (record: StoredLesson) => ({
  sections: record.sections.map((section, order) => ({ lessonVersionId: record.public.versionId,
    sectionId: section.sectionId, role: section.role, title: section.title, order })),
  blocks: [
    ...record.sections.flatMap(section => blockRows('section', record.public.versionId, section.sectionId, 'body', section.contentBlocks)),
    ...record.problems.flatMap(problem => [
      ...blockRows('problem', record.public.versionId, problem.problemVersionId, 'prompt', problem.promptContent),
      ...blockRows('problem', record.public.versionId, problem.problemVersionId, 'hint', problem.hints),
      ...blockRows('problem', record.public.versionId, problem.problemVersionId, 'solution', problem.solution),
    ]),
  ],
});
/**
 * Writes every row a published lesson is read from — what it says about itself, its sections, its
 * blocks and its questions. Whoever publishes a lesson owes these.
 */
export async function indexLessonDocument(db: Db, record: StoredLesson) {
  const { sections, blocks } = lessonRows(record);
  if (sections.length) await db.lessonSection.createMany({ data: sections, skipDuplicates: true });
  if (blocks.length) await db.contentBlock.createMany({ data: blocks, skipDuplicates: true });
  await indexPublishedProblems(db, 'lesson', record.public.versionId, record.problems);
}
/**
 * Writes the question rows a published version owns. Whoever writes a version owes these, and
 * whoever removes one owes their removal; verifyProblemIndex is what says so out loud.
 */
export async function indexPublishedProblems(db: Db, ownerKind: 'lesson' | 'diagnostic', ownerVersionId: string, problems: IndexedProblem[]) {
  const rows = problemRows(ownerKind, ownerVersionId, problems);
  if (rows.length) await db.publishedProblem.createMany({ data: rows, skipDuplicates: true });
}
/**
 * Writes the rows a published diagnostic is read from. Its questions carry no hint and no solution,
 * so a prompt is the whole of what a diagnostic question holds.
 */
export async function indexDiagnosticDocument(db: Db, definition: DiagnosticDefinition) {
  await indexPublishedProblems(db, 'diagnostic', definition.versionId, definition.problems);
  const blocks = definition.problems.flatMap(problem =>
    blockRows('problem', definition.versionId, problem.problemVersionId, 'prompt', problem.promptContent));
  if (blocks.length) await db.contentBlock.createMany({ data: blocks, skipDuplicates: true });
}
/** Writes the rows a published definition is read from: one list of blocks the version owns. */
export async function indexTermDocument(db: Db, versionId: string, blocks: ContentBlock[]) {
  const rows = blockRows('term', versionId, versionId, 'body', blocks);
  if (rows.length) await db.contentBlock.createMany({ data: rows, skipDuplicates: true });
}
/** Published questions by name, as they were published: the row's own columns and its blocks. */
export async function publishedProblemRecords(db: Db, problemVersionIds: string[]): Promise<Map<string, StoredProblem>> {
  const wanted = [...new Set(problemVersionIds)];
  if (!wanted.length) return new Map();
  // The same question may belong to several versions, and a published one never differs between
  // them, so the first owner found answers for all of them.
  const rows = await db.publishedProblem.findMany({ where: { problemVersionId: { in: wanted } },
    orderBy: [{ ownerVersionId: 'asc' }], distinct: ['problemVersionId'] });
  const blocksOf = await blockIndex(db, [...new Set(rows.map(row => row.ownerVersionId))]);
  return new Map(rows.map(row => [row.problemVersionId,
    problemOf(row, slot => blocksOf(row.ownerVersionId, 'problem', row.problemVersionId, slot))]));
}

type ProblemRow = { problemVersionId: string; skillKeys: unknown; responseSpec: unknown; gradingSpec: unknown; hintAvailable: boolean };
/** A question read back: what the row says, with its blocks put back in the order they were in. */
const problemOf = (row: ProblemRow, blocks: (slot: string) => ContentBlock[]): StoredProblem => ({
  problemVersionId: row.problemVersionId,
  skillKeys: row.skillKeys as string[],
  promptContent: blocks('prompt'),
  responseSpec: row.responseSpec as StoredProblem['responseSpec'],
  hintAvailable: row.hintAvailable,
  gradingSpec: row.gradingSpec as StoredProblem['gradingSpec'],
  hints: blocks('hint'),
  solution: blocks('solution'),
});
type BlockIndex = (versionId: string, ownerKind: string, ownerId: string, slot: string) => ContentBlock[];
/** Every block these versions hold, in order, ready to be asked for by the thing that owns it. */
async function blockIndex(db: Db, versionIds: string[]): Promise<BlockIndex> {
  const blocks = await db.contentBlock.findMany({ where: { ownerVersionId: { in: versionIds } }, orderBy: { order: 'asc' } });
  const held = new Map<string, ContentBlock[]>();
  for (const block of blocks) {
    const key = `${block.ownerVersionId}/${block.ownerKind}/${block.ownerId}/${block.slot}`;
    (held.get(key) ?? held.set(key, []).get(key)!).push(blockOf(block));
  }
  return (versionId, ownerKind, ownerId, slot) => held.get(`${versionId}/${ownerKind}/${ownerId}/${slot}`) ?? [];
}
/** A published lesson, put back together out of the rows that are now all there is of it. */
export async function lessonRecords(db: Db, versionIds: string[]): Promise<Map<string, StoredLesson>> {
  const wanted = [...new Set(versionIds)];
  if (!wanted.length) return new Map();
  const [versions, sections, blocksOf, problems] = await Promise.all([
    db.lessonVersion.findMany({ where: { id: { in: wanted } }, select: { id: true, metadata: true } }),
    db.lessonSection.findMany({ where: { lessonVersionId: { in: wanted } }, orderBy: { order: 'asc' } }),
    blockIndex(db, wanted),
    db.publishedProblem.findMany({ where: { ownerKind: 'lesson', ownerVersionId: { in: wanted } }, orderBy: { order: 'asc' } }),
  ]);
  return new Map(versions.map(version => {
    const metadata = version.metadata as { public: StoredLesson['public']; homeworkProblemIds: string[] };
    return [version.id, {
      public: metadata.public,
      sections: sections.filter(section => section.lessonVersionId === version.id).map(section => ({
        sectionId: section.sectionId, role: section.role as StoredLesson['sections'][number]['role'],
        title: section.title, contentBlocks: blocksOf(version.id, 'section', section.sectionId, 'body'),
      })),
      problems: problems.filter(problem => problem.ownerVersionId === version.id).map(problem =>
        problemOf(problem, slot => blocksOf(version.id, 'problem', problem.problemVersionId, slot))),
      homeworkProblemIds: metadata.homeworkProblemIds,
    }];
  }));
}
export async function lessonRecord(db: Db, versionId: string): Promise<StoredLesson | null> {
  return (await lessonRecords(db, [versionId])).get(versionId) ?? null;
}

/** A diagnostic is its own columns and the questions the rows hold for it, in their order. */
export async function diagnosticDefinitions(db: Db, rows: DiagnosticVersion[]): Promise<DiagnosticDefinition[]> {
  if (!rows.length) return [];
  const ids = rows.map(row => row.id);
  const [blocksOf, problems] = await Promise.all([
    blockIndex(db, ids),
    db.publishedProblem.findMany({ where: { ownerKind: 'diagnostic', ownerVersionId: { in: ids } }, orderBy: { order: 'asc' } }),
  ]);
  return rows.map(row => diagnosticDefinitionSchema.parse({ versionId: row.id, diagnosticKey: row.diagnosticKey,
    title: row.title, description: row.description, estimatedMinutes: row.estimatedMinutes,
    problems: problems.filter(problem => problem.ownerVersionId === row.id)
      .map(problem => problemOf(problem, slot => blocksOf(row.id, 'problem', problem.problemVersionId, slot))) }));
}
/** A definition is its own columns and one list of blocks the version owns directly. */
export async function termDefinitions(db: Db, rows: TermVersion[]): Promise<TermDefinition[]> {
  if (!rows.length) return [];
  const blocksOf = await blockIndex(db, rows.map(row => row.id));
  return rows.map(row => termDefinitionSchema.parse({ versionId: row.id, termKey: row.termKey,
    scopeKind: row.scopeKind, scopeKey: row.scopeKey, skillKey: row.skillKey,
    label: row.label, summary: row.summary, blocks: blocksOf(row.id, 'term', row.id, 'body') }));
}
const rowRef = (row: { termKey: string; scopeKind: string; scopeKey: string }) =>
  termRefId({ termKey: row.termKey, scopeKind: row.scopeKind as ConceptScope, scopeKey: row.scopeKey });
/**
 * Latest published definition for each term a document asked for. A reference names its scope, so a
 * lesson-scoped term and a dictionary term may share a key without either one answering for the
 * other. Only the version is late-bound: a reworded definition needs no lesson republished.
 */
export async function currentTerms(db: Db, refs: TermRef[]): Promise<TermDefinition[]> {
  if (!refs.length) return [];
  const wanted = new Set(refs.map(termRefId));
  const rows = await db.termVersion.findMany({ where: { termKey: { in: [...new Set(refs.map(ref => ref.termKey))] } },
    orderBy: [{ publishedAt: 'desc' }, { id: 'desc' }] });
  const seen = new Set<string>();
  const current = rows.filter(row => {
    const ref = rowRef(row);
    if (!wanted.has(ref) || seen.has(ref)) return false;
    seen.add(ref);
    return true;
  });
  return termDefinitions(db, current);
}
export async function currentDiagnostic(db: Db) {
  const row = await db.diagnosticVersion.findFirst({ where: { diagnosticKey: 'starting-point' }, orderBy: [{ publishedAt: 'desc' }, { id: 'desc' }] });
  return row ? (await diagnosticDefinitions(db, [row]))[0] : null;
}
export async function exportContent(db: Db): Promise<ContentBundle> {
  const [skills, lessons, diagnostics, terms] = await Promise.all([
    db.skill.findMany({ orderBy: [{ order: 'asc' }, { key: 'asc' }] }),
    db.lessonVersion.findMany({ orderBy: [{ publishedAt: 'asc' }, { id: 'asc' }],
      select: { id: true, lessonKey: true, title: true, order: true } }),
    db.diagnosticVersion.findMany({ orderBy: [{ publishedAt: 'asc' }, { id: 'asc' }] }),
    db.termVersion.findMany({ orderBy: [{ publishedAt: 'asc' }, { id: 'asc' }] }),
  ]);
  const records = await lessonRecords(db, lessons.map(row => row.id));
  for (const row of lessons) {
    const record = records.get(row.id);
    if (!record) throw new ContentError(`Published lesson has no rows to read it from: ${row.id}`);
    if (row.id !== record.public?.versionId || row.lessonKey !== record.public?.lessonKey || row.title !== record.public?.title || row.order !== record.public?.order) throw new ContentError(`Lesson metadata mismatch: ${row.id}`);
  }
  return parseContentBundle({ schemaVersion: 1, skills, lessons: lessons.map(row => records.get(row.id)),
    diagnostics: await diagnosticDefinitions(db, diagnostics), terms: await termDefinitions(db, terms) });
}

/**
 * Nothing holds a second copy of a published version any more, so verification is no longer a
 * comparison of two stories. What is left is that every row belongs to a version that reads back
 * whole — exportContent has just rebuilt and revalidated all of them — and that no row belongs to
 * none of them, which is a matter of counting.
 */
export async function verifyRowsBelongToVersions(db: Db, bundle: ContentBundle) {
  const expected = bundle.lessons.reduce((totals, record) => {
    const rows = lessonRows(record);
    return { sections: totals.sections + rows.sections.length, blocks: totals.blocks + rows.blocks.length,
      problems: totals.problems + record.problems.length };
  }, { sections: 0, blocks: 0, problems: 0 });
  expected.blocks += bundle.diagnostics.reduce((n, d) => n + d.problems.reduce((m, p) => m + p.promptContent.length, 0), 0);
  expected.blocks += bundle.terms.reduce((n, t) => n + t.blocks.length, 0);
  expected.problems += bundle.diagnostics.reduce((n, d) => n + d.problems.length, 0);
  const [sections, blocks, problems] = await Promise.all([db.lessonSection.count(), db.contentBlock.count(), db.publishedProblem.count()]);
  if (sections !== expected.sections) throw new ContentError(`Section rows belong to no published lesson: ${sections - expected.sections} extra.`);
  if (blocks !== expected.blocks) throw new ContentError(`Block rows belong to no published version: ${blocks - expected.blocks} extra.`);
  if (problems !== expected.problems) throw new ContentError(`Question rows belong to no published version: ${problems - expected.problems} extra.`);
  return { blocks, problems };
}

export async function verifyContent(db: Db) {
  const bundle = await exportContent(db);
  validateReferences(bundle);
  if (!bundle.lessons.length || !bundle.skills.length || !bundle.diagnostics.some(d => d.diagnosticKey === 'starting-point')) throw new ContentError('Database content is incomplete. Apply database migrations or import a reviewed bundle.');
  const { blocks: indexedBlocks, problems: indexedProblems } = await verifyRowsBelongToVersions(db, bundle);
  return { lessons: bundle.lessons.length, lessonProblems: bundle.lessons.reduce((n, c) => n + c.problems.length, 0), indexedProblems, indexedBlocks,
    skills: bundle.skills.length, diagnosticVersions: bundle.diagnostics.length, diagnosticProblems: bundle.diagnostics.reduce((n, d) => n + d.problems.length, 0),
    termVersions: bundle.terms.length, terms: new Set(bundle.terms.map(termRefId)).size };
}

type Ledger = { name: string; checksum: string };
async function importInTransaction(db: Db, incoming: ContentBundle, dryRun: boolean, ledger?: Ledger) {
  const existing = await exportContent(db);
  const newLessons: StoredLesson[] = [], newDiagnostics: DiagnosticDefinition[] = [], newTerms: TermDefinition[] = [];
  for (const c of incoming.lessons) {
    const old = await lessonRecord(db, c.public.versionId);
    if (old && canonicalJson(old) !== canonicalJson(c)) throw new ContentError(`Published lesson is immutable: ${c.public.versionId}. Use a new version ID.`);
    if (!old) newLessons.push(c);
  }
  for (const d of incoming.diagnostics) {
    const old = await db.diagnosticVersion.findUnique({ where: { id: d.versionId } });
    const published = old ? (await diagnosticDefinitions(db, [old]))[0] : null;
    if (published && canonicalJson(published) !== canonicalJson(d)) throw new ContentError(`Published diagnostic is immutable: ${d.versionId}. Use a new version ID.`);
    if (!old) newDiagnostics.push(d);
  }
  for (const t of incoming.terms) {
    const old = await db.termVersion.findUnique({ where: { id: t.versionId } });
    const published = old ? (await termDefinitions(db, [old]))[0] : null;
    if (published && canonicalJson(published) !== canonicalJson(t)) throw new ContentError(`Published term is immutable: ${t.versionId}. Use a new version ID.`);
    if (!old) newTerms.push(t);
  }
  const skills = new Map(existing.skills.map(s => [s.key, s]));
  for (const s of incoming.skills) {
    const old = await db.skill.findUnique({ where: { key: s.key } });
    if (old && old.key !== s.key) throw new ContentError('Skill keys cannot differ only by letter case.');
    skills.set(s.key, s);
  }
  validateReferences({ schemaVersion: 1, skills: [...skills.values()], lessons: [...existing.lessons, ...newLessons],
    diagnostics: [...existing.diagnostics, ...newDiagnostics], terms: [...existing.terms, ...newTerms] });
  if (!dryRun) {
    // Bundle order is publication order. Millisecond ties must not select an arbitrary version.
    const [lastLesson, lastDiagnostic, lastTerm] = await Promise.all([
      db.lessonVersion.findFirst({ orderBy: { publishedAt: 'desc' }, select: { publishedAt: true } }),
      db.diagnosticVersion.findFirst({ orderBy: { publishedAt: 'desc' }, select: { publishedAt: true } }),
      db.termVersion.findFirst({ orderBy: { publishedAt: 'desc' }, select: { publishedAt: true } }),
    ]);
    let publishedTime = Math.max(Date.now(), (lastLesson?.publishedAt.getTime() ?? 0) + 1, (lastDiagnostic?.publishedAt.getTime() ?? 0) + 1, (lastTerm?.publishedAt.getTime() ?? 0) + 1);
    const publishedAt = () => new Date(publishedTime++);
    for (const s of incoming.skills) await db.skill.upsert({ where: { key: s.key }, create: s, update: { label: s.label, order: s.order } });
    for (const c of newLessons) await db.lessonVersion.create({ data: { id: c.public.versionId, lessonKey: c.public.lessonKey,
      title: c.public.title, order: c.public.order, metadata: json(lessonMetadata(c)),
      contentHash: hash(c), publishedAt: publishedAt() } });
    for (const d of newDiagnostics) await db.diagnosticVersion.create({ data: { id: d.versionId, diagnosticKey: d.diagnosticKey,
      title: d.title, description: d.description, estimatedMinutes: d.estimatedMinutes, contentHash: hash(d), publishedAt: publishedAt() } });
    // The index shares the transaction that publishes the version, so a question is never findable
    // by name before the document that holds it exists.
    for (const c of newLessons) await indexLessonDocument(db, c);
    for (const d of newDiagnostics) await indexDiagnosticDocument(db, d);
    // Term links live inside lesson JSON with no foreign key, so creation order is free; the merged
    // reference check above already proved every linked term exists.
    for (const t of newTerms) await db.termVersion.create({ data: { id: t.versionId, termKey: t.termKey,
      scopeKind: t.scopeKind, scopeKey: t.scopeKey, skillKey: t.skillKey,
      label: t.label, summary: t.summary, contentHash: hash(t), publishedAt: publishedAt() } });
    for (const t of newTerms) await indexTermDocument(db, t.versionId, t.blocks as ContentBlock[]);
    // The ledger entry shares this transaction: a file counts as applied only if its content landed.
    if (ledger) await db.appliedContentBundle.upsert({ where: { name: ledger.name }, create: { ...ledger },
      update: { checksum: ledger.checksum, appliedAt: new Date() } });
  }
  return { dryRun, newLessons: newLessons.length, newDiagnostics: newDiagnostics.length, newTerms: newTerms.length, skills: incoming.skills.length,
    unchangedVersions: incoming.lessons.length + incoming.diagnostics.length + incoming.terms.length - newLessons.length - newDiagnostics.length - newTerms.length };
}
export async function importContent(db: PrismaClient, input: unknown, dryRun = false, ledger?: Ledger) {
  const incoming = parseContentBundle(input);
  for (let retry = 0; ; retry++) {
    try { return await db.$transaction(tx => importInTransaction(tx, incoming, dryRun, ledger), { isolationLevel: Prisma.TransactionIsolationLevel.Serializable, timeout: 30_000, maxWait: 10_000 }); }
    catch (error) {
      if (retry < 3 && error instanceof Prisma.PrismaClientKnownRequestError && ['P2002', 'P2034'].includes(error.code)) continue;
      throw error;
    }
  }
}

/**
 * Publishes a reviewed bundle file once, the way a migration ledger works: an entry with the same
 * checksum means the file already landed, so a release does no database work for unchanged content.
 * An edited file publishes its new versions; an edited published version is rejected as immutable.
 */
export async function publishBundle(db: PrismaClient, name: string, checksum: string, input: unknown, dryRun = false) {
  const applied = await db.appliedContentBundle.findUnique({ where: { name } });
  if (applied?.checksum === checksum) return { name, skipped: true as const, appliedAt: applied.appliedAt.toISOString() };
  const result = await importContent(db, input, dryRun, { name, checksum });
  return { name, skipped: false as const, ...result };
}
