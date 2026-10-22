'use client';

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { reasonLabel, type FeedbackAction, type FeedbackItem } from '@/shared/feedback';
import { RichText } from '@/features/learning/content-blocks';
import { rangeOf } from '@/features/learning/feedback-quote';
import { Icon } from '@/features/learning/icons';

/** The page the margin sits beside: the step of the draft as it is drawn in the editor. */
const sheetOf = () => document.querySelector<HTMLElement>('#lesson-preview .lesson-sheet');
const gap = 10;
type Anchor = { holder: Element; range: Range | null };

function anchorOf(root: HTMLElement, item: FeedbackItem): Anchor | null {
  if (!item.blockId) return null;
  const block = root.querySelector(`[data-feedback-block="${CSS.escape(item.blockId)}"]`);
  const holder = (item.problemVersionId && root.querySelector(`[data-feedback-problem="${CSS.escape(item.problemVersionId)}"]`)) || block;
  if (!holder) return null;
  return { holder, range: item.quote ? rangeOf(item.quote, holder) : null };
}

/**
 * Where each card goes: level with what it points at, pushed down past the one above it. A chosen
 * card sits exactly at its place and the ones before it make room upwards, the way a document's
 * comments do, so the card being read is never the one that moved.
 */
export function placeCards(wanted: { id: string; top: number; height: number }[], active: string | null): Record<string, number> {
  const placed: Record<string, number> = {};
  const at = active ? wanted.findIndex((card) => card.id === active) : -1;
  const start = at >= 0 ? at : 0;
  let floor = -Infinity;
  for (let index = start; index < wanted.length; index++) {
    const top = index === at ? wanted[index].top : Math.max(wanted[index].top, floor);
    placed[wanted[index].id] = top;
    floor = top + wanted[index].height + gap;
  }
  let ceiling = at >= 0 ? placed[wanted[at].id] : Infinity;
  for (let index = start - 1; index >= 0; index--) {
    const top = Math.min(wanted[index].top, ceiling - wanted[index].height - gap);
    placed[wanted[index].id] = top;
    ceiling = top;
  }
  return placed;
}

/**
 * What learners said about this step, in the margin beside it — a document's comments. The words
 * they meant are underlined in the step, the card stands level with them, and pressing either one
 * brings out the other. 「고치기」 picks the block for editing; marking a note dealt with is for once
 * it is fixed.
 *
 * Where the margin is not beside the step — a narrow window puts it underneath — the cards are a
 * plain list in the order of the step.
 */
