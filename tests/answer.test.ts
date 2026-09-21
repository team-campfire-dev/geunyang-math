import { describe, expect, it } from 'vitest';
import { answerSpec, answerText, matchMisreading, misreadingsIssue, parseAnswer } from '@/shared/answer';
import { misconceptionKeys, misconceptions } from '@/shared/misconception';
import katex from 'katex';
import { mathOptions, splitRichText } from '@/shared/rich-text';
import { gradeAnswer } from '@/core/grading';

describe('reading the answer an author wrote', () => {
  it('lets the written form decide what the question expects', () => {
    // A whole number asks for a whole number; a fraction or a decimal accepts an equivalent value.
    expect(answerSpec('3')).toEqual({ kind: 'integer', value: 3 });
    expect(answerSpec('-7')).toEqual({ kind: 'integer', value: -7 });
    expect(answerSpec('1/2')).toEqual({ kind: 'rational', numerator: 1, denominator: 2 });
    expect(answerSpec('2/4')).toEqual({ kind: 'rational', numerator: 1, denominator: 2 });
    expect(answerSpec('0.5')).toEqual({ kind: 'rational', numerator: 1, denominator: 2 });
    expect(answerSpec('3/-4')).toEqual({ kind: 'rational', numerator: -3, denominator: 4 });
  });

  it('carries a form requirement only where a form exists', () => {
    expect(answerSpec('1/2', 'reduced_fraction')).toEqual({ kind: 'rational', numerator: 1, denominator: 2, requiredForm: 'reduced_fraction' });
    // A whole number has no fraction to reduce, so the requirement is dropped rather than stored.
    expect(answerSpec('3', 'reduced_fraction')).toEqual({ kind: 'integer', value: 3 });
  });

  it('refuses what it cannot read rather than guessing', () => {
    for (const input of ['', ' ', '1/0', 'x', '1 + 1', '\\frac{1+1}{2}', '1/2/3']) {
      expect(answerSpec(input), input).toBeNull();
    }
  });

  it('writes back what it read, so opening a question shows the answer it holds', () => {
    for (const written of ['3', '-7', '1/2', '5/4']) expect(answerText(answerSpec(written)!)).toBe(written);
    // What an author typed is stored in its smallest equal form, and reads back that way.
    expect(answerText(answerSpec('2/4')!)).toBe('1/2');
  });

  it('accepts the answer its author wrote, in the forms a learner may write it', () => {
    const spec = answerSpec('2/4')!;
    for (const answer of ['1/2', '2/4', '0.5', '$\\frac{1}{2}$']) {
      expect(gradeAnswer(answer, spec).status, answer).toBe('correct');
    }
    const reduced = answerSpec('2/4', 'reduced_fraction')!;
    expect(gradeAnswer('2/4', reduced).status).toBe('incorrect');
    expect(gradeAnswer('1/2', reduced).status).toBe('correct');
    // A question written with a whole number turns down an equal fraction, which is the point of it.
    expect(gradeAnswer('6/2', answerSpec('3')!).status).toBe('invalid');
  });

  it('reads the same string the grader reads', () => {
    expect(parseAnswer('$\\frac{3}{4}$')).toMatchObject({ numerator: 3n, denominator: 4n, fraction: true, reduced: true });
    expect(parseAnswer('−3')).toMatchObject({ numerator: -3n, denominator: 1n });
  });
});

