import 'server-only';
import { createHash } from 'node:crypto';
import { Prisma, type PrismaClient, type DiagnosticVersion, type TermVersion } from '@prisma/client';
import { canonicalJson, ContentError, diagnosticDefinitionSchema, parseContentBundle, termDefinitionSchema, validateReferences, type ContentBundle, type DiagnosticDefinition, type TermDefinition } from '@/core/content-bundle';
import type { StoredClass } from '@/core/content';
import { termRefId, type TermRef, type TermScopeKind } from '@/shared/rich-text';

type Db = Prisma.TransactionClient;
const json = (value: unknown) => JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
const hash = (value: unknown) => createHash('sha256').update(canonicalJson(value)).digest('hex');
type IndexedProblem = { problemVersionId: string };
/** The lookup rows a published version owns. Derived from its document, never edited on its own. */
const problemRows = (ownerKind: 'class' | 'diagnostic', ownerVersionId: string, problems: IndexedProblem[]) =>
  problems.map(problem => ({ ownerKind, ownerVersionId, problemVersionId: problem.problemVersionId, document: json(problem) }));
const problemRowsOf = (bundle: ContentBundle) => [
  ...bundle.classes.flatMap(c => problemRows('class', c.public.versionId, c.problems)),
  ...bundle.diagnostics.flatMap(d => problemRows('diagnostic', d.versionId, d.problems)),
];
const rowKey = (row: { ownerKind: string; ownerVersionId: string; problemVersionId: string }) =>
  `${row.ownerKind}/${row.ownerVersionId}/${row.problemVersionId}`;
/**
 * Writes the lookup rows a published version owns. Whoever writes a version owes these, and whoever
 * removes one owes their removal; verifyProblemIndex is what says so out loud.
 */
export async function indexPublishedProblems(db: Db, ownerKind: 'class' | 'diagnostic', ownerVersionId: string, problems: IndexedProblem[]) {
  const rows = problemRows(ownerKind, ownerVersionId, problems);
  if (rows.length) await db.publishedProblem.createMany({ data: rows, skipDuplicates: true });
}

export function diagnosticDefinition(row: DiagnosticVersion): DiagnosticDefinition {
  return diagnosticDefinitionSchema.parse({ versionId: row.id, diagnosticKey: row.diagnosticKey, title: row.title,
    description: row.description, estimatedMinutes: row.estimatedMinutes, problems: row.document });
}
export function termDefinition(row: TermVersion): TermDefinition {
  return termDefinitionSchema.parse({ versionId: row.id, termKey: row.termKey,
    scopeKind: row.scopeKind, scopeKey: row.scopeKey, skillKey: row.skillKey,
    label: row.label, summary: row.summary, blocks: row.document });
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
  return rows.filter(row => {
    const ref = rowRef(row);
    if (!wanted.has(ref) || seen.has(ref)) return false;
    seen.add(ref);
    return true;
  }).map(termDefinition);
}
export async function currentDiagnostic(db: Db) {
  const row = await db.diagnosticVersion.findFirst({ where: { diagnosticKey: 'starting-point' }, orderBy: [{ publishedAt: 'desc' }, { id: 'desc' }] });
  return row ? diagnosticDefinition(row) : null;
}
export async function exportContent(db: Db): Promise<ContentBundle> {
  const [skills, classes, diagnostics, terms] = await Promise.all([
    db.skill.findMany({ orderBy: [{ order: 'asc' }, { key: 'asc' }] }),
    db.classVersion.findMany({ orderBy: [{ publishedAt: 'asc' }, { id: 'asc' }] }),
    db.diagnosticVersion.findMany({ orderBy: [{ publishedAt: 'asc' }, { id: 'asc' }] }),
    db.termVersion.findMany({ orderBy: [{ publishedAt: 'asc' }, { id: 'asc' }] }),
  ]);
  for (const row of classes) {
    const record = row.document as unknown as StoredClass;
    if (row.id !== record.public?.versionId || row.classKey !== record.public?.classKey || row.title !== record.public?.title || row.order !== record.public?.order) throw new ContentError(`Class metadata mismatch: ${row.id}`);
  }
  return parseContentBundle({ schemaVersion: 1, skills, classes: classes.map(c => c.document),
    diagnostics: diagnostics.map(diagnosticDefinition), terms: terms.map(termDefinition) });
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

export async function verifyContent(db: Db) {
  const bundle = await exportContent(db);
  validateReferences(bundle);
  if (!bundle.classes.length || !bundle.skills.length || !bundle.diagnostics.some(d => d.diagnosticKey === 'starting-point')) throw new ContentError('Database content is incomplete. Apply database migrations or import a reviewed bundle.');
  const indexedProblems = await verifyProblemIndex(db, bundle);
  return { classes: bundle.classes.length, classProblems: bundle.classes.reduce((n, c) => n + c.problems.length, 0), indexedProblems,
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
    if (old && canonicalJson(diagnosticDefinition(old)) !== canonicalJson(d)) throw new ContentError(`Published diagnostic is immutable: ${d.versionId}. Use a new version ID.`);
    if (!old) newDiagnostics.push(d);
  }
  for (const t of incoming.terms) {
    const old = await db.termVersion.findUnique({ where: { id: t.versionId } });
    if (old && canonicalJson(termDefinition(old)) !== canonicalJson(t)) throw new ContentError(`Published term is immutable: ${t.versionId}. Use a new version ID.`);
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
      title: c.public.title, order: c.public.order, document: json(c), contentHash: hash(c), publishedAt: publishedAt() } });
    for (const d of newDiagnostics) await db.diagnosticVersion.create({ data: { id: d.versionId, diagnosticKey: d.diagnosticKey,
      title: d.title, description: d.description, estimatedMinutes: d.estimatedMinutes, document: json(d.problems), contentHash: hash(d), publishedAt: publishedAt() } });
    // The index shares the transaction that publishes the version, so a question is never findable
    // by name before the document that holds it exists.
    for (const c of newClasses) await indexPublishedProblems(db, 'class', c.public.versionId, c.problems);
    for (const d of newDiagnostics) await indexPublishedProblems(db, 'diagnostic', d.versionId, d.problems);
    // Term links live inside class JSON with no foreign key, so creation order is free; the merged
    // reference check above already proved every linked term exists.
    for (const t of newTerms) await db.termVersion.create({ data: { id: t.versionId, termKey: t.termKey,
      scopeKind: t.scopeKind, scopeKey: t.scopeKey, skillKey: t.skillKey,
      label: t.label, summary: t.summary, document: json(t.blocks), contentHash: hash(t), publishedAt: publishedAt() } });
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
