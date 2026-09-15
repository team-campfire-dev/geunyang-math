import { describe, expect, it } from 'vitest';
import { glossaryEntries, type PublishedTerm } from '@/core/glossary';
import { seedClasses } from './fixtures/content';
import type { PublicClass } from '@/shared/api';

const classes: PublicClass[] = seedClasses.map(c => c.public);
const meaning = classes[0], equivalence = classes[1];
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
    expect(glossaryEntries(terms, classes).map(entry => entry.termKey))
      .toEqual(['term.denominator', 'term.equivalent', 'term.common-denominator']);
    // Including the concept the class being read teaches, which used to be withheld.
    expect(glossaryEntries([term('term.denominator', 'fraction.meaning')], classes)).toHaveLength(1);
  });

  it('points each definition at the class that teaches its concept', () => {
    const entries = glossaryEntries(terms, classes);
    expect(entries.find(entry => entry.termKey === 'term.equivalent'))
      .toMatchObject({ classKey: equivalence.classKey, skillKey: 'fraction.equivalence', summary: 'term.equivalent 설명' });
    expect(entries.find(entry => entry.termKey === 'term.denominator')).toMatchObject({ classKey: meaning.classKey });
  });

  it('offers no class link for a concept no published class teaches', () => {
    const [entry] = glossaryEntries([term('term.decimal', 'decimal.meaning')], classes);
    expect(entry).toMatchObject({ termKey: 'term.decimal', classKey: null });
  });

  it('carries the scope through, so a class term and a dictionary term stay apart', () => {
    const scoped = term('term.denominator', 'fraction.meaning', { scopeKind: 'class', scopeKey: meaning.classKey });
    const entries = glossaryEntries([terms[0], scoped], classes);
    expect(entries.map(entry => `${entry.scopeKind}:${entry.scopeKey}`)).toEqual(['global:', `class:${meaning.classKey}`]);
  });

  it('keeps the order the document asked for them in', () => {
    expect(glossaryEntries([terms[2], terms[0]], classes).map(entry => entry.termKey))
      .toEqual(['term.common-denominator', 'term.denominator']);
  });
});
