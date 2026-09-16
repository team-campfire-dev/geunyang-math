// Shared by the publishing validator and the block renderer. Both sides must agree on where
// math ends and prose begins, or a definition could be underlined inside a formula on one side only.
export type RichTextSegment =
  | { kind: 'text'; value: string; start: number }
  | { kind: 'math'; value: string; start: number; equation: string; display: boolean };
/**
 * Where a definition is kept. A global definition is the operator's shared dictionary; the others
 * belong to whoever owns that part of the catalogue. A lesson names the scope when it links a definition,
 * so reading a definition never needs to know which lesson, course or organisation is being read.
 */
export type ConceptScope = 'global' | 'organization' | 'course' | 'lesson';
export type DefinitionRef = { conceptKey: string; scopeKind?: ConceptScope; scopeKey?: string };
/** One string that names a definition across every scope, so matching compares one value, not three. */
export const definitionRefId = (definition: DefinitionRef): string =>
  (!definition.scopeKind || definition.scopeKind === 'global' ? `global::${definition.conceptKey}` : `${definition.scopeKind}:${definition.scopeKey ?? ''}:${definition.conceptKey}`);
export type DefinitionLink = DefinitionRef & { surface: string; occurrence?: number };
export type TermPlacement = { ref: string; conceptKey: string; start: number; end: number };

const mathPattern = /\$\$[\s\S]+?\$\$|\\\([\s\S]+?\\\)|\$[^$\n]+?\$/g;

export function splitRichText(text: string): RichTextSegment[] {
  const segments: RichTextSegment[] = [];
  let cursor = 0;
  for (const match of text.matchAll(mathPattern)) {
    const start = match.index;
    if (start > cursor) segments.push({ kind: 'text', value: text.slice(cursor, start), start: cursor });
    const value = match[0];
    const display = value.startsWith('$$');
    const width = display || value.startsWith('\\(') ? 2 : 1;
    segments.push({ kind: 'math', value, start, equation: value.slice(width, -width), display });
    cursor = start + value.length;
  }
  if (cursor < text.length) segments.push({ kind: 'text', value: text.slice(cursor), start: cursor });
  return segments;
}

/**
 * Resolves definition annotations to character ranges. Occurrences are counted over prose only, so a
 * surface that also appears inside a formula never shifts the numbering an author sees.
 * Published content carries no issues; renderers draw the spans and ignore the rest.
 */
/**
 * Which mention of `surface` a position falls on, counted the way `locateTerms` resolves one: over
 * prose only, so a word inside a formula never shifts the numbering, and stepping one character at
 * a time so overlapping mentions agree on both sides.
 */
export function occurrenceAt(text: string, surface: string, position: number): number {
  let count = 0;
  for (const segment of splitRichText(text)) {
    if (segment.kind !== 'text') continue;
    for (let index = segment.value.indexOf(surface); index >= 0; index = segment.value.indexOf(surface, index + 1)) {
      if (segment.start + index >= position) return count + 1;
      count += 1;
    }
  }
  return count + 1;
}

export function locateTerms(text: string, definitions: DefinitionLink[]): { spans: TermPlacement[]; issues: string[] } {
  const prose = splitRichText(text).filter((segment) => segment.kind === 'text');
  const spans: TermPlacement[] = [];
  const issues: string[] = [];
  const seen = new Set<string>();
  for (const definition of definitions) {
    const ref = definitionRefId(definition);
    if (seen.has(ref)) { issues.push(`Definition is annotated twice in one block: ${definition.conceptKey}`); continue; }
    seen.add(ref);
    const occurrence = definition.occurrence ?? 1;
    if (!Number.isInteger(occurrence) || occurrence < 1) { issues.push(`Occurrence must be a positive integer: ${definition.conceptKey}`); continue; }
    let remaining = occurrence;
    let placement: TermPlacement | undefined;
    for (const segment of prose) {
      for (let index = segment.value.indexOf(definition.surface); index >= 0; index = segment.value.indexOf(definition.surface, index + 1)) {
        if (--remaining > 0) continue;
        placement = { ref, conceptKey: definition.conceptKey, start: segment.start + index, end: segment.start + index + definition.surface.length };
        break;
      }
      if (placement) break;
    }
    if (!placement) { issues.push(`Surface "${definition.surface}" does not occur ${occurrence} time(s) outside math: ${definition.conceptKey}`); continue; }
    spans.push(placement);
  }
  spans.sort((a, b) => a.start - b.start);
  for (let index = 1; index < spans.length; index++) {
    if (spans[index].start < spans[index - 1].end) issues.push(`Overlapping definition annotations: ${spans[index - 1].conceptKey} and ${spans[index].conceptKey}`);
  }
  return { spans, issues };
}
