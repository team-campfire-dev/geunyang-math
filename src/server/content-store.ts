import 'server-only';
import { createHash } from 'node:crypto';
import { Prisma, type PrismaClient, type DiagnosticVersion } from '@prisma/client';
import { canonicalJson, ContentError, diagnosticDefinitionSchema, parseContentBundle, definitionSchema, validateReferences, type ContentBundle, type CourseDefinition, type DiagnosticDefinition, type DiagnosticRecord, type DefinitionRecord } from '@/core/content-bundle';
import type { PublishedDefinition } from '@/core/glossary';
import { problemSetRefs, storedLessonOf, type LessonRecord, type StoredLesson, type StoredProblem, type StoredProblemSet } from '@/core/content';
import { defaultCourseTrack, type ContentBlock, type CourseStage, type CourseTrack } from '@/shared/api';
import { definitionRefId, type DefinitionRef, type ConceptScope } from '@/shared/rich-text';

type Db = Prisma.TransactionClient;
const json = (value: unknown) => JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
const hash = (value: unknown) => createHash('sha256').update(canonicalJson(value)).digest('hex');
/**
 * A published question as a row: what it is apart from its blocks. The blocks are rows of their own,
 * so reading a question back joins the two. Every question belongs to a problem set version.
 */
const problemRows = (ownerVersionId: string, problems: StoredProblem[]) =>
  problems.map((problem, order) => ({ ownerKind: 'problem_set', ownerVersionId, problemVersionId: problem.problemVersionId,
    order, conceptKeys: json(problem.conceptKeys), responseSpec: json(problem.responseSpec),
    gradingSpec: json(problem.gradingSpec), hintAvailable: problem.hintAvailable }));
type BlockRow = { ownerKind: string; ownerVersionId: string; ownerId: string; slot: string; order: number;
  blockId: string; kind: string; typeVersion: number; required: boolean; payload: Prisma.InputJsonValue; fallback: string | null };
/**
 * A block as a row. `fallback` is absent from a document rather than empty, so it travels as null
 * and comes back as no key at all — a row that restored it as null would change the content hash.
 */
const blockRows = (ownerKind: 'section' | 'problem' | 'definition', ownerVersionId: string, ownerId: string, slot: string, blocks: ContentBlock[]): BlockRow[] =>
  blocks.map((block, order) => ({ ownerKind, ownerVersionId, ownerId, slot, order,
    blockId: block.blockId, kind: block.kind, typeVersion: block.typeVersion, required: block.required,
    payload: json(block.payload), fallback: block.fallback ?? null }));
type StoredBlockRow = { blockId: string; kind: string; typeVersion: number; required: boolean; payload: unknown; fallback: string | null };
export const blockOf = (row: StoredBlockRow): ContentBlock => ({
  blockId: row.blockId, kind: row.kind, typeVersion: row.typeVersion, required: row.required,
  payload: row.payload as Record<string, unknown>, ...(row.fallback === null ? {} : { fallback: row.fallback }),
});
/** Everything a lesson says about itself that is not a section or a block. */
export const lessonMetadata = (record: StoredLesson) => ({ public: record.public, review: record.review });
/** Every section and block a published lesson holds, in the order the document holds them. */
const lessonRows = (record: StoredLesson) => ({
  sections: record.sections.map((section, order) => ({ lessonVersionId: record.public.versionId,
    sectionId: section.sectionId, role: section.role, title: section.title, order })),
  blocks: record.sections.flatMap(section => blockRows('section', record.public.versionId, section.sectionId, 'body', section.contentBlocks)),
});
/** Every block a problem set version holds: each question's prompt, hints and solution. */
const problemSetRows = (record: StoredProblemSet) => record.problems.flatMap(problem => [
  ...blockRows('problem', record.versionId, problem.problemVersionId, 'prompt', problem.promptContent),
  ...blockRows('problem', record.versionId, problem.problemVersionId, 'hint', problem.hints),
  ...blockRows('problem', record.versionId, problem.problemVersionId, 'solution', problem.solution),
]);
/** The frozen part of a problem set version: what its hash is taken over and what may not change. */
export const frozenProblemSet = (record: StoredProblemSet) =>
  ({ problemSetId: record.problemSetId, versionId: record.versionId, problems: record.problems });
