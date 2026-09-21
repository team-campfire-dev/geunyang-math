import 'server-only';
import { z } from 'zod';
import { courseStages, courseTracks, type CourseStage, type CourseTrack } from '@/shared/api';
import { blockDefinitionRefs, definitionBlockSchema, definitionReferences, diagnosticPoolRefSchema, problemSetRefs, validateLesson, validateProblemSet, type LessonRecord, type StoredLesson, type StoredProblem, type StoredProblemSet } from './content';
import { definitionRefId, mayReferenceDefinition } from '@/shared/rich-text';

const id = z.string().min(1).max(191).regex(/^[a-zA-Z0-9:._-]+$/);
/** A concept is global: its key never moves, and whether a question may assess it is its own. */
export const conceptSchema = z.object({ key: id.max(100), label: z.string().trim().min(1).max(191), assessable: z.boolean() }).strict();
export type ConceptRecord = z.infer<typeof conceptSchema>;
/** A diagnostic names its questions the way a lesson step does: a frozen problem set version and the ones it picked, in order. */
export const diagnosticDefinitionSchema = z.object({
  versionId: id, diagnosticKey: id.max(100), title: z.string().trim().min(1).max(191),
  description: z.string().trim().min(1).max(2000), estimatedMinutes: z.number().int().min(1).max(120),
  problemSet: diagnosticPoolRefSchema,
}).strict();
export type DiagnosticDefinition = z.infer<typeof diagnosticDefinitionSchema>;
/** A diagnostic with the questions its reference resolves to, the way the application reads one. */
export type DiagnosticRecord = DiagnosticDefinition & { problems: StoredProblem[] };
/**
 * How one scope calls and explains a concept. Not a version: a definition is written in place, since
 * it decides nothing and has no past to recover. A row with no blocks only renames the concept in
 * that scope; a paragraph may link only a definition that has something to show.
 */
export const definitionSchema = z.object({
  conceptKey: id.max(100),
  // Absent means the operator's shared dictionary.
  scopeKind: z.enum(['global', 'organization', 'course', 'lesson']).optional().default('global'),
  scopeKey: id.max(100).or(z.literal('')).optional().default(''),
  label: z.string().trim().min(1).max(191).optional(), summary: z.string().trim().min(1).max(500).optional(),
  usageNote: z.string().trim().min(1).max(500).optional(),
  blocks: z.array(definitionBlockSchema).max(20),
}).strict().refine((definition) => (definition.scopeKind === 'global' ? definition.scopeKey === '' : definition.scopeKey !== ''),
  { message: 'A scoped definition must name the scope it belongs to, and a global one must not' });
export type DefinitionRecord = z.infer<typeof definitionSchema>;
/**
 * A course and the identities it keeps. Nothing here is a version: a course changes in place, and a
 * lesson's place in it is the course's to move. A bundle that names a course merges into the one
 * already published — title and summary replace, lessons and diagnostics are added — so a partial
 * bundle can add one lesson to a course without restating the rest.
 */
