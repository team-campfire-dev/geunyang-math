'use client';

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type CSSProperties, type FormEvent, type ReactNode } from 'react';
import { feedbackLimits, feedbackReasons, reasonLabel, type FeedbackAction, type FeedbackItem, type FeedbackReason, type LessonFeedbackView } from '@/shared/feedback';
import { feedbackApi } from './api-client';
import { quoteOf, rangeOf } from './feedback-quote';
import { Icon, type IconName } from './icons';
import { RichText } from './content-blocks';

/** Where in a step somebody is pointing: a block, a question in it, and the words they dragged over. */
export type FeedbackTarget = { blockId: string; problemVersionId: string | null; quote: string | null };
type Place = { lessonKey: string; lessonVersionId: string; sectionId: string };

const reasonIcons: Record<FeedbackReason, IconName> = { confusing: 'question', hard: 'steep', wrong: 'alert', broken: 'screen', good: 'smile' };
const messageOf = (reason: unknown) => (reason instanceof Error ? reason.message : '의견을 보내지 못했어요. 다시 시도해 주세요.');
const sameSpot = (a: Pick<FeedbackTarget, 'blockId' | 'problemVersionId'>, b: Pick<FeedbackTarget, 'blockId' | 'problemVersionId'>) =>
  a.blockId === b.blockId && (a.problemVersionId ?? null) === (b.problemVersionId ?? null);

/**
 * What this reader may see and say about a lesson. Signed out there is nothing to load: a note needs
 * somebody to have written it, and the lesson reads the same without it.
 */
export function useLessonFeedback(lessonKey: string | null, userId: string | null) {
  const [view, setView] = useState<LessonFeedbackView | null>(null);
  useEffect(() => {
    setView(null);
    if (!lessonKey || !userId) return;
    let live = true;
    // Feedback is beside the lesson, never in its way: a failed load leaves the lesson as it is.
    feedbackApi.lesson(lessonKey).then((response) => { if (live) setView(response.feedback); }, () => {});
    return () => { live = false; };
  }, [lessonKey, userId]);
  const act = useCallback(async (action: FeedbackAction) => {
    if (!userId) return;
    setView((await feedbackApi.act(action, userId)).feedback);
  }, [userId]);
  return { view, act };
}

type Context = {
  view: LessonFeedbackView; place: Place;
  active: FeedbackTarget | null;
  /** Opens the note over the page, next to what was pressed or dragged over. */
  open: (target: FeedbackTarget, anchor: DOMRect, align: 'start' | 'end') => void;
  close: () => void;
  itemsAt: (spot: Pick<FeedbackTarget, 'blockId' | 'problemVersionId'>) => FeedbackItem[];
  act: (action: FeedbackAction) => Promise<void>;
  onSent: () => void;
};
const FeedbackContext = createContext<Context | null>(null);

/** The quotes in this step drawn as highlights, where the browser can draw one without touching the page. */
function useQuoteHighlights(root: HTMLElement | null, items: FeedbackItem[], active: FeedbackTarget | null) {
  useEffect(() => {
    const registry = typeof CSS !== 'undefined' ? (CSS as unknown as { highlights?: Map<string, unknown> }).highlights : undefined;
    const Highlight = (globalThis as unknown as { Highlight?: new (...ranges: Range[]) => unknown }).Highlight;
    if (!root || !registry || !Highlight) return;
    const find = (item: { blockId: string | null; problemVersionId: string | null; quote: string | null }) => {
      if (!item.quote || !item.blockId) return null;
      const block = root.querySelector(`[data-feedback-block="${CSS.escape(item.blockId)}"]`);
      const holder = item.problemVersionId ? block?.querySelector(`[data-feedback-problem="${CSS.escape(item.problemVersionId)}"]`) : block;
      return holder ? rangeOf(item.quote, holder) : null;
    };
    const kept = items.filter((item) => item.status === 'open').map(find).filter((range): range is Range => !!range);
    const drafting = active ? find(active) : null;
    registry.set('lesson-feedback', new Highlight(...kept));
    if (drafting) registry.set('lesson-feedback-draft', new Highlight(drafting)); else registry.delete('lesson-feedback-draft');
    return () => { registry.delete('lesson-feedback'); registry.delete('lesson-feedback-draft'); };
  }, [root, items, active]);
}

