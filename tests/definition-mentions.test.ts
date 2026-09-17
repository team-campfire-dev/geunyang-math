import { describe, expect, it } from 'vitest';
import { linkDefinition, mentionAt } from '@/features/authoring/definition-mentions';
import { locateTerms, type DefinitionLink } from '@/shared/rich-text';
import type { DefinitionChoice } from '@/shared/authoring';

const shared: DefinitionChoice = { conceptKey: 'term.denominator', scopeKind: 'global', scopeKey: '', label: '분모' };
const mine: DefinitionChoice = { conceptKey: 'term.denominator', scopeKind: 'lesson', scopeKey: 'fraction-meaning', label: '분모' };

describe('typing @ to reach for a definition', () => {
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

  it('puts the definition name in the text and records the link', () => {
    const typed = '전체를 나눈 @분';
    const { text, definitions } = linkDefinition(typed, { from: typed.indexOf('@'), query: '분' }, shared, []);
    expect(text).toBe('전체를 나눈 분모');
    expect(definitions).toEqual([{ conceptKey: 'term.denominator', surface: '분모' }]);
    // What was written is exactly what the renderer will find.
    expect(locateTerms(text, definitions).issues).toEqual([]);
    expect(text.slice(locateTerms(text, definitions).spans[0].start)).toBe('분모');
  });

  it('records which mention was meant when the word repeats', () => {
    const typed = '분모와 분모 사이, @분';
    const { text, definitions } = linkDefinition(typed, { from: typed.indexOf('@'), query: '분' }, shared, []);
    expect(text).toBe('분모와 분모 사이, 분모');
    expect(definitions[0]).toMatchObject({ occurrence: 3 });
    expect(locateTerms(text, definitions).spans[0].start).toBe(text.lastIndexOf('분모'));
  });

  it('carries the scope of the definition that was chosen', () => {
    const { definitions } = linkDefinition('@분', { from: 0, query: '분' }, mine, []);
    expect(definitions[0]).toEqual({ conceptKey: 'term.denominator', surface: '분모', scopeKind: 'lesson', scopeKey: 'fraction-meaning' });
  });

  it('moves an existing link rather than adding a second one the validator would reject', () => {
    const existing: DefinitionLink[] = [{ conceptKey: 'term.denominator', surface: '분모' }];
    const typed = '분모를 다시 씁니다. @분';
    const { text, definitions } = linkDefinition(typed, { from: typed.indexOf('@'), query: '분' }, shared, existing);
    expect(definitions).toHaveLength(1);
    expect(definitions[0]).toMatchObject({ occurrence: 2 });
    expect(locateTerms(text, definitions).issues).toEqual([]);
    // A definition kept by the lesson is a different definition, so it links alongside the shared one.
    const both = linkDefinition(text, { from: text.length, query: '' }, mine, definitions);
    expect(both.definitions).toHaveLength(2);
  });
});
