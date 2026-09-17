import 'server-only';

import { z } from 'zod';
import type { LessonDocument, LessonSection, ContentBlock, GlossaryEntry, ProblemSetRef, PublicLesson, PublicProblem } from '@/shared/api';
import { frameLimits, isSceneColor, itemIdPattern, pathPattern, sceneLimits, stripLimits } from '@/shared/scene';
import { locateTerms, definitionRefId, type DefinitionLink, type DefinitionRef } from '@/shared/rich-text';

/** Private content records stay on the server; only toPublicLesson crosses the API boundary. */
export type StoredProblem = PublicProblem & {
  gradingSpec: {
    kind: 'integer' | 'rational';
    numerator?: number;
    denominator?: number;
    value?: number;
    requiredForm?: 'reduced_fraction';
  };
  hints: ContentBlock[];
  solution: ContentBlock[];
};

/** What a lesson version says about itself. Which course keeps it, and where, is the identity's, not the version's. */
export type LessonMetadata = Omit<PublicLesson, 'courseKey'>;

export type { ProblemSetRef };

/**
 * A lesson version as it is frozen. Its steps reference problem sets; the questions themselves are
 * the sets'. `review` is the set its review assignments draw from, or null for a lesson that sets none.
 */
export type StoredLesson = {
  public: LessonMetadata;
  sections: LessonSection[];
  review: ProblemSetRef | null;
};
/** A lesson read back with the questions its references resolve to, which is what a reader needs. */
export type LessonRecord = StoredLesson & { problems: StoredProblem[] };

/**
 * A problem set version as it is frozen, with the identity that keeps it. A course owns the set;
 * its name — none for a set made in place while writing a lesson — is the identity's and may change.
 */
export type StoredProblemSet = {
  problemSetId: string;
  courseKey: string;
  name: string | null;
  versionId: string;
  problems: StoredProblem[];
};

const id = z.string().min(1).max(191).regex(/^[a-zA-Z0-9:._-]+$/);
const shortText = z.string().trim().min(1).max(500);
const integer = z.number().int().min(Number.MIN_SAFE_INTEGER).max(Number.MAX_SAFE_INTEGER);
const fractionStripShape = {
  parts: z.number().int().min(1).max(100),
  filled: z.number().int().min(0).max(100),
  label: z.string().max(200).optional(),
};
const fractionStrip = z.object(fractionStripShape).strict().refine((value) => value.filled <= value.parts, 'filled must not exceed parts');
/** Math markup renders visually; a screen reader needs a plain sentence instead. */
const carriesMath = (value?: string) => !!value && (value.includes('$') || value.includes('\\('));
const plainText = (max: number) => z.string().trim().min(1).max(max).refine((value) => !carriesMath(value), 'Accessible text must not contain math markup');

