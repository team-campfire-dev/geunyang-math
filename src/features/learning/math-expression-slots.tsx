'use client';

import type { MathNode } from '@/shared/math-expression';
import type { AnswerSelection } from './answer-editing';

/** All expression structures use the same editable leaves and the same answer string. */
export function MathExpressionSlots({ node, selection, active, disabled, onSelect }: {
  node: MathNode; selection: AnswerSelection; active: boolean; disabled?: boolean;
  onSelect: (range: AnswerSelection) => void;
}) {
  function draw(current: MathNode, label: string): React.ReactNode {
    const inner = (child: MathNode, name: string) => draw(child.kind === 'group' ? child.child : child, name);
    if (current.kind === 'hole' || current.kind === 'number') {
      const text = current.kind === 'number' ? current.text : '';
      return <button type="button" className={`fraction-slot${text ? '' : ' is-empty'}`} aria-label={`${label}: ${text || '빈 칸'}`}
        aria-pressed={active && selection.start >= current.start && selection.end <= current.end}
        disabled={disabled} onClick={() => onSelect({ start: current.start, end: current.end })}><span>{text || '\u00a0'}</span></button>;
    }
    if (current.kind === 'group') return <span className="math-slot-group"><span aria-hidden="true">(</span>{draw(current.child, `${label} 괄호 안`)}<span aria-hidden="true">)</span></span>;
    if (current.kind === 'root') return <span className="math-slot-root"><span aria-hidden="true">√</span><span>{inner(current.child, `${label} 근호 안`)}</span></span>;
    if (current.kind === 'negate' || current.kind === 'positive') return <span className="math-slot-row"><span aria-hidden="true">{current.kind === 'negate' ? '−' : '+'}</span>{draw(current.child, label)}</span>;
    if (current.op === '/') return <span className="fraction-slots" role="group" aria-label="분수 입력 칸"><span>{inner(current.left, `${label} 분자`)}</span><span>{inner(current.right, `${label} 분모`)}</span></span>;
    if (current.op === '^') return <span className="math-slot-power">{draw(current.left, `${label} 밑`)}<span>{inner(current.right, `${label} 지수`)}</span></span>;
    return <span className="math-slot-row">{draw(current.left, label)}<span aria-hidden="true">{current.op === '*' ? '×' : current.op === '-' ? '−' : '+'}</span>{draw(current.right, label)}</span>;
  }
  return <div className="math-expression-slots" role="group" aria-label="수식 입력 칸">{draw(node, '답')}</div>;
}
