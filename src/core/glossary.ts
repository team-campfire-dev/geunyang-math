import type { GlossaryEntry, PublicClass } from '@/shared/api';
import type { TermScopeKind } from '@/shared/rich-text';

export type PublishedTerm = {
  termKey: string; scopeKind: TermScopeKind; scopeKey: string;
  skillKey: string; label: string; summary: string; blocks: GlossaryEntry['blocks'];
};

/**
 * Turns the definitions a document linked into what a learner may open. Linking is the decision:
 * whoever wrote the lesson chose that word, in that place, to be explainable, so nothing here
 * second-guesses it from the learner's progress.
 *
 * The one thing this adds is where a concept is taught, so a definition can offer the way back to
 * the class that teaches it.
 */
export function glossaryEntries(terms: PublishedTerm[], classes: PublicClass[]): GlossaryEntry[] {
  const taughtIn = new Map<string, PublicClass>();
  for (const item of [...classes].sort((a, b) => a.order - b.order)) {
    for (const skillKey of item.skillKeys) if (!taughtIn.has(skillKey)) taughtIn.set(skillKey, item);
  }
  return terms.map((term) => ({
    termKey: term.termKey, scopeKind: term.scopeKind, scopeKey: term.scopeKey,
    label: term.label, summary: term.summary, skillKey: term.skillKey,
    blocks: term.blocks, classKey: taughtIn.get(term.skillKey)?.classKey ?? null,
  }));
}
