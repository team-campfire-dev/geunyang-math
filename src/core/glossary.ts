import type { GlossaryEntry, PublicClass } from '@/shared/api';

export type PublishedTerm = { termKey: string; skillKey: string; label: string; summary: string; blocks: GlossaryEntry['blocks'] };

/**
 * Decides which term definitions a learner may open while reading. The rule is structural, so it
 * holds before any personal history exists: a concept is explained only once it is behind the
 * learner. Explaining the concept currently being taught or assessed would replace the lesson.
 *
 * Hidden terms are omitted from the response rather than flagged, so their text never ships to a
 * client that must not show it, and the renderer needs no rule of its own.
 */
export function visibleTerms(input: {
  terms: PublishedTerm[];
  classes: PublicClass[];
  /** The class being read, or the skills an assignment assesses when there is no class context. */
  current: { classKey: string; skillKeys: string[]; prerequisiteSkillKeys: string[]; order: number } | { assessedSkillKeys: string[] };
}): GlossaryEntry[] {
  const taughtIn = new Map<string, PublicClass>();
  for (const item of [...input.classes].sort((a, b) => a.order - b.order)) {
    for (const skillKey of item.skillKeys) if (!taughtIn.has(skillKey)) taughtIn.set(skillKey, item);
  }
  const visible = (skillKey: string) => {
    if ('assessedSkillKeys' in input.current) return !input.current.assessedSkillKeys.includes(skillKey);
    if (input.current.skillKeys.includes(skillKey)) return false;
    if (input.current.prerequisiteSkillKeys.includes(skillKey)) return true;
    const source = taughtIn.get(skillKey);
    // A concept from a later class is not review material; leave the text plain until it is taught.
    return !!source && source.order < input.current.order;
  };
  return input.terms.filter((term) => visible(term.skillKey)).map((term) => ({
    termKey: term.termKey, label: term.label, summary: term.summary, skillKey: term.skillKey,
    blocks: term.blocks, classKey: taughtIn.get(term.skillKey)?.classKey ?? null,
  }));
}
