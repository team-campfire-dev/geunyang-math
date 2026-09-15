import 'server-only';

import { z } from 'zod';
import type { ClassDocument, ClassSection, ContentBlock, GlossaryEntry, PublicClass, PublicProblem } from '@/shared/api';
import { frameLimits, isSceneColor, itemIdPattern, pathPattern, sceneLimits, stripLimits } from '@/shared/scene';
import { locateTerms, type TermAnnotation } from '@/shared/rich-text';

/** Private content records stay on the server; only toPublicClass crosses the API boundary. */
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

export type StoredClass = {
  public: PublicClass;
  sections: ClassSection[];
  problems: StoredProblem[];
  homeworkProblemIds: string[];
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
const termAnnotation = z.object({
  termKey: id.max(100),
  surface: z.string().min(1).max(100),
  // Terms repeat in a paragraph; the author picks which mention carries the definition.
  occurrence: z.number().int().min(1).max(100).optional(),
}).strict();
const blockSchemas = {
  'core.rich_text@1': z.object({ text: richText }).strict(),
  'core.rich_text@2': z.object({ text: richText, terms: z.array(termAnnotation).max(20) }).strict()
    .superRefine((payload, ctx) => {
      for (const issue of locateTerms(payload.text, payload.terms).issues) ctx.addIssue({ code: 'custom', message: issue });
    }),
  'core.problem_set@1': z.object({ problemVersionIds: z.array(id).min(1).max(50) }).strict(),
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
  if (!parsed.success) ctx.addIssue({ code: 'custom', path: ['payload'], message: `Invalid payload for ${key}: ${parsed.error.message}` });
});

/** A drawing the learner arranges reports nothing, so it stays out of anything that is assessed:
 *  beside an answer box it would read as the answer itself. */
const arrangeable = (block: { kind: string; payload: Record<string, unknown> }) =>
  block.kind === 'core.scene' && Array.isArray(block.payload.zones) && block.payload.zones.length > 0;

// Term definitions are leaves: no problem groups, and no annotations nesting a term inside a term.
// A definition is read while a problem waits, so it explains rather than asks for an interaction.
export const termContentBlockSchema = blockSchema.refine(
  (block) => block.kind !== 'core.problem_set' && !(block.kind === 'core.rich_text' && block.typeVersion === 2) && !arrangeable(block),
  { message: 'Term definitions cannot embed problems, further term annotations, or a drawing to arrange' },
);

const responseSchema = z.object({
  kind: z.enum(['integer', 'rational']),
  requiredForm: z.literal('reduced_fraction').optional(),
}).strict();

// Problem groups belong to class sections. A problem cannot embed another problem group,
// including an optional future version, in its prompt, hint, or solution.
const problemContentBlockSchema = blockSchema.refine((block) => block.kind !== 'core.problem_set', {
  message: 'core.problem_set is not allowed inside a problem',
}).refine((block) => !arrangeable(block), {
  message: 'A drawing to arrange is not allowed inside a problem',
});