export function FeedbackMargin({ items, sectionId, steps, baseVersionId, active, busy, onActive, onAct, onFix, onStep }: {
  items: FeedbackItem[]; sectionId: string; steps: { sectionId: string; title: string }[];
  /** The published version this draft was made from; a note left on an older one may be about words since changed. */
  baseVersionId: string | null;
  active: string | null; busy: boolean;
  onActive: (id: string | null) => void;
  onAct: (action: FeedbackAction) => void;
  onFix: (item: FeedbackItem) => void;
  onStep: (index: number) => void;
}) {
  const [showResolved, setShowResolved] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  /** What the cards are placed in; levels are measured from its top, under the margin's own heading. */
  const column = useRef<HTMLDivElement>(null);
  const cards = useRef(new Map<string, HTMLElement>());
  const [layout, setLayout] = useState<{ side: boolean; tops: Record<string, number>; height: number; loose: string[] }>({ side: false, tops: {}, height: 0, loose: [] });
  const here = useMemo(() => items.filter((item) => item.sectionId === sectionId && (showResolved || item.status === 'open')), [items, sectionId, showResolved]);
  const elsewhere = steps.map((step, index) => ({ ...step, index,
    count: items.filter((item) => item.sectionId === step.sectionId && item.status === 'open').length }))
    .filter((step) => step.sectionId !== sectionId && step.count > 0);
  const away = items.filter((item) => item.status === 'open' && !steps.some((step) => step.sectionId === item.sectionId)).length;

  const measure = useCallback(() => {
    const root = sheetOf(), container = box.current, placedIn = column.current;
    if (!root || !container || !placedIn) return;
    const frame = placedIn.getBoundingClientRect(), page = root.getBoundingClientRect();
    const side = container.getBoundingClientRect().left >= page.right - 1;
    const wanted: { id: string; top: number; height: number }[] = [];
    const loose: string[] = [];
    const quotes: Range[] = [];
    let chosen: Range | null = null;
    for (const item of here) {
      const anchor = anchorOf(root, item);
      if (!anchor) { loose.push(item.id); continue; }
      const top = (anchor.range?.getClientRects()[0] ?? anchor.holder.getBoundingClientRect()).top - frame.top;
      wanted.push({ id: item.id, top, height: cards.current.get(item.id)?.offsetHeight ?? 120 });
      if (anchor.range && item.status === 'open') quotes.push(anchor.range);
      if (anchor.range && item.id === active) chosen = anchor.range;
    }
    wanted.sort((a, b) => a.top - b.top);
    const tops = side ? placeCards(wanted, active) : {};
    const height = side ? Math.max(page.bottom - frame.top, ...wanted.map((card) => tops[card.id] + card.height)) : 0;
    setLayout((previous) => JSON.stringify(previous) === JSON.stringify({ side, tops, height, loose }) ? previous : { side, tops, height, loose });
    const registry = typeof CSS !== 'undefined' ? (CSS as unknown as { highlights?: Map<string, unknown> }).highlights : undefined;
    const Highlight = (globalThis as unknown as { Highlight?: new (...ranges: Range[]) => unknown }).Highlight;
    if (registry && Highlight) {
      registry.set('editor-feedback', new Highlight(...quotes));
      if (chosen) registry.set('editor-feedback-active', new Highlight(chosen)); else registry.delete('editor-feedback-active');
    }
  }, [here, active]);

  useLayoutEffect(() => { measure(); });
  useEffect(() => {
    const root = sheetOf();
    let frame = 0;
    const later = () => { cancelAnimationFrame(frame); frame = requestAnimationFrame(measure); };
    const sizes = new ResizeObserver(later);
    if (root) sizes.observe(root);
    const changes = new MutationObserver(later);
    if (root) changes.observe(root, { subtree: true, childList: true, characterData: true });
    window.addEventListener('resize', later);
    return () => { cancelAnimationFrame(frame); sizes.disconnect(); changes.disconnect(); window.removeEventListener('resize', later); };
  }, [measure]);
  useEffect(() => () => {
    const registry = typeof CSS !== 'undefined' ? (CSS as unknown as { highlights?: Map<string, unknown> }).highlights : undefined;
    registry?.delete('editor-feedback'); registry?.delete('editor-feedback-active');
  }, []);

  // Pressing underlined words, or a block somebody spoke about, brings its card forward.
  useEffect(() => {
    const root = sheetOf();
    if (!root) return;
    const press = (event: MouseEvent) => {
      const caret = (document as Document & { caretRangeFromPoint?: (x: number, y: number) => Range | null }).caretRangeFromPoint?.(event.clientX, event.clientY);
      const target = event.target as Element;
      const hit = here.find((item) => {
        const anchor = anchorOf(root, item);
        if (!anchor) return false;
        if (anchor.range && caret) return anchor.range.isPointInRange(caret.startContainer, caret.startOffset);
        return !item.quote && anchor.holder.contains(target);
      }) ?? here.find((item) => { const anchor = anchorOf(root, item); return !!anchor && anchor.holder.contains(target); });
      if (hit) onActive(hit.id);
    };
    root.addEventListener('click', press);
    return () => root.removeEventListener('click', press);
  }, [here, onActive]);

  const when = (iso: string) => new Date(iso).toLocaleDateString('ko-KR', { month: 'long', day: 'numeric' });
  const card = (item: FeedbackItem) => <article key={item.id} ref={(node) => { if (node) cards.current.set(item.id, node); else cards.current.delete(item.id); }}
    className={`margin-card${item.id === active ? ' active' : ''}${item.status === 'resolved' ? ' resolved' : ''}`}
    style={layout.side && layout.tops[item.id] !== undefined ? { top: layout.tops[item.id] } : undefined}
    onClick={() => onActive(item.id)}>
    <header><strong>{item.author.name}</strong><span>{when(item.createdAt)}</span></header>
    {item.quote && <blockquote><RichText text={item.quote} /></blockquote>}
    {(item.reason || item.body) && <p>{item.reason && <span className="feedback-reason-tag">{reasonLabel(item.reason)}</span>}{item.body}</p>}
    {(item.lessonVersionId !== baseVersionId || item.status === 'resolved') && <small>
      {item.status === 'resolved' ? '처리함' : '지난 판본에서 남긴 의견이에요'}</small>}
    <footer>
      <button type="button" className="text-button" onClick={(event) => { event.stopPropagation(); onFix(item); }}>고치기</button>
      <button type="button" className="text-button" disabled={busy} onClick={(event) => { event.stopPropagation();
        onAct({ action: item.status === 'open' ? 'feedback.resolve' : 'feedback.reopen', feedbackId: item.id }); }}>
        <Icon name="check" size={13} />{item.status === 'open' ? '처리함' : '다시 열기'}</button>
    </footer>
  </article>;

  const placed = here.filter((item) => !layout.loose.includes(item.id));
  const loose = here.filter((item) => layout.loose.includes(item.id));
  return <div className="feedback-margin" ref={box}>
    <div className="feedback-margin-head">
      <label><input type="checkbox" checked={showResolved} onChange={(event) => setShowResolved(event.target.checked)} />처리한 것도 보기</label>
    </div>
    {!here.length && <p className="editor-note">이 단계에 남은 의견이 없어요.</p>}
    <div ref={column} className={layout.side ? 'margin-cards aligned' : 'margin-cards'} style={layout.side ? { height: layout.height } : undefined}>
      {placed.map(card)}
    </div>
    {loose.length > 0 && <section className="margin-loose"><h4>이 단계에서 자리를 찾지 못한 의견</h4>
      <p className="editor-note">그 블록이 지워졌거나 옮겨졌어요.</p>{loose.map(card)}</section>}
    {(elsewhere.length > 0 || away > 0) && <section className="margin-elsewhere"><h4>다른 단계의 의견</h4>
      {elsewhere.map((step) => <button key={step.sectionId} type="button" className="text-button" onClick={() => onStep(step.index)}>
        {step.index + 1}단계 · {step.title} <b>{step.count}</b></button>)}
      {away > 0 && <p className="editor-note">지금 초안에 없는 단계에 {away}개가 있어요. 「수업 의견」에서 볼 수 있어요.</p>}
    </section>}
  </div>;
}
