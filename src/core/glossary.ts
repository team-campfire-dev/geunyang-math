import type { GlossaryEntry, PublicLesson } from '@/shared/api';
import type { ConceptScope } from '@/shared/rich-text';

/** A definition as one scope keeps it, with the name that scope uses for the concept already resolved. */
export type PublishedDefinition = {
  conceptKey: string; scopeKind: ConceptScope; scopeKey: string;
  label: string; summary: string; blocks: GlossaryEntry['blocks'];
};

/**
 * Turns the definitions a document linked into what a learner may open. Linking is the decision:
 * whoever wrote the lesson chose that word, in that place, to be explainable, so nothing here
 * second-guesses it from the learner's progress.
 *
 * The one thing this adds is where a concept is taught, so a definition can offer the way back to
 * the lesson that teaches it.
 */
export function glossaryEntries(definitions: PublishedDefinition[], lessons: PublicLesson[]): GlossaryEntry[] {
  // Lessons arrive in course order, so the first lesson teaching a concept is the one to go back to.
  const taughtIn = new Map<string, PublicLesson>();
  for (const item of lessons) {
    for (const conceptKey of item.conceptKeys) if (!taughtIn.has(conceptKey)) taughtIn.set(conceptKey, item);
  }
  return definitions.map((definition) => ({
    conceptKey: definition.conceptKey, scopeKind: definition.scopeKind, scopeKey: definition.scopeKey,
    label: definition.label, summary: definition.summary,
    blocks: definition.blocks, lessonKey: taughtIn.get(definition.conceptKey)?.lessonKey ?? null,
  }));
}
