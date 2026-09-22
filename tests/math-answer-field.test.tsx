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
function Field({ integerOnly = false, onSend }: { integerOnly?: boolean; onSend?: () => void }) {
  const [value, setValue] = useState('');
  return <MathAnswerField label="나의 답" placeholder="예: 3/4" value={value} onChange={setValue} integerOnly={integerOnly}
    onSend={onSend} sendLabel="답안 저장" sendDisabled={!value.trim()} />;
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
    // Leaving the box puts the pad away, so a page of questions is not a page of keypads.
    fireEvent.blur(box());
    expect(screen.queryByRole('group', { name: '숫자 키패드' })).toBeNull();
  });

  it('keeps the focus in the box while anything under it is pressed', () => {
    render(<Field />);
    fireEvent.focus(box());
    // A control that took the focus would count as leaving the box: the pad would come down
    // between the press and the release, and the press would never arrive. That is how the
    // switch to the system keyboard stopped working the first time.
    for (const name of ['7', '한 글자 지우기', '키보드로 쓸게요']) {
      expect(fireEvent.mouseDown(screen.getByRole('button', { name })), `${name}가 포커스를 가져간다`).toBe(false);
    }
  });

  it('sends from the pad, where a keyboard keeps its return key', () => {
    const sent = vi.fn();
    render(<Field onSend={sent} />);
    fireEvent.focus(box());
    // Nothing to send yet, so the key is there and refuses rather than sending an empty answer.
    expect((screen.getByRole('button', { name: '답안 저장' }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: '3' }));
    // The send key is under the box like every other key, so it must not take the focus either.
    expect(fireEvent.mouseDown(screen.getByRole('button', { name: '답안 저장' })), '보내는 키가 포커스를 가져간다').toBe(false);
    fireEvent.click(screen.getByRole('button', { name: '답안 저장' }));
    expect(sent).toHaveBeenCalledTimes(1);
    // And it puts the pad away, because what the marker says back stands under the box.
    expect(screen.queryByRole('group', { name: '숫자 키패드' })).toBeNull();
  });

  it('keeps to the keys where nothing is waiting to be sent', () => {
    render(<Field />);
    fireEvent.focus(box());
    expect(screen.queryByRole('button', { name: '답안 저장' })).toBeNull();
  });

  it('asks for no phone keyboard of its own while the pad is up, and gives it back on request', () => {
    render(<Field />);
    // Two keyboards at once is the thing to avoid: while the pad is up the box wants no other.
    expect(box().getAttribute('inputmode')).toBe('none');
    fireEvent.focus(box());
    fireEvent.click(screen.getByRole('button', { name: '키보드로 쓸게요' }));
    expect(screen.queryByRole('group', { name: '숫자 키패드' })).toBeNull();
    expect(box().getAttribute('inputmode')).toBe('text');
    // And it stays away until asked back, rather than returning the next time the box is touched.
    fireEvent.focus(box());
    expect(screen.queryByRole('group', { name: '숫자 키패드' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: '숫자 키패드 쓰기' }));
    expect(box().getAttribute('inputmode')).toBe('none');
    expect(screen.getByRole('group', { name: '숫자 키패드' })).toBeDefined();
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