/**
 * Writes every row a published lesson is read from — what it says about itself, its sections and
 * their blocks. Its questions are the problem sets' rows. Whoever publishes a lesson owes these.
 */
export async function indexLessonDocument(db: Db, record: StoredLesson) {
  const { sections, blocks } = lessonRows(record);
  if (sections.length) await db.lessonSection.createMany({ data: sections, skipDuplicates: true });
  if (blocks.length) await db.contentBlock.createMany({ data: blocks, skipDuplicates: true });
}
/** Writes the rows a published problem set version is read from: its questions and their blocks. */
export async function indexProblemSetDocument(db: Db, record: StoredProblemSet) {
  await indexPublishedProblems(db, record.versionId, record.problems);
  const blocks = problemSetRows(record);
  if (blocks.length) await db.contentBlock.createMany({ data: blocks, skipDuplicates: true });
}
/**
 * Writes the question rows a published version owns. Whoever writes a version owes these, and
 * whoever removes one owes their removal; verifyProblemIndex is what says so out loud.
 */
export async function indexPublishedProblems(db: Db, ownerVersionId: string, problems: StoredProblem[]) {
  const rows = problemRows(ownerVersionId, problems);
  if (rows.length) await db.publishedProblem.createMany({ data: rows, skipDuplicates: true });
}
/** Writes the blocks a definition is read from. A definition is saved in place, so what was there goes first. */
export async function indexDefinitionBlocks(db: Db, definitionId: string, blocks: ContentBlock[]) {
  await db.contentBlock.deleteMany({ where: { ownerKind: 'definition', ownerVersionId: definitionId } });
  const rows = blockRows('definition', definitionId, definitionId, 'body', blocks);
  if (rows.length) await db.contentBlock.createMany({ data: rows });
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

type ProblemRow = { problemVersionId: string; conceptKeys: unknown; responseSpec: unknown; gradingSpec: unknown; hintAvailable: boolean };
/** A question read back: what the row says, with its blocks put back in the order they were in. */
const problemOf = (row: ProblemRow, blocks: (slot: string) => ContentBlock[]): StoredProblem => ({
  problemVersionId: row.problemVersionId,
  conceptKeys: row.conceptKeys as string[],
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
/** Published problem set versions, with the identity that keeps each: its course and its name. */
export async function problemSetRecords(db: Db, versionIds: string[]): Promise<Map<string, StoredProblemSet>> {
  const wanted = [...new Set(versionIds)];
  if (!wanted.length) return new Map();
  const [versions, blocksOf, problems] = await Promise.all([
    db.problemSetVersion.findMany({ where: { id: { in: wanted } }, include: { problemSet: { include: { course: { select: { key: true } } } } } }),
    blockIndex(db, wanted),
    db.publishedProblem.findMany({ where: { ownerKind: 'problem_set', ownerVersionId: { in: wanted } }, orderBy: { order: 'asc' } }),
  ]);
  return new Map(versions.map(version => [version.id, {
    problemSetId: version.problemSetId, courseKey: version.problemSet.course.key, name: version.problemSet.name, versionId: version.id,
    problems: problems.filter(problem => problem.ownerVersionId === version.id).map(problem =>
      problemOf(problem, slot => blocksOf(version.id, 'problem', problem.problemVersionId, slot))),
  }]));
}
/**
 * A published lesson, put back together out of the rows that are now all there is of it, with the
 * questions its references resolve to — in the order the lesson names them, each once.
 */
export async function lessonRecords(db: Db, versionIds: string[]): Promise<Map<string, LessonRecord>> {
  const wanted = [...new Set(versionIds)];
  if (!wanted.length) return new Map();
  const [versions, sections, blocksOf] = await Promise.all([
    db.lessonVersion.findMany({ where: { id: { in: wanted } }, select: { id: true, metadata: true } }),
    db.lessonSection.findMany({ where: { lessonVersionId: { in: wanted } }, orderBy: { order: 'asc' } }),
    blockIndex(db, wanted),
  ]);
  const stored = versions.map(version => {
    const metadata = version.metadata as { public: StoredLesson['public']; review: StoredLesson['review'] };
    return { id: version.id, record: {
      public: metadata.public,
      sections: sections.filter(section => section.lessonVersionId === version.id).map(section => ({
        sectionId: section.sectionId, role: section.role as StoredLesson['sections'][number]['role'],
        title: section.title, contentBlocks: blocksOf(version.id, 'section', section.sectionId, 'body'),
      })),
      review: metadata.review ?? null,
    } satisfies StoredLesson };
  });
  const sets = await problemSetRecords(db, stored.flatMap(({ record }) => problemSetRefs(record).map(ref => ref.problemSetVersionId)));
  return new Map(stored.map(({ id, record }) => {
    const problems = new Map<string, StoredProblem>();
    for (const ref of problemSetRefs(record)) {
      const set = sets.get(ref.problemSetVersionId);
      for (const problemId of ref.problemVersionIds) {
        const problem = set?.problems.find(item => item.problemVersionId === problemId);
        if (problem && !problems.has(problemId)) problems.set(problemId, problem);
      }
    }
    return [id, { ...record, problems: [...problems.values()] }];
  }));
}
export async function lessonRecord(db: Db, versionId: string): Promise<LessonRecord | null> {
  return (await lessonRecords(db, [versionId])).get(versionId) ?? null;
}

/** A diagnostic is its own columns and the questions the rows hold for it, in their order. */
/** Diagnostics as a bundle carries them: the row, with the reference to the set version its questions come from. */
export function diagnosticDefinitions(rows: DiagnosticVersion[]): DiagnosticDefinition[] {
  return rows.map(row => diagnosticDefinitionSchema.parse({ versionId: row.id, diagnosticKey: row.diagnosticKey,
    title: row.title, description: row.description, estimatedMinutes: row.estimatedMinutes,
    problemSet: { problemSetId: row.problemSetId, problemSetVersionId: row.problemSetVersionId, problemVersionIds: row.problemVersionIds } }));
}
/** Diagnostics with the questions their references resolve to, in the order the diagnostic asks them. */
export async function diagnosticRecords(db: Db, rows: DiagnosticVersion[]): Promise<DiagnosticRecord[]> {
  const definitions = diagnosticDefinitions(rows);
  const sets = await problemSetRecords(db, definitions.map(d => d.problemSet.problemSetVersionId));
  return definitions.map(d => {
    const set = sets.get(d.problemSet.problemSetVersionId);
    if (!set) throw new ContentError(`Missing problem set version: ${d.problemSet.problemSetVersionId} (${d.versionId})`);
    const problems = d.problemSet.problemVersionIds.map(id => {
      const problem = set.problems.find(p => p.problemVersionId === id);
      if (!problem) throw new ContentError(`Problem is not in the problem set version: ${id} (${d.versionId})`);
      return problem;
    });
    return { ...d, problems };
  });
}
type DefinitionRow = { id: string; conceptKey: string; scopeKind: string; scopeKey: string; label: string | null; summary: string | null; usageNote: string | null };
const definitionWhere = (ref: DefinitionRef) => ({ conceptKey: ref.conceptKey, scopeKind: ref.scopeKind ?? 'global', scopeKey: ref.scopeKey ?? '' });
/** Definitions as a bundle carries them: what the row says, and the blocks the row owns. */
export async function definitionRecords(db: Db, rows: DefinitionRow[]): Promise<DefinitionRecord[]> {
  if (!rows.length) return [];
  const blocksOf = await blockIndex(db, rows.map(row => row.id));
  return rows.map(row => definitionSchema.parse({ conceptKey: row.conceptKey, scopeKind: row.scopeKind, scopeKey: row.scopeKey,
    ...(row.label === null ? {} : { label: row.label }), ...(row.summary === null ? {} : { summary: row.summary }),
    ...(row.usageNote ? { usageNote: row.usageNote } : {}),
    blocks: blocksOf(row.id, 'definition', row.id, 'body') }));
}
/**
 * The definitions a document linked, as a learner may open them. A reference names its scope, so a
 * lesson's own definition and the dictionary's may explain the same concept without either answering
 * for the other. A row that only renames the concept has nothing to open and is left out.
 */
export async function currentDefinitions(db: Db, refs: DefinitionRef[]): Promise<PublishedDefinition[]> {
  if (!refs.length) return [];
  const rows = await db.conceptDefinition.findMany({ where: { OR: refs.map(definitionWhere) }, include: { concept: { select: { label: true } } } });
  const blocksOf = await blockIndex(db, rows.map(row => row.id));
  return rows.map(row => ({ conceptKey: row.conceptKey, scopeKind: row.scopeKind as ConceptScope, scopeKey: row.scopeKey,
    label: row.label ?? row.concept.label, summary: row.summary ?? '', usageNote: row.usageNote ?? '', revision: row.updatedAt.toISOString(), blocks: blocksOf(row.id, 'definition', row.id, 'body') }))
    .filter(definition => definition.blocks.length);
}
/**
 * The placement a learner starting today would take: the most recently published one, whatever key
 * it was published under. It used to name `starting-point`, which was the fractions course's own
 * placement; the bank that replaced it spans the catalogue and belongs to no course, so it is
 * published under its own. A service with one placement has nothing to choose between, and the newer
 * definition is the one that replaces the older — which is what the key-scoped lookup already meant.
 */
export async function currentDiagnostic(db: Db): Promise<DiagnosticRecord | null> {
  const row = await db.diagnosticVersion.findFirst({ orderBy: [{ publishedAt: 'desc' }, { id: 'desc' }] });
  return row ? (await diagnosticRecords(db, [row]))[0] : null;
}
/** Courses with the identities they keep, in the order the course gives them. */
async function courseDefinitions(db: Db): Promise<CourseDefinition[]> {
  const courses = await db.course.findMany({ orderBy: [{ order: 'asc' }, { createdAt: 'asc' }, { key: 'asc' }], include: {
    lessons: { orderBy: [{ order: 'asc' }, { key: 'asc' }], select: { key: true, order: true } },
    diagnostics: { orderBy: { key: 'asc' }, select: { key: true } },
  } });
  return courses.map(course => ({ key: course.key, title: course.title, summary: course.summary, order: course.order,
    track: course.track as CourseTrack, ...(course.stage ? { stage: course.stage as CourseStage } : {}),
    lessons: course.lessons, diagnostics: course.diagnostics.map(row => row.key) }));
}
export async function exportContent(db: Db): Promise<ContentBundle> {
  const [courses, concepts, lessons, sets, diagnostics, definitionRows] = await Promise.all([
    courseDefinitions(db),
    db.concept.findMany({ orderBy: { key: 'asc' }, select: { key: true, label: true, assessable: true } }),
    db.lessonVersion.findMany({ orderBy: [{ publishedAt: 'asc' }, { id: 'asc' }],
      select: { id: true, lessonKey: true, title: true } }),
    db.problemSetVersion.findMany({ orderBy: [{ publishedAt: 'asc' }, { id: 'asc' }], select: { id: true } }),
    db.diagnosticVersion.findMany({ orderBy: [{ publishedAt: 'asc' }, { id: 'asc' }] }),
    db.conceptDefinition.findMany({ orderBy: [{ scopeKind: 'asc' }, { scopeKey: 'asc' }, { conceptKey: 'asc' }] }),
  ]);
  const records = await lessonRecords(db, lessons.map(row => row.id));
  for (const row of lessons) {
    const record = records.get(row.id);
    if (!record) throw new ContentError(`Published lesson has no rows to read it from: ${row.id}`);
    if (row.id !== record.public?.versionId || row.lessonKey !== record.public?.lessonKey || row.title !== record.public?.title) throw new ContentError(`Lesson metadata mismatch: ${row.id}`);
  }
  const setRecords = await problemSetRecords(db, sets.map(row => row.id));
  for (const row of sets) if (!setRecords.has(row.id)) throw new ContentError(`Published problem set has no rows to read it from: ${row.id}`);
  return parseContentBundle({ schemaVersion: 1, courses, concepts, lessons: lessons.map(row => storedLessonOf(records.get(row.id)!)),
    problemSets: sets.map(row => setRecords.get(row.id)),
    diagnostics: diagnosticDefinitions(diagnostics), definitions: await definitionRecords(db, definitionRows) });
}

/**
 * A course named again is the same course: what the bundle says replaces the title and summary, and
 * the lessons and diagnostics it names join the ones already there. A lesson never moves between
 * courses, so naming it under another one is refused rather than obeyed.
 */
function mergeCourses(existing: CourseDefinition[], incoming: CourseDefinition[]): CourseDefinition[] {
  const merged = new Map(existing.map(course => [course.key, structuredClone(course)]));
  const homes = new Map(existing.flatMap(course => course.lessons.map(lesson => [lesson.key, course.key] as const)));
  for (const course of incoming) {
    for (const lesson of course.lessons) {
      const home = homes.get(lesson.key);
      if (home && home !== course.key) throw new ContentError(`Lesson already belongs to another course: ${lesson.key} (${home})`);
    }
    const old = merged.get(course.key);
    if (!old) { merged.set(course.key, { ...structuredClone(course), summary: course.summary ?? '' }); continue; }
    const lessons = new Map(old.lessons.map(lesson => [lesson.key, lesson]));
    for (const lesson of course.lessons) lessons.set(lesson.key, lesson);
    merged.set(course.key, { key: course.key, title: course.title, summary: course.summary ?? old.summary,
      order: course.order ?? old.order, track: course.track ?? old.track, stage: course.stage ?? old.stage,
      lessons: [...lessons.values()].sort((a, b) => a.order - b.order || a.key.localeCompare(b.key)),
      diagnostics: [...new Set([...old.diagnostics, ...course.diagnostics])] });
  }
  return [...merged.values()];
}
/** Writes what a bundle says about a course: the course itself, then the identities it keeps. */
async function writeCourse(db: Db, course: CourseDefinition) {
  const row = await db.course.upsert({ where: { key: course.key },
    create: { key: course.key, title: course.title, summary: course.summary ?? '', order: course.order ?? 0,
      track: course.track ?? defaultCourseTrack, stage: course.stage ?? null },
    update: { title: course.title, ...(course.summary === undefined ? {} : { summary: course.summary }),
      ...(course.order === undefined ? {} : { order: course.order }),
      ...(course.track === undefined ? {} : { track: course.track }),
      ...(course.stage === undefined ? {} : { stage: course.stage }) } });
  for (const lesson of course.lessons) {
    await db.lesson.upsert({ where: { key: lesson.key }, create: { key: lesson.key, courseId: row.id, order: lesson.order },
      update: { order: lesson.order } });
  }
  for (const key of course.diagnostics) {
    await db.diagnostic.upsert({ where: { key }, create: { key, courseId: row.id }, update: {} });
  }
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
    return { sections: totals.sections + rows.sections.length, blocks: totals.blocks + rows.blocks.length, problems: totals.problems };
  }, { sections: 0, blocks: 0, problems: 0 });
  expected.blocks += bundle.problemSets.reduce((n, s) => n + problemSetRows(s).length, 0);
  expected.problems += bundle.problemSets.reduce((n, s) => n + s.problems.length, 0);
  expected.blocks += bundle.definitions.reduce((n, t) => n + t.blocks.length, 0);
  const [sections, blocks, problems] = await Promise.all([db.lessonSection.count(), db.contentBlock.count(), db.publishedProblem.count()]);
  if (sections !== expected.sections) throw new ContentError(`Section rows belong to no published lesson: ${sections - expected.sections} extra.`);
  if (blocks !== expected.blocks) throw new ContentError(`Block rows belong to no published version: ${blocks - expected.blocks} extra.`);
  if (problems !== expected.problems) throw new ContentError(`Question rows belong to no published version: ${problems - expected.problems} extra.`);
  return { blocks, problems };
}

export async function verifyContent(db: Db) {
  const bundle = await exportContent(db);
  validateReferences(bundle);
  if (!bundle.lessons.length || !bundle.concepts.length || !bundle.diagnostics.some(d => d.diagnosticKey === 'starting-point')) throw new ContentError('Database content is incomplete. Apply database migrations or import a reviewed bundle.');
  const { blocks: indexedBlocks, problems: indexedProblems } = await verifyRowsBelongToVersions(db, bundle);
  return { lessons: bundle.lessons.length, problemSets: bundle.problemSets.length,
    problems: bundle.problemSets.reduce((n, s) => n + s.problems.length, 0), indexedProblems, indexedBlocks,
    concepts: bundle.concepts.length, diagnosticVersions: bundle.diagnostics.length, diagnosticProblems: bundle.diagnostics.reduce((n, d) => n + d.problemSet.problemVersionIds.length, 0),
    definitions: bundle.definitions.length };
}

type Ledger = { name: string; checksum: string };
async function importInTransaction(db: Db, incoming: ContentBundle, dryRun: boolean, ledger?: Ledger) {
  const existing = await exportContent(db);
  const newLessons: StoredLesson[] = [], newSets: StoredProblemSet[] = [], newDiagnostics: DiagnosticDefinition[] = [];
  for (const c of incoming.lessons) {
    const old = await lessonRecord(db, c.public.versionId);
    if (old && canonicalJson(storedLessonOf(old)) !== canonicalJson(c)) throw new ContentError(`Published lesson is immutable: ${c.public.versionId}. Use a new version ID.`);
    if (!old) newLessons.push(c);
  }
  // A set's questions are frozen with the version; its name and the course that keeps it are not.
  const oldSets = await problemSetRecords(db, incoming.problemSets.map(s => s.versionId));
  for (const s of incoming.problemSets) {
    const old = oldSets.get(s.versionId);
    if (old && canonicalJson(frozenProblemSet(old)) !== canonicalJson(frozenProblemSet(s))) throw new ContentError(`Published problem set is immutable: ${s.versionId}. Use a new version ID.`);
    if (old && old.courseKey !== s.courseKey) throw new ContentError(`Problem set cannot move between courses: ${s.problemSetId}`);
    if (!old) newSets.push(s);
  }
  for (const d of incoming.diagnostics) {
    const old = await db.diagnosticVersion.findUnique({ where: { id: d.versionId } });
    const published = old ? diagnosticDefinitions([old])[0] : null;
    if (published && canonicalJson(published) !== canonicalJson(d)) throw new ContentError(`Published diagnostic is immutable: ${d.versionId}. Use a new version ID.`);
    if (!old) newDiagnostics.push(d);
  }
  // A concept named again is the same concept restated; a definition named again is rewritten in place.
  const concepts = new Map(existing.concepts.map(s => [s.key, s]));
  for (const s of incoming.concepts) {
    const old = await db.concept.findUnique({ where: { key: s.key } });
    if (old && old.key !== s.key) throw new ContentError('Concept keys cannot differ only by letter case.');
    concepts.set(s.key, s);
  }
  const definitions = new Map(existing.definitions.map(t => [definitionRefId(t), t]));
  for (const t of incoming.definitions) definitions.set(definitionRefId(t), t);
  const courses = mergeCourses(existing.courses, incoming.courses);
  const problemSets = new Map(existing.problemSets.map(s => [s.versionId, s]));
  for (const s of incoming.problemSets) problemSets.set(s.versionId, s);
  validateReferences({ schemaVersion: 1, courses, concepts: [...concepts.values()], lessons: [...existing.lessons, ...newLessons],
    problemSets: [...problemSets.values()], diagnostics: [...existing.diagnostics, ...newDiagnostics], definitions: [...definitions.values()] });
  if (!dryRun) {
    // A version hangs off the identity that keeps it, so the course and its lessons come first.
    for (const course of incoming.courses) await writeCourse(db, course);
    // Bundle order is publication order. Millisecond ties must not select an arbitrary version.
    const [lastLesson, lastSet, lastDiagnostic] = await Promise.all([
      db.lessonVersion.findFirst({ orderBy: { publishedAt: 'desc' }, select: { publishedAt: true } }),
      db.problemSetVersion.findFirst({ orderBy: { publishedAt: 'desc' }, select: { publishedAt: true } }),
      db.diagnosticVersion.findFirst({ orderBy: { publishedAt: 'desc' }, select: { publishedAt: true } }),
    ]);
    let publishedTime = Math.max(Date.now(), (lastLesson?.publishedAt.getTime() ?? 0) + 1, (lastSet?.publishedAt.getTime() ?? 0) + 1, (lastDiagnostic?.publishedAt.getTime() ?? 0) + 1);
    const publishedAt = () => new Date(publishedTime++);
    for (const s of incoming.concepts) await db.concept.upsert({ where: { key: s.key }, create: s, update: { label: s.label, assessable: s.assessable } });
    // The identity of a set is written whenever the set is named; a version only when it is new. A
    // lesson references set versions, so the sets go first.
    const courseIds = new Map((await db.course.findMany({ select: { id: true, key: true } })).map(course => [course.key, course.id]));
    for (const s of incoming.problemSets) {
      await db.problemSet.upsert({ where: { id: s.problemSetId }, create: { id: s.problemSetId, courseId: courseIds.get(s.courseKey)!, name: s.name },
        update: { name: s.name } });
    }
    for (const s of newSets) await db.problemSetVersion.create({ data: { id: s.versionId, problemSetId: s.problemSetId,
      contentHash: hash(frozenProblemSet(s)), publishedAt: publishedAt() } });
    for (const s of newSets) await indexProblemSetDocument(db, s);
    for (const c of newLessons) await db.lessonVersion.create({ data: { id: c.public.versionId, lessonKey: c.public.lessonKey,
      title: c.public.title, metadata: json(lessonMetadata(c)),
      contentHash: hash(c), publishedAt: publishedAt() } });
    // A diagnostic, like a lesson, only references the set version that holds its questions.
    for (const d of newDiagnostics) await db.diagnosticVersion.create({ data: { id: d.versionId, diagnosticKey: d.diagnosticKey,
      title: d.title, description: d.description, estimatedMinutes: d.estimatedMinutes,
      problemSetId: d.problemSet.problemSetId, problemSetVersionId: d.problemSet.problemSetVersionId, problemVersionIds: d.problemSet.problemVersionIds,
      contentHash: hash(d), publishedAt: publishedAt() } });
    // The index shares the transaction that publishes the version, so a question is never findable
    // by name before the document that holds it exists.
    for (const c of newLessons) await indexLessonDocument(db, c);
    // A definition is written where it is: the row by its concept and scope, then its blocks anew.
    for (const t of incoming.definitions) {
      const row = await db.conceptDefinition.upsert({
        where: { conceptKey_scopeKind_scopeKey: { conceptKey: t.conceptKey, scopeKind: t.scopeKind, scopeKey: t.scopeKey } },
        create: { conceptKey: t.conceptKey, scopeKind: t.scopeKind, scopeKey: t.scopeKey, label: t.label ?? null, summary: t.summary ?? null, usageNote: t.usageNote ?? null },
        update: { label: t.label ?? null, summary: t.summary ?? null, usageNote: t.usageNote ?? null } });
      await indexDefinitionBlocks(db, row.id, t.blocks as ContentBlock[]);
    }
    // The ledger entry shares this transaction: a file counts as applied only if its content landed.
    if (ledger) await db.appliedContentBundle.upsert({ where: { name: ledger.name }, create: { ...ledger },
      update: { checksum: ledger.checksum, appliedAt: new Date() } });
  }
  return { dryRun, newLessons: newLessons.length, newProblemSets: newSets.length, newDiagnostics: newDiagnostics.length,
    concepts: incoming.concepts.length, definitions: incoming.definitions.length,
    unchangedVersions: incoming.lessons.length + incoming.problemSets.length + incoming.diagnostics.length - newLessons.length - newSets.length - newDiagnostics.length };
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
