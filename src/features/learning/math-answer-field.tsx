'use client';

import { useId, useRef, useState } from 'react';
import { answerLatex } from '@/shared/answer';
import { RichText } from './content-blocks';
import { Icon } from './icons';

/**
 * The keys an answer is actually made of. Answers are whole numbers, decimals and fractions, so the
 * pad offers those and nothing else: a key that types something the marker cannot read would only
 * invite an answer that is refused.
 */
// Laid out three to a row, so 1 2 3 / 4 5 6 / 7 8 9 falls where a phone's keypad puts it.
const keys = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '-', '0', '.'] as const;
const names: Record<string, string> = { '-': '음수 부호', '.': '소수점', '/': '분수 선' };

/**
 * A box for writing a number in, with a keypad and a picture of what is in it.
 *
 * The keypad exists because the answers are fractions and negative numbers and a phone's keyboard
 * hides the page to offer them; it appears while the box is in use and goes away after. The picture
 * exists because `3/4` typed on one line and $\frac{3}{4}$ printed in the question are the same
 * answer, and a learner should be able to see that before saving.
 *
 * Writing by hand still works exactly as it did — the pad only appends and deletes, so nothing here
 * is the only way in.
 */
export function MathAnswerField({ value, onChange, disabled, label, placeholder, integerOnly }: {
  value: string; onChange: (next: string) => void; disabled?: boolean;
  label: string; placeholder: string; integerOnly?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const field = useRef<HTMLInputElement>(null);
  const previewId = useId();
  const drawn = answerLatex(value);
  // A whole number needs neither of them, and offering a fraction bar there invites a refused answer.
  const pad: string[] = integerOnly ? keys.filter((key) => key !== '.') : [...keys, '/'];
  const press = (key: string) => {
    onChange(`${value}${key}`);
    field.current?.focus();
  };
  return <div className="math-answer">
    <label>{label}<input ref={field} aria-label={label} type="text" inputMode="text" maxLength={100}
      placeholder={placeholder} value={value} disabled={disabled} autoComplete="off" spellCheck={false}
      aria-describedby={drawn ? previewId : undefined}
      onChange={(event) => onChange(event.target.value)}
      onFocus={() => setOpen(true)} /></label>
    {/* A div, not a paragraph: the renderer draws prose as a block and a block cannot sit in a <p>. */}
    {drawn && <div className="math-answer-preview" id={previewId}>
      <span className="sr-only">입력한 답: </span><RichText text={`$${drawn}$`} />
    </div>}
    {open && !disabled && <>
      {/* Three to a row, so a whole-number pad is four full rows and the digits sit where they do
          on a phone. Closing is not a key — it would take a place a digit should have. */}
      <div className="math-keypad" role="group" aria-label="숫자 키패드">
        {pad.map((key) => <button key={key} type="button" className={`math-key${key === '/' ? ' is-wide' : ''}`}
          aria-label={names[key] ?? key} disabled={disabled} onClick={() => press(key)}>{key === '/' ? '⁄' : key}</button>)}
        <button type="button" className="math-key" aria-label="한 글자 지우기" disabled={disabled || !value}
          onClick={() => { onChange(value.slice(0, -1)); field.current?.focus(); }}><Icon name="back" size={16} /></button>
      </div>
      <button type="button" className="text-button math-keypad-close" onClick={() => setOpen(false)}>키패드 닫기</button>
    </>}
  </div>;
}
