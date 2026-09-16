'use client';

import { useRef, useState } from 'react';
import type { TermChoice } from '@/shared/authoring';
import { occurrenceAt, termRefId, type TermAnnotation } from '@/shared/rich-text';
import { useExpertMode } from './expert-mode';

/**
 * The mention being typed at the caret, if any. A mention is one unbroken run right after `@`, so a
 * stray `@` earlier in the paragraph never reopens the list while the author writes past it.
 */
export function mentionAt(text: string, caret: number): { from: number; query: string } | null {
  const before = text.slice(0, caret);
  const at = before.lastIndexOf('@');
  if (at < 0) return null;
  const query = before.slice(at + 1);
  return /[\s@]/.test(query) ? null : { from: at, query };
}

/**
 * Replaces the mention with the term's own name and records the link. The author never counts which
 * mention they meant: the position they typed at decides it, counted the way the renderer resolves
 * it. One annotation per term in a block, so choosing the same term again moves the link rather
 * than adding a second one the publishing validator would reject.
 */
export function linkTerm(text: string, mention: { from: number; query: string }, choice: TermChoice, annotations: TermAnnotation[]) {
  const surface = choice.label;
  const next = `${text.slice(0, mention.from)}${surface}${text.slice(mention.from + 1 + mention.query.length)}`;
  const occurrence = occurrenceAt(next, surface, mention.from);
  const annotation: TermAnnotation = {
    termKey: choice.termKey, surface,
    ...(choice.scopeKind === 'class' ? { scopeKind: 'class' as const, scopeKey: choice.scopeKey } : {}),
    ...(occurrence > 1 ? { occurrence } : {}),
  };
  return { text: next, terms: [...annotations.filter((item) => termRefId(item) !== termRefId(choice)), annotation] };
}

const choiceKey = (term: TermChoice) => `${term.scopeKind}:${term.scopeKey}:${term.termKey}`;

/** The body of a paragraph that may link terms, with the picker that puts one in. */
export function TermText({ payload, terms, onChange }: {
  payload: Record<string, unknown>; terms: TermChoice[]; onChange: (next: Record<string, unknown>) => void;
}) {
  const text = typeof payload.text === 'string' ? payload.text : '';
  const annotations = Array.isArray(payload.terms) ? (payload.terms as TermAnnotation[]) : [];
  const [mention, setMention] = useState<{ from: number; query: string } | null>(null);
  const [highlight, setHighlight] = useState(0);
  const expert = useExpertMode();
  const area = useRef<HTMLTextAreaElement>(null);

  const matches = mention
    ? terms.filter((term) => !mention.query || term.label.includes(mention.query) || term.termKey.includes(mention.query)).slice(0, 8)
    : [];
  const at = matches.length ? Math.min(highlight, matches.length - 1) : 0;

  const look = (value: string, caret: number) => { setMention(mentionAt(value, caret)); setHighlight(0); };
  const pick = (choice: TermChoice) => {
    if (!mention) return;
    onChange({ ...payload, ...linkTerm(text, mention, choice, annotations) });
    const caret = mention.from + choice.label.length;
    setMention(null);
    requestAnimationFrame(() => { area.current?.focus(); area.current?.setSelectionRange(caret, caret); });
  };

  return <label className="editor-field term-writing">
    <span className="editor-label">글</span>
    <textarea ref={area} rows={4} value={text}
      onChange={(event) => { onChange({ ...payload, text: event.target.value }); look(event.target.value, event.target.selectionStart); }}
      onClick={(event) => look(text, event.currentTarget.selectionStart)}
      onKeyDown={(event) => {
        if (!mention) return;
        if (event.key === 'Escape') { setMention(null); event.preventDefault(); return; }
        if (!matches.length) return;
        if (event.key === 'ArrowDown') { setHighlight(at + 1 >= matches.length ? 0 : at + 1); event.preventDefault(); }
        else if (event.key === 'ArrowUp') { setHighlight(at === 0 ? matches.length - 1 : at - 1); event.preventDefault(); }
        else if (event.key === 'Enter' || event.key === 'Tab') { pick(matches[at]); event.preventDefault(); }
      }}
      // The list closes a moment later so a click on it still lands.
      onBlur={() => window.setTimeout(() => setMention(null), 150)} />
    <small>용어를 걸려면 <code>@</code> 뒤에 이름을 적고 고르세요. 고른 이름이 글에 들어가고, 아래에 연결한 용어로 남습니다.</small>
    {mention && (matches.length
      ? <ul className="term-mentions" role="listbox">
        {matches.map((term, index) => <li key={choiceKey(term)}>
          <button type="button" className={index === at ? 'active' : ''}
            onMouseDown={(event) => event.preventDefault()} onClick={() => pick(term)}>
            <strong>{term.label}</strong>
            <small>{expert && `${term.termKey} · `}{term.scopeKind === 'class' ? '이 클래스' : '공통 사전'}</small>
          </button>
        </li>)}
      </ul>
      : <p className="editor-note term-mentions-empty">
        「{mention.query}」에 맞는 용어가 없어요. 「용어 풀이」에서 먼저 발행해 주세요.</p>)}
  </label>;
}
