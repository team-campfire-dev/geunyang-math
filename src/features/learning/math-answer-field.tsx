'use client';

import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import { createPortal, flushSync } from 'react-dom';
import type { PublicProblem } from '@/shared/api';
import { deleteMathSelection, enclosingMathStructure, insertMathStructure, MathEditHistory, moveMathSelection,
  replaceAnswerSelection, unwrapMathStructure, type AnswerSelection, type MathEdit } from './answer-editing';
import { MathExpressionSlots } from './math-expression-slots';
import { parseMathExpression } from '@/shared/math-expression';
import { mathInputIssue } from './math-input-issue';
import { useAnswerDock, useTouchAnswerInput } from './use-answer-dock';

const names: Record<string, string> = { '-': '음수 부호', '.': '소수점', '/': '나누기', '*': '곱하기', '+': '더하기' };

/** A single visible math field, backed by a native input for keyboard/IME/accessibility support. */
export function MathAnswerField({ value, onChange, disabled, label, placeholder, responseSpec, onSend, sendLabel, sendDisabled }: {
  value: string; onChange: (next: string) => void; disabled?: boolean;
  label: string; placeholder: string; responseSpec?: PublicProblem['responseSpec'];
  onSend?: () => void; sendLabel?: string; sendDisabled?: boolean;
}) {
  const [touch, setTouch] = useTouchAnswerInput();
  const [writing, setWriting] = useState<'native' | 'math'>('math');
  const [inUse, setInUse] = useState(false);
  const [choosingPart, setChoosingPart] = useState(false);
  const [composing, setComposing] = useState(false);
  const [, refreshHistory] = useState(0);
  const field = useRef<HTMLInputElement>(null);
  const container = useRef<HTMLDivElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const selection = useRef<AnswerSelection>({ start: value.length, end: value.length });
  const [visibleSelection, setVisibleSelection] = useState(selection.current);
  const pendingSelection = useRef<AnswerSelection | null>(null);
  const history = useRef(new MathEditHistory());
  const compositionStart = useRef<MathEdit | null>(null);
  const expectedValue = useRef(value);
  const issueId = useId(), noteId = useId(), panelId = useId();
  const usingMath = touch && writing === 'math';
  const showDock = usingMath && inUse && !disabled;
  const expression = composing ? null : parseMathExpression(value, true);
  const issue = composing ? null : mathInputIssue(value, responseSpec?.kind === 'integer');
  const formNote = responseSpec?.kind === 'integer' ? '답안 형식: 정수'
    : responseSpec?.requiredForm ? `답안 형식: ${['simplest', 'simplest_fraction', 'reduced_fraction'].includes(responseSpec.requiredForm) ? '기약분수' : responseSpec.requiredForm}` : null;
  const enclosing = enclosingMathStructure(value, visibleSelection);
  const hold = (event: { preventDefault: () => void }) => event.preventDefault();
  const updateSelection = (range: AnswerSelection) => {
    selection.current = { start: range.start, end: range.end };
    setVisibleSelection(previous => previous.start === range.start && previous.end === range.end ? previous : selection.current);
  };
  const remember = () => {
    if (field.current) updateSelection({ start: field.current.selectionStart ?? value.length, end: field.current.selectionEnd ?? value.length });
  };
  const select = (range: AnswerSelection) => {
    field.current?.focus({ preventScroll: true });
    field.current?.setSelectionRange(range.start, range.end);
    updateSelection(range);
  };
  const commit = (result: MathEdit, record = true) => {
    if (disabled) return;
    if (record) history.current.record({ value, ...selection.current }, result);
    expectedValue.current = result.value;
    pendingSelection.current = { start: result.start, end: result.end };
    setChoosingPart(false); refreshHistory(n => n + 1);
    onChange(result.value); select(result);
  };
  const edit = (inserted: string) => commit(replaceAnswerSelection(value, selection.current, inserted));
  const erase = (forward = false) => commit(deleteMathSelection(value, selection.current, forward));
  const restore = (redo: boolean) => {
    const next = history.current[redo ? 'redo' : 'undo']({ value, ...selection.current });
    if (next) commit(next, false);
  };
  useLayoutEffect(() => {
    if (value !== expectedValue.current) {
      // A new externally supplied answer must not expose another question's undo history.
      expectedValue.current = value; history.current = new MathEditHistory();
      pendingSelection.current = null; setChoosingPart(false);
      updateSelection({ start: value.length, end: value.length }); refreshHistory(n => n + 1);
    } else if (pendingSelection.current) { select(pendingSelection.current); pendingSelection.current = null; }
  }, [value]);
  useLayoutEffect(() => {
    container.current?.querySelector('.math-caret')?.scrollIntoView?.({ block: 'nearest', inline: 'nearest' });
  }, [value, visibleSelection, inUse]);
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
    const restorePreference = () => { try { const saved = sessionStorage.getItem('answer-input-mode'); if (saved === 'math' || saved === 'native') setWriting(saved); } catch { /* Storage is optional. */ } };
    restorePreference(); window.addEventListener('answer-input-mode', restorePreference);
    return () => window.removeEventListener('answer-input-mode', restorePreference);
  }, []);
  // Mobile keyboards may send beforeinput without keydown for deletion.
  useEffect(() => {
    const input = field.current;
    const beforeInput = (event: InputEvent) => {
      if (!event.isComposing && event.cancelable && ['deleteContentBackward', 'deleteContentForward'].includes(event.inputType)) {
        event.preventDefault(); erase(event.inputType === 'deleteContentForward');
      }
    };
    input?.addEventListener('beforeinput', beforeInput);
    return () => input?.removeEventListener('beforeinput', beforeInput);
  });
  const prefer = (next: 'native' | 'math') => {
    setWriting(next);
    try { sessionStorage.setItem('answer-input-mode', next); window.dispatchEvent(new Event('answer-input-mode')); } catch { /* Storage is optional. */ }
  };
  const switchWriting = (next: 'native' | 'math') => {
    remember(); field.current?.blur();
    flushSync(() => { prefer(next); setInUse(true); });
    select(selection.current);
  };
  const structure = (kind: 'fraction' | 'power' | 'root' | 'group') => {
    if (touch && !usingMath) switchWriting('math');
    const result = insertMathStructure(value, selection.current, kind);
    if (result) commit(result);
  };
  const close = () => { setInUse(false); setChoosingPart(false); field.current?.blur(); };
  const send = () => {
    if (disabled || sendDisabled || composing) return;
    if (issue) { select(issue.range); return; }
    close(); onSend?.();
  };
  useEffect(() => {
    const form = field.current?.form;
    if (!onSend) return;
    const submit = (event: Event) => { event.preventDefault(); event.stopPropagation(); send(); };
    form?.addEventListener('submit', submit);
    return () => form?.removeEventListener('submit', submit);
  });
  const editingTools = <div className="math-edit-tools" role="group" aria-label="수식 편집 도구">
    <button type="button" disabled={disabled || !history.current.canUndo} onClick={() => restore(false)}>실행 취소</button>
    <button type="button" disabled={disabled || !history.current.canRedo} onClick={() => restore(true)}>다시 실행</button>
    <button type="button" disabled={disabled || !enclosing} aria-expanded={choosingPart} onClick={() => {
      if (!enclosing) return;
      if (enclosing.kind === 'binary') setChoosingPart(open => !open);
      else commit(unwrapMathStructure(value, enclosing));
    }}>구조 없애기</button>
    {choosingPart && enclosing?.kind === 'binary' && <div className="math-keep-part" role="group" aria-label="남길 값 선택">
      <span>남길 부분을 골라 주세요.</span>
      <button type="button" onClick={() => commit(unwrapMathStructure(value, enclosing, 'left'))}>{enclosing.op === '/' ? '분자만 남기기' : '밑만 남기기'}</button>
      <button type="button" onClick={() => commit(unwrapMathStructure(value, enclosing, 'right'))}>{enclosing.op === '/' ? '분모만 남기기' : '지수만 남기기'}</button>
    </div>}
  </div>;
  const structures = <div className="math-structures" role="group" aria-label="수식 도구">
    <button type="button" aria-label="분수 입력" onClick={() => structure('fraction')}>분수</button>
    <button type="button" aria-label="거듭제곱 입력" onClick={() => structure('power')}>xⁿ</button>
    <button type="button" aria-label="제곱근 입력" onClick={() => structure('root')}>√</button>
    <button type="button" aria-label="괄호 입력" onClick={() => structure('group')}>( )</button>
  </div>;
  const dock = showDock && <div ref={panel} id={panelId} className="math-dock" role="region" aria-label="수식 키보드"
    onBlur={event => { if (!panel.current?.contains(event.relatedTarget) && !container.current?.contains(event.relatedTarget)) setInUse(false); }}
    onPointerDown={hold} onMouseDown={hold} onKeyDown={event => { if (event.key === 'Escape') { event.preventDefault(); close(); } }}>
    <div className="math-dock-inner">
      <div className="math-dock-heading"><span>수식 입력</span><div>
        <button type="button" onClick={() => switchWriting('native')}>기본 키보드</button>
        <button type="button" onClick={close}>입력기 닫기</button>
      </div></div>
      {editingTools}{structures}
      <div className="math-keypad" role="group" aria-label="숫자 키패드">
        {['1', '2', '3', '+', 'back', '4', '5', '6', '-', '*', '7', '8', '9', '/', '.', 'left', '0', 'right', 'clear'].map(key => {
          const movement = key === 'left' || key === 'right';
          const name = key === 'clear' ? '전체 지우기' : key === 'back' ? '한 글자 지우기' : movement ? (key === 'left' ? '커서 왼쪽으로' : '커서 오른쪽으로') : names[key] ?? key;
          return <button key={key} type="button" className={`math-key${key === 'clear' ? ' is-clear' : ''}`} aria-label={name} disabled={key === 'back' && !value}
            onClick={() => {
              if (key === 'clear') commit({ value: '', start: 0, end: 0 });
              else if (key === 'back') erase();
              else if (movement) { setChoosingPart(false); select(moveMathSelection(value, selection.current, key === 'left' ? -1 : 1)); }
              else edit(key);
            }}>{key === 'clear' ? '전체 지우기' : key === 'back' ? '⌫' : key === 'left' ? '←' : key === 'right' ? '→' : key === '/' ? '÷' : key === '*' ? '×' : key}</button>;
        })}
      </div>
      {onSend && <button type="button" className="math-pad-send" disabled={sendDisabled} onClick={send}>{sendLabel ?? '답안 저장'}</button>}
    </div>
  </div>;
  return <><div className="math-answer" ref={container}>
    {formNote && <p className="input-help math-form-note" id={noteId}>{formNote}</p>}
    <div className={`math-editor${inUse ? ' is-active' : ''}${issue ? ' has-issue' : ''}${expression ? ' is-structured' : ''}`}
      onPointerDownCapture={event => { if (event.pointerType === 'touch' || event.pointerType === 'pen') setTouch(true); else if (event.pointerType === 'mouse') setTouch(false); }}>
      <input ref={field} className="math-source-input" aria-label={label} type="text" maxLength={80}
        inputMode={usingMath ? 'none' : 'text'} enterKeyHint="done" aria-invalid={!!issue}
        placeholder={placeholder} value={value} disabled={disabled} autoComplete="off" spellCheck={false}
        aria-describedby={[formNote && noteId, issue && issueId].filter(Boolean).join(' ') || undefined} aria-controls={showDock ? panelId : undefined}
        onSelect={remember} onChange={event => {
          if (compositionStart.current) { expectedValue.current = event.target.value; onChange(event.target.value); return; }
          commit({ value: event.target.value, start: event.target.selectionStart ?? event.target.value.length, end: event.target.selectionEnd ?? event.target.value.length });
        }}
        onCompositionStart={() => { compositionStart.current = { value, ...selection.current }; setComposing(true); }}
        onCompositionEnd={event => {
          const input = event.currentTarget;
          const result = { value: input.value, start: input.selectionStart ?? input.value.length, end: input.selectionEnd ?? input.value.length };
          if (compositionStart.current) history.current.record(compositionStart.current, result);
          compositionStart.current = null; setComposing(false); commit(result, false);
        }}
        onFocus={() => setInUse(true)} onBlur={event => { if (!panel.current?.contains(event.relatedTarget) && !container.current?.contains(event.relatedTarget)) setInUse(false); }}
        onKeyDown={event => {
          if (event.nativeEvent.isComposing) return;
          if (event.key === 'Escape') { close(); return; }
          if (event.key === 'Enter' && onSend) { event.preventDefault(); send(); return; }
          if ((event.metaKey || event.ctrlKey) && !event.altKey) {
            if (event.key.toLowerCase() === 'z' || event.key.toLowerCase() === 'y') {
              event.preventDefault(); restore(event.key.toLowerCase() === 'y' || event.shiftKey); return;
            }
            return;
          }
          if (event.altKey) return;
          if (usingMath && (event.key.length === 1 || event.key === 'Backspace' || event.key === 'Delete')) prefer('native');
          if (event.key === 'Backspace' || event.key === 'Delete') { event.preventDefault(); erase(event.key === 'Delete'); }
          else if (!event.shiftKey && (event.key === 'ArrowLeft' || event.key === 'ArrowRight')) {
            event.preventDefault(); select(moveMathSelection(value, selection.current, event.key === 'ArrowLeft' ? -1 : 1));
          }
        }} />
      {expression && <div className="math-editor-canvas" onPointerDown={hold} onMouseDown={hold}
        onClick={event => { if (!(event.target as Element).closest('button')) select({ start: value.length, end: value.length }); }}>
        <MathExpressionSlots node={expression} selection={visibleSelection} issue={issue?.range} active={inUse && !disabled} disabled={disabled}
          onSelect={range => { setChoosingPart(false); select(range); }} />
        {!value && !inUse && <span className="math-editor-placeholder">{placeholder}</span>}
      </div>}
    </div>
    {issue && <div className="math-input-issue" id={issueId} role="status"><span>{issue.message}</span>
      <button type="button" disabled={disabled} onPointerDown={hold} onMouseDown={hold} onClick={() => select(issue.range)}>수정할 칸으로</button></div>}
    {!disabled && !showDock && <div className="math-input-tools" onPointerDown={hold} onMouseDown={hold}>
      <button type="button" aria-label="음수 부호" onClick={() => edit('-')}>−</button>{structures}{editingTools}
      {touch && <button type="button" className="text-button" onClick={() => switchWriting('math')}>수식 키보드 열기</button>}
    </div>}
  </div>
    {onSend && !showDock && <button type="button" className="button primary" onPointerDown={hold} onMouseDown={hold}
      disabled={disabled || sendDisabled} onClick={send}>{sendLabel ?? '답안 저장'}</button>}
    {dock && createPortal(dock, document.body)}
  </>;
}
