'use client';

import { Fragment } from 'react';
import type { MathNode } from '@/shared/math-expression';
import type { AnswerSelection } from './answer-editing';

/** The source input is invisible when a draft can be drawn; this is the actual answer field. */
export function MathExpressionSlots({ node, selection, active, disabled, issue, onSelect }: {
  node: MathNode; selection: AnswerSelection; active: boolean; disabled?: boolean; issue?: AnswerSelection;
  onSelect: (range: AnswerSelection) => void;
}) {
  let caretDrawn = false;
  const caret = (at: number) => {
    if (!active || caretDrawn || selection.start !== selection.end || selection.start !== at) return null;
    caretDrawn = true;
    return <span className="math-caret" aria-hidden="true" />;
  };
  function draw(current: MathNode, label: string): React.ReactNode {
    const inner = (child: MathNode, name: string) => draw(child.kind === 'group' ? child.child : child, name);
    if (current.kind === 'hole' || current.kind === 'number') {
      const text = current.kind === 'number' ? current.text : '';
      const selected = active && (selection.start === selection.end
        ? selection.start >= current.start && selection.end <= current.end
        : selection.start < current.end && selection.end > current.start);
      const invalid = !!issue && current.start >= issue.start && current.end <= issue.end;
      return <button type="button" className={`fraction-slot${text ? '' : ' is-empty'}${invalid ? ' has-issue' : ''}`} aria-label={`${label}: ${text || '빈 칸'}`}
        aria-pressed={selected} aria-invalid={invalid || undefined} disabled={disabled}
        onClick={() => onSelect({ start: current.start, end: current.end })}><span>
          {text ? [...text].map((character, i) => <Fragment key={i}>{caret(current.start + i)}<span className={selected && current.start + i >= selection.start && current.start + i < selection.end ? 'math-selected-text' : undefined}>{character}</span></Fragment>) : '\u00a0'}
          {caret(current.end)}
        </span></button>;
    }
    const before = caret(current.start);
    let content: React.ReactNode;
    if (current.kind === 'group') content = <span className="math-slot-group"><span aria-hidden="true">(</span>{draw(current.child, `${label} 괄호 안`)}<span aria-hidden="true">)</span></span>;
    else if (current.kind === 'root') content = <span className="math-slot-root"><span aria-hidden="true">√</span><span>{inner(current.child, `${label} 근호 안`)}</span></span>;
    else if (current.kind === 'negate' || current.kind === 'positive') content = <span className="math-slot-row"><span aria-hidden="true">{current.kind === 'negate' ? '−' : '+'}</span>{draw(current.child, label)}</span>;
    else if (current.op === '/') content = <span className="fraction-slots" role="group" aria-label="분수 입력 칸"><span>{inner(current.left, `${label} 분자`)}</span><span>{inner(current.right, `${label} 분모`)}</span></span>;
    else if (current.op === '^') content = <span className="math-slot-power">{draw(current.left, `${label} 밑`)}<span>{inner(current.right, `${label} 지수`)}</span></span>;
    else content = <span className="math-slot-row">{draw(current.left, label)}<span aria-hidden="true">{current.op === '*' ? '×' : current.op === '-' ? '−' : '+'}</span>{draw(current.right, label)}</span>;
    return <span className="math-node-boundary">{before}{content}{caret(current.end)}</span>;
  }
  return <div className="math-expression-slots" role="group" aria-label="수식 입력 칸">{draw(node, '답')}</div>;
}
