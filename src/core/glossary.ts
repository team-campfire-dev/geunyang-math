import type { GlossaryEntry, PublicLesson } from '@/shared/api';
import type { ConceptScope } from '@/shared/rich-text';

export type PublishedTerm = {
  termKey: string; scopeKind: ConceptScope; scopeKey: string;
  skillKey: string; label: string; summary: string; blocks: GlossaryEntry['blocks'];
};

/**
 * Turns the definitions a document linked into what a learner may open. Linking is the decision:
 * whoever wrote the lesson chose that word, in that place, to be explainable, so nothing here
 * second-guesses it from the learner's progress.
 *
 * The one thing this adds is where a concept is taught, so a definition can offer the way back to
 * the lesson that teaches it.
 */
export function glossaryEntries(terms: PublishedTerm[], lessons: PublicLesson[]): GlossaryEntry[] {
  // Lessons arrive in course order, so the first lesson teaching a concept is the one to go back to.
  const taughtIn = new Map<string, PublicLesson>();
  for (const item of lessons) {
    for (const skillKey of item.skillKeys) if (!taughtIn.has(skillKey)) taughtIn.set(skillKey, item);
  }
  return terms.map((term) => ({
    termKey: term.termKey, scopeKind: term.scopeKind, scopeKey: term.scopeKey,
    label: term.label, summary: term.summary, skillKey: term.skillKey,
    blocks: term.blocks, lessonKey: taughtIn.get(term.skillKey)?.lessonKey ?? null,
  }));
}