describe('naming a question\u2019s expected wrong answers', () => {
  const known = (key: string) => misconceptionKeys.includes(key);
  const sum = { kind: 'rational' as const, numerator: 5, denominator: 6 };
  const reduced = { kind: 'rational' as const, numerator: 2, denominator: 3, requiredForm: 'reduced_fraction' as const };
  const pick = { kind: 'choice' as const, options: [{ id: 'a', text: '$\\frac{2}{5}$' }, { id: 'b', text: '$\\frac{5}{6}$' }], correct: 'b' };

  it('matches a written answer by value rather than by how it was spelled', () => {
    const entries = [{ answer: '2/5', misconception: 'add-denominators' }];
    for (const written of ['2/5', '4/10', '0.4', ' 0.40 ', '\\frac{2}{5}']) {
      expect(matchMisreading(written, sum, entries), written).toBe('add-denominators');
    }
    expect(matchMisreading('5/6', sum, entries)).toBeNull();
  });

  it('matches a picked answer by the name of the option, which is the only thing that names it', () => {
    const entries = [{ answer: 'a', misconception: 'add-denominators' }];
    expect(matchMisreading('a', pick, entries)).toBe('add-denominators');
    expect(matchMisreading(' a ', pick, entries)).toBe('add-denominators');
    expect(matchMisreading('b', pick, entries)).toBeNull();
  });

  it('refuses a name on an answer that would be marked right', () => {
    // Same value, spelled differently: it would be marked correct, so naming it a mistake would
    // tell a learner who got it right that they keep getting it wrong.
    expect(misreadingsIssue(sum, [{ answer: '10/12', misconception: 'add-denominators' }], known)).toMatch(/맞는 답으로 채점될 값/);
    expect(misreadingsIssue(sum, [{ answer: '0.8333', misconception: 'add-denominators' }], known)).toBeNull();
    // A question that wants a reduced fraction marks `4/6` wrong, and that is exactly a mistake
    // worth naming — so the rule is about how the answer would be marked, not about its value.
    expect(misreadingsIssue(reduced, [{ answer: '4/6', misconception: 'stop-reducing-early' }], known)).toBeNull();
    expect(misreadingsIssue({ ...reduced, requiredForm: undefined }, [{ answer: '4/6', misconception: 'stop-reducing-early' }], known)).toMatch(/맞는 답으로 채점될 값/);
  });

  it('refuses names that could not be counted or could not be read', () => {
    expect(misreadingsIssue(sum, [{ answer: '2/5', misconception: 'not-a-real-key' }], known)).toMatch(/알려진 오개념 이름이 아니에요/);
    expect(misreadingsIssue(sum, [{ answer: '2/5', misconception: 'add-denominators' }, { answer: '0.4', misconception: 'swap-parts' }], known)).toMatch(/같은 값에 뜻이 둘/);
    expect(misreadingsIssue(sum, [{ answer: '사분의 삼', misconception: 'add-denominators' }], known)).toMatch(/답으로 읽을 수 없는/);
    expect(misreadingsIssue(pick, [{ answer: 'z', misconception: 'add-denominators' }], known)).toMatch(/보기에 없는 이름/);
    expect(misreadingsIssue(pick, [{ answer: 'b', misconception: 'add-denominators' }], known)).toMatch(/정답인 보기/);
    expect(misreadingsIssue({ kind: 'integer', value: 12 }, [{ answer: '10.5', misconception: 'add-instead-of-scale' }], known)).toMatch(/정수여야/);
  });

  it('sets the mathematics in every note, rather than showing a learner backslashes', () => {
    // The same trap the catalogue has: KaTeX does not fail loudly, it draws the source in red. A
    // note reaches a learner the moment they write the answer it names, so it is checked here.
    for (const record of misconceptions) {
      for (const piece of splitRichText(record.note)) {
        if (piece.kind !== 'math') continue;
        const drawn = katex.renderToString(piece.equation, { ...mathOptions, displayMode: piece.display });
        expect(drawn, `${record.key}: ${piece.equation}`).not.toContain('katex-error');
      }
    }
  });

  it('keeps the vocabulary a vocabulary: no repeated keys, and every one says what was done', () => {
    expect(new Set(misconceptionKeys).size).toBe(misconceptionKeys.length);
    for (const record of misconceptions) {
      expect(record.label.trim().length, record.key).toBeGreaterThan(1);
      // A label is read where mathematics cannot be drawn — a `<select>`, a title — so it is plain.
      expect(record.label, record.key).not.toContain('$');
      expect(record.note.trim().endsWith('.') || record.note.trim().endsWith('요.'), record.key).toBe(true);
    }
  });
});
