import { describe, expect, it } from 'vitest';
import { glossaryEntries, type PublishedDefinition } from '@/core/glossary';
import { seedLessons } from './fixtures/content';
import type { PublicLesson } from '@/shared/api';

const lessons: PublicLesson[] = seedLessons.map(c => ({ ...c.public, courseKey: 'fractions' }));
const meaning = lessons[0], equivalence = lessons[1];
const definition = (conceptKey: string, scope?: { scopeKind: PublishedDefinition['scopeKind']; scopeKey: string }): PublishedDefinition => ({
  conceptKey, scopeKind: scope?.scopeKind ?? 'global', scopeKey: scope?.scopeKey ?? '',
  label: conceptKey, summary: `${conceptKey} 설명`,
  blocks: [{ blockId: `${conceptKey}-b1`, kind: 'core.rich_text', typeVersion: 1, required: true, payload: { text: '정의' } }],
});
// Two explain concepts the lessons teach; one explains a concept no question assesses.
const definitions = [definition('fraction.meaning'), definition('fraction.equivalence'), definition('common-denominator')];

describe('the definitions a lesson linked', () => {
  it('sends every one of them, because linking is the decision', () => {
    // Whoever wrote the lesson chose that word in that place; progress does not overrule it.
    expect(glossaryEntries(definitions, lessons).map(entry => entry.conceptKey))
      .toEqual(['fraction.meaning', 'fraction.equivalence', 'common-denominator']);
    // Including the concept the lesson being read teaches, which used to be withheld.
    expect(glossaryEntries([definition('fraction.meaning')], lessons)).toHaveLength(1);
  });

  it('points each definition at the lesson that teaches its concept', () => {
    const entries = glossaryEntries(definitions, lessons);
    expect(entries.find(entry => entry.conceptKey === 'fraction.equivalence'))
      .toMatchObject({ lessonKey: equivalence.lessonKey, summary: 'fraction.equivalence 설명' });
    expect(entries.find(entry => entry.conceptKey === 'fraction.meaning')).toMatchObject({ lessonKey: meaning.lessonKey });
  });

  it('offers no lesson link for a concept no published lesson teaches', () => {
    const [entry] = glossaryEntries([definition('common-denominator')], lessons);
    expect(entry).toMatchObject({ conceptKey: 'common-denominator', lessonKey: null });
  });

  it('carries the scope through, so a lesson definition and a dictionary definition stay apart', () => {
    const scoped = definition('fraction.meaning', { scopeKind: 'lesson', scopeKey: meaning.lessonKey });
    const entries = glossaryEntries([definitions[0], scoped], lessons);
    expect(entries.map(entry => `${entry.scopeKind}:${entry.scopeKey}`)).toEqual(['global:', `lesson:${meaning.lessonKey}`]);
  });

  it('keeps the order the document asked for them in', () => {
    expect(glossaryEntries([definitions[2], definitions[0]], lessons).map(entry => entry.conceptKey))
      .toEqual(['common-denominator', 'fraction.meaning']);
  });
});
