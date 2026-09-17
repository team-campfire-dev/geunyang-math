import type { ContentBlock, GlossaryEntry, LessonSection } from './api';
import { definitionRefId, type DefinitionRef } from './rich-text';

export const canExploreDefinitions = (role: LessonSection['role']) =>
  role === 'explanation' || role === 'worked_example' || role === 'summary';

/** Problem/legacy responses carry the explanation, never its outgoing graph. */
export function withoutDefinitionLinks(blocks: ContentBlock[]): ContentBlock[] {
  return blocks.map(block => block.kind === 'core.rich_text' && block.typeVersion === 3
    ? { ...block, payload: { ...block.payload, definitions: [] } } : block);
}

export function leafGlossary(entries: GlossaryEntry[], assessedConcepts: string[] = []): GlossaryEntry[] {
  return entries.filter(entry => !assessedConcepts.includes(entry.conceptKey))
    .map(entry => ({ ...entry, blocks: withoutDefinitionLinks(entry.blocks) }));
}

export const referenceOf = (entry: DefinitionRef): DefinitionRef => ({
  conceptKey: entry.conceptKey, scopeKind: entry.scopeKind ?? 'global', scopeKey: entry.scopeKey ?? '',
});

/** Revisiting a scoped definition returns to its existing frame, including through a cycle. */
export function definitionPath<T extends DefinitionRef>(path: T[], next: T): T[] {
  const index = path.findIndex(entry => definitionRefId(entry) === definitionRefId(next));
  return index < 0 ? [...path, next] : path.slice(0, index + 1);
}
