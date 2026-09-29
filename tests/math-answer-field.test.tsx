// @vitest-environment jsdom
import { useState } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen } from './render';
import { MathAnswerField } from '@/features/learning/math-answer-field';
import { ProblemCard } from '@/features/learning/problem-card';
import { answerLatex } from '@/shared/answer';
import { gradeAnswer } from '@/core/grading';

function Field({ onSend, initial = '' }: { onSend?: () => void; initial?: string }) {
  const [value, setValue] = useState(initial);
  return <MathAnswerField label="나의 답" placeholder="답 또는 수식" value={value} onChange={setValue}
    onSend={onSend} sendLabel="답안 저장" sendDisabled={!value.trim()} />;
}
const box = () => screen.getByRole('textbox', { name: '나의 답' }) as HTMLInputElement;
const button = (name: string | RegExp) => screen.getByRole('button', { name });
function touch() {
  const original = window.matchMedia;
  vi.spyOn(window, 'matchMedia').mockImplementation(query => ({ ...original(query), matches: query === '(any-pointer: coarse)' }));
}
const open = () => fireEvent.focus(box());
const tap = (name: string | RegExp) => fireEvent.click(button(name));
beforeEach(() => sessionStorage.clear());
afterEach(() => vi.restoreAllMocks());

describe('one structured math input for every question', () => {
  it.each(['integer', 'rational', 'expression'] as const)('shows the same touch tools for %s answers', kind => {
    touch();
    render(<ProblemCard problem={{ problemVersionId: 'p1', conceptKeys: [], promptContent: [], responseSpec: { kind }, hintAvailable: false, solutionAvailable: false }}
      actions={{ submit: vi.fn(), openHint: vi.fn() }} busy={false} />);
    open();
    expect(box().inputMode).toBe('none');
    for (const key of ['분수 입력', '거듭제곱 입력', '제곱근 입력', '괄호 입력', '소수점', '음수 부호']) expect(button(key)).toBeTruthy();
    expect(screen.getByRole('region', { name: '수식 키보드' })).toBeTruthy();
  });
  it('offers all structures without a number pad on desktop', () => {
    render(<Field />); open();
    expect(screen.queryByRole('region', { name: '수식 키보드' })).toBeNull();
    for (const name of ['분수 입력', '거듭제곱 입력', '제곱근 입력', '괄호 입력']) expect(button(name)).toBeTruthy();
    expect(screen.queryByRole('button', { name: '1' })).toBeNull();
  });
  it('fills numerator and denominator boxes and submits the written fraction without reducing it', () => {
    touch(); render(<Field />); open(); tap('분수 입력');
    expect(button(/분자: 빈 칸/).getAttribute('aria-pressed')).toBe('true');
    tap(/분모: 빈 칸/); tap('2'); tap('4');
    tap(/분자: 빈 칸/); tap('1'); tap('2');
    expect(box().value).toBe('(12)/(24)');
    tap(/분모: 24/); tap('3'); tap('6');
    expect(box().value).toBe('(12)/(36)');
    expect(gradeAnswer(box().value, { kind: 'rational', numerator: 1, denominator: 3, requiredForm: 'reduced_fraction' }).status).toBe('incorrect');
    tap(/분자: 12/); tap('1'); tap(/분모: 36/); tap('3');
    expect(gradeAnswer(box().value, { kind: 'rational', numerator: 1, denominator: 3, requiredForm: 'reduced_fraction' }).status).toBe('correct');
  });
  it('edits a power base and exponent independently', () => {
    touch(); render(<Field />); open(); tap('거듭제곱 입력');
    tap(/밑 괄호 안: 빈 칸/); tap('2');
    tap(/지수: 빈 칸/); tap('3');
    expect(box().value).toBe('(2)^(3)');
    tap(/지수: 3/); tap('4');
    expect(box().value).toBe('(2)^(4)');
    expect(gradeAnswer(box().value, { kind: 'expression', expression: '16' }).status).toBe('correct');
  });
  it('nests a root inside a fraction and edits its radicand directly', () => {
    touch(); render(<Field />); open(); tap('분수 입력'); tap('제곱근 입력');
    tap(/분자 근호 안: 빈 칸/); tap('8');
    tap(/분모: 빈 칸/); tap('2');
    expect(box().value).toBe('(sqrt(8))/(2)');
    expect(gradeAnswer(box().value, { kind: 'expression', expression: 'sqrt(2)' }).status).toBe('correct');
    tap(/분자 근호 안: 8/); tap('1'); tap('8');
    expect(box().value).toBe('(sqrt(18))/(2)');
  });
  it('keeps parentheses editable and observes operation precedence', () => {
    touch(); render(<Field />); open(); tap('괄호 입력'); tap('2'); tap('더하기'); tap('3');
    expect(box().value).toBe('(2+3)');
    tap(/괄호 안: 3/); tap('4');
    expect(box().value).toBe('(2+4)');
    expect(gradeAnswer(box().value, { kind: 'expression', expression: '6' }).status).toBe('correct');
  });
  it('keeps a typed base when turning it into a power', () => {
    render(<Field initial="12" />); open(); box().setSelectionRange(0, 2); fireEvent.select(box()); tap('거듭제곱 입력');
    expect(box().value).toBe('(12)^(□)');
    expect(box().value.slice(box().selectionStart!, box().selectionEnd!)).toBe('□');
  });
  it('leaves the final structure to continue arithmetic without destroying its brackets', () => {
    touch(); render(<Field />); open(); tap('제곱근 입력'); tap('9'); tap('커서 오른쪽으로');
    expect(box().selectionStart).toBe('sqrt(9)'.length);
    tap('한 글자 지우기'); expect(box().value).toBe('sqrt(9)');
    tap('커서 오른쪽으로'); tap('커서 오른쪽으로'); tap('더하기'); tap('3');
    expect(box().value).toBe('sqrt(9)+3');
    expect(gradeAnswer(box().value, { kind: 'expression', expression: '6' }).status).toBe('correct');
  });
  it('does not delete a structure boundary when a slot is empty', () => {
    touch(); render(<Field initial="(3)/(4)" />); open(); tap(/분모: 4/); tap('한 글자 지우기');
    expect(box().value).toBe('(3)/()');
    tap('한 글자 지우기'); expect(box().value).toBe('(3)/()');
    expect(button(/분자: 3/).getAttribute('aria-pressed')).toBe('true');
  });
  it('remembers an explicit native keyboard choice across questions', () => {
    touch(); const view = render(<Field />); open(); tap('기본 키보드');
    expect(box().inputMode).toBe('text');
    view.unmount(); render(<Field initial="sqrt(2)" />); open();
    expect(screen.queryByRole('region', { name: '수식 키보드' })).toBeNull();
    tap('수식 키보드 열기'); expect(screen.getByRole('region', { name: '수식 키보드' })).toBeTruthy();
  });
  it('gets out of the way of a hardware keyboard and keeps the draft', () => {
    touch(); render(<Field initial="sqrt(2)" />); open();
    fireEvent.keyDown(box(), { key: '3' });
    expect(screen.queryByRole('region', { name: '수식 키보드' })).toBeNull();
    expect(box().value).toBe('sqrt(2)');
  });
  it('sends once and closes the dock with either click or Enter', () => {
    touch(); const submit = vi.fn(); render(<Field onSend={submit} />); open();
    expect((button('답안 저장') as HTMLButtonElement).disabled).toBe(true);
    tap('3'); expect(fireEvent.pointerDown(button('답안 저장'))).toBe(false); tap('답안 저장');
    expect(submit).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('region', { name: '수식 키보드' })).toBeNull();
    expect(screen.getAllByRole('button', { name: '답안 저장' })).toHaveLength(1);
    open(); fireEvent.keyDown(box(), { key: 'Enter' }); expect(submit).toHaveBeenCalledTimes(2);
  });
  it('cleans up on outside interaction, Escape, or unmount', () => {
    touch(); const view = render(<Field />); open(); fireEvent.pointerDown(document.body);
    expect(screen.queryByRole('region', { name: '수식 키보드' })).toBeNull();
    open(); fireEvent.keyDown(box(), { key: 'Escape' });
    expect(screen.queryByRole('region', { name: '수식 키보드' })).toBeNull();
    act(() => box().focus()); view.unmount();
    expect(document.documentElement.hasAttribute('data-answer-dock')).toBe(false);
  });
});

describe('an answer as TeX', () => {
  it('renders supported numeric expressions without changing their value', () => {
    expect(answerLatex('3/4')).toBe('\\frac{3}{4}');
    expect(answerLatex('(3)/(4)')).toBe('\\frac{3}{4}');
    expect(answerLatex('-1/2')).toBe('-\\frac{1}{2}');
    expect(answerLatex('sqrt(2)')).toBe('\\sqrt{2}');
    expect(answerLatex('2^3')).toBe('{2}^{3}');
    for (const written of ['', '3/', 'abc', '3/0', '--2']) expect(answerLatex(written), written).toBeNull();
  });
});
