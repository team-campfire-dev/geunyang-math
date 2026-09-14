import 'server-only';

import { z } from 'zod';
import type { ClassDocument, ClassSection, ContentBlock, PublicClass, PublicProblem } from '@/shared/api';

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

const id = z.string().min(1).max(200).regex(/^[a-zA-Z0-9:._-]+$/);
const shortText = z.string().trim().min(1).max(500);
const integer = z.number().int().min(Number.MIN_SAFE_INTEGER).max(Number.MAX_SAFE_INTEGER);
const fractionStrip = z.object({
  parts: z.number().int().min(1).max(100),
  filled: z.number().int().min(0).max(100),
  label: z.string().max(200).optional(),
}).strict().refine((value) => value.filled <= value.parts, 'filled must not exceed parts');

/** New block kinds register a versioned payload schema here and a renderer in the UI. */
const blockSchemas = {
  'core.rich_text@1': z.object({ text: z.string().min(1).max(20_000) }).strict(),
  'core.problem_set@1': z.object({ problemVersionIds: z.array(id).min(1).max(50) }).strict(),
  'core.figure@1': z.object({
    alt: shortText,
    caption: z.string().max(500).optional(),
    primitive: z.object({ kind: z.literal('fraction_strip'), ...fractionStrip.shape }).strict()
      .refine((value) => value.filled <= value.parts, 'filled must not exceed parts'),
  }).strict(),
  'math.fraction_strip@1': fractionStrip,
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

const responseSchema = z.object({
  kind: z.enum(['integer', 'rational']),
  requiredForm: z.literal('reduced_fraction').optional(),
}).strict();

// Problem groups belong to class sections. A problem cannot embed another problem group,
// including an optional future version, in its prompt, hint, or solution.
const problemContentBlockSchema = blockSchema.refine((block) => block.kind !== 'core.problem_set', {
  message: 'core.problem_set is not allowed inside a problem',
});

const problemSchema = z.object({
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
}).strict().superRefine((problem, ctx) => {
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
});

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

export function toPublicClass(record: StoredClass): ClassDocument {
  validateClass(record);
  return {
    ...structuredClone(record.public),
    sections: structuredClone(record.sections),
    problems: record.problems.map(publicProblem),
  };
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
