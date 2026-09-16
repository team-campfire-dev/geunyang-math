import 'server-only';
import { createHash } from 'node:crypto';
import { Prisma, type PrismaClient, type DiagnosticVersion, type TermVersion } from '@prisma/client';
import { canonicalJson, ContentError, diagnosticDefinitionSchema, parseContentBundle, termDefinitionSchema, validateReferences, type ContentBundle, type DiagnosticDefinition, type TermDefinition } from '@/core/content-bundle';
import type { StoredClass, StoredProblem } from '@/core/content';
import type { ContentBlock } from '@/shared/api';
import { termRefId, type TermRef, type TermScopeKind } from '@/shared/rich-text';

type Db = Prisma.TransactionClient;
const json = (value: unknown) => JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
const hash = (value: unknown) => createHash('sha256').update(canonicalJson(value)).digest('hex');
type IndexedProblem = StoredProblem | DiagnosticDefinition['problems'][number];
/**
 * A published question as a row: what it is apart from its blocks, plus the whole of it as it was
 * published. The blocks are rows of their own, so reading one back joins the two.
 */
const problemRows = (ownerKind: 'class' | 'diagnostic', ownerVersionId: string, problems: IndexedProblem[]) =>
  problems.map((problem, order) => ({ ownerKind, ownerVersionId, problemVersionId: problem.problemVersionId,
    order, skillKeys: json(problem.skillKeys), responseSpec: json(problem.responseSpec),
    gradingSpec: json(problem.gradingSpec), hintAvailable: problem.hintAvailable, document: json(problem) }));
