import { describe, expect, it } from 'vitest';
import { visibleTerms, type PublishedTerm } from '@/core/glossary';
import { seedClasses } from './fixtures/content';
import type { PublicClass } from '@/shared/api';

const classes: PublicClass[] = seedClasses.map(c => c.public);
const meaning = classes[0], equivalence = classes[1], addition = classes[2];
const term = (termKey: string, skillKey: string): PublishedTerm => ({
  termKey, skillKey, label: termKey, summary: `${termKey} 설명`,
  blocks: [{ blockId: `${termKey}-b1`, kind: 'core.rich_text', typeVersion: 1, required: true, payload: { text: '정의' } }],
});
const terms = [
  term('term.denominator', 'fraction.meaning'),
  term('term.equivalent', 'fraction.equivalence'),
  term('term.common-denominator', 'fraction.addition'),
];
const keys = (current: Parameters<typeof visibleTerms>[0]['current']) =>
  visibleTerms({ terms, classes, current }).map(entry => entry.termKey);

describe('term visibility while reading a class', () => {
  it('withholds the concepts the class itself teaches', () => {
    expect(keys(addition)).not.toContain('term.common-denominator');
    expect(keys(meaning)).not.toContain('term.denominator');
  });
  it('explains prerequisites and anything taught earlier', () => {
    expect(keys(addition)).toEqual(['term.denominator', 'term.equivalent']);
    expect(keys(equivalence)).toEqual(['term.denominator']);
  });
  it('leaves concepts from later classes plain', () => {
    expect(keys(meaning)).toEqual([]);
    expect(keys(equivalence)).not.toContain('term.common-denominator');
  });
  it('points each definition at the class that teaches it', () => {
    const entry = visibleTerms({ terms, classes, current: addition }).find(item => item.termKey === 'term.equivalent');
    expect(entry).toMatchObject({ classKey: equivalence.classKey, skillKey: 'fraction.equivalence', summary: 'term.equivalent 설명' });
  });
  it('offers no class link for a concept no published class teaches', () => {
    const orphan = [term('term.decimal', 'decimal.meaning')];
    expect(visibleTerms({ terms: orphan, classes, current: addition })).toEqual([]);
  });
});

describe('term visibility while solving assigned review work', () => {
  it('withholds only the concepts the assignment assesses', () => {
    expect(keys({ assessedSkillKeys: ['fraction.addition'] })).toEqual(['term.denominator', 'term.equivalent']);
    expect(keys({ assessedSkillKeys: ['fraction.meaning', 'fraction.addition'] })).toEqual(['term.equivalent']);
  });
  it('keeps a definition that no item in the assignment assesses', () => {
    expect(keys({ assessedSkillKeys: [] })).toHaveLength(terms.length);
  });
});