/**
 * Around one step of a lesson. Dragging over words in it offers a small 「의견 남기기」 under them,
 * and each drawing, table and question has a mark on its edge; either opens a note right there. There
 * is no mode to go into — reading and saying something are the same screen.
 */
export function FeedbackLayer({ view, place, act, children }: {
  view: LessonFeedbackView | null; place: Place; act: (action: FeedbackAction) => Promise<void>; children: ReactNode;
}) {
  const [root, setRoot] = useState<HTMLDivElement | null>(null);
  const [active, setActive] = useState<FeedbackTarget | null>(null);
  const [picked, setPicked] = useState<{ target: FeedbackTarget; anchor: DOMRect; top: number; left: number } | null>(null);
  const [at, setAt] = useState<{ top: number; left: number; width: number } | null>(null);
  const [sent, setSent] = useState(false);
  const accepting = !!view?.accepting;
  const items = useMemo(() => (view?.items ?? []).filter((item) => item.sectionId === place.sectionId), [view, place.sectionId]);

  useEffect(() => {
    if (!root || !accepting) return;
    let frame = 0;
    const look = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        const selection = window.getSelection();
        if (!selection || selection.isCollapsed || !selection.rangeCount) { setPicked(null); return; }
        const range = selection.getRangeAt(0);
        const start = range.startContainer instanceof Element ? range.startContainer : range.startContainer.parentElement;
        if (!start || !root.contains(start) || start.closest('[data-feedback-chrome], input, textarea')) { setPicked(null); return; }
        const block = start.closest<HTMLElement>('[data-feedback-block]');
        if (!block) { setPicked(null); return; }
        const problem = start.closest<HTMLElement>('[data-feedback-problem]');
        const quote = quoteOf(range, problem ?? block);
        if (!quote) { setPicked(null); return; }
        const rects = range.getClientRects();
        const end = rects[rects.length - 1] ?? range.getBoundingClientRect();
        const box = root.getBoundingClientRect();
        setPicked({ target: { blockId: block.dataset.feedbackBlock!, problemVersionId: problem?.dataset.feedbackProblem ?? null, quote }, anchor: end,
          top: end.bottom - box.top + 6, left: Math.min(Math.max(end.right - box.left - 50, 0), Math.max(box.width - 110, 0)) });
      });
    };
    document.addEventListener('selectionchange', look);
    return () => { cancelAnimationFrame(frame); document.removeEventListener('selectionchange', look); };
  }, [root, accepting]);

  useEffect(() => {
    if (!sent) return;
    const timer = window.setTimeout(() => setSent(false), 2600);
    return () => window.clearTimeout(timer);
  }, [sent]);

  useQuoteHighlights(root, items, active);

  const context = useMemo<Context | null>(() => view && {
    view, place, active, act,
    open: (target, anchor, align) => {
      const box = root?.getBoundingClientRect();
      const width = Math.min(360, box?.width ?? 360);
      const edge = align === 'end' ? anchor.right - width : anchor.left - 16;
      setAt({ top: anchor.bottom - (box?.top ?? 0) + 8, left: Math.min(Math.max(edge - (box?.left ?? 0), 0), Math.max((box?.width ?? width) - width, 0)), width });
      setActive(target); setPicked(null); setSent(false);
    },
    close: () => setActive(null),
    itemsAt: (spot) => items.filter((item) => item.blockId !== null && sameSpot({ blockId: item.blockId, problemVersionId: item.problemVersionId }, spot)),
    onSent: () => { setActive(null); setSent(true); },
  }, [view, place, active, act, items, root]);

  if (!context || (!accepting && !items.length)) return <>{children}</>;
  const pick = () => {
    if (!picked) return;
    context.open(picked.target, picked.anchor, 'start');
    window.getSelection()?.removeAllRanges();
  };
  return <FeedbackContext.Provider value={context}>
    <div className="feedback-layer" ref={setRoot}>
      {children}
      {picked && <button type="button" className="feedback-pick" data-feedback-chrome style={{ top: picked.top, left: picked.left }}
        // Acting on the press keeps a touch from clearing the selection before the button hears it.
        onPointerDown={(event) => { event.preventDefault(); pick(); }} onClick={pick}>
        <Icon name="comment" size={14} />의견 남기기</button>}
      {active && at && <FeedbackThread key={`${active.blockId}:${active.problemVersionId}:${active.quote}`} style={{ top: at.top, left: at.left, width: at.width }} />}
      <p className="feedback-sent" role="status" data-feedback-chrome>{sent ? '의견을 남겼어요. 고마워요!' : ''}</p>
    </div>
  </FeedbackContext.Provider>;
}