const problemShape = {
  problemVersionId: id,
  skillKeys: z.array(id).min(1).max(50),
  promptContent: z.array(problemContentBlockSchema).min(1).max(100, 'At most 100 blocks per content array'),
  responseSpec: responseSchema,
  hintAvailable: z.boolean(),
  gradingSpec: z.discriminatedUnion('kind', [
    z.object({ kind: z.literal('integer'), value: integer }).strict(),
    z.object({ kind: z.literal('rational'), numerator: integer, denominator: integer.refine((value) => value > 0), requiredForm: z.literal('reduced_fraction').optional() }).strict(),
  ]),
  hints: z.array(problemContentBlockSchema).max(100, 'At most 100 blocks per content array'),
  solution: z.array(problemContentBlockSchema).min(1).max(100, 'At most 100 blocks per content array'),
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
// Placement omits hints and solutions, while retaining the same block and grading validation.
export const diagnosticProblemSchema = z.object({ ...problemShape,
  hintAvailable: z.literal(false), hints: z.array(problemContentBlockSchema).max(0),
  solution: z.array(problemContentBlockSchema).max(0),
}).strict().superRefine(validateProblemFields);

const storedClassSchema = z.object({
  public: z.object({
    classKey: id,
    versionId: id,
    title: shortText,
    summary: shortText,
    estimatedMinutes: z.number().int().min(1).max(240),
    skillKeys: z.array(id).min(1).max(50),
    prerequisiteSkillKeys: z.array(id).max(50),
    sectionCount: z.number().int().min(1).max(50),
    order: z.number().int().min(0),
  }).strict(),
  sections: z.array(z.object({
    sectionId: id,
    role: z.enum(['explanation', 'worked_example', 'practice', 'check', 'summary']),
    title: shortText,
    contentBlocks: z.array(blockSchema).min(1).max(100, 'At most 100 blocks per content array'),
  }).strict()).min(1).max(50, 'At most 50 sections per class'),
  problems: z.array(problemSchema).min(1).max(200, 'At most 200 problems per class'),
  homeworkProblemIds: z.array(id).max(200),
}).strict();

function requireUnique(values: string[], label: string): void {
  if (new Set(values).size !== values.length) throw new Error(`Duplicate ${label}`);
}

export function validateClass(record: unknown): asserts record is StoredClass {
  const parsed = storedClassSchema.parse(record);
  if (parsed.public.sectionCount !== parsed.sections.length) throw new Error('sectionCount does not match sections');
  requireUnique(parsed.sections.map((section) => section.sectionId), 'section IDs');
  requireUnique(parsed.problems.map((problem) => problem.problemVersionId), 'problem version IDs');
  requireUnique(parsed.homeworkProblemIds, 'homework problem IDs');
  requireUnique(parsed.public.skillKeys, 'class skill keys');
  requireUnique(parsed.public.prerequisiteSkillKeys, 'prerequisite skill keys');
  for (const prerequisite of parsed.public.prerequisiteSkillKeys) {
    if (parsed.public.skillKeys.includes(prerequisite)) {
      throw new Error(`Class cannot require its own skill as a prerequisite: ${prerequisite}`);
    }
  }
  const problems = new Set(parsed.problems.map((problem) => problem.problemVersionId));
  const sectionBlocks = parsed.sections.flatMap((section) => section.contentBlocks);
  const blocks = [
    ...sectionBlocks,
    ...parsed.problems.flatMap((problem) => [...problem.promptContent, ...problem.hints, ...problem.solution]),
  ];
  requireUnique(blocks.map((block) => block.blockId), 'block IDs');
  const referenceOwners = new Map(parsed.homeworkProblemIds.map((problemId) => [problemId, 'homework']));
  for (const block of sectionBlocks) {
    if (block.kind === 'core.problem_set' && block.typeVersion === 1) {
      const ids = block.payload.problemVersionIds as string[];
      requireUnique(ids, `problem references in ${block.blockId}`);
      for (const problemId of ids) {
        const existingOwner = referenceOwners.get(problemId);
        if (existingOwner) {
          throw new Error(`Reused problem version across activities: ${problemId} (${existingOwner} and ${block.blockId})`);
        }
        referenceOwners.set(problemId, block.blockId);
      }
    }
  }
  for (const reference of referenceOwners.keys()) {
    if (!problems.has(reference)) throw new Error(`Missing immutable problem version: ${reference}`);
  }
  for (const problem of parsed.problems) {
    if (!referenceOwners.has(problem.problemVersionId)) throw new Error(`Unreferenced problem version: ${problem.problemVersionId}`);
    for (const skill of problem.skillKeys) {
      if (!parsed.public.skillKeys.includes(skill)) throw new Error(`Problem skill is absent from class skills: ${skill}`);
    }
  }
}

function publicProblem(problem: StoredProblem): PublicProblem {
  return {
    problemVersionId: problem.problemVersionId,
    skillKeys: [...problem.skillKeys],
    promptContent: structuredClone(problem.promptContent),
    responseSpec: { ...problem.responseSpec },
    hintAvailable: problem.hintAvailable,
  };
}

export function toPublicClass(record: StoredClass, glossary: GlossaryEntry[] = []): ClassDocument {
  validateClass(record);
  return {
    ...structuredClone(record.public),
    sections: structuredClone(record.sections),
    problems: record.problems.map(publicProblem),
    glossary: structuredClone(glossary),
  };
}

const blockAnnotations = (block: ContentBlock): TermAnnotation[] =>
  block.kind === 'core.rich_text' && block.typeVersion === 2 ? (block.payload.terms as TermAnnotation[]) : [];

/** Term keys linked from any of these blocks, for resolving definitions before delivery. */
export function blockTermKeys(blocks: ContentBlock[]): string[] {
  return [...new Set(blocks.flatMap((block) => blockAnnotations(block).map((term) => term.termKey)))];
}

/**
 * Term annotations name a published term by key; the definition itself lives in its own version so
 * that rewording it does not republish every class. Callers resolve the keys against TermVersion.
 */
export function termReferences(record: StoredClass): { termKey: string; blockId: string; problemSkillKeys: string[] | null }[] {
  const annotations = (block: ContentBlock, problemSkillKeys: string[] | null) =>
    blockAnnotations(block).map((term) => ({ termKey: term.termKey, blockId: block.blockId, problemSkillKeys }));
  return [
    ...record.sections.flatMap((section) => section.contentBlocks.flatMap((block) => annotations(block, null))),
    ...record.problems.flatMap((problem) => [...problem.promptContent, ...problem.hints, ...problem.solution]
      .flatMap((block) => annotations(block, problem.skillKeys))),
  ];
}

export function getActivityProblemIds(record: StoredClass, sectionId: string): string[] {
  const section = record.sections.find((item) => item.sectionId === sectionId);
  if (!section) throw new Error(`Unknown section: ${sectionId}`);
  return [...new Set(section.contentBlocks.flatMap((block) =>
    block.kind === 'core.problem_set' && block.typeVersion === 1
      ? (block.payload.problemVersionIds as string[])
      : [],
  ))];
}