const sceneSize = z.number().min(sceneLimits.minSize).max(sceneLimits.maxSize);
const coordinate = z.number().min(-sceneLimits.maxSize).max(sceneLimits.maxSize * 2);
const span = z.number().min(0).max(sceneLimits.maxSize * 2);
const colour = z.string().refine(isSceneColor, 'Unknown colour name');
// Shared paint. Colours are palette names or plain hex, never a URL or a reference to anything.
const painted = {
  id: z.string().regex(itemIdPattern, 'A shape name may only contain letters, digits, - and _').optional(),
  // A shape a learner can pick up says its own name, since the drawing's alt describes the whole.
  label: plainText(80).optional(),
  draggable: z.boolean().optional(),
  fill: colour.optional(), stroke: colour.optional(),
  strokeWidth: z.number().min(sceneLimits.minStroke).max(sceneLimits.maxStroke).optional(),
  dash: z.boolean().optional(), opacity: z.number().min(0).max(1).optional(),
  rotate: z.number().min(-360).max(360).optional(),
};
const point = z.tuple([coordinate, coordinate]);
const sceneItem = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('rect'), x: coordinate, y: coordinate, width: span, height: span, radius: span.max(200).optional(), ...painted }).strict(),
  z.object({ kind: z.literal('ellipse'), cx: coordinate, cy: coordinate, rx: span, ry: span, ...painted }).strict(),
  z.object({ kind: z.literal('line'), x1: coordinate, y1: coordinate, x2: coordinate, y2: coordinate,
    arrow: z.enum(['none', 'end', 'both']).optional(), ...painted }).strict(),
  z.object({ kind: z.literal('polygon'), points: z.array(point).min(2).max(sceneLimits.maxPoints), closed: z.boolean().optional(), ...painted }).strict(),
  // Path data is commands and numbers only; the pattern is what keeps it from being anything else.
  z.object({ kind: z.literal('path'), d: z.string().trim().min(1).max(sceneLimits.maxPath).regex(pathPattern, 'Path data may only contain commands and numbers'), ...painted }).strict(),
  z.object({ kind: z.literal('strip'), x: coordinate, y: coordinate, width: span, height: span,
    parts: z.number().int().min(stripLimits.minParts).max(stripLimits.maxParts),
    filled: z.number().int().min(0).max(stripLimits.maxParts), ...painted }).strict()
    .refine((value) => value.filled <= value.parts, 'filled must not exceed parts'),
  z.object({ kind: z.literal('text'), x: coordinate, y: coordinate, text: z.string().trim().min(1).max(sceneLimits.maxText),
    size: z.number().min(sceneLimits.minFontSize).max(sceneLimits.maxFontSize).optional(),
    anchor: z.enum(['start', 'middle', 'end']).optional(), weight: z.enum(['regular', 'bold']).optional(), ...painted }).strict(),
]);

const sceneChange = z.object({
  id: z.string().regex(itemIdPattern),
  dx: coordinate.optional(), dy: coordinate.optional(),
  opacity: z.number().min(0).max(1).optional(), rotate: z.number().min(-360).max(360).optional(),
  fill: colour.optional(), hidden: z.boolean().optional(),
}).strict();
const sceneFrame = z.object({
  caption: z.string().max(200).optional(),
  changes: z.array(sceneChange).max(sceneLimits.maxItems),
}).strict();
const sceneZone = z.object({
  id: z.string().regex(itemIdPattern),
  x: coordinate, y: coordinate, width: span, height: span,
  label: plainText(80),
  accepts: z.array(z.string().regex(itemIdPattern)).max(sceneLimits.maxItems).optional(),
}).strict();
const sceneTask = z.object({
  prompt: z.string().trim().min(1).max(300),
  promptAlt: plainText(300).optional(),
  successText: plainText(300).optional(),
}).strict();

/** New block kinds register a versioned payload schema here and a renderer in the UI. */
const richText = z.string().min(1).max(20_000);
const definitionLink = z.object({
  conceptKey: id.max(100),
  // Absent means the operator's shared dictionary. Naming the scope here is what lets a definition
  // be resolved without knowing which lesson, course or organisation the reader is inside.
  scopeKind: z.enum(['global', 'organization', 'course', 'lesson']).optional(),
  scopeKey: id.max(100).optional(),
  surface: z.string().min(1).max(100),
  // Definitions repeat in a paragraph; the author picks which mention carries the definition.
  occurrence: z.number().int().min(1).max(100).optional(),
}).strict().refine((definition) => (definition.scopeKind ?? 'global') === 'global' ? !definition.scopeKey : !!definition.scopeKey,
  { message: 'A scoped definition must name the scope it belongs to, and a global one must not' });
