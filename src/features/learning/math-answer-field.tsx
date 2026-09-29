'use client';

import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import { createPortal, flushSync } from 'react-dom';
import { answerLatex } from '@/shared/answer';
import { fractionSelection, replaceAnswerSelection, type AnswerSelection } from './answer-editing';
import { RichText } from './content-blocks';
import { FractionAnswerSlots } from './fraction-answer-slots';
import { useAnswerDock, useTouchAnswerInput } from './use-answer-dock';

const names: Record<string, string> = { '-': '음수 부호', '.': '소수점', '/': '분수 입력' };

/** Native numeric input first. Fractions get a dock on touch devices and small tools on desktop.
 * Only offer syntax accepted by the response contract: powers and roots need a new grading kind.
 */
export function MathAnswerField({ value, onChange, disabled, label, placeholder, integerOnly, fractionRequired, onSend, sendLabel, sendDisabled }: {
  value: string; onChange: (next: string) => void; disabled?: boolean;
  label: string; placeholder: string; integerOnly?: boolean; fractionRequired?: boolean;
  /** Owns the only submit control, whether it lives in the dock or beside the field. */
  onSend?: () => void; sendLabel?: string; sendDisabled?: boolean;
}) {
  const [touch, setTouch] = useTouchAnswerInput();
  const [writing, setWriting] = useState<'auto' | 'native' | 'math'>('auto');
  const [inUse, setInUse] = useState(false);
  const field = useRef<HTMLInputElement>(null);
  const container = useRef<HTMLDivElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const selection = useRef<AnswerSelection>({ start: value.length, end: value.length });
  const [visibleSelection, setVisibleSelection] = useState(selection.current);
  const pendingSelection = useRef<AnswerSelection | null>(null);
  const previewId = useId();
  const panelId = useId();
  const usingMath = touch && (writing === 'math' || (writing === 'auto' && !!fractionRequired));
  const showDock = usingMath && inUse && !disabled;
  const drawn = answerLatex(value);
  const hasFractionSlots = !integerOnly && /^\s*[+-]?\d*\s*\/\s*[+-]?\d*\s*$/.test(value);
  const hold = (event: { preventDefault: () => void }) => event.preventDefault();
  const updateSelection = (range: AnswerSelection) => {
    selection.current = range;
    setVisibleSelection(previous => previous.start === range.start && previous.end === range.end ? previous : range);
  };
  const remember = () => {
    if (field.current) updateSelection({ start: field.current.selectionStart ?? value.length, end: field.current.selectionEnd ?? value.length });
  };
  const select = (range: AnswerSelection) => {
    field.current?.focus({ preventScroll: true });
    field.current?.setSelectionRange(range.start, range.end);
    updateSelection(range);
  };
  const edit = (inserted: string, remove = false) => {
    const range = selection.current;
    // At the start of the denominator, go back to the numerator without removing the bar.
    if (remove && hasFractionSlots && range.start === range.end && value[range.start - 1] === '/') {
      select({ start: range.start - 1, end: range.start - 1 });
      return;
    }
    const result = replaceAnswerSelection(value, remove && range.start === range.end ? { start: Math.max(0, range.start - 1), end: range.end } : range, inserted);
    pendingSelection.current = result.value === value ? null : { start: result.start, end: result.end };
    onChange(result.value);
    select({ start: result.start, end: result.end });
  };
  useLayoutEffect(() => {
    if (pendingSelection.current) { select(pendingSelection.current); pendingSelection.current = null; }
  }, [value]);
  useAnswerDock(showDock, panel, field);
  useEffect(() => {
    if (!showDock) return;
    const dismissOutside = (event: PointerEvent) => {
      if (!container.current?.contains(event.target as Node) && !panel.current?.contains(event.target as Node)) setInUse(false);
    };
    document.addEventListener('pointerdown', dismissOutside);
    return () => document.removeEventListener('pointerdown', dismissOutside);
  }, [showDock]);
  const switchWriting = (next: 'native' | 'math') => {
    remember();
    // Commit inputMode before refocusing: Safari decides which keyboard to open at focus time.
    field.current?.blur();
    flushSync(() => { setWriting(next); setInUse(true); });
    select(selection.current);
  };
  const fraction = () => {
    if (touch && !usingMath) switchWriting('math');
    const denominator = fractionSelection(value, 'denominator');
    if (denominator) select(denominator);
    else if (!value) {
      pendingSelection.current = { start: 0, end: 0 };
      onChange('/');
      select(pendingSelection.current);
    } else {
      // Turning a selected number into a fraction keeps it as the numerator.
      selection.current = { start: selection.current.end, end: selection.current.end };
      edit('/');
    }
  };
  const close = () => { setInUse(false); field.current?.blur(); };
  const send = () => { close(); if (!disabled && !sendDisabled) onSend?.(); };
  const fractionSlots = hasFractionSlots && <FractionAnswerSlots value={value} selection={visibleSelection}
    active={inUse && !disabled} disabled={disabled} onSelect={part => {
      if (touch && !usingMath) switchWriting('math');
      select(fractionSelection(value, part)!);
    }} />;
  const dock = showDock && <div ref={panel} id={panelId} className="math-dock" role="region" aria-label="수식 키보드"
    onBlur={event => { if (!panel.current?.contains(event.relatedTarget) && event.relatedTarget !== field.current) setInUse(false); }}
    onPointerDown={hold} onMouseDown={hold} onKeyDown={event => { if (event.key === 'Escape') { event.preventDefault(); close(); } }}>
    <div className="math-dock-inner">
      <div className="math-dock-heading"><span>수식 입력</span><div>
        <button type="button" onClick={() => switchWriting('native')}>기본 키보드</button>
        <button type="button" onClick={close}>입력기 닫기</button>
      </div></div>
      <div className="math-dock-draft"><span className="sr-only">입력한 답: {value || '비어 있음'}</span>
        {fractionSlots || (drawn ? <RichText text={`$${drawn}$`} /> : <span>{value || '답을 입력해 주세요'}</span>)}</div>
      <div className="math-keypad" role="group" aria-label="숫자 키패드">
        {['1', '2', '3', 'back', '4', '5', '6', '-', '7', '8', '9', '/', 'left', '0', 'right', '.'].map(key => {
          if (integerOnly && (key === '/' || key === '.')) return <span key={key} />;
          const movement = key === 'left' || key === 'right';
          const name = key === 'back' ? '한 글자 지우기' : movement ? (key === 'left' ? '커서 왼쪽으로' : '커서 오른쪽으로') : names[key] ?? key;
          return <button key={key} type="button" className="math-key" aria-label={name} disabled={key === 'back' && !value}
            onClick={() => {
              if (key === 'back') edit('', true);
              else if (movement) {
                const { start, end } = selection.current;
                const step = start === end ? 1 : 0;
                const point = Math.max(0, Math.min(value.length, key === 'left' ? start - step : end + step));
                select({ start: point, end: point });
              }
              else if (key === '/') fraction();
              else edit(key);
            }}>{key === 'back' ? '⌫' : key === 'left' ? '←' : key === 'right' ? '→' : key === '/' ? 'a/b' : key}</button>;
        })}
      </div>
      {onSend && <button type="button" className="math-pad-send" disabled={sendDisabled} onClick={send}>{sendLabel ?? '답안 저장'}</button>}
    </div>
  </div>;
  return <><div className="math-answer" ref={container}>
    <label><span className="sr-only">{label}</span><input ref={field} aria-label={label} type="text" maxLength={80}
      inputMode={usingMath ? 'none' : integerOnly ? 'numeric' : 'decimal'} enterKeyHint="done"
      placeholder={placeholder} value={value} disabled={disabled} autoComplete="off" spellCheck={false}
      aria-describedby={!showDock && (drawn || fractionSlots) ? previewId : undefined} aria-controls={showDock ? panelId : undefined}
      onPointerDown={event => { if (event.pointerType === 'touch' || event.pointerType === 'pen') setTouch(true); else if (event.pointerType === 'mouse') setTouch(false); }}
      onSelect={remember} onChange={event => { onChange(event.target.value); remember(); }}
      onFocus={() => setInUse(true)} onBlur={event => { if (!panel.current?.contains(event.relatedTarget)) setInUse(false); }}
      onKeyDown={event => {
        if (event.key === 'Escape') { close(); return; }
        if (event.key === 'Enter' && !event.nativeEvent.isComposing && onSend) { event.preventDefault(); send(); return; }
        // With the software keyboard suppressed, a printable key came from a physical keyboard.
        if (usingMath && (event.key.length === 1 || event.key === 'Backspace' || event.key === 'Delete')) setWriting('native');
      }} /></label>
    {!showDock && (drawn || fractionSlots) && <div className="math-answer-preview" id={previewId} onPointerDown={hold} onMouseDown={hold}><span className="sr-only">입력한 답: </span>{fractionSlots || <RichText text={`$${drawn}$`} />}</div>}
    {!disabled && !showDock && <div className="math-input-tools" onPointerDown={hold} onMouseDown={hold}>
      {/* Some native numeric keyboards omit minus, so it must remain available outside them. */}
      <button type="button" aria-label="음수 부호" onClick={() => edit('-')}>−</button>
      {!integerOnly && <button type="button" aria-label="분수 입력" onClick={fraction}>분수 a/b</button>}
      {touch && !integerOnly && <button type="button" className="text-button" onClick={() => switchWriting('math')}>수식 키보드 열기</button>}
    </div>}
  </div>
    {onSend && !showDock && <button type="button" className="button primary" onPointerDown={hold} onMouseDown={hold}
      disabled={disabled || sendDisabled} onClick={send}>{sendLabel ?? '답안 저장'}</button>}
    {dock && createPortal(dock, document.body)}
  </>;
}
