// @vitest-environment jsdom
import { useState } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from './render';
import { MathAnswerField } from '@/features/learning/math-answer-field';
import { answerLatex } from '@/shared/answer';

/**
 * Writing a number on a phone. The answers are fractions and negative numbers, and a phone's
 * keyboard hides the page to offer either — so the page offers them itself, and shows back what it
 * understood before anything is saved.
 */
function Field({ integerOnly = false }: { integerOnly?: boolean }) {
  const [value, setValue] = useState('');
  return <MathAnswerField label="나의 답" placeholder="예: 3/4" value={value} onChange={setValue} integerOnly={integerOnly} />;
}
const box = () => screen.getByLabelText('나의 답') as HTMLInputElement;

/**
 * React reports invalid markup — a block drawn inside a paragraph, say — through console.error, and
 * says nothing else there. Watching it is how a rendering mistake fails a test rather than shipping.
 */
let complaints: unknown[][] = [];
beforeEach(() => { complaints = []; vi.spyOn(console, 'error').mockImplementation((...args) => { complaints.push(args); }); });
afterEach(() => { vi.restoreAllMocks(); expect(complaints.map(String), '렌더러가 경고를 남겼다').toEqual([]); });

describe('writing a number', () => {
  it('stays a box somebody can type into, pad or no pad', () => {
    render(<Field />);
    // The pad is an offer, not the way in: nothing is disabled and nothing has to be tapped first.
    expect(screen.queryByRole('group', { name: '숫자 키패드' })).toBeNull();
    fireEvent.change(box(), { target: { value: '\\frac{3}{4}' } });
    expect(box().value).toBe('\\frac{3}{4}');
  });

  it('offers the keys a phone keyboard hides, and only while the box is in use', () => {
    render(<Field />);
    fireEvent.focus(box());
    const pad = screen.getByRole('group', { name: '숫자 키패드' });
    for (const name of ['1', '음수 부호', '소수점', '분수 선', '한 글자 지우기']) {
      expect(screen.getByRole('button', { name }), name).toBeDefined();
    }
    fireEvent.click(screen.getByRole('button', { name: '음수 부호' }));
    fireEvent.click(screen.getByRole('button', { name: '3' }));
    fireEvent.click(screen.getByRole('button', { name: '분수 선' }));
    fireEvent.click(screen.getByRole('button', { name: '4' }));
    expect(box().value).toBe('-3/4');
    fireEvent.click(screen.getByRole('button', { name: '한 글자 지우기' }));
    expect(box().value).toBe('-3/');
    fireEvent.click(screen.getByRole('button', { name: '키패드 닫기' }));
    expect(pad.isConnected).toBe(false);
  });

  it('does not offer a fraction bar where only a whole number is accepted', () => {
    render(<Field integerOnly />);
    fireEvent.focus(box());
    expect(screen.queryByRole('button', { name: '분수 선' })).toBeNull();
    expect(screen.queryByRole('button', { name: '소수점' })).toBeNull();
    expect(screen.getByRole('button', { name: '음수 부호' })).toBeDefined();
  });

  it('shows back what it understood, and nothing while it understands nothing', () => {
    const { container } = render(<Field />);
    fireEvent.change(box(), { target: { value: '3/' } });
    expect(container.querySelector('.math-answer-preview'), '반쯤 쓴 답에 그림을 붙인다').toBeNull();
    fireEvent.change(box(), { target: { value: '3/4' } });
    const preview = container.querySelector('.math-answer-preview')!;
    expect(preview.querySelector('.katex'), '분수를 수식으로 그리지 않는다').not.toBeNull();
    // What is drawn is the same answer, printed: the box keeps the writing, the picture shows it.
    expect(box().value).toBe('3/4');
    expect(box().getAttribute('aria-describedby')).toBe(preview.id);
  });
});

describe('an answer as TeX', () => {
  it('prints a written answer the way a question prints one', () => {
    expect(answerLatex('3/4')).toBe('\\frac{3}{4}');
    // The sign belongs in front of the fraction, where it is read.
    expect(answerLatex('-1/2')).toBe('-\\frac{1}{2}');
    expect(answerLatex('0.75')).toBe('0.75');
    expect(answerLatex('$3/4$')).toBe('\\frac{3}{4}');
    expect(answerLatex('\\frac{3}{4}')).toBe('\\frac{3}{4}');
    // Nothing to print is not the same as something wrong to print.
    for (const written of ['', '3/', 'abc', '3/0', '--2']) expect(answerLatex(written), written).toBeNull();
  });
});