const blockSchemas = {
  'core.rich_text@1': z.object({ text: richText }).strict(),
  'core.rich_text@3': z.object({ text: richText, definitions: z.array(definitionLink).max(20) }).strict()
    .superRefine((payload, ctx) => {
      for (const issue of locateTerms(payload.text, payload.definitions).issues) ctx.addIssue({ code: 'custom', message: issue });
    }),
  // A step references a problem set: which one, which frozen version, and which of its questions.
  'core.problem_set@2': z.object({ problemSetId: id, problemSetVersionId: id, problemVersionIds: z.array(id).min(1).max(50) }).strict(),
  // caption may carry math: the wrapping role="img" takes its accessible name from alt.
  'core.figure@1': z.object({
    alt: plainText(500),
    caption: z.string().max(500).optional(),
    primitive: z.object({ kind: z.literal('fraction_strip'), ...fractionStrip.shape }).strict()
      .refine((value) => value.filled <= value.parts, 'filled must not exceed parts'),
  }).strict(),
  // A standalone strip names itself from its label, so a math label needs a plain alternative.
  'math.fraction_strip@1': z.object({ ...fractionStripShape, labelAlt: plainText(200).optional() }).strict()
    .refine((value) => value.filled <= value.parts, 'filled must not exceed parts')
    .refine((value) => !carriesMath(value.label) || !!value.labelAlt, 'A label containing math requires labelAlt for the accessible name'),
  // A drawing given as data. Every value lands in an attribute of an element the renderer creates,
  // so an author — or later a generator — can describe any picture without describing any markup.
  'core.scene@1': z.object({
    alt: plainText(500),
    caption: z.string().max(500).optional(),
    width: sceneSize, height: sceneSize,
    items: z.array(sceneItem).max(sceneLimits.maxItems),
    // Frames move the shapes that are already there. A frame adds nothing and removes nothing, so a
    // drawing that is safe to show is safe to animate.
    frames: z.array(sceneFrame).min(frameLimits.minFrames).max(frameLimits.maxFrames).optional(),
    frameMs: z.number().int().min(frameLimits.minMs).max(frameLimits.maxMs).optional(),
    loop: z.boolean().optional(),
    autoplay: z.boolean().optional(),
    // Zones turn the same drawing into something to arrange by hand. Nothing here is reported, so
    // the block carries no answer: the task states openly what it is asking for.
    zones: z.array(sceneZone).max(sceneLimits.maxItems).optional(),
    task: sceneTask.optional(),
  }).strict().superRefine((payload, ctx) => {
    const named = new Set(payload.items.map((item) => item.id).filter(Boolean));
    for (const frame of payload.frames ?? []) {
      for (const change of frame.changes) {
        if (!named.has(change.id)) ctx.addIssue({ code: 'custom', message: `A frame changes a shape that is not in the drawing: ${change.id}` });
      }
    }
    if (payload.items.map((item) => item.id).filter(Boolean).length !== named.size) {
      ctx.addIssue({ code: 'custom', message: 'Two shapes share one name' });
    }
    const zones = payload.zones ?? [];
    // A drawing is either played or played with. Both at once would have the frames and the learner
    // moving the same shape, and no way to say which one is right.
    if (zones.length && payload.frames?.length) {
      ctx.addIssue({ code: 'custom', message: 'A drawing may move on its own or be arranged by hand, not both' });
    }
    if (zones.length && !payload.task) ctx.addIssue({ code: 'custom', message: 'A drawing with zones needs a task that says what to do' });
    if (payload.task && !zones.length) ctx.addIssue({ code: 'custom', message: 'A task needs at least one zone to put something in' });
    if (new Set(zones.map((zone) => zone.id)).size !== zones.length) ctx.addIssue({ code: 'custom', message: 'Two zones share one name' });
    const movable = new Set(payload.items.filter((item) => item.draggable).map((item) => item.id).filter(Boolean));
    for (const item of payload.items) {
      if (!item.draggable) continue;
      if (!item.id) ctx.addIssue({ code: 'custom', message: 'A shape the learner can move needs a name' });
      if (!item.label) ctx.addIssue({ code: 'custom', message: 'A shape the learner can move needs a spoken label' });
    }
    if (zones.length && !movable.size) ctx.addIssue({ code: 'custom', message: 'A drawing with zones needs a shape the learner can move' });
    for (const zone of zones) {
      for (const accepted of zone.accepts ?? []) {
        if (!movable.has(accepted)) ctx.addIssue({ code: 'custom', message: `A zone accepts a shape that cannot be moved: ${accepted}` });
      }
    }
    if (!zones.length && payload.items.some((item) => item.draggable)) {
      ctx.addIssue({ code: 'custom', message: 'A movable shape needs somewhere to be put' });
    }
    if (carriesMath(payload.task?.prompt) && !payload.task?.promptAlt) {
      ctx.addIssue({ code: 'custom', message: 'A task prompt containing math requires promptAlt for the accessible name' });
    }
  }),
} satisfies Record<string, z.ZodType>;


