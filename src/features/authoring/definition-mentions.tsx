'use client';

import { useRef, useState } from 'react';
import type { DefinitionChoice } from '@/shared/authoring';
import { occurrenceAt, definitionRefId, type DefinitionLink } from '@/shared/rich-text';
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
 * Replaces the mention with the definition's own name and records the link. The author never counts which
 * mention they meant: the position they typed at decides it, counted the way the renderer resolves
 * it. One annotation per definition in a block, so choosing the same definition again moves the link rather
 * than adding a second one the publishing validator would reject.
 */
export function linkDefinition(text: string, mention: { from: number; query: string }, choice: DefinitionChoice, annotations: DefinitionLink[]) {
  const surface = choice.label;
  const next = `${text.slice(0, mention.from)}${surface}${text.slice(mention.from + 1 + mention.query.length)}`;
  const occurrence = occurrenceAt(next, surface, mention.from);
  const annotation: DefinitionLink = {
    conceptKey: choice.conceptKey, surface,
    ...(choice.scopeKind === 'lesson' ? { scopeKind: 'lesson' as const, scopeKey: choice.scopeKey } : {}),
    ...(occurrence > 1 ? { occurrence } : {}),
  };
  return { text: next, definitions: [...annotations.filter((item) => definitionRefId(item) !== definitionRefId(choice)), annotation] };
}

const choiceKey = (definition: DefinitionChoice) => `${definition.scopeKind}:${definition.scopeKey}:${definition.conceptKey}`;

/**
 * Writing a paragraph that may link definitions. The caller draws its own text box — a lesson sheet wants
 * one that looks like the finished paragraph, a question wants a plain field — and this supplies
 * what makes `@` work: what to bind to the box, and the list that opens under it.
 */
export function useDefinitionMentions({ payload, definitions, onChange }: {
  payload: Record<string, unknown>; definitions: DefinitionChoice[]; onChange: (next: Record<string, unknown>) => void;
}) {
  const text = typeof payload.text === 'string' ? payload.text : '';
  const annotations = Array.isArray(payload.definitions) ? (payload.definitions as DefinitionLink[]) : [];
  const [mention, setMention] = useState<{ from: number; query: string } | null>(null);
  const [highlight, setHighlight] = useState(0);
  const expert = useExpertMode();
  const area = useRef<HTMLTextAreaElement>(null);

  const matches = mention
    ? definitions.filter((definition) => !mention.query || definition.label.includes(mention.query) || definition.conceptKey.includes(mention.query)).slice(0, 8)
    : [];
  const at = matches.length ? Math.min(highlight, matches.length - 1) : 0;

  const look = (value: string, caret: number) => { setMention(mentionAt(value, caret)); setHighlight(0); };
  const pick = (choice: DefinitionChoice) => {
    if (!mention) return;
    onChange({ ...payload, ...linkDefinition(text, mention, choice, annotations) });
    const caret = mention.from + choice.label.length;
    setMention(null);
    requestAnimationFrame(() => { area.current?.focus(); area.current?.setSelectionRange(caret, caret); });
  };

  const bind = {
    ref: area,
    value: text,
    onChange: (event: React.ChangeEvent<HTMLTextAreaElement>) => {
      onChange({ ...payload, text: event.target.value });
      look(event.target.value, event.target.selectionStart);
    },
    onClick: (event: React.MouseEvent<HTMLTextAreaElement>) => look(text, event.currentTarget.selectionStart),
    onKeyDown: (event: React.KeyboardEvent<HTMLTextAreaElement>) => {
      if (!mention) return;
      if (event.key === 'Escape') { setMention(null); event.preventDefault(); return; }
      if (!matches.length) return;
      if (event.key === 'ArrowDown') { setHighlight(at + 1 >= matches.length ? 0 : at + 1); event.preventDefault(); }
      else if (event.key === 'ArrowUp') { setHighlight(at === 0 ? matches.length - 1 : at - 1); event.preventDefault(); }
      else if (event.key === 'Enter' || event.key === 'Tab') { pick(matches[at]); event.preventDefault(); }
    },
    // The list closes a moment later so a click on it still lands.
    onBlur: () => window.setTimeout(() => setMention(null), 150),
  };

  const picker = mention && (matches.length
    ? <ul className="term-mentions" role="listbox">
      {matches.map((definition, index) => <li key={choiceKey(definition)}>
        <button type="button" className={index === at ? 'active' : ''}
          onMouseDown={(event) => event.preventDefault()} onClick={() => pick(definition)}>
          <strong>{definition.label}</strong>
          <small>{expert && `${definition.conceptKey} · `}{definition.scopeKind === 'lesson' ? '이 수업' : '공통 사전'}</small>
        </button>
      </li>)}
    </ul>
    : <p className="editor-note term-mentions-empty">
      「{mention.query}」에 맞는 뜻풀이가 없어요. 「뜻풀이 사전」에서 먼저 써 주세요.</p>);

  return { bind, picker };
}

/** The body of a paragraph as a plain field, with the picker that puts a definition in. */
export function TermText({ payload, definitions, onChange }: {
  payload: Record<string, unknown>; definitions: DefinitionChoice[]; onChange: (next: Record<string, unknown>) => void;
}) {
  const { bind, picker } = useDefinitionMentions({ payload, definitions, onChange });
  return <label className="editor-field term-writing">
    <span className="editor-label">글</span>
    <textarea rows={4} {...bind} />
    <small>뜻풀이를 걸려면 <code>@</code> 뒤에 이름을 적고 고르세요. 고른 이름이 글에 들어가고, 아래에 연결한 뜻풀이로 남습니다.</small>
    {picker}
  </label>;
}
