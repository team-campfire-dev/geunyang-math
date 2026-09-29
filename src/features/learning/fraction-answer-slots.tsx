'use client';

import type { AnswerSelection } from './answer-editing';

/** A fraction is edited where it is drawn. The ordinary answer field remains the input source. */
export function FractionAnswerSlots({ value, selection, active, disabled, onSelect }: {
  value: string; selection: AnswerSelection; active: boolean; disabled?: boolean;
  onSelect: (part: 'numerator' | 'denominator') => void;
}) {
  const slash = value.indexOf('/');
  const parts = [
    { key: 'numerator' as const, label: '분자', text: value.slice(0, slash), selected: selection.end <= slash },
    { key: 'denominator' as const, label: '분모', text: value.slice(slash + 1), selected: selection.start > slash },
  ];
  return <div className="fraction-slots" role="group" aria-label="분수 입력 칸">
    {parts.map(part => <button key={part.key} type="button" className={`fraction-slot${part.text.trim() ? '' : ' is-empty'}`}
      aria-label={`${part.label}: ${part.text.trim() || '빈 칸'}`} aria-pressed={active && part.selected}
      disabled={disabled} onClick={() => onSelect(part.key)}>
      <span>{part.text || '\u00a0'}</span>
    </button>)}
  </div>;
}