export const supportedBlockTypes = Object.keys(blockSchemas).map((key) => {
  const [kind, version] = key.split('@');
  return { kind, typeVersion: Number(version) };
});

const blockSchema = z.object({
  blockId: id,
  kind: z.string().regex(/^[a-z][a-z0-9_]*\.[a-z][a-z0-9_]*$/),
  typeVersion: z.number().int().min(1),
  required: z.boolean(),
  payload: z.record(z.string(), z.unknown()),
  fallback: z.string().trim().min(1).max(2_000).optional(),
}).strict().superRefine((block, ctx) => {
  const key = `${block.kind}@${block.typeVersion}`;
  const schema = blockSchemas[key as keyof typeof blockSchemas];
  if (!schema) {
    if (block.required || !block.fallback) {
      ctx.addIssue({ code: 'custom', message: `Unsupported block ${key}; optional blocks need a text fallback` });
    }
    return;
  }
  const parsed = schema.safeParse(block.payload);
  // Each refusal is raised on its own, at the field it is about. Reported as one issue carrying the
  // whole error, the path stopped at `payload` and the message was a JSON dump of the rest — which
  // told a reader neither which field was wrong nor, in a word, what was wrong with it.
  if (!parsed.success) {
    for (const issue of parsed.error.issues) {
      ctx.addIssue({ code: 'custom', path: ['payload', ...(issue.path as (string | number)[])],
        message: `Invalid payload for ${key}: ${issue.message}` });
    }
  }
});

/** A drawing the learner arranges reports nothing, so it stays out of anything that is assessed:
 *  beside an answer box it would read as the answer itself. */
const arrangeable = (block: { kind: string; payload: Record<string, unknown> }) =>
  block.kind === 'core.scene' && Array.isArray(block.payload.zones) && block.payload.zones.length > 0;

// Definitions are leaves: no problem groups, and no links nesting a definition inside a definition.
// A definition is read while a problem waits, so it explains rather than asks for an interaction.
export const definitionBlockSchema = blockSchema.refine(
  (block) => block.kind !== 'core.problem_set' && !(block.kind === 'core.rich_text' && block.typeVersion === 3) && !arrangeable(block),
  { message: 'Definitions cannot embed problems, further definition links, or a drawing to arrange' },
);

const responseSchema = z.object({
  kind: z.enum(['integer', 'rational']),
  requiredForm: z.literal('reduced_fraction').optional(),
}).strict();

// Problem groups belong to lesson sections. A problem cannot embed another problem group,
// including an optional future version, in its prompt, hint, or solution.
const problemContentBlockSchema = blockSchema.refine((block) => block.kind !== 'core.problem_set', {
  message: 'core.problem_set is not allowed inside a problem',
}).refine((block) => !arrangeable(block), {
  message: 'A drawing to arrange is not allowed inside a problem',
});

const problemShape = {
  problemVersionId: id,
  conceptKeys: z.array(id).min(1).max(50),
  promptContent: z.array(problemContentBlockSchema).min(1).max(100, 'At most 100 blocks per content array'),
  responseSpec: responseSchema,
  hintAvailable: z.boolean(),
  gradingSpec: z.discriminatedUnion('kind', [
    z.object({ kind: z.literal('integer'), value: integer }).strict(),
    z.object({ kind: z.literal('rational'), numerator: integer, denominator: integer.refine((value) => value > 0), requiredForm: z.literal('reduced_fraction').optional() }).strict(),
  ]),
  hints: z.array(problemContentBlockSchema).max(100, 'At most 100 blocks per content array'),
  // A question may have no solution: a placement question is one, and whether a solution is shown is
  // the policy of whatever issues the question, not a kind of question.
  solution: z.array(problemContentBlockSchema).max(100, 'At most 100 blocks per content array'),
};
function validateProblemFields(problem: StoredProblem, ctx: z.RefinementCtx) {
  if (problem.responseSpec.kind !== problem.gradingSpec.kind) {
    ctx.addIssue({ code: 'custom', message: 'Response and grading kinds must match' });
  }
  const requiredForm = 'requiredForm' in problem.gradingSpec ? problem.gradingSpec.requiredForm : undefined;
  if (problem.responseSpec.requiredForm !== requiredForm) {
    ctx.addIssue({ code: 'custom', message: 'Response and grading form requirements must match' });
  }
  if (problem.hintAvailable !== (problem.hints.length > 0)) {
    ctx.addIssue({ code: 'custom', message: 'hintAvailable must match the stored hints' });
  }
}
const problemSchema = z.object(problemShape).strict().superRefine(validateProblemFields);

