// @vitest-environment jsdom
import { useState } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen } from './render';
import { MathAnswerField } from '@/features/learning/math-answer-field';
import { answerLatex } from '@/shared/answer';

function Field({ integerOnly = false, fractionRequired = false, onSend, initial = '' }: {
  integerOnly?: boolean; fractionRequired?: boolean; onSend?: () => void; initial?: string;
}) {
  const [value, setValue] = useState(initial);
  return <MathAnswerField label="나의 답" placeholder="예: 3/4" value={value} onChange={setValue} integerOnly={integerOnly}
    fractionRequired={fractionRequired} onSend={onSend} sendLabel="답안 저장" sendDisabled={!value.trim()} />;
}
const box = () => screen.getByRole('textbox', { name: '나의 답' }) as HTMLInputElement;
const button = (name: string) => screen.getByRole('button', { name });
function touch() {
  const original = window.matchMedia;
  vi.spyOn(window, 'matchMedia').mockImplementation(query => ({ ...original(query), matches: query === '(any-pointer: coarse)' }));
}
const open = () => { fireEvent.focus(box()); fireEvent.click(button('수식 키보드 열기')); };
afterEach(() => vi.restoreAllMocks());

describe('adaptive answer input', () => {
  it.each([true, false])('starts with a native numeric keyboard (integer: %s)', integerOnly => {
    touch();
    render(<Field integerOnly={integerOnly} />);
    fireEvent.focus(box());
    expect(box().inputMode).toBe(integerOnly ? 'numeric' : 'decimal');
    expect(screen.queryByRole('region', { name: '수식 키보드' })).toBeNull();
    expect(screen.queryByRole('button', { name: '1' })).toBeNull();
    fireEvent.click(button('음수 부호'));
    expect(box().value).toBe('-');
  });
  it('uses compact tools on desktop, including for a required fraction', () => {
    render(<Field fractionRequired />);
    fireEvent.focus(box());
    fireEvent.click(button('분수 입력'));
    expect(screen.queryByRole('region', { name: '수식 키보드' })).toBeNull();
    expect(box().value).toBe('/');
    expect(box().selectionStart).toBe(0);
    expect(screen.queryByRole('button', { name: '1' })).toBeNull();
  });
  it('keeps a selected number when making it the numerator', () => {
    render(<Field initial="12" />);
    fireEvent.focus(box());
    box().setSelectionRange(0, 2);
    fireEvent.select(box());
    fireEvent.click(button('분수 입력'));
    expect(box().value).toBe('12/');
    expect(box().selectionStart).toBe(3);
  });
  it('opens required fractions in a touch dock without a second software keyboard', () => {
    touch();
    render(<Field fractionRequired />);
    fireEvent.focus(box());
    expect(box().inputMode).toBe('none');
    expect(screen.getByRole('region', { name: '수식 키보드' }).parentElement).toBe(document.body);
    expect(document.documentElement.getAttribute('data-answer-dock')).toBe('open');
    fireEvent.click(button('입력기 닫기'));
    expect(screen.queryByRole('region', { name: '수식 키보드' })).toBeNull();
    expect(document.documentElement.hasAttribute('data-answer-dock')).toBe(false);
  });
  it('writes a fraction and replaces only the selected denominator', () => {
    touch();
    render(<Field />);
    open();
    for (const key of ['음수 부호', '3', '분수 입력', '4']) fireEvent.click(button(key));
    expect(box().value).toBe('-3/4');
    fireEvent.click(button('분모 수정'));
    fireEvent.click(button('8'));
    expect(box().value).toBe('-3/8');
    fireEvent.click(button('분자 수정'));
    fireEvent.click(button('1'));
    expect(box().value).toBe('1/8');
    fireEvent.click(button('커서 오른쪽으로'));
    fireEvent.click(button('한 글자 지우기'));
    expect(box().value).toBe('18');
  });
  it('inserts and deletes at the caret instead of always changing the end', () => {
    touch();
    render(<Field initial="123" />);
    open();
    box().setSelectionRange(1, 2);
    fireEvent.select(box());
    fireEvent.click(button('9'));
    expect(box().value).toBe('193');
    fireEvent.click(button('한 글자 지우기'));
    expect(box().value).toBe('13');
  });
  it('keeps the draft and selection when switching back to the native keyboard', () => {
    touch();
    render(<Field initial="12/34" />);
    open();
    fireEvent.click(button('분모 수정'));
    fireEvent.click(button('기본 키보드'));
    expect(box().inputMode).toBe('decimal');
    expect(box().value).toBe('12/34');
    expect([box().selectionStart, box().selectionEnd]).toEqual([3, 5]);
    expect(screen.queryByRole('region', { name: '수식 키보드' })).toBeNull();
  });
  it('gets out of the way of an attached physical keyboard', () => {
    touch();
    render(<Field fractionRequired initial="1/2" />);
    fireEvent.focus(box());
    fireEvent.keyDown(box(), { key: '3', code: 'Digit3' });
    expect(screen.queryByRole('region', { name: '수식 키보드' })).toBeNull();
    expect(box().inputMode).toBe('decimal');
    fireEvent.focus(box());
    expect(screen.queryByRole('region', { name: '수식 키보드' })).toBeNull();
    fireEvent.click(button('수식 키보드 열기'));
    expect(screen.getByRole('region', { name: '수식 키보드' })).toBeTruthy();
  });
  it('submits exactly once and closes the dock for either click or Enter', () => {
    touch();
    const submit = vi.fn();
    render(<Field onSend={submit} />);
    open();
    expect((button('답안 저장') as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(button('3'));
    expect(fireEvent.pointerDown(button('답안 저장'))).toBe(false);
    fireEvent.click(button('답안 저장'));
    expect(submit).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('region', { name: '수식 키보드' })).toBeNull();
    expect(screen.getAllByRole('button', { name: '답안 저장' })).toHaveLength(1);
    fireEvent.focus(box());
    fireEvent.keyDown(box(), { key: 'Enter' });
    expect(submit).toHaveBeenCalledTimes(2);
    expect(screen.queryByRole('region', { name: '수식 키보드' })).toBeNull();
  });
  it('closes on outside interaction or Escape and cleans up on unmount', () => {
    touch();
    const view = render(<Field />);
    open();
    fireEvent.pointerDown(document.body);
    expect(screen.queryByRole('region', { name: '수식 키보드' })).toBeNull();
    fireEvent.focus(box());
    fireEvent.keyDown(box(), { key: 'Escape' });
    expect(screen.queryByRole('region', { name: '수식 키보드' })).toBeNull();
    act(() => box().focus());
    view.unmount();
    expect(document.documentElement.hasAttribute('data-answer-dock')).toBe(false);
    expect(document.documentElement.style.getPropertyValue('--answer-dock-height')).toBe('');
  });
  it('keeps drafts as written and renders a fraction preview', () => {
    const { container } = render(<Field />);
    fireEvent.change(box(), { target: { value: '3/4' } });
    expect(container.querySelector('.math-answer-preview .katex')).not.toBeNull();
    expect(box().value).toBe('3/4');
    expect(box().getAttribute('aria-describedby')).toBe(container.querySelector('.math-answer-preview')!.id);
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