export const courseSchema = z.object({
  key: id.max(100), title: z.string().trim().min(1).max(191), summary: z.string().trim().max(500).optional(),
  // Where the course sits in the catalogue, the way `order` places a lesson inside one. A bundle
  // written before courses were ordered names none and keeps the place it already has.
  order: z.number().int().min(0).max(1_000_000).optional(),
  // Which line of study it is on. A bundle written before there was a second line names none and
  // is on the first, which is what every course installed until now is.
  track: z.enum(courseTracks as [CourseTrack, ...CourseTrack[]]).optional(),
  // Which school year inside that line. 기초 과정 and NCS have none, so it stays optional.
  stage: z.enum(courseStages as [CourseStage, ...CourseStage[]]).optional(),
  lessons: z.array(z.object({ key: id.max(100), order: z.number().int().min(0).max(1_000_000) }).strict()).max(500),
  diagnostics: z.array(id.max(100)).max(50),
}).strict();
export type CourseDefinition = z.infer<typeof courseSchema>;
export type ContentBundle = { schemaVersion: 1; courses: CourseDefinition[]; concepts: ConceptRecord[]; lessons: StoredLesson[]; problemSets: StoredProblemSet[]; diagnostics: DiagnosticDefinition[]; definitions: DefinitionRecord[] };
export class ContentError extends Error {}
function unique(values: string[], label: string) {
  if (new Set(values).size !== values.length) throw new ContentError(`Duplicate ${label}.`);
}
export function parseContentBundle(input: unknown): ContentBundle {
  // Definitions are additive: a bundle exported before glossary support still imports unchanged.
  // Courses too: a bundle written before courses existed names none, and may still add definitions.
  const parsed = z.object({ schemaVersion: z.literal(1), courses: z.array(courseSchema).max(200).optional().default([]),
    concepts: z.array(conceptSchema).max(1000),
    lessons: z.array(z.unknown()).max(1000), problemSets: z.array(z.unknown()).max(2000).optional().default([]),
    diagnostics: z.array(diagnosticDefinitionSchema).max(100),
    definitions: z.array(definitionSchema).max(2000).optional().default([]),
  }).strict().parse(input);
  unique(parsed.courses.map(c => c.key), 'course keys');
  // A lesson or a diagnostic belongs to exactly one course, so one bundle may not place it in two.
  unique(parsed.courses.flatMap(c => c.lessons.map(l => l.key)), 'lesson keys across courses');
  unique(parsed.courses.flatMap(c => c.diagnostics), 'diagnostic keys across courses');
  unique(parsed.concepts.map(s => s.key), 'concept keys');
  unique(parsed.diagnostics.map(d => d.versionId), 'diagnostic version IDs');
  // One definition per concept in each scope.
  unique(parsed.definitions.map(definitionRefId), 'definitions per concept and scope');
  unique(parsed.definitions.flatMap(t => t.blocks.map(b => b.blockId)), 'definition block IDs');
  for (const record of parsed.lessons) {
    validateLesson(record);
    if (record.public.lessonKey.length > 100 || record.public.title.length > 191) throw new ContentError('Lesson metadata exceeds database limits.');
  }
  const lessons = parsed.lessons as StoredLesson[];
  unique(lessons.map(c => c.public.versionId), 'lesson version IDs');
  for (const record of parsed.problemSets) validateProblemSet(record);
  const problemSets = parsed.problemSets as StoredProblemSet[];
  unique(problemSets.map(s => s.versionId), 'problem set version IDs');
  for (const d of parsed.diagnostics) unique(d.problemSet.problemVersionIds, 'diagnostic problem IDs');
  return { schemaVersion: 1, courses: parsed.courses, concepts: parsed.concepts, lessons, problemSets, diagnostics: parsed.diagnostics, definitions: parsed.definitions };
}

// Object order in MySQL JSON differs from source files. Compare semantic content, not serialization order.
export function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (value && typeof value === 'object') return `{${Object.entries(value).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0).map(([k, v]) => `${JSON.stringify(k)}:${canonicalJson(v)}`).join(',')}}`;
  return JSON.stringify(value);
}

