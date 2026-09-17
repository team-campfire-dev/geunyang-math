'use client';

import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import type { GlossaryEntry, PublicLesson } from '@/shared/api';
import { definitionPath, referenceOf } from '@/shared/definition-exploration';
import { definitionRefId, type DefinitionRef } from '@/shared/rich-text';
import { ContentBlocks, RichText, type GlossaryContext } from './content-blocks';
import { Icon } from './icons';

type Frame = { entry: GlossaryEntry; scroll: number };
type Navigation = { frames: Frame[]; trigger: HTMLButtonElement | null; scroll: number };
const historyKey = 'gmConceptExplorer';
const focusable = 'button:not([disabled]), a[href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), summary, [tabindex="0"]';

/** A single reader for lesson prose and author previews. Question renderers never receive its opener. */
export function ConceptExplorer({ glossary, loadDefinition, lessons = [], browserHistory = true, allowSidePanel = true, returnLabel = '수업으로 돌아가기', children }: {
  glossary: GlossaryContext;
  loadDefinition: (path: DefinitionRef[]) => Promise<GlossaryEntry>;
  lessons?: PublicLesson[];
  browserHistory?: boolean;
  allowSidePanel?: boolean;
  returnLabel?: string;
  children: (glossary: GlossaryContext) => ReactNode;
}) {
  const id = useId();
  const historyId = useRef('');
  if (!historyId.current) historyId.current = crypto.randomUUID();
  const host = useRef<HTMLDivElement>(null);
  const panel = useRef<HTMLElement>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  const body = useRef<HTMLDivElement>(null);
  const portal = useRef<HTMLDivElement>(null);
  const rootTrigger = useRef<HTMLButtonElement | null>(null);
  const rootScroll = useRef(0);
  const frames = useRef<Frame[]>([]);
  const historyPosition = useRef(0);
  const historyFrames = useRef(new Map<number, Navigation>());
  const resetRoot = useRef<(() => void) | null>(null);
  const pending = useRef<DefinitionRef[] | null>(null);
  const generation = useRef(0);
  const alive = useRef(true);
  const [shown, setShown] = useState<Frame[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [wide, setWide] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [restoring, setRestoring] = useState(false);
  const open = shown.length > 0;
  const current = shown.at(-1)?.entry;
  const loader = useRef(loadDefinition); loader.current = loadDefinition;
  const restoreFocus = () => {
    const trigger = rootTrigger.current;
    requestAnimationFrame(() => {
      if (!trigger?.isConnected) return;
      window.scrollTo({ top: rootScroll.current, behavior: 'instant' });
      trigger.focus({ preventScroll: true });
    });
  };
  const show = (next: Frame[], restoringFrame = false) => {
    frames.current = next; setShown(next); setRestoring(restoringFrame);
  };
  const saveScroll = () => {
    const frame = frames.current.at(-1);
    if (frame) frame.scroll = body.current?.scrollTop ?? 0;
  };
  const writeHistory = (next: Frame[], replace = false) => {
    if (!browserHistory) return;
    if (!replace) historyPosition.current += 1;
    const position = historyPosition.current;
    for (const key of historyFrames.current.keys()) if (key > position) historyFrames.current.delete(key);
    historyFrames.current.set(position, { frames: next, trigger: rootTrigger.current, scroll: rootScroll.current });
    const state = { ...window.history.state, [historyKey]: { id: historyId.current, position } };
    if (replace) window.history.replaceState(state, '');
    else window.history.pushState(state, '');
  };
  const close = () => {
    generation.current += 1; pending.current = null; setLoading(false); setError('');
    if (resetRoot.current) {
      resetRoot.current = () => { show([]); restoreFocus(); };
      show([]); return;
    }
    if (browserHistory && window.history.state?.[historyKey]?.id === historyId.current && historyPosition.current) {
      show([]); restoreFocus();
      window.history.go(-historyPosition.current);
    } else { show([]); restoreFocus(); }
  };

  useEffect(() => {
    alive.current = true;
    const measure = () => setWide(allowSidePanel && (host.current?.getBoundingClientRect().width ?? 0) >= 800 && window.innerWidth >= 1100);
    const observer = new ResizeObserver(measure);
    if (host.current) observer.observe(host.current);
    measure();
    const onPop = (event: PopStateEvent) => {
      generation.current += 1; pending.current = null; setLoading(false); setError('');
      if (resetRoot.current) {
        const reset = resetRoot.current; resetRoot.current = null;
        historyPosition.current = 0; reset(); return;
      }
      const marker = event.state?.[historyKey];
      const saved = marker?.id === historyId.current ? historyFrames.current.get(marker.position) : undefined;
      historyPosition.current = saved ? marker.position : 0;
      if (saved) { rootTrigger.current = saved.trigger; rootScroll.current = saved.scroll; show(saved.frames, true); }
      else { show([]); restoreFocus(); }
    };
    if (browserHistory) window.addEventListener('popstate', onPop);
    return () => {
      const resetting = !!resetRoot.current;
      alive.current = false; resetRoot.current = null; generation.current += 1; observer.disconnect();
      window.removeEventListener('popstate', onPop);
      // These same-URL history entries belong to the reader, not to the next lesson/step.
      if (!resetting && browserHistory && window.history.state?.[historyKey]?.id === historyId.current && historyPosition.current) window.history.go(-historyPosition.current);
    };
  }, [browserHistory, allowSidePanel, id]);

  useEffect(() => {
    if (!open) { setExpanded(false); return; }
    heading.current?.focus({ preventScroll: true });
    if (body.current) body.current.scrollTop = restoring ? shown.at(-1)?.scroll ?? 0 : 0;
  }, [shown, open, restoring]);

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); close(); return; }
      if (wide || event.key !== 'Tab') return;
      const items = Array.from(panel.current?.querySelectorAll<HTMLElement>(focusable) ?? []).filter(item => item.getClientRects().length);
      const first = items[0], last = items.at(-1);
      if (!first) { event.preventDefault(); return; }
      const active = document.activeElement;
      if (event.shiftKey && (active === first || active === heading.current)) { event.preventDefault(); last?.focus(); }
      else if (!event.shiftKey && (active === last || !panel.current?.contains(active))) { event.preventDefault(); first.focus(); }
    };
    document.addEventListener('keydown', onKey);
    if (wide) return () => document.removeEventListener('keydown', onKey);
    const background = Array.from(document.body.children).filter((node): node is HTMLElement => node instanceof HTMLElement && node !== portal.current);
    const previous = background.map(node => ({ node, inert: node.inert }));
    background.forEach(node => { node.inert = true; });
    const overflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      previous.forEach(({ node, inert }) => { node.inert = inert; });
      document.body.style.overflow = overflow;
    };
  }, [open, wide]);

  const load = async (path: DefinitionRef[], root = false) => {
    const request = ++generation.current;
    pending.current = path; setLoading(true); setError('');
    try {
      const entry = await loader.current(path);
      if (!alive.current || generation.current !== request) return;
      saveScroll();
      const next = root ? [{ entry, scroll: 0 }] : [...frames.current, { entry, scroll: 0 }];
      show(next); writeHistory(next, root); pending.current = null;
    } catch (reason) {
      if (alive.current && generation.current === request) setError(reason instanceof Error ? reason.message : '뜻풀이를 불러오지 못했어요.');
    } finally {
      if (alive.current && generation.current === request) setLoading(false);
    }
  };
  const openRoot = (ref: DefinitionRef, trigger: HTMLButtonElement) => {
    const entry = glossary.entries.find(item => definitionRefId(item) === definitionRefId(ref));
    if (!entry) return;
    generation.current += 1;
    rootTrigger.current = trigger; rootScroll.current = window.scrollY;
    const next = [{ entry: { ...entry, blocks: [] }, scroll: 0 }];
    if (resetRoot.current) {
      resetRoot.current = () => { show(next); writeHistory(next); void load([referenceOf(ref)], true); };
      return;
    }
    // Opening another word starts a new reading path without mixing its history with the old root.
    if (frames.current.length) {
      const position = historyPosition.current;
      if (browserHistory && position > 0) {
        resetRoot.current = () => { show(next); writeHistory(next); void load([referenceOf(ref)], true); };
        // Return to the lesson entry before pushing the new root, discarding the old forward path.
        window.history.go(-position); return;
      }
      show(next); writeHistory(next, true);
    } else { show(next); writeHistory(next); }
    void load([referenceOf(ref)], true);
  };
  const openNested = (ref: DefinitionRef) => {
    saveScroll();
    const path = definitionPath(frames.current.map(frame => referenceOf(frame.entry)), referenceOf(ref));
    if (path.length <= frames.current.length) {
      generation.current += 1; setLoading(false); setError(''); pending.current = null;
      const distance = frames.current.length - path.length;
      if (browserHistory && distance) window.history.go(-distance);
      else show(frames.current.slice(0, path.length), true);
      return;
    }
    void load(path);
  };
  const back = () => {
    generation.current += 1; setLoading(false); setError(''); pending.current = null;
    saveScroll();
    if (browserHistory) window.history.back();
    else show(frames.current.slice(0, -1), true);
  };
  const related = current?.lessonKey && current.lessonKey !== glossary.currentLessonKey ? lessons.find(lesson => lesson.lessonKey === current.lessonKey) : undefined;
  const context: GlossaryContext = { ...glossary, onOpenDefinition: openRoot, activeDefinition: current ? definitionRefId(current) : undefined, panelId: id };

  return <div className={`concept-reader${open && wide ? ' has-concept-panel' : ''}`} ref={host}>
    <div className="concept-reader-content">{children(context)}</div>
    {open && createPortal(<div ref={portal} className={`concept-explorer-layer ${wide ? 'concept-wide' : 'concept-modal'}${expanded ? ' concept-expanded' : ''}`}>
      {!wide && <div className="concept-scrim" onClick={close} aria-hidden="true" />}
      <section ref={panel} id={id} className="concept-panel" role={wide ? 'region' : 'dialog'} aria-modal={wide ? undefined : true} aria-labelledby={`${id}-title`}>
        <div className="concept-panel-actions">
          {shown.length > 1 && <button type="button" className="text-button" onClick={back} aria-label={`이전 개념: ${shown.at(-2)?.entry.label}`}><Icon name="back" size={16} />{shown.at(-2)?.entry.label}</button>}
          <button type="button" className="text-button concept-close" onClick={close}>{returnLabel}<Icon name="close" size={17} /></button>
        </div>
        {!wide && <button type="button" className="text-button concept-expand" onClick={() => setExpanded(value => !value)} aria-expanded={expanded}>{expanded ? '작게 보기' : '크게 보기'}</button>}
        <div className="concept-panel-body" ref={body} aria-busy={loading}>
          {shown.length > 1 && <p className="concept-path" aria-label="탐색 경로">{shown.length > 3 ? `${shown[0].entry.label} › … › ${shown.at(-2)?.entry.label} › ${current?.label}` : shown.map(frame => frame.entry.label).join(' › ')}</p>}
          <h2 ref={heading} tabIndex={-1} id={`${id}-title`}>{current?.label}</h2>
          {current?.usageNote && <p className="concept-usage">{current.usageNote}</p>}
          {current?.summary && <div className="concept-summary"><RichText text={current.summary} /></div>}
          {loading && <p role="status" className="concept-loading">뜻풀이를 불러오고 있어요…</p>}
          {error && <div className="error-banner" role="alert"><span>{error}</span><button type="button" className="text-button" onClick={() => pending.current && void load(pending.current, pending.current.length === 1)}>다시 시도</button></div>}
          {current && <ContentBlocks blocks={current.blocks} glossary={{ entries: [], onOpenDefinition: openNested, allowUnresolvedDefinitions: true, panelId: id }} />}
          {related && <details className="concept-related"><summary>관련 수업 보기</summary><h3>{related.title}</h3><p>{related.summary}</p><a className="text-button" href={`/?lesson=${encodeURIComponent(related.lessonKey)}`} target="_blank" rel="noopener noreferrer">새 탭에서 수업 읽기<Icon name="arrow" size={16} /></a><small>지금 읽는 수업과 작성 중인 답은 이 탭에 남아요.</small></details>}
        </div>
      </section>
    </div>, document.body)}
  </div>;
}
