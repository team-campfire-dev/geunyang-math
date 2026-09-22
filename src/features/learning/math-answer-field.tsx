'use client';

import { useEffect, useId, useRef, useState } from 'react';
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
 * **The pad replaces the phone's keyboard rather than joining it.** Two keyboards at once would be
 * the worst of both: the system one covers the page and still has no fraction bar, and ours sits
 * behind it. So while the pad is up the box asks for no on-screen keyboard (`inputMode="none"`),
 * and a learner who would rather type says so once and gets theirs back.
 *
 * A hardware keyboard is unaffected — `inputMode` only speaks to on-screen ones — so writing by
 * hand keeps working everywhere it did, and the pad is never the only way in.
 *
 * The picture exists because `3/4` typed on one line and $\frac{3}{4}$ printed in the question are
 * the same answer, and a learner should be able to see that before saving.
 */
export function MathAnswerField({ value, onChange, disabled, label, placeholder, integerOnly, onSend, sendLabel, sendDisabled }: {
  value: string; onChange: (next: string) => void; disabled?: boolean;
  label: string; placeholder: string; integerOnly?: boolean;
  /**
   * What the pad's own send key does, where the box stands in something that takes an answer. A
   * keyboard ends with a return key for the same reason: the writing and the sending are one
   * motion, and the button below the box is behind the pad and off the bottom of a phone.
   */
  onSend?: () => void; sendLabel?: string; sendDisabled?: boolean;
}) {
  const [writing, setWriting] = useState<'pad' | 'keyboard'>('pad');
  const [inUse, setInUse] = useState(false);
  const field = useRef<HTMLInputElement>(null);
  const pane = useRef<HTMLDivElement>(null);
  const previewId = useId();
  const drawn = answerLatex(value);
  const usingPad = writing === 'pad' && !disabled;
  const showPad = usingPad && inUse;
  // A whole number needs neither of them, and offering a fraction bar there invites a refused answer.
  const pad: string[] = integerOnly ? keys.filter((key) => key !== '.') : [...keys, '/'];
  /**
   * Nothing under the box may take the focus. A control that did would count as leaving the box,
   * and the pad would unmount between the press and the release — so the press would never arrive.
   * Held once around the whole pad, so a control added later cannot forget it.
   */
  const hold = (event: { preventDefault: () => void }) => event.preventDefault();
  /**
   * The pad comes up under a box the browser has just scrolled to, so on a short screen its last
   * row — the one that sends — can open below the fold. `nearest` moves the page by as little as
   * it takes to show the whole pad, and by nothing at all when it already shows.
   */
  useEffect(() => { if (showPad) pane.current?.scrollIntoView({ block: 'nearest' }); }, [showPad]);
  return <div className="math-answer">
    {/* The question asks for the answer and the box stands right under it, so the caption is kept
        for readers who meet the box without seeing where it stands. */}
    <label><span className="sr-only">{label}</span><input ref={field} aria-label={label} type="text" maxLength={100}
      // While the pad is up this box wants no keyboard of the phone's own.
      inputMode={usingPad ? 'none' : 'text'}
      placeholder={placeholder} value={value} disabled={disabled} autoComplete="off" spellCheck={false}
      aria-describedby={drawn ? previewId : undefined}
      onChange={(event) => onChange(event.target.value)}
      onFocus={() => setInUse(true)} onBlur={() => setInUse(false)} /></label>
    {/* A div, not a paragraph: the renderer draws prose as a block and a block cannot sit in a <p>. */}
    {drawn && <div className="math-answer-preview" id={previewId}>
      <span className="sr-only">입력한 답: </span><RichText text={`$${drawn}$`} />
    </div>}
    {showPad && <div className="math-pad" ref={pane} onPointerDown={hold} onMouseDown={hold}>
      {/* Three to a row, so a whole-number pad is four full rows and the digits sit where they do
          on a phone. Switching is not a key — it would take a place a digit should have. */}
      <div className="math-keypad" role="group" aria-label="숫자 키패드">
        {pad.map((key) => <button key={key} type="button" className={`math-key${key === '/' ? ' is-wide' : ''}`}
          aria-label={names[key] ?? key} onClick={() => onChange(`${value}${key}`)}>{key === '/' ? '⁄' : key}</button>)}
        <button type="button" className="math-key" aria-label="한 글자 지우기" disabled={!value}
          onClick={() => onChange(value.slice(0, -1))}><Icon name="back" size={16} /></button>
      </div>
      {/* Sending puts the pad away: what the marker says back stands under the box, and a pad still
          up would hold it below the fold on the screen this pad exists for. */}
      {onSend && <button type="button" className="math-pad-send" disabled={sendDisabled}
        onClick={() => { setInUse(false); field.current?.blur(); onSend(); }}>{sendLabel ?? '답안 저장'}</button>}
      <button type="button" className="text-button math-keypad-switch"
        onClick={() => { setWriting('keyboard'); setInUse(false); field.current?.blur(); }}>
        키보드로 쓸게요
      </button>
    </div>}
    {!usingPad && !disabled && <button type="button" className="text-button math-keypad-switch"
      onClick={() => { setWriting('pad'); field.current?.focus(); }}>숫자 키패드 쓰기</button>}
  </div>;
}
