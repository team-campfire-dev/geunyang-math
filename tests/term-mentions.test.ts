import { describe, expect, it } from 'vitest';
import { linkTerm, mentionAt } from '@/features/authoring/term-mentions';
import { locateTerms, type TermAnnotation } from '@/shared/rich-text';
import type { TermChoice } from '@/shared/authoring';

const shared: TermChoice = { termKey: 'term.denominator', scopeKind: 'global', scopeKey: '', label: '분모', skillKey: 'fraction.meaning' };
const mine: TermChoice = { termKey: 'term.denominator', scopeKind: 'class', scopeKey: 'fraction-meaning', label: '분모', skillKey: 'fraction.meaning' };

describe('typing @ to reach for a term', () => {
  it('reads the mention being typed, and only that one', () => {
    const typing = '전체를 나눈 @분';
    expect(mentionAt(typing, typing.length)).toEqual({ from: typing.indexOf('@'), query: '분' });
    expect(mentionAt('@', 1)).toEqual({ from: 0, query: '' });
    // A mention ends at whitespace, so an @ the author already wrote past never reopens the list.
    const past = '@분모 를 봅니다';
    expect(mentionAt(past, past.length)).toBeNull();
    const mail = '메일 주소 a@b 를 씁니다';
    expect(mentionAt(mail, mail.length)).toBeNull();
    expect(mentionAt('용어가 없는 문장', 5)).toBeNull();
    // Only what is left of the caret counts.
    expect(mentionAt('@분모입니다', 3)).toEqual({ from: 0, query: '분모' });
  });

  it('puts the term name in the text and records the link', () => {
    const typed = '전체를 나눈 @분';
    const { text, terms } = linkTerm(typed, { from: typed.indexOf('@'), query: '분' }, shared, []);
    expect(text).toBe('전체를 나눈 분모');
    expect(terms).toEqual([{ termKey: 'term.denominator', surface: '분모' }]);
    // What was written is exactly what the renderer will find.
    expect(locateTerms(text, terms).issues).toEqual([]);
    expect(text.slice(locateTerms(text, terms).spans[0].start)).toBe('분모');
  });

  it('records which mention was meant when the word repeats', () => {
    const typed = '분모와 분모 사이, @분';
    const { text, terms } = linkTerm(typed, { from: typed.indexOf('@'), query: '분' }, shared, []);
    expect(text).toBe('분모와 분모 사이, 분모');
    expect(terms[0]).toMatchObject({ occurrence: 3 });
    expect(locateTerms(text, terms).spans[0].start).toBe(text.lastIndexOf('분모'));
  });

  it('carries the scope of the term that was chosen', () => {
    const { terms } = linkTerm('@분', { from: 0, query: '분' }, mine, []);
    expect(terms[0]).toEqual({ termKey: 'term.denominator', surface: '분모', scopeKind: 'class', scopeKey: 'fraction-meaning' });
  });

  it('moves an existing link rather than adding a second one the validator would reject', () => {
    const existing: TermAnnotation[] = [{ termKey: 'term.denominator', surface: '분모' }];
    const typed = '분모를 다시 씁니다. @분';
    const { text, terms } = linkTerm(typed, { from: typed.indexOf('@'), query: '분' }, shared, existing);
    expect(terms).toHaveLength(1);
    expect(terms[0]).toMatchObject({ occurrence: 2 });
    expect(locateTerms(text, terms).issues).toEqual([]);
    // A term kept by the class is a different term, so it links alongside the shared one.
    const both = linkTerm(text, { from: text.length, query: '' }, mine, terms);
    expect(both.terms).toHaveLength(2);
  });
});
