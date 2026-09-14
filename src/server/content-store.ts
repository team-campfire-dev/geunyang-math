import 'server-only';
import { createHash } from 'node:crypto';
import { Prisma, type PrismaClient, type DiagnosticVersion } from '@prisma/client';
import { canonicalJson, ContentError, diagnosticDefinitionSchema, parseContentBundle, validateReferences, type ContentBundle, type DiagnosticDefinition } from '@/core/content-bundle';
import type { StoredClass } from '@/core/content';

type Db = Prisma.TransactionClient;
const json = (value: unknown) => JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
const hash = (value: unknown) => createHash('sha256').update(canonicalJson(value)).digest('hex');

export function diagnosticDefinition(row: DiagnosticVersion): DiagnosticDefinition {
  return diagnosticDefinitionSchema.parse({ versionId: row.id, diagnosticKey: row.diagnosticKey, title: row.title,
    description: row.description, estimatedMinutes: row.estimatedMinutes, problems: row.document });
}
export async function currentDiagnostic(db: Db) {
  const row = await db.diagnosticVersion.findFirst({ where: { diagnosticKey: 'starting-point' }, orderBy: [{ publishedAt: 'desc' }, { id: 'desc' }] });
  return row ? diagnosticDefinition(row) : null;
}
export async function exportContent(db: Db): Promise<ContentBundle> {
  const [skills, classes, diagnostics] = await Promise.all([
    db.skill.findMany({ orderBy: [{ order: 'asc' }, { key: 'asc' }] }),
    db.classVersion.findMany({ orderBy: [{ publishedAt: 'asc' }, { id: 'asc' }] }),
    db.diagnosticVersion.findMany({ orderBy: [{ publishedAt: 'asc' }, { id: 'asc' }] }),
  ]);
  for (const row of classes) {
    const record = row.document as unknown as StoredClass;
    if (row.id !== record.public?.versionId || row.classKey !== record.public?.classKey || row.title !== record.public?.title || row.order !== record.public?.order) throw new ContentError(`Class metadata mismatch: ${row.id}`);
  }
  return parseContentBundle({ schemaVersion: 1, skills, classes: classes.map(c => c.document), diagnostics: diagnostics.map(diagnosticDefinition) });
}

export async function verifyContent(db: Db) {
  const bundle = await exportContent(db);
  validateReferences(bundle);
  if (!bundle.classes.length || !bundle.skills.length || !bundle.diagnostics.some(d => d.diagnosticKey === 'starting-point')) throw new ContentError('Database content is incomplete. Apply database migrations or import a reviewed bundle.');
  return { classes: bundle.classes.length, classProblems: bundle.classes.reduce((n, c) => n + c.problems.length, 0),
    skills: bundle.skills.length, diagnosticVersions: bundle.diagnostics.length, diagnosticProblems: bundle.diagnostics.reduce((n, d) => n + d.problems.length, 0) };
}

async function importInTransaction(db: Db, incoming: ContentBundle, dryRun: boolean) {
  const existing = await exportContent(db);
  const newClasses: StoredClass[] = [], newDiagnostics: DiagnosticDefinition[] = [];
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
  const skills = new Map(existing.skills.map(s => [s.key, s]));
  for (const s of incoming.skills) {
    const old = await db.skill.findUnique({ where: { key: s.key } });
    if (old && old.key !== s.key) throw new ContentError('Skill keys cannot differ only by letter case.');
    skills.set(s.key, s);
  }
  validateReferences({ schemaVersion: 1, skills: [...skills.values()], classes: [...existing.classes, ...newClasses], diagnostics: [...existing.diagnostics, ...newDiagnostics] });
  if (!dryRun) {
    // Bundle order is publication order. Millisecond ties must not select an arbitrary version.
    const [lastClass, lastDiagnostic] = await Promise.all([
      db.classVersion.findFirst({ orderBy: { publishedAt: 'desc' }, select: { publishedAt: true } }),
      db.diagnosticVersion.findFirst({ orderBy: { publishedAt: 'desc' }, select: { publishedAt: true } }),
    ]);
    let publishedTime = Math.max(Date.now(), (lastClass?.publishedAt.getTime() ?? 0) + 1, (lastDiagnostic?.publishedAt.getTime() ?? 0) + 1);
    const publishedAt = () => new Date(publishedTime++);
    for (const s of incoming.skills) await db.skill.upsert({ where: { key: s.key }, create: s, update: { label: s.label, order: s.order } });
    for (const c of newClasses) await db.classVersion.create({ data: { id: c.public.versionId, classKey: c.public.classKey,
      title: c.public.title, order: c.public.order, document: json(c), contentHash: hash(c), publishedAt: publishedAt() } });
    for (const d of newDiagnostics) await db.diagnosticVersion.create({ data: { id: d.versionId, diagnosticKey: d.diagnosticKey,
      title: d.title, description: d.description, estimatedMinutes: d.estimatedMinutes, document: json(d.problems), contentHash: hash(d), publishedAt: publishedAt() } });
  }
  return { dryRun, newClasses: newClasses.length, newDiagnostics: newDiagnostics.length, skills: incoming.skills.length,
    unchangedVersions: incoming.classes.length + incoming.diagnostics.length - newClasses.length - newDiagnostics.length };
}
export async function importContent(db: PrismaClient, input: unknown, dryRun = false) {
  const incoming = parseContentBundle(input);
  for (let retry = 0; ; retry++) {
    try { return await db.$transaction(tx => importInTransaction(tx, incoming, dryRun), { isolationLevel: Prisma.TransactionIsolationLevel.Serializable, timeout: 30_000, maxWait: 10_000 }); }
    catch (error) {
      if (retry < 3 && error instanceof Prisma.PrismaClientKnownRequestError && ['P2002', 'P2034'].includes(error.code)) continue;
      throw error;
    }
  }
}
