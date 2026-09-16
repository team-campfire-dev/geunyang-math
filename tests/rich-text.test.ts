import { describe, expect, it } from 'vitest';
import { locateTerms, occurrenceAt, splitRichText } from '@/shared/rich-text';

const place = (text: string, definitions: Parameters<typeof locateTerms>[1]) => locateTerms(text, definitions);
const marked = (text: string, definitions: Parameters<typeof locateTerms>[1]) =>
  place(text, definitions).spans.map(span => `${span.conceptKey}:${text.slice(span.start, span.end)}`);

describe('rich text segmentation', () => {
  it('separates prose from inline and display math', () => {
    const segments = splitRichText('앞 $a+b$ 중간 $$x^2$$ 뒤 \\(c\\)');
    expect(segments.map(s => s.kind)).toEqual(['text', 'math', 'text', 'math', 'text', 'math']);
    expect(segments.filter(s => s.kind === 'math').map(s => [s.equation, s.display]))
      .toEqual([['a+b', false], ['x^2', true], ['c', false]]);
  });
  it('keeps offsets aligned with the original text', () => {
    const text = '분모가 같으면 $1/5 + 2/5$ 처럼 더해요.';
    for (const segment of splitRichText(text)) expect(text.slice(segment.start, segment.start + segment.value.length)).toBe(segment.value);
  });
});

describe('definition placement', () => {
  const text = '분모가 같으면 조각 크기가 같아요. 분모가 다르면 통분해요. 분모를 맞추면 끝이에요.';
  it('marks the first occurrence by default and a chosen occurrence on request', () => {
    expect(marked(text, [{ conceptKey: 'term.denominator', surface: '분모' }])).toEqual(['term.denominator:분모']);
    const third = place(text, [{ conceptKey: 'term.denominator', surface: '분모', occurrence: 3 }]);
    expect(third.issues).toEqual([]);
    expect(third.spans[0].start).toBe(text.lastIndexOf('분모'));
  });
  it('matches a surface that a Korean particle follows', () => {
    const span = place('분모를 같게 만들어요.', [{ conceptKey: 'term.denominator', surface: '분모' }]).spans[0];
    expect(span).toMatchObject({ start: 0, end: 2 });
  });
  it('never matches inside math and does not count math occurrences', () => {
    const formula = '$분모 + 1$ 뒤의 분모만 표시해요.';
    const result = place(formula, [{ conceptKey: 'term.denominator', surface: '분모' }]);
    expect(result.issues).toEqual([]);
    expect(result.spans[0].start).toBe(formula.lastIndexOf('분모'));
    expect(place('$분모$', [{ conceptKey: 'term.denominator', surface: '분모' }]).issues).toHaveLength(1);
  });
  it('reports a missing occurrence instead of guessing', () => {
    expect(place(text, [{ conceptKey: 'term.denominator', surface: '분모', occurrence: 4 }]).issues).toHaveLength(1);
    expect(place(text, [{ conceptKey: 'term.reduce', surface: '약분' }]).issues).toHaveLength(1);
  });
  it('rejects overlapping spans and a definition annotated twice', () => {
    expect(place('동치분수로 바꿔요.', [{ conceptKey: 'term.equivalent', surface: '동치분수' }, { conceptKey: 'term.fraction', surface: '분수' }]).issues)
      .toEqual([expect.stringContaining('Overlapping')]);
    expect(place(text, [{ conceptKey: 'term.denominator', surface: '분모' }, { conceptKey: 'term.denominator', surface: '분모', occurrence: 2 }]).issues)
      .toEqual([expect.stringContaining('twice')]);
  });
  it('orders spans by position for rendering', () => {
    const spans = place('통분한 뒤 분자를 더해요.', [{ conceptKey: 'term.numerator', surface: '분자' }, { conceptKey: 'term.common', surface: '통분' }]).spans;
    expect(spans.map(s => s.conceptKey)).toEqual(['term.common', 'term.numerator']);
  });
});

describe('which mention the author meant', () => {
  it('counts mentions the way the renderer resolves them', () => {
    const text = '분모는 전체를 나눈 수예요. 분모가 4면 네 조각이에요.';
    expect(occurrenceAt(text, '분모', 0)).toBe(1);
    expect(occurrenceAt(text, '분모', text.indexOf('분모', 3))).toBe(2);
    // Past the last mention the next one would be the next ordinal.
    expect(occurrenceAt(text, '분모', text.length)).toBe(3);
  });

  it('ignores a word inside a formula, so numbering matches what the reader sees', () => {
    const text = '$분모$가 아니라 분모를 봅니다.';
    expect(occurrenceAt(text, '분모', text.lastIndexOf('분모'))).toBe(1);
    expect(locateTerms(text, [{ conceptKey: 'term.denominator', surface: '분모' }]).spans[0].start).toBe(text.lastIndexOf('분모'));
  });

  it('agrees with locateTerms on a repeated word', () => {
    const text = '분모와 분모와 분모';
    const position = text.indexOf('분모', text.indexOf('분모') + 1);
    const occurrence = occurrenceAt(text, '분모', position);
    expect(occurrence).toBe(2);
    expect(locateTerms(text, [{ conceptKey: 'term.denominator', surface: '분모', occurrence }]).spans[0].start).toBe(position);
  });
});