const problemRowsOf = (bundle: ContentBundle) => [
  ...bundle.classes.flatMap(c => problemRows('class', c.public.versionId, c.problems)),
  ...bundle.diagnostics.flatMap(d => problemRows('diagnostic', d.versionId, d.problems)),
];
const rowKey = (row: { ownerKind: string; ownerVersionId: string; problemVersionId: string }) =>
  `${row.ownerKind}/${row.ownerVersionId}/${row.problemVersionId}`;
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
/** Everything a class says about itself that is not a section, a block or a question. */
export const classMetadata = (record: StoredClass) => ({ public: record.public, homeworkProblemIds: record.homeworkProblemIds });
/** Every section and block a published class holds, in the order the document holds them. */
const classRows = (record: StoredClass) => ({
  sections: record.sections.map((section, order) => ({ classVersionId: record.public.versionId,
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
 * Writes every row a published class is read from — what it says about itself, its sections, its
 * blocks and its questions. Whoever publishes a class owes these.
 */
export async function indexClassDocument(db: Db, record: StoredClass) {
  const { sections, blocks } = classRows(record);
  if (sections.length) await db.classSection.createMany({ data: sections, skipDuplicates: true });
  if (blocks.length) await db.contentBlock.createMany({ data: blocks, skipDuplicates: true });
  await indexPublishedProblems(db, 'class', record.public.versionId, record.problems);
}
/**
 * Writes the question rows a published version owns. Whoever writes a version owes these, and
 * whoever removes one owes their removal; verifyProblemIndex is what says so out loud.
 */
export async function indexPublishedProblems(db: Db, ownerKind: 'class' | 'diagnostic', ownerVersionId: string, problems: IndexedProblem[]) {
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
/**
 * Published classes read from their rows rather than from the document they were written as. The
 * document is still written and still checked against this, until a later change removes it.
 */
export async function classRecords(db: Db, versionIds: string[]): Promise<Map<string, StoredClass>> {
  const wanted = [...new Set(versionIds)];
  if (!wanted.length) return new Map();
  const [versions, sections, blocksOf, problems] = await Promise.all([
    db.classVersion.findMany({ where: { id: { in: wanted } }, select: { id: true, metadata: true } }),
    db.classSection.findMany({ where: { classVersionId: { in: wanted } }, orderBy: { order: 'asc' } }),
    blockIndex(db, wanted),
    db.publishedProblem.findMany({ where: { ownerKind: 'class', ownerVersionId: { in: wanted } }, orderBy: { order: 'asc' } }),
  ]);
  return new Map(versions.map(version => {
    const metadata = version.metadata as { public: StoredClass['public']; homeworkProblemIds: string[] };
    return [version.id, {
      public: metadata.public,
      sections: sections.filter(section => section.classVersionId === version.id).map(section => ({
        sectionId: section.sectionId, role: section.role as StoredClass['sections'][number]['role'],
        title: section.title, contentBlocks: blocksOf(version.id, 'section', section.sectionId, 'body'),
      })),
      problems: problems.filter(problem => problem.ownerVersionId === version.id).map(problem =>
        problemOf(problem, slot => blocksOf(version.id, 'problem', problem.problemVersionId, slot))),
      homeworkProblemIds: metadata.homeworkProblemIds,
    }];
  }));
}
export async function classRecord(db: Db, versionId: string): Promise<StoredClass | null> {
  return (await classRecords(db, [versionId])).get(versionId) ?? null;
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
  termRefId({ termKey: row.termKey, scopeKind: row.scopeKind as TermScopeKind, scopeKey: row.scopeKey });
/**
 * Latest published definition for each term a document asked for. A reference names its scope, so a
 * class-scoped term and a dictionary term may share a key without either one answering for the
 * other. Only the version is late-bound: a reworded definition needs no class republished.
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
  const [skills, classes, diagnostics, terms] = await Promise.all([
    db.skill.findMany({ orderBy: [{ order: 'asc' }, { key: 'asc' }] }),
    db.classVersion.findMany({ orderBy: [{ publishedAt: 'asc' }, { id: 'asc' }],
      select: { id: true, classKey: true, title: true, order: true } }),
    db.diagnosticVersion.findMany({ orderBy: [{ publishedAt: 'asc' }, { id: 'asc' }] }),
    db.termVersion.findMany({ orderBy: [{ publishedAt: 'asc' }, { id: 'asc' }] }),
  ]);
  const records = await classRecords(db, classes.map(row => row.id));
  for (const row of classes) {
    const record = records.get(row.id);
    if (!record) throw new ContentError(`Published class has no rows to read it from: ${row.id}`);
    if (row.id !== record.public?.versionId || row.classKey !== record.public?.classKey || row.title !== record.public?.title || row.order !== record.public?.order) throw new ContentError(`Class metadata mismatch: ${row.id}`);
  }
  return parseContentBundle({ schemaVersion: 1, skills, classes: classes.map(row => records.get(row.id)),
    diagnostics: await diagnosticDefinitions(db, diagnostics), terms: await termDefinitions(db, terms) });
}

/**
 * The question index repeats what the published documents hold, so a disagreement means one of the
 * two is wrong and a draft would be renaming questions on a false answer. Deploys check it.
 */
export async function verifyProblemIndex(db: Db, bundle: ContentBundle) {
  const expected = new Map(problemRowsOf(bundle).map(row => [rowKey(row), canonicalJson(row.document)]));
  const rows = await db.publishedProblem.findMany();
  for (const row of rows) {
    const document = expected.get(rowKey(row));
    if (document === undefined) throw new ContentError(`Question index holds a question its version does not: ${rowKey(row)}`);
    if (document !== canonicalJson(row.document)) throw new ContentError(`Question index disagrees with the published document: ${rowKey(row)}`);
    expected.delete(rowKey(row));
  }
  if (expected.size) throw new ContentError(`Question index is missing published questions: ${[...expected.keys()].slice(0, 5).join(', ')}`);
  return rows.length;
}

/**
 * The rows are what a published version is read from now, and the document it was published as is
 * still there. So the check is the one that matters: put the rows back together and see whether
 * they say exactly what the document says, down to the order a section holds its blocks in.
 */
export async function verifyPublishedDocuments(db: Db, bundle: ContentBundle) {
  const compare = async <T>(label: string, assembled: Map<string, string>, rows: { id: string; document: unknown }[]) => {
    for (const row of rows) {
      const record = assembled.get(row.id);
      if (record === undefined) throw new ContentError(`A published ${label} has no rows to read it from: ${row.id}`);
      if (record !== canonicalJson(row.document)) throw new ContentError(`The rows and the document disagree about a ${label}: ${row.id}`);
      assembled.delete(row.id);
    }
    if (assembled.size) throw new ContentError(`Rows describe a ${label} no version holds: ${[...assembled.keys()].slice(0, 5).join(', ')}`);
  };
  const [classRowsOf, diagnosticRows, termRows] = await Promise.all([
    db.classVersion.findMany({ select: { id: true, document: true } }),
    db.diagnosticVersion.findMany({ select: { id: true, document: true } }),
    db.termVersion.findMany({ select: { id: true, document: true } }),
  ]);
  await compare('class', new Map(bundle.classes.map(record => [record.public.versionId, canonicalJson(record)])), classRowsOf);
  // A diagnostic's document is its question list, and a definition's is its blocks.
  await compare('diagnostic', new Map(bundle.diagnostics.map(d => [d.versionId, canonicalJson(d.problems)])), diagnosticRows);
  await compare('term', new Map(bundle.terms.map(t => [t.versionId, canonicalJson(t.blocks)])), termRows);
  // Every version matched, so counting is all that is left to catch a row belonging to none of them.
  const [sections, blocks] = await Promise.all([db.classSection.count(), db.contentBlock.count()]);
  const expected = bundle.classes.reduce((totals, record) => {
    const rows = classRows(record);
    return { sections: totals.sections + rows.sections.length, blocks: totals.blocks + rows.blocks.length };
  }, { sections: 0, blocks: 0 });
  expected.blocks += bundle.diagnostics.reduce((n, d) => n + d.problems.reduce((m, p) => m + p.promptContent.length, 0), 0);
  expected.blocks += bundle.terms.reduce((n, t) => n + t.blocks.length, 0);
  if (sections !== expected.sections) throw new ContentError(`Section rows belong to no published class: ${sections - expected.sections} extra.`);
  if (blocks !== expected.blocks) throw new ContentError(`Block rows belong to no published version: ${blocks - expected.blocks} extra.`);
  return blocks;
}

export async function verifyContent(db: Db) {
  const bundle = await exportContent(db);
  validateReferences(bundle);
  if (!bundle.classes.length || !bundle.skills.length || !bundle.diagnostics.some(d => d.diagnosticKey === 'starting-point')) throw new ContentError('Database content is incomplete. Apply database migrations or import a reviewed bundle.');
  const indexedProblems = await verifyProblemIndex(db, bundle);
  const indexedBlocks = await verifyPublishedDocuments(db, bundle);
  return { classes: bundle.classes.length, classProblems: bundle.classes.reduce((n, c) => n + c.problems.length, 0), indexedProblems, indexedBlocks,
    skills: bundle.skills.length, diagnosticVersions: bundle.diagnostics.length, diagnosticProblems: bundle.diagnostics.reduce((n, d) => n + d.problems.length, 0),
    termVersions: bundle.terms.length, terms: new Set(bundle.terms.map(termRefId)).size };
}

type Ledger = { name: string; checksum: string };
async function importInTransaction(db: Db, incoming: ContentBundle, dryRun: boolean, ledger?: Ledger) {
  const existing = await exportContent(db);
  const newClasses: StoredClass[] = [], newDiagnostics: DiagnosticDefinition[] = [], newTerms: TermDefinition[] = [];
  for (const c of incoming.classes) {
    const old = await db.classVersion.findUnique({ where: { id: c.public.versionId } });
    if (old && canonicalJson(old.document) !== canonicalJson(c)) throw new ContentError(`Published class is immutable: ${c.public.versionId}. Use a new version ID.`);
    if (!old) newClasses.push(c);
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
  validateReferences({ schemaVersion: 1, skills: [...skills.values()], classes: [...existing.classes, ...newClasses],
    diagnostics: [...existing.diagnostics, ...newDiagnostics], terms: [...existing.terms, ...newTerms] });
  if (!dryRun) {
    // Bundle order is publication order. Millisecond ties must not select an arbitrary version.
    const [lastClass, lastDiagnostic, lastTerm] = await Promise.all([
      db.classVersion.findFirst({ orderBy: { publishedAt: 'desc' }, select: { publishedAt: true } }),
      db.diagnosticVersion.findFirst({ orderBy: { publishedAt: 'desc' }, select: { publishedAt: true } }),
      db.termVersion.findFirst({ orderBy: { publishedAt: 'desc' }, select: { publishedAt: true } }),
    ]);
    let publishedTime = Math.max(Date.now(), (lastClass?.publishedAt.getTime() ?? 0) + 1, (lastDiagnostic?.publishedAt.getTime() ?? 0) + 1, (lastTerm?.publishedAt.getTime() ?? 0) + 1);
    const publishedAt = () => new Date(publishedTime++);
    for (const s of incoming.skills) await db.skill.upsert({ where: { key: s.key }, create: s, update: { label: s.label, order: s.order } });
    for (const c of newClasses) await db.classVersion.create({ data: { id: c.public.versionId, classKey: c.public.classKey,
      title: c.public.title, order: c.public.order, document: json(c), metadata: json(classMetadata(c)),
      contentHash: hash(c), publishedAt: publishedAt() } });
    for (const d of newDiagnostics) await db.diagnosticVersion.create({ data: { id: d.versionId, diagnosticKey: d.diagnosticKey,
      title: d.title, description: d.description, estimatedMinutes: d.estimatedMinutes, document: json(d.problems), contentHash: hash(d), publishedAt: publishedAt() } });
    // The index shares the transaction that publishes the version, so a question is never findable
    // by name before the document that holds it exists.
    for (const c of newClasses) await indexClassDocument(db, c);
    for (const d of newDiagnostics) await indexDiagnosticDocument(db, d);
    // Term links live inside class JSON with no foreign key, so creation order is free; the merged
    // reference check above already proved every linked term exists.
    for (const t of newTerms) await db.termVersion.create({ data: { id: t.versionId, termKey: t.termKey,
      scopeKind: t.scopeKind, scopeKey: t.scopeKey, skillKey: t.skillKey,
      label: t.label, summary: t.summary, document: json(t.blocks), contentHash: hash(t), publishedAt: publishedAt() } });
    for (const t of newTerms) await indexTermDocument(db, t.versionId, t.blocks as ContentBlock[]);
    // The ledger entry shares this transaction: a file counts as applied only if its content landed.
    if (ledger) await db.appliedContentBundle.upsert({ where: { name: ledger.name }, create: { ...ledger },
      update: { checksum: ledger.checksum, appliedAt: new Date() } });
  }
  return { dryRun, newClasses: newClasses.length, newDiagnostics: newDiagnostics.length, newTerms: newTerms.length, skills: incoming.skills.length,
    unchangedVersions: incoming.classes.length + incoming.diagnostics.length + incoming.terms.length - newClasses.length - newDiagnostics.length - newTerms.length };
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