/**
 * One block, or one question in a block, as somewhere feedback can point. A drawing, a table or a
 * question carries a mark on its edge; prose shows one only once something was said about it, since
 * prose is pointed at by dragging over it.
 */
export function FeedbackSpot({ blockId, problemVersionId = null, mark, className, children }: {
  blockId: string; problemVersionId?: string | null; mark: 'always' | 'when-noted' | 'never'; className?: string; children: ReactNode;
}) {
  const context = useContext(FeedbackContext);
  const spot = { blockId, problemVersionId };
  const items = context?.itemsAt(spot) ?? [];
  const opened = !!context?.active && !context.active.quote && sameSpot(context.active, spot);
  const open = items.filter((item) => item.status === 'open').length;
  const shown = !!context && (mark === 'always' ? context.view.accepting || items.length > 0 : mark === 'when-noted' && items.length > 0);
  const data = problemVersionId ? { 'data-feedback-problem': problemVersionId } : { 'data-feedback-block': blockId };
  return <div className={`${className ?? ''} feedback-target${shown ? ' has-feedback-mark' : ''}`.trim()} {...data}>
    {children}
    {shown && <button type="button" className={`feedback-mark${items.length ? ' noted' : ''}${opened ? ' open' : ''}`} data-feedback-chrome
      aria-expanded={opened} aria-label={items.length ? `남긴 의견 ${items.length}개 보기` : '여기에 의견 남기기'}
      title={items.length ? `남긴 의견 ${items.length}개` : '여기에 의견 남기기'}
      onClick={(event) => opened ? context!.close() : context!.open({ ...spot, quote: null }, event.currentTarget.getBoundingClientRect(), 'end')}>
      <Icon name="comment" size={14} />{open > 0 && <span>{open}</span>}</button>}
  </div>;
}

/**
 * The note itself, as a layer over the lesson rather than a block pushed into it: the step stays where
 * it was while somebody writes. Most of what anybody says fits one of a few quick answers, which go
 * in one press; the field to write in opens only when they ask for it. Pressing outside closes it,
 * unless something is half written.
 */