/** A frozen problem set version and the questions picked from it — how a lesson step, a review pool and a diagnostic name their questions. */
export const problemSetRefSchema = z.object({
  problemSetId: id, problemSetVersionId: id, problemVersionIds: z.array(id).min(1).max(50),
}).strict();
const storedLessonSchema = z.object({
  public: z.object({
    lessonKey: id,
    versionId: id,
    title: shortText,
    summary: shortText,
    estimatedMinutes: z.number().int().min(1).max(240),
    conceptKeys: z.array(id).min(1).max(50),
    prerequisiteConceptKeys: z.array(id).max(50),
    sectionCount: z.number().int().min(1).max(50),
  }).strict(),
  sections: z.array(z.object({
    sectionId: id,
    role: z.enum(['explanation', 'worked_example', 'practice', 'check', 'summary']),
    title: shortText,
    contentBlocks: z.array(blockSchema).min(1).max(100, 'At most 100 blocks per content array'),
  }).strict()).min(1).max(50, 'At most 50 sections per lesson'),
  review: problemSetRefSchema.nullable(),
}).strict();
const storedProblemSetSchema = z.object({
  problemSetId: id,
  courseKey: id.max(100),
  name: z.string().trim().min(1).max(191).nullable(),
  versionId: id,
  problems: z.array(problemSchema).min(1).max(200, 'At most 200 problems per problem set'),
}).strict();

function requireUnique(values: string[], label: string): void {
  if (new Set(values).size !== values.length) throw new Error(`Duplicate ${label}`);
}

/** The problem set references a lesson holds: one per activity block, and the review pool. */
export function problemSetRefs(record: StoredLesson): (ProblemSetRef & { blockId: string | null })[] {
  const refs = record.sections.flatMap((section) => section.contentBlocks
    .filter((block) => block.kind === 'core.problem_set' && block.typeVersion === 2)
    .map((block) => ({ ...(block.payload as unknown as ProblemSetRef), blockId: block.blockId })));
  return record.review ? [...refs, { ...record.review, blockId: null }] : refs;
}

/**
 * A lesson on its own: its steps and what they reference, before the references are checked
 * against the problem sets themselves. Questions are not the lesson's to validate.
 */
export function validateLesson(record: unknown): asserts record is StoredLesson {
  const parsed = storedLessonSchema.parse(record);
  if (parsed.public.sectionCount !== parsed.sections.length) throw new Error('sectionCount does not match sections');
  requireUnique(parsed.sections.map((section) => section.sectionId), 'section IDs');
  requireUnique(parsed.public.conceptKeys, 'lesson concept keys');
  requireUnique(parsed.public.prerequisiteConceptKeys, 'prerequisite concept keys');
  for (const prerequisite of parsed.public.prerequisiteConceptKeys) {
    if (parsed.public.conceptKeys.includes(prerequisite)) {
      throw new Error(`Lesson cannot require its own concept as a prerequisite: ${prerequisite}`);
    }
  }
  const sectionBlocks = parsed.sections.flatMap((section) => section.contentBlocks);
  requireUnique(sectionBlocks.map((block) => block.blockId), 'block IDs');
  // A question appears in one activity of a lesson. Two activities showing the same question would
  // record one answer twice, under two steps.
  const referenceOwners = new Map<string, string>();
  for (const block of sectionBlocks) {
    if (block.kind !== 'core.problem_set' || block.typeVersion !== 2) continue;
    const ids = (block.payload as unknown as ProblemSetRef).problemVersionIds;
    requireUnique(ids, `problem references in ${block.blockId}`);
    for (const problemId of ids) {
      const existingOwner = referenceOwners.get(problemId);
      if (existingOwner) throw new Error(`Reused problem version across activities: ${problemId} (${existingOwner} and ${block.blockId})`);
      referenceOwners.set(problemId, block.blockId);
    }
  }
  if (parsed.review) requireUnique(parsed.review.problemVersionIds, 'review problem references');
}