export function validateReferences(bundle: ContentBundle) {
  // MySQL identity comparisons are case-insensitive; application references must stay unambiguous.
  function consistentCase(values: string[]) {
    const exact = new Map<string, string>();
    for (const value of values) {
      const key = value.toLowerCase();
      if (exact.has(key) && exact.get(key) !== value) throw new ContentError('Content identities cannot differ only by letter case.');
      exact.set(key, value);
    }
  }
  consistentCase(bundle.courses.map(c => c.key));
  consistentCase(bundle.courses.flatMap(c => c.lessons.map(l => l.key)));
  consistentCase(bundle.concepts.map(s => s.key));
  consistentCase(bundle.lessons.map(c => c.public.versionId));
  consistentCase(bundle.lessons.map(c => c.public.lessonKey));
  consistentCase(bundle.problemSets.map(s => s.versionId));
  consistentCase(bundle.problemSets.map(s => s.problemSetId));
  consistentCase(bundle.diagnostics.map(d => d.versionId));
  consistentCase(bundle.diagnostics.map(d => d.diagnosticKey));
  // Blocks hang off the version that holds them, named by that version's ID alone. Definitions hang
  // theirs off a generated row id, so they cannot collide with a name an author chose.
  unique([...bundle.lessons.map(c => c.public.versionId), ...bundle.problemSets.map(s => s.versionId), ...bundle.diagnostics.map(d => d.versionId)],
    'version IDs across lessons, problem sets and diagnostics');
  // Keys only have to stay unambiguous inside their own scope; a lesson may reuse a dictionary word.
  for (const scope of new Set(bundle.definitions.map(t => `${t.scopeKind}:${t.scopeKey}`))) {
    consistentCase(bundle.definitions.filter(t => `${t.scopeKind}:${t.scopeKey}` === scope).map(t => t.conceptKey));
  }
  consistentCase(bundle.problemSets.flatMap(s => s.problems).map(p => p.problemVersionId));
  // Nothing floats outside a course: every published lesson, problem set and diagnostic is kept by one.
  const courseOf = new Map(bundle.courses.flatMap(c => c.lessons.map(l => [l.key, c.key] as const)));
  const courseKeys = new Set(bundle.courses.map(c => c.key));
  const diagnosticCourseOf = new Map(bundle.courses.flatMap(c => c.diagnostics.map(key => [key, c.key] as const)));
  for (const c of bundle.lessons) {
    if (!courseOf.has(c.public.lessonKey)) throw new ContentError(`Lesson belongs to no course: ${c.public.lessonKey}`);
  }
  for (const d of bundle.diagnostics) {
    if (!diagnosticCourseOf.has(d.diagnosticKey)) throw new ContentError(`Diagnostic belongs to no course: ${d.diagnosticKey}`);
  }
  // A problem set has one course and one name across its versions, and a question has one set.
  const setCourse = new Map<string, string>();
  const setOfProblem = new Map<string, string>();
  const setVersions = new Map(bundle.problemSets.map(s => [s.versionId, s]));
  for (const s of bundle.problemSets) {
    if (!courseKeys.has(s.courseKey)) throw new ContentError(`Problem set belongs to no course: ${s.problemSetId} (${s.courseKey})`);
    const course = setCourse.get(s.problemSetId);
    if (course && course !== s.courseKey) throw new ContentError(`Problem set cannot move between courses: ${s.problemSetId}`);
    setCourse.set(s.problemSetId, s.courseKey);
    for (const p of s.problems) {
      const owner = setOfProblem.get(p.problemVersionId);
      if (owner && owner !== s.problemSetId) throw new ContentError(`Problem belongs to another problem set: ${p.problemVersionId} (${owner})`);
      setOfProblem.set(p.problemVersionId, s.problemSetId);
    }
  }
  // A lesson's questions are the ones its references resolve to; every reference must resolve.
  const lessonProblems = new Map<string, LessonRecord>();
  for (const c of bundle.lessons) {
    const problems = new Map<string, StoredProblemSet['problems'][number]>();
    for (const ref of problemSetRefs(c)) {
      // Which lesson version asked, as well as where in it: the same block id can be in several.
      const where = `${ref.blockId ?? 'review'} in ${c.public.versionId}`;
      const version = setVersions.get(ref.problemSetVersionId);
      if (!version) throw new ContentError(`Missing problem set version: ${ref.problemSetVersionId} (${where})`);
      if (version.problemSetId !== ref.problemSetId) throw new ContentError(`Problem set version belongs to another set: ${ref.problemSetVersionId} (${where})`);
      if (version.courseKey !== courseOf.get(c.public.lessonKey)) throw new ContentError(`Problem set belongs to another course: ${ref.problemSetId} (${where})`);
      for (const problemId of ref.problemVersionIds) {
        const problem = version.problems.find(p => p.problemVersionId === problemId);
        if (!problem) throw new ContentError(`Problem is not in the problem set version: ${problemId} (${where})`);
        problems.set(problemId, problem);
      }
    }
    lessonProblems.set(c.public.versionId, { ...c, problems: [...problems.values()] });
  }
  // A diagnostic's questions resolve the same way, from a set its own course keeps.
  for (const d of bundle.diagnostics) {
    const ref = d.problemSet;
    const version = setVersions.get(ref.problemSetVersionId);
    if (!version) throw new ContentError(`Missing problem set version: ${ref.problemSetVersionId} (${d.versionId})`);
    if (version.problemSetId !== ref.problemSetId) throw new ContentError(`Problem set version belongs to another set: ${ref.problemSetVersionId} (${d.versionId})`);
    if (version.courseKey !== diagnosticCourseOf.get(d.diagnosticKey)) throw new ContentError(`Problem set belongs to another course: ${ref.problemSetId} (${d.versionId})`);
    for (const problemId of ref.problemVersionIds) {
      if (!version.problems.some(p => p.problemVersionId === problemId)) throw new ContentError(`Problem is not in the problem set version: ${problemId} (${d.versionId})`);
    }
  }
  const concepts = new Map(bundle.concepts.map(s => [s.key, s]));
  const problems = new Map<string, string>();
  const assertConcept = (key: string) => { if (!concepts.has(key)) throw new ContentError(`Missing concept: ${key}`); };
  // Readiness travels on concepts a question can assess, so what a lesson teaches and presumes, and
  // what a question claims, must be assessable; a definition may explain any concept.
  const assertAssessable = (key: string) => {
    assertConcept(key);
    if (!concepts.get(key)!.assessable) throw new ContentError(`Concept is not assessable: ${key}`);
  };
  for (const c of bundle.lessons) {
    [...c.public.conceptKeys, ...c.public.prerequisiteConceptKeys].forEach(assertAssessable);
    // A lesson asks only about what it says it teaches.
    for (const p of lessonProblems.get(c.public.versionId)!.problems) for (const concept of p.conceptKeys) {
      if (!c.public.conceptKeys.includes(concept)) throw new ContentError(`Problem concept is absent from lesson concepts: ${concept} (${p.problemVersionId} in ${c.public.versionId})`);
    }
  }
  // Only a definition with something to show can be linked; a row that merely renames a concept cannot.
  const linkable = new Set<string>();
  for (const t of bundle.definitions) {
    assertConcept(t.conceptKey);
    if (t.blocks.length) linkable.add(definitionRefId(t));
  }
  // Cycles are valid references; verify each edge without recursively expanding the graph.
  for (const definition of bundle.definitions) for (const reference of blockDefinitionRefs(definition.blocks)) {
    if (!mayReferenceDefinition(definition, reference)) throw new ContentError(`A definition can only link its own scope or the dictionary: ${definitionRefId(reference)}`);
    if (!linkable.has(definitionRefId(reference))) throw new ContentError(`Missing definition: ${definitionRefId(reference)}`);
  }
  for (const c of lessonProblems.values()) for (const reference of definitionReferences(c)) {
    // A lesson-scoped definition belongs to the lesson that keeps it. Reaching into another lesson's
    // definitions would make one lesson's wording depend on a document its author cannot see.
    if (reference.scopeKind === 'lesson' && reference.scopeKey !== c.public.lessonKey) {
      throw new ContentError(`A lesson can only link its own definitions: ${definitionRefId(reference)} (${c.public.lessonKey})`);
    }
    if (!linkable.has(definitionRefId(reference))) throw new ContentError(`Missing definition: ${definitionRefId(reference)} (${c.public.lessonKey})`);
    // A definition of the very concept under assessment would answer the question.
    if (reference.problemConceptKeys?.includes(reference.conceptKey)) throw new ContentError(`A problem cannot explain the concept it assesses: ${reference.conceptKey} (${c.public.lessonKey})`);
  }
  for (const p of bundle.problemSets.flatMap(s => s.problems)) {
    p.conceptKeys.forEach(assertAssessable);
    const value = canonicalJson(p);
    if (problems.has(p.problemVersionId) && problems.get(p.problemVersionId) !== value) throw new ContentError(`Problem version is immutable: ${p.problemVersionId}`);
    problems.set(p.problemVersionId, value);
  }
}
