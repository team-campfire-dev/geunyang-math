// Shared by the publishing validator and the block renderer. Both sides must agree on where
// math ends and prose begins, or a term could be underlined inside a formula on one side only.
export type RichTextSegment =
  | { kind: 'text'; value: string; start: number }
  | { kind: 'math'; value: string; start: number; equation: string; display: boolean };
/**
 * Where a term is kept. A global definition is the operator's shared dictionary; the others
 * belong to whoever owns that part of the catalogue. A class names the scope when it links a term,
 * so reading a definition never needs to know which class, course or organisation is being read.
 */
export type TermScopeKind = 'global' | 'organization' | 'course' | 'class';
export type TermRef = { termKey: string; scopeKind?: TermScopeKind; scopeKey?: string };
/** One string that names a term across every scope, so matching compares one value, not three. */
export const termRefId = (term: TermRef): string =>
  (!term.scopeKind || term.scopeKind === 'global' ? `global::${term.termKey}` : `${term.scopeKind}:${term.scopeKey ?? ''}:${term.termKey}`);
export type TermAnnotation = TermRef & { surface: string; occurrence?: number };
export type TermPlacement = { ref: string; termKey: string; start: number; end: number };

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
 * Resolves term annotations to character ranges. Occurrences are counted over prose only, so a
 * surface that also appears inside a formula never shifts the numbering an author sees.
 * Published content carries no issues; renderers draw the spans and ignore the rest.
 */
export function locateTerms(text: string, terms: TermAnnotation[]): { spans: TermPlacement[]; issues: string[] } {
  const prose = splitRichText(text).filter((segment) => segment.kind === 'text');
  const spans: TermPlacement[] = [];
  const issues: string[] = [];
  const seen = new Set<string>();
  for (const term of terms) {
    const ref = termRefId(term);
    if (seen.has(ref)) { issues.push(`Term is annotated twice in one block: ${term.termKey}`); continue; }
    seen.add(ref);
    const occurrence = term.occurrence ?? 1;
    if (!Number.isInteger(occurrence) || occurrence < 1) { issues.push(`Occurrence must be a positive integer: ${term.termKey}`); continue; }
    let remaining = occurrence;
    let placement: TermPlacement | undefined;
    for (const segment of prose) {
      for (let index = segment.value.indexOf(term.surface); index >= 0; index = segment.value.indexOf(term.surface, index + 1)) {
        if (--remaining > 0) continue;
        placement = { ref, termKey: term.termKey, start: segment.start + index, end: segment.start + index + term.surface.length };
        break;
      }
      if (placement) break;
    }
    if (!placement) { issues.push(`Surface "${term.surface}" does not occur ${occurrence} time(s) outside math: ${term.termKey}`); continue; }
    spans.push(placement);
  }
  spans.sort((a, b) => a.start - b.start);
  for (let index = 1; index < spans.length; index++) {
    if (spans[index].start < spans[index - 1].end) issues.push(`Overlapping term annotations: ${spans[index - 1].termKey} and ${spans[index].termKey}`);
  }
  return { spans, issues };
}