/** A problem set on its own: the questions it holds and their blocks, each valid and named once. */
export function validateProblemSet(record: unknown): asserts record is StoredProblemSet {
  const parsed = storedProblemSetSchema.parse(record);
  requireUnique(parsed.problems.map((problem) => problem.problemVersionId), 'problem version IDs');
  requireUnique(parsed.problems.flatMap((problem) => [...problem.promptContent, ...problem.hints, ...problem.solution])
    .map((block) => block.blockId), 'block IDs');
}

/** The frozen half of a lesson read back: what a bundle carries and a hash is taken over. */
export const storedLessonOf = (record: LessonRecord): StoredLesson =>
  ({ public: record.public, sections: record.sections, review: record.review });

function publicProblem(problem: StoredProblem): PublicProblem {
  return {
    problemVersionId: problem.problemVersionId,
    conceptKeys: [...problem.conceptKeys],
    promptContent: structuredClone(problem.promptContent),
    responseSpec: { ...problem.responseSpec },
    hintAvailable: problem.hintAvailable,
  };
}

export function toPublicLesson(record: LessonRecord, courseKey: string, glossary: GlossaryEntry[] = []): LessonDocument {
  validateLesson(storedLessonOf(record));
  return {
    ...structuredClone(record.public), courseKey,
    sections: structuredClone(record.sections),
    problems: record.problems.map(publicProblem),
    glossary: structuredClone(glossary),
  };
}

const blockLinks = (block: ContentBlock): DefinitionLink[] =>
  block.kind === 'core.rich_text' && block.typeVersion === 3 ? (block.payload.definitions as DefinitionLink[]) : [];

/** Definitions linked from any of these blocks, for resolving definitions before delivery. */
export function blockDefinitionRefs(blocks: ContentBlock[]): DefinitionRef[] {
  const seen = new Map<string, DefinitionRef>();
  for (const block of blocks) for (const definition of blockLinks(block)) {
    seen.set(definitionRefId(definition), { conceptKey: definition.conceptKey, scopeKind: definition.scopeKind, scopeKey: definition.scopeKey });
  }
  return [...seen.values()];
}

/**
 * Links name a concept and the scope whose definition explains it; the definition is its own row, so
 * rewording it republishes no lesson. Callers resolve the references against ConceptDefinition.
 */
export function definitionReferences(record: LessonRecord): (DefinitionRef & { blockId: string; problemConceptKeys: string[] | null })[] {
  const annotations = (block: ContentBlock, problemConceptKeys: string[] | null) =>
    blockLinks(block).map((definition) => ({ conceptKey: definition.conceptKey, scopeKind: definition.scopeKind, scopeKey: definition.scopeKey,
      blockId: block.blockId, problemConceptKeys }));
  return [
    ...record.sections.flatMap((section) => section.contentBlocks.flatMap((block) => annotations(block, null))),
    ...record.problems.flatMap((problem) => [...problem.promptContent, ...problem.hints, ...problem.solution]
      .flatMap((block) => annotations(block, problem.conceptKeys))),
  ];
}

export function getActivityProblemIds(record: StoredLesson, sectionId: string): string[] {
  const section = record.sections.find((item) => item.sectionId === sectionId);
  if (!section) throw new Error(`Unknown section: ${sectionId}`);
  return [...new Set(section.contentBlocks.flatMap((block) =>
    block.kind === 'core.problem_set' && block.typeVersion === 2
      ? (block.payload.problemVersionIds as string[])
      : [],
  ))];
}
