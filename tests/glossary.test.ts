import { describe, expect, it } from 'vitest';
import { glossaryEntries, type PublishedTerm } from '@/core/glossary';
import { seedLessons } from './fixtures/content';
import type { PublicLesson } from '@/shared/api';

const lessons: PublicLesson[] = seedLessons.map(c => c.public);
const meaning = lessons[0], equivalence = lessons[1];
const term = (termKey: string, skillKey: string, scope?: { scopeKind: PublishedTerm['scopeKind']; scopeKey: string }): PublishedTerm => ({
  termKey, scopeKind: scope?.scopeKind ?? 'global', scopeKey: scope?.scopeKey ?? '',
  skillKey, label: termKey, summary: `${termKey} 설명`,
  blocks: [{ blockId: `${termKey}-b1`, kind: 'core.rich_text', typeVersion: 1, required: true, payload: { text: '정의' } }],
});
const terms = [
  term('term.denominator', 'fraction.meaning'),
  term('term.equivalent', 'fraction.equivalence'),
  term('term.common-denominator', 'fraction.addition'),
];

describe('the definitions a lesson linked', () => {
  it('sends every one of them, because linking is the decision', () => {
    // Whoever wrote the lesson chose that word in that place; progress does not overrule it.
    expect(glossaryEntries(terms, lessons).map(entry => entry.termKey))
      .toEqual(['term.denominator', 'term.equivalent', 'term.common-denominator']);
    // Including the concept the lesson being read teaches, which used to be withheld.
    expect(glossaryEntries([term('term.denominator', 'fraction.meaning')], lessons)).toHaveLength(1);
  });

  it('points each definition at the lesson that teaches its concept', () => {
    const entries = glossaryEntries(terms, lessons);
    expect(entries.find(entry => entry.termKey === 'term.equivalent'))
      .toMatchObject({ lessonKey: equivalence.lessonKey, skillKey: 'fraction.equivalence', summary: 'term.equivalent 설명' });
    expect(entries.find(entry => entry.termKey === 'term.denominator')).toMatchObject({ lessonKey: meaning.lessonKey });
  });

  it('offers no lesson link for a concept no published lesson teaches', () => {
    const [entry] = glossaryEntries([term('term.decimal', 'decimal.meaning')], lessons);
    expect(entry).toMatchObject({ termKey: 'term.decimal', lessonKey: null });
  });

  it('carries the scope through, so a lesson term and a dictionary term stay apart', () => {
    const scoped = term('term.denominator', 'fraction.meaning', { scopeKind: 'lesson', scopeKey: meaning.lessonKey });
    const entries = glossaryEntries([terms[0], scoped], lessons);
    expect(entries.map(entry => `${entry.scopeKind}:${entry.scopeKey}`)).toEqual(['global:', `lesson:${meaning.lessonKey}`]);
  });

  it('keeps the order the document asked for them in', () => {
    expect(glossaryEntries([terms[2], terms[0]], lessons).map(entry => entry.termKey))
      .toEqual(['term.common-denominator', 'term.denominator']);
  });
});
