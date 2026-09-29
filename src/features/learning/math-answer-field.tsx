'use client';

import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import { createPortal, flushSync } from 'react-dom';
import { answerLatex } from '@/shared/answer';
import { insertMathStructure, mathSlots, replaceAnswerSelection, type AnswerSelection } from './answer-editing';
import { RichText } from './content-blocks';
import { MathExpressionSlots } from './math-expression-slots';
import { parseMathExpression } from '@/shared/math-expression';
import { useAnswerDock, useTouchAnswerInput } from './use-answer-dock';

const names: Record<string, string> = { '-': '음수 부호', '.': '소수점', '/': '나누기', '*': '곱하기', '+': '더하기' };

/** One math keyboard for every written answer, with a touch dock and compact desktop tools.
 * Every written-answer question offers the same tools; grading enforces any required form.
 */
export function MathAnswerField({ value, onChange, disabled, label, placeholder, onSend, sendLabel, sendDisabled }: {
  value: string; onChange: (next: string) => void; disabled?: boolean;
  label: string; placeholder: string;
  /** Owns the only submit control, whether it lives in the dock or beside the field. */
  onSend?: () => void; sendLabel?: string; sendDisabled?: boolean;
}) {
  const [touch, setTouch] = useTouchAnswerInput();
  const [writing, setWriting] = useState<'native' | 'math'>('math');
  const [inUse, setInUse] = useState(false);
  const field = useRef<HTMLInputElement>(null);
  const container = useRef<HTMLDivElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const selection = useRef<AnswerSelection>({ start: value.length, end: value.length });
  const [visibleSelection, setVisibleSelection] = useState(selection.current);
  const pendingSelection = useRef<AnswerSelection | null>(null);
  const previewId = useId();
  const panelId = useId();
  const usingMath = touch && writing === 'math';
  const showDock = usingMath && inUse && !disabled;
  const drawn = answerLatex(value);
  const expression = parseMathExpression(value, true);
  const slots = expression ? mathSlots(expression) : [];
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
    if (remove && range.start === range.end) {
      const at = slots.findIndex(node => range.start === node.start);
      if (at >= 0) { if (at > 0) select(slots[at - 1]); return; }
      if (expression && value[range.start - 1] === ')') {
        const previous = [...slots].reverse().find(node => node.end < range.start);
        if (previous) select(previous);
        return;
      }
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
  useEffect(() => {
    const restore = () => { try { const saved = sessionStorage.getItem('answer-input-mode'); if (saved === 'math' || saved === 'native') setWriting(saved); } catch { /* Storage is optional. */ } };
    restore(); window.addEventListener('answer-input-mode', restore);
    return () => window.removeEventListener('answer-input-mode', restore);
  }, []);
  const prefer = (next: 'native' | 'math') => {
    setWriting(next);
    try { sessionStorage.setItem('answer-input-mode', next); window.dispatchEvent(new Event('answer-input-mode')); } catch { /* Storage is optional. */ }
  };
  const switchWriting = (next: 'native' | 'math') => {
    remember();
    // Commit inputMode before refocusing: Safari decides which keyboard to open at focus time.
    field.current?.blur();
    flushSync(() => { prefer(next); setInUse(true); });
    select(selection.current);
  };
  const structure = (kind: 'fraction' | 'power' | 'root' | 'group') => {
    if (touch && !usingMath) switchWriting('math');
    const result = insertMathStructure(value, selection.current, kind);
    if (!result) return;
    pendingSelection.current = { start: result.start, end: result.end };
    onChange(result.value); select(pendingSelection.current);
  };
  const close = () => { setInUse(false); field.current?.blur(); };
  const send = () => { close(); if (!disabled && !sendDisabled) onSend?.(); };
  const expressionSlots = expression && <MathExpressionSlots node={expression} selection={visibleSelection}
    active={inUse && !disabled} disabled={disabled} onSelect={range => {
      if (touch && !usingMath) switchWriting('math');
      select(range);
    }} />;
  const structures = <div className="math-structures" role="group" aria-label="수식 도구">
    <button type="button" aria-label="분수 입력" onClick={() => structure('fraction')}>분수</button>
    <button type="button" aria-label="거듭제곱 입력" onClick={() => structure('power')}>xⁿ</button>
    <button type="button" aria-label="제곱근 입력" onClick={() => structure('root')}>√</button>
    <button type="button" aria-label="괄호 입력" onClick={() => structure('group')}>( )</button>
  </div>;
  const dock = showDock && <div ref={panel} id={panelId} className="math-dock" role="region" aria-label="수식 키보드"
    onBlur={event => { if (!panel.current?.contains(event.relatedTarget) && event.relatedTarget !== field.current) setInUse(false); }}
    onPointerDown={hold} onMouseDown={hold} onKeyDown={event => { if (event.key === 'Escape') { event.preventDefault(); close(); } }}>
    <div className="math-dock-inner">
      <div className="math-dock-heading"><span>수식 입력</span><div>
        <button type="button" onClick={() => switchWriting('native')}>기본 키보드</button>
        <button type="button" onClick={close}>입력기 닫기</button>
      </div></div>
      <div className="math-dock-draft"><span className="sr-only">입력한 답: {value || '비어 있음'}</span>
        {expressionSlots || (drawn ? <RichText text={`$${drawn}$`} /> : <span>{value || '답을 입력해 주세요'}</span>)}</div>
      {structures}
      <div className="math-keypad" role="group" aria-label="숫자 키패드">
        {['1', '2', '3', '+', 'back', '4', '5', '6', '-', '*', '7', '8', '9', '/', '.', 'left', '0', 'right', 'clear'].map(key => {
          const movement = key === 'left' || key === 'right';
          const name = key === 'clear' ? '전체 지우기' : key === 'back' ? '한 글자 지우기' : movement ? (key === 'left' ? '커서 왼쪽으로' : '커서 오른쪽으로') : names[key] ?? key;
          return <button key={key} type="button" className={`math-key${key === 'clear' ? ' is-clear' : ''}`} aria-label={name} disabled={key === 'back' && !value}
            onClick={() => {
              if (key === 'clear') { pendingSelection.current = { start: 0, end: 0 }; onChange(''); select(pendingSelection.current); }
              else if (key === 'back') edit('', true);
              else if (movement) {
                const { start, end } = selection.current;
                const at = slots.findIndex(node => start >= node.start && end <= node.end);
                const leaf = slots[at];
                if (start !== end) select({ start: key === 'left' ? start : end, end: key === 'left' ? start : end });
                else if (leaf && (key === 'left' ? start === leaf.start : end === leaf.end)) {
                  const next = slots[at + (key === 'left' ? -1 : 1)];
                  if (next) select(next);
                  else if (key === 'right') select({ start: value.length, end: value.length });
                } else if (!leaf && key === 'left' && slots.some(node => node.end < start)) {
                  select([...slots].reverse().find(node => node.end < start)!);
                } else { const point = Math.max(0, Math.min(value.length, start + (key === 'left' ? -1 : 1))); select({ start: point, end: point }); }
              }
              else if (key === '/') edit('/');
              else edit(key);
            }}>{key === 'clear' ? '전체 지우기' : key === 'back' ? '⌫' : key === 'left' ? '←' : key === 'right' ? '→' : key === '/' ? '÷' : key === '*' ? '×' : key}</button>;
        })}
      </div>
      {onSend && <button type="button" className="math-pad-send" disabled={sendDisabled} onClick={send}>{sendLabel ?? '답안 저장'}</button>}
    </div>
  </div>;
  return <><div className="math-answer" ref={container}>
    <label><span className="sr-only">{label}</span><input ref={field} aria-label={label} type="text" maxLength={80}
      inputMode={usingMath ? 'none' : 'text'} enterKeyHint="done"
      placeholder={placeholder} value={value} disabled={disabled} autoComplete="off" spellCheck={false}
      aria-describedby={!showDock && (drawn || expressionSlots) ? previewId : undefined} aria-controls={showDock ? panelId : undefined}
      onPointerDown={event => { if (event.pointerType === 'touch' || event.pointerType === 'pen') setTouch(true); else if (event.pointerType === 'mouse') setTouch(false); }}
      onSelect={remember} onChange={event => { onChange(event.target.value); remember(); }}
      onFocus={() => setInUse(true)} onBlur={event => { if (!panel.current?.contains(event.relatedTarget)) setInUse(false); }}
      onKeyDown={event => {
        if (event.key === 'Escape') { close(); return; }
        if (event.key === 'Enter' && !event.nativeEvent.isComposing && onSend) { event.preventDefault(); send(); return; }
        // With the software keyboard suppressed, a printable key came from a physical keyboard.
        if (usingMath && (event.key.length === 1 || event.key === 'Backspace' || event.key === 'Delete')) prefer('native');
      }} /></label>
    {!showDock && (drawn || expressionSlots) && <div className="math-answer-preview" id={previewId} onPointerDown={hold} onMouseDown={hold}><span className="sr-only">입력한 답: </span>{expressionSlots || <RichText text={`$${drawn}$`} />}</div>}
    {!disabled && !showDock && <div className="math-input-tools" onPointerDown={hold} onMouseDown={hold}>
      {/* Some native numeric keyboards omit minus, so it must remain available outside them. */}
      <button type="button" aria-label="음수 부호" onClick={() => edit('-')}>−</button>
      {structures}
      {touch && <button type="button" className="text-button" onClick={() => switchWriting('math')}>수식 키보드 열기</button>}
    </div>}
  </div>
    {onSend && !showDock && <button type="button" className="button primary" onPointerDown={hold} onMouseDown={hold}
      disabled={disabled || sendDisabled} onClick={send}>{sendLabel ?? '답안 저장'}</button>}
    {dock && createPortal(dock, document.body)}
  </>;
}