function FeedbackThread({ style }: { style: CSSProperties }) {
  const context = useContext(FeedbackContext)!;
  const { view, place, active, act } = context;
  const [body, setBody] = useState('');
  const [writing, setWriting] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const field = useRef<HTMLTextAreaElement>(null);
  const layer = useRef<HTMLDivElement>(null);
  const items = context.itemsAt(active!);
  useEffect(() => {
    layer.current?.scrollIntoView({ block: 'nearest' });
    layer.current?.querySelector<HTMLButtonElement>('.feedback-reason')?.focus({ preventScroll: true });
  }, []);
  useEffect(() => { if (writing) field.current?.focus({ preventScroll: true }); }, [writing]);
  const halfWritten = useRef(false);
  halfWritten.current = !!body.trim();
  useEffect(() => {
    const away = (event: PointerEvent) => {
      const target = event.target as Element | null;
      if (halfWritten.current || !target || layer.current?.contains(target) || target.closest('.feedback-mark, .feedback-pick')) return;
      context.close();
    };
    document.addEventListener('pointerdown', away);
    return () => document.removeEventListener('pointerdown', away);
  }, [context]);

  const run = async (action: FeedbackAction, then?: () => void) => {
    if (busy) return;
    setBusy(true); setError('');
    try { await act(action); then?.(); }
    catch (reason) { setError(messageOf(reason)); }
    finally { setBusy(false); }
  };
  /** A quick answer goes at once, and takes along whatever was written beside it. */
  const send = (reason: FeedbackReason | null) => {
    if (!reason && !body.trim()) return;
    void run({ action: 'feedback.add', ...place, blockId: active!.blockId, problemVersionId: active!.problemVersionId, quote: active!.quote, reason, body: body.trim() },
      () => { setBody(''); context.onSent(); });
  };
  const submit = (event: FormEvent) => { event.preventDefault(); send(null); };
  const when = (iso: string) => new Date(iso).toLocaleDateString('ko-KR', { month: 'long', day: 'numeric' });

  return <div className="feedback-thread feedback-popover" data-feedback-chrome role="dialog" aria-label="이 자리의 의견" ref={layer} style={style}
    onKeyDown={(event) => { if (event.key === 'Escape') { event.stopPropagation(); context.close(); } }}>
    <div className="feedback-popover-head"><strong>{items.length ? `남긴 의견 ${items.length}개` : '의견 남기기'}</strong>
      <button type="button" className="icon-button" aria-label="의견 닫기" onClick={context.close}><Icon name="close" size={15} /></button></div>
    {items.map((item) => <article key={item.id} className={`feedback-note ${item.status}`}>
      {item.quote && <blockquote><RichText text={item.quote} /></blockquote>}
      <p>{item.reason && <span className="feedback-reason-tag"><Icon name={reasonIcons[item.reason]} size={13} />{reasonLabel(item.reason)}</span>}{item.body}</p>
      <footer>
        <span>{view.reviewer && !item.author.mine ? item.author.name : '내 의견'} · {when(item.createdAt)}
          {item.lessonVersionId !== place.lessonVersionId && ' · 다른 판본에서'}
          {item.status === 'resolved' && (view.reviewer ? ' · 처리함' : ' · 운영자가 확인했어요')}</span>
        {view.reviewer && <button type="button" className="text-button" disabled={busy}
          onClick={() => void run({ action: item.status === 'open' ? 'feedback.resolve' : 'feedback.reopen', feedbackId: item.id })}>
          {item.status === 'open' ? '처리함으로' : '다시 열기'}</button>}
        {(item.author.mine || view.reviewer) && <button type="button" className="text-button" disabled={busy}
          onClick={() => void run({ action: 'feedback.remove', feedbackId: item.id })}>지우기</button>}
      </footer>
    </article>)}
    {view.accepting ? <div className="feedback-compose">
      {active!.quote && <blockquote className="draft"><RichText text={active!.quote} /></blockquote>}
      <div className="feedback-reasons" role="group" aria-label={active!.quote ? '이 부분은' : '여기는'}>
        {feedbackReasons.map((reason) => <button key={reason.key} type="button" className={`feedback-reason reason-${reason.key}`} disabled={busy}
          onClick={() => send(reason.key)}><Icon name={reasonIcons[reason.key]} size={15} />{reason.label}</button>)}
      </div>
      {writing ? <form onSubmit={submit}>
        <label className="sr-only" htmlFor="feedback-body">의견</label>
        <textarea id="feedback-body" ref={field} value={body} rows={3} maxLength={feedbackLimits.body} disabled={busy}
          placeholder={active!.quote ? '이 부분에서 무엇이 헷갈렸나요?' : '여기서 헷갈리거나 이상한 점이 있었나요?'}
          onChange={(event) => setBody(event.target.value)}
          onKeyDown={(event) => { if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) submit(event); }} />
        {error && <p className="field-error" role="alert">{error}</p>}
        <div className="feedback-actions">
          <span className="muted small">위에서 하나 골라도 함께 가요.</span>
          <button type="submit" className="button primary" disabled={busy || !body.trim()}>{busy ? '보내는 중…' : '보내기'}</button>
        </div>
      </form> : <>
        {error && <p className="field-error" role="alert">{error}</p>}
        <button type="button" className="text-button feedback-write" onClick={() => setWriting(true)}><Icon name="pencil" size={14} />직접 쓰기</button>
      </>}
    </div> : <>
      {error && <p className="field-error" role="alert">{error}</p>}
      <p className="muted small">이 수업은 지금 의견을 받지 않아요.</p>
    </>}
  </div>;
}
