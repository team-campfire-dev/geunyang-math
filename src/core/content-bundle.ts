import 'server-only';
import { z } from 'zod';
import { diagnosticProblemSchema, termContentBlockSchema, termReferences, validateClass, type StoredClass } from './content';
import { termRefId } from '@/shared/rich-text';

const id = z.string().min(1).max(191).regex(/^[a-zA-Z0-9:._-]+$/);
export const skillSchema = z.object({ key: id.max(100), label: z.string().trim().min(1).max(191), order: z.number().int().min(0).max(1_000_000) }).strict();
export const diagnosticDefinitionSchema = z.object({
  versionId: id, diagnosticKey: id.max(100), title: z.string().trim().min(1).max(191),
  description: z.string().trim().min(1).max(2000), estimatedMinutes: z.number().int().min(1).max(120),
  problems: z.array(diagnosticProblemSchema).min(1).max(100),
}).strict();
export type DiagnosticDefinition = z.infer<typeof diagnosticDefinitionSchema>;
export const termDefinitionSchema = z.object({
  versionId: id, termKey: id.max(100),
  // A bundle written before scopes existed carries neither field and imports as the shared dictionary.
  scopeKind: z.enum(['global', 'organization', 'course', 'class']).optional().default('global'),
  scopeKey: id.max(100).or(z.literal('')).optional().default(''),
  skillKey: id.max(100),
  label: z.string().trim().min(1).max(191), summary: z.string().trim().min(1).max(500),
  blocks: z.array(termContentBlockSchema).min(1).max(20),
}).strict().refine((term) => (term.scopeKind === 'global' ? term.scopeKey === '' : term.scopeKey !== ''),
  { message: 'A scoped term must name the scope it belongs to, and a global one must not' });
export type TermDefinition = z.infer<typeof termDefinitionSchema>;
export type ContentBundle = { schemaVersion: 1; skills: z.infer<typeof skillSchema>[]; classes: StoredClass[]; diagnostics: DiagnosticDefinition[]; terms: TermDefinition[] };
export class ContentError extends Error {}
function unique(values: string[], label: string) {
  if (new Set(values).size !== values.length) throw new ContentError(`Duplicate ${label}.`);
}
export function parseContentBundle(input: unknown): ContentBundle {
  // Terms are additive: a bundle exported before glossary support still imports unchanged.
  const parsed = z.object({ schemaVersion: z.literal(1), skills: z.array(skillSchema).max(1000),
    classes: z.array(z.unknown()).max(1000), diagnostics: z.array(diagnosticDefinitionSchema).max(100),
    terms: z.array(termDefinitionSchema).max(2000).optional().default([]),
  }).strict().parse(input);
  unique(parsed.skills.map(s => s.key), 'skill keys');
  unique(parsed.diagnostics.map(d => d.versionId), 'diagnostic version IDs');
  unique(parsed.terms.map(t => t.versionId), 'term version IDs');
  unique(parsed.terms.flatMap(t => t.blocks.map(b => b.blockId)), 'term block IDs');
  for (const record of parsed.classes) {
    validateClass(record);
    if (record.public.classKey.length > 100 || record.public.title.length > 191 || record.public.order > 2_147_483_647) throw new ContentError('Class metadata exceeds database limits.');
  }
  const classes = parsed.classes as StoredClass[];
  unique(classes.map(c => c.public.versionId), 'class version IDs');
  for (const d of parsed.diagnostics) {
    unique(d.problems.map(p => p.problemVersionId), 'diagnostic problem IDs');
    unique(d.problems.flatMap(p => p.promptContent.map(b => b.blockId)), 'diagnostic block IDs');
    for (const p of d.problems) unique(p.skillKeys, 'diagnostic problem skill keys');
  }
  return { schemaVersion: 1, skills: parsed.skills, classes, diagnostics: parsed.diagnostics, terms: parsed.terms };
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
  consistentCase(bundle.skills.map(s => s.key));
  consistentCase(bundle.classes.map(c => c.public.versionId));
  consistentCase(bundle.classes.map(c => c.public.classKey));
  consistentCase(bundle.diagnostics.map(d => d.versionId));
  consistentCase(bundle.diagnostics.map(d => d.diagnosticKey));
  consistentCase(bundle.terms.map(t => t.versionId));
  // Keys only have to stay unambiguous inside their own scope; a class may reuse a dictionary word.
  for (const scope of new Set(bundle.terms.map(t => `${t.scopeKind}:${t.scopeKey}`))) {
    consistentCase(bundle.terms.filter(t => `${t.scopeKind}:${t.scopeKey}` === scope).map(t => t.termKey));
  }
  consistentCase([...bundle.classes.flatMap(c => c.problems), ...bundle.diagnostics.flatMap(d => d.problems)].map(p => p.problemVersionId));
  const skills = new Set(bundle.skills.map(s => s.key));
  const problems = new Map<string, string>();
  const classProblems = new Set(bundle.classes.flatMap(c => c.problems.map(p => p.problemVersionId)));
  const assertSkill = (key: string) => { if (!skills.has(key)) throw new ContentError(`Missing skill: ${key}`); };
  for (const c of bundle.classes) {
    [...c.public.skillKeys, ...c.public.prerequisiteSkillKeys].forEach(assertSkill);
  }
  const termSkills = new Map<string, string>();
  for (const t of bundle.terms) {
    assertSkill(t.skillKey);
    const ref = termRefId(t);
    const concept = termSkills.get(ref);
    // Visibility follows the concept a term belongs to, so it must not move between versions.
    if (concept && concept !== t.skillKey) throw new ContentError(`Term concept cannot change across versions: ${t.termKey}`);
    termSkills.set(ref, t.skillKey);
  }
  for (const c of bundle.classes) for (const reference of termReferences(c)) {
    // A class-scoped term belongs to the class that keeps it. Reaching into another class's terms
    // would make one class's wording depend on a document its author cannot see.
    if (reference.scopeKind === 'class' && reference.scopeKey !== c.public.classKey) {
      throw new ContentError(`A class can only link its own terms: ${reference.termKey} (${reference.blockId})`);
    }
    const concept = termSkills.get(termRefId(reference));
    if (!concept) throw new ContentError(`Missing term: ${reference.termKey} (${reference.blockId})`);
    // A definition of the very concept under assessment would answer the question.
    if (reference.problemSkillKeys?.includes(concept)) throw new ContentError(`A problem cannot explain the concept it assesses: ${reference.termKey} (${reference.blockId})`);
  }
  for (const d of bundle.diagnostics) for (const p of d.problems) {
    if (classProblems.has(p.problemVersionId)) throw new ContentError(`Diagnostic problem overlaps class content: ${p.problemVersionId}`);
  }
  for (const p of [...bundle.classes.flatMap(c => c.problems), ...bundle.diagnostics.flatMap(d => d.problems)]) {
    p.skillKeys.forEach(assertSkill);
    const value = canonicalJson(p);
    if (problems.has(p.problemVersionId) && problems.get(p.problemVersionId) !== value) throw new ContentError(`Problem version is immutable: ${p.problemVersionId}`);
    problems.set(p.problemVersionId, value);
  }
}
