'use client';

import { useEffect, useId, useRef, useState } from 'react';
import type { ConceptHelp as Help } from '@/shared/api';
import { learningApi } from './api-client';
import { ContentBlocks, RichText } from './content-blocks';
import { Icon } from './icons';

/** Mounted with the attempt as its key so a new answer cannot inherit an older request or panel. */
export function ConceptHelp({ attemptId, busy, context = 'answer', conceptKey, buttonLabel = '관련 개념 설명' }: {
  attemptId: string; busy?: boolean; context?: 'answer' | 'history'; conceptKey?: string; buttonLabel?: string;
}) {
  const id = useId();
  const [open, setOpen] = useState(false);
  const [help, setHelp] = useState<Help | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const alive = useRef(true);
  const pending = useRef(false);
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  async function load() {
    if (pending.current) return;
    pending.current = true; setLoading(true); setError('');
    try {
      const result = await learningApi.conceptHelp(attemptId);
      if (alive.current) setHelp(result);
    } catch (cause) {
      if (alive.current) setError(cause instanceof Error ? cause.message : '설명을 불러오지 못했어요. 다시 시도해 주세요.');
    } finally {
      pending.current = false;
      if (alive.current) setLoading(false);
    }
  }
  function toggle() {
    setOpen(value => !value);
    if (!open && !help) void load();
  }
  const concepts = help?.concepts.filter(concept => !conceptKey || concept.key === conceptKey);
  return <div className="concept-help">
    <button type="button" className="text-button" aria-expanded={open} aria-controls={id} disabled={busy}
      onPointerDown={event => event.preventDefault()} onMouseDown={event => event.preventDefault()} onClick={toggle}>
      <Icon name="book" size={16} />{open ? '개념 설명 접기' : buttonLabel}
    </button>
    {open && <section id={id} className="concept-help-body" aria-label="오답과 관련된 개념 설명" aria-busy={loading}>
      <p className="muted small">{context === 'history'
        ? '이 풀이에 쓰인 개념을 다시 살펴보세요. 설명을 읽어도 원래 풀이 기록이나 힌트 사용 여부는 바뀌지 않아요.'
        : '이 문제에 쓰인 개념이에요. 설명을 읽고, 쓰던 답으로 돌아가 다시 생각해 보세요.'}</p>
      {loading && <p role="status">개념 설명을 불러오고 있어요…</p>}
      {error && <div className="error-banner" role="alert"><span>{error}</span><button type="button" className="text-button" onClick={() => void load()}>다시 시도</button></div>}
      {concepts?.map(concept => <article key={concept.key} className="concept-help-entry">
        <h4>{concept.label}</h4>
        {concept.definition && <>
          {concept.definition.usageNote && <p className="muted small">{concept.definition.usageNote}</p>}
          {concept.definition.summary && <RichText text={concept.definition.summary} />}
          <ContentBlocks blocks={concept.definition.blocks} />
        </>}
        {concept.lesson && <details className="concept-help-lesson">
          <summary>수업 설명 읽기 · {concept.lesson.title}</summary>
          {concept.lesson.sections.map(section => <section key={section.sectionId}>
            <h5>{section.title}</h5><ContentBlocks blocks={section.contentBlocks} />
          </section>)}
        </details>}
        {!concept.definition && !concept.lesson && <p className="muted small">아직 이 개념에 연결된 설명이 없어요.</p>}
      </article>)}
      {help && !concepts?.length && <p className="muted small">아직 이 문제에 연결된 개념 설명이 없어요.</p>}
    </section>}
  </div>;
}
