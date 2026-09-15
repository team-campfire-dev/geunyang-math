'use client';

import { useEffect, useId, useState, type ReactNode } from 'react';
import katex from 'katex';
import type { ContentBlock, GlossaryEntry, PublicProblem } from '@/shared/api';
import {
  builderLimits, builderStatus, createSlots, nextFrameIndex, placedCount, sequenceLimits, setSlot, stepFrameIndex,
  type BuilderStatus, type StripFrame,
} from '@/shared/manipulatives';
import { cssColor, itemBounds, sceneItemKinds, sceneLimits, type SceneItem } from '@/shared/scene';
import { locateTerms, splitRichText, type TermAnnotation } from '@/shared/rich-text';
import { Icon } from './icons';

/**
 * Terms the server chose to reveal here. An annotation whose term is absent renders as plain text,
 * so the decision to withhold a definition lives on the server and never leaks into the markup.
 */
export type GlossaryContext = {
  entries: GlossaryEntry[];
  /** Concepts the learner is still practising; their terms get a stronger hint that help is there. */
  reviewSkillKeys?: string[];
  currentClassKey?: string;
  onOpenClass?: (classKey: string) => void;
};
const noGlossary: GlossaryContext = { entries: [] };

export function RichText({ text, terms = [], glossary = noGlossary, asCaption = false }: { text: string; terms?: TermAnnotation[]; glossary?: GlossaryContext; asCaption?: boolean }) {
  const [openTerm, setOpenTerm] = useState<string | null>(null);
  const panelId = useId();
  const entryOf = (termKey: string) => glossary.entries.find((entry) => entry.termKey === termKey);
  // A caption renders inline inside figcaption, where an expanding panel has nowhere to open.
  const spans = asCaption ? [] : locateTerms(text, terms.filter((term) => entryOf(term.termKey))).spans;
  const open = openTerm ? entryOf(openTerm) : undefined;
  // Only the math renderer creates HTML. Text and authored content remain React text nodes.
  const nodes: ReactNode[] = [];
  const pushText = (value: string, key: number) => { if (value) nodes.push(<span key={key}>{value}</span>); };
  for (const segment of splitRichText(text)) {
    if (segment.kind === 'math') {
      try {
        const html = katex.renderToString(segment.equation, { displayMode: segment.display, throwOnError: false, trust: false, strict: 'error', maxExpand: 1000 });
        nodes.push(<span key={segment.start} className={segment.display ? 'display-math' : undefined} dangerouslySetInnerHTML={{ __html: html }} />);
      } catch { pushText(segment.value, segment.start); }
      continue;
    }
    const segmentEnd = segment.start + segment.value.length;
    let cursor = segment.start;
    for (const span of spans) {
      if (span.start < cursor || span.end > segmentEnd) continue;
      const entry = entryOf(span.termKey)!;
      const expanded = openTerm === span.termKey;
      pushText(text.slice(cursor, span.start), cursor);
      nodes.push(<button key={span.start} type="button" aria-expanded={expanded} aria-controls={expanded ? panelId : undefined}
        className={`term-mark${glossary.reviewSkillKeys?.includes(entry.skillKey) ? ' needs-review' : ''}${expanded ? ' open' : ''}`}
        onClick={() => setOpenTerm(expanded ? null : span.termKey)}>{text.slice(span.start, span.end)}</button>);
      cursor = span.end;
    }
    pushText(text.slice(cursor, segmentEnd), cursor);
  }
  const Wrapper = asCaption ? 'span' : 'div';
  return <Wrapper className={asCaption ? 'caption-text' : 'rich-text'} onKeyDown={(event) => { if (event.key === 'Escape' && openTerm) { event.stopPropagation(); setOpenTerm(null); } }}>
    {nodes}
    {open && <aside className="term-panel" id={panelId}>
      <div className="term-panel-head"><strong>{open.label}</strong>
        <button type="button" className="icon-button" aria-label="용어 설명 닫기" onClick={() => setOpenTerm(null)}><Icon name="close" size={15} /></button></div>
      <p className="term-summary">{open.summary}</p>
      {/* Definitions never nest: the inner blocks render without a glossary of their own. */}
      <ContentBlocks blocks={open.blocks} />
      {open.classKey && open.classKey !== glossary.currentClassKey && glossary.onOpenClass &&
        <button type="button" className="text-button" onClick={() => glossary.onOpenClass!(open.classKey!)}>이 개념 다시 배우기<Icon name="arrow" size={15} /></button>}
    </aside>}
  </Wrapper>;
}

/**
 * Draws a scene. Every value is placed in an attribute of an element created here — no authored
 * markup ever reaches the document — so an arbitrary drawing stays as safe as a fixed one. The
 * figure carries the accessible name and the shapes themselves are hidden from a reader.
 */
export function SceneFigure({ width, height, items, alt, caption }:
{ width: number; height: number; items: SceneItem[]; alt: string; caption?: string }) {
  return <figure className="scene-figure" role="img" aria-label={alt}>
    <svg viewBox={`0 0 ${width} ${height}`} style={{ aspectRatio: `${width} / ${height}` }} aria-hidden="true" focusable="false">
      <SceneShapes items={items} />
    </svg>
    {caption && <figcaption><RichText text={caption} asCaption /></figcaption>}
  </figure>;
}

/** The shapes alone, so the editor's canvas draws exactly what the learner will see. */
export function SceneShapes({ items }: { items: SceneItem[] }) {
  const paint = (item: SceneItem) => ({
    fill: cssColor(item.fill), stroke: cssColor(item.stroke), strokeWidth: item.strokeWidth ?? (item.stroke ? 1 : 0),
    strokeDasharray: item.dash ? '4 3' : undefined, opacity: item.opacity, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const,
    transform: item.rotate ? rotateAround(item) : undefined,
  });
  return <>
    <defs><marker id="scene-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
      <path d="M0 0 L10 5 L0 10 z" fill="context-stroke" /></marker></defs>
    {items.map((item, index) => {
        const style = paint(item);
        if (item.kind === 'rect') return <rect key={index} x={item.x} y={item.y} width={item.width} height={item.height} rx={item.radius} {...style} />;
        if (item.kind === 'ellipse') return <ellipse key={index} cx={item.cx} cy={item.cy} rx={item.rx} ry={item.ry} {...style} />;
        if (item.kind === 'line') return <line key={index} x1={item.x1} y1={item.y1} x2={item.x2} y2={item.y2} {...style}
          markerEnd={item.arrow === 'end' || item.arrow === 'both' ? 'url(#scene-arrow)' : undefined}
          markerStart={item.arrow === 'both' ? 'url(#scene-arrow)' : undefined} />;
        if (item.kind === 'polygon') {
          const points = item.points.map(([x, y]) => `${x},${y}`).join(' ');
          return item.closed === false
            ? <polyline key={index} points={points} {...style} fill="none" />
            : <polygon key={index} points={points} {...style} />;
        }
        if (item.kind === 'path') return <path key={index} d={item.d} {...style} />;
        return <text key={index} x={item.x} y={item.y} textAnchor={item.anchor ?? 'start'} fontSize={item.size ?? 14}
          fontWeight={item.weight === 'bold' ? 600 : 400} {...style} stroke="none" fill={cssColor(item.fill, 'var(--ink)')}>{item.text}</text>;
    })}
  </>;
}
const rotateAround = (item: SceneItem) => {
  const bounds = itemBounds(item);
  return `rotate(${item.rotate} ${bounds.x + bounds.width / 2} ${bounds.y + bounds.height / 2})`;
};

/** The cells every strip is drawn from: a still figure, a frame of an animation, and the board a
 *  learner fills all show the same object, so they share one way of drawing it. */
function StripCells({ parts, filled, animated = false }: { parts: number; filled: number; animated?: boolean }) {
  return <div className="fraction-strip" style={{ gridTemplateColumns: `repeat(${parts}, minmax(0, 1fr))`, minWidth: parts > 24 ? `${parts * 7}px` : undefined }} aria-hidden="true">
    {Array.from({ length: parts }, (_, index) =>
      // Cells settle one after another so a filling strip reads as a movement, not a jump.
      <span key={index} className={index < filled ? 'filled' : ''} style={animated ? { transitionDelay: `${Math.min(index, 8) * 45}ms` } : undefined} />)}
  </div>;
}

export function FractionStrip({ parts, filled, label, accessibleLabel }: { parts: number; filled: number; label?: string; accessibleLabel?: string }) {
  // KaTeX gives the caption its own MathML; an aria-label would instead be read as raw markup.
  const named = accessibleLabel ?? (label && !label.includes('$') ? label : `${parts}등분 중 ${filled}개`);
  return <figure className="fraction-figure" aria-label={named}>
    <StripCells parts={parts} filled={filled} />
    {label && <figcaption><RichText text={label} asCaption /></figcaption>}
  </figure>;
}

/**
 * A strip played as frames. Playback starts stopped unless the author asked for autoplay, and
 * autoplay yields to a reduced-motion preference; the stepping controls stay either way, so the
 * whole sequence is reachable without any movement at all.
 */
export function FractionSequence({ parts, frames, alt, frameMs = sequenceLimits.defaultMs, loop = false, autoplay = false }:
{ parts: number; frames: StripFrame[]; alt: string; frameMs?: number; loop?: boolean; autoplay?: boolean }) {
  const [index, setIndex] = useState(0);
  const [playing, setPlaying] = useState(false);
  const total = frames.length;
  const frame = frames[Math.min(index, total - 1)];
  const atEnd = !loop && index === total - 1;
  useEffect(() => {
    if (!autoplay || window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    setPlaying(true);
  }, [autoplay]);
  useEffect(() => {
    if (!playing) return;
    const timer = setTimeout(() => {
      const next = nextFrameIndex(index, total, loop);
      if (next === index) setPlaying(false);
      else setIndex(next);
    }, frameMs);
    return () => clearTimeout(timer);
  }, [playing, index, total, loop, frameMs]);
  const step = (delta: number) => { setPlaying(false); setIndex(stepFrameIndex(index, total, delta)); };
  const toggle = () => {
    if (playing) { setPlaying(false); return; }
    if (atEnd) setIndex(0);
    setPlaying(true);
  };
  return <figure className="fraction-figure sequence-figure" aria-label={alt}>
    <StripCells parts={parts} filled={frame.filled} animated />
    {frame.caption && <figcaption><RichText text={frame.caption} asCaption /></figcaption>}
    <div className="figure-controls">
      <button type="button" className="icon-button" aria-label="이전 장면" disabled={index === 0} onClick={() => step(-1)}><Icon name="back" size={16} /></button>
      <button type="button" className="control-button" onClick={toggle}>
        <Icon name={playing ? 'pause' : 'play'} size={14} />{playing ? '멈춤' : atEnd ? '다시 보기' : '재생'}
      </button>
      <button type="button" className="icon-button" aria-label="다음 장면" disabled={index === total - 1} onClick={() => step(1)}><Icon name="arrow" size={16} /></button>
      <span className="sequence-count" aria-live="polite">장면 {index + 1} / {total}</span>
    </div>
  </figure>;
}

/**
 * Pieces the learner places into a strip. Tapping a slot is the interaction that works everywhere;
 * dragging a piece from the tray is an extra for a mouse, so touch and keyboard never depend on it.
 * Nothing here is reported to the server: this is a thing to try, not a thing that is marked.
 */
export function FractionBuilder({ parts, target, start = 0, prompt, promptAlt, successText }:
{ parts: number; target: number; start?: number; prompt: string; promptAlt?: string; successText?: string }) {
  const [slots, setSlots] = useState(() => createSlots(parts, start));
  const placed = placedCount(slots);
  const status = builderStatus(placed, target);
  const messages: Record<BuilderStatus, string> = {
    empty: '칸을 눌러 조각을 놓아 보세요.',
    building: `${parts}칸 중 ${placed}칸을 채웠어요.`,
    matched: successText ?? `${parts}칸 중 ${placed}칸, 목표한 만큼 놓았어요.`,
    over: `${parts}칸 중 ${placed}칸이라 목표보다 많아요. 하나 빼 볼까요?`,
  };
  return <div className="fraction-builder" role="group" aria-label={promptAlt ?? prompt}>
    <div className="builder-prompt"><RichText text={prompt} asCaption /></div>
    <div className="builder-board">
      <div className="builder-strip" style={{ gridTemplateColumns: `repeat(${parts}, minmax(0, 1fr))`, minWidth: parts > 8 ? `${parts * 34}px` : undefined }}>
        {slots.map((filled, slot) => <button key={slot} type="button" className={`builder-slot${filled ? ' filled' : ''}`}
          aria-pressed={filled} aria-label={`${slot + 1}번째 칸, ${filled ? '채움' : '비어 있음'}`}
          onClick={() => setSlots(setSlot(slots, slot, !filled))}
          onDragOver={(event) => { if (!filled) event.preventDefault(); }}
          onDrop={(event) => { event.preventDefault(); setSlots(setSlot(slots, slot, true)); }} />)}
      </div>
    </div>
    {/* Dragging is the extra a mouse gets; the tray is hidden on a touch device, where HTML drag
        does not fire and tapping a slot is the whole interaction. */}
    <div className="builder-tray">
      <span className="builder-piece" draggable aria-hidden="true"
        onDragStart={(event) => event.dataTransfer.setData('text/plain', 'fraction-piece')} />
      <span className="builder-hint">조각을 끌어다 놓아도 돼요.</span>
    </div>
    <p className={`builder-status ${status}`} aria-live="polite">{messages[status]}</p>
    <div className="builder-actions">
      <span>지금 <RichText text={`$\\frac{${placed}}{${parts}}$`} asCaption /></span>
      <button type="button" className="text-button" onClick={() => setSlots(createSlots(parts, start))}>처음으로</button>
    </div>
  </div>;
}

type BlockContext = { problems: PublicProblem[]; renderProblem: (problem: PublicProblem) => ReactNode; glossary: GlossaryContext };
type Renderer = { validate: (payload: Record<string, unknown>, context: BlockContext) => boolean; render: (block: ContentBlock, context: BlockContext) => ReactNode };
const validFraction = (payload: Record<string, unknown>) => Number.isInteger(payload.parts) && Number(payload.parts) >= 1 && Number(payload.parts) <= 100 && Number.isInteger(payload.filled) && Number(payload.filled) >= 0 && Number(payload.filled) <= Number(payload.parts);
// The shape of a scene, checked the way the other blocks are: enough to know the renderer can draw
// it. The publishing schema is the authority on what a scene may contain.
const validScene = (payload: Record<string, unknown>) => typeof payload.alt === 'string' && payload.alt.length > 0
  && Number.isFinite(payload.width) && Number.isFinite(payload.height) && Number(payload.width) > 0 && Number(payload.height) > 0
  && Array.isArray(payload.items) && payload.items.length <= sceneLimits.maxItems
  && payload.items.every((item) => !!item && typeof item === 'object' && sceneItemKinds.includes((item as SceneItem).kind));
const validSequence = (payload: Record<string, unknown>) => Number.isInteger(payload.parts) && Number(payload.parts) >= 1 && Number(payload.parts) <= 100
  && Array.isArray(payload.frames) && payload.frames.length >= sequenceLimits.minFrames && payload.frames.length <= sequenceLimits.maxFrames
  && payload.frames.every((frame) => !!frame && typeof frame === 'object' && Number.isInteger((frame as StripFrame).filled)
    && (frame as StripFrame).filled >= 0 && (frame as StripFrame).filled <= Number(payload.parts))
  && typeof payload.alt === 'string' && payload.alt.length > 0;
const validBuilder = (payload: Record<string, unknown>) => Number.isInteger(payload.parts)
  && Number(payload.parts) >= builderLimits.minParts && Number(payload.parts) <= builderLimits.maxParts
  && Number.isInteger(payload.target) && Number(payload.target) >= 0 && Number(payload.target) <= Number(payload.parts)
  && (payload.start === undefined || (Number.isInteger(payload.start) && Number(payload.start) >= 0 && Number(payload.start) <= Number(payload.parts)))
  && typeof payload.prompt === 'string' && payload.prompt.trim().length > 0;
const validTerms = (payload: Record<string, unknown>) => Array.isArray(payload.terms) && payload.terms.every((term) => !!term && typeof term === 'object' && typeof (term as TermAnnotation).termKey === 'string' && typeof (term as TermAnnotation).surface === 'string');
const registry: Record<string, Renderer> = {
  'core.rich_text@1': {
    validate: (payload) => typeof payload.text === 'string',
    render: (block) => <RichText text={block.payload.text as string} />,
  },
  'core.rich_text@2': {
    validate: (payload) => typeof payload.text === 'string' && validTerms(payload),
    render: (block, context) => <RichText text={block.payload.text as string} terms={block.payload.terms as TermAnnotation[]} glossary={context.glossary} />,
  },
  'math.fraction_strip@1': {
    validate: (payload) => validFraction(payload) && (!String(payload.label ?? '').includes('$') || typeof payload.labelAlt === 'string'),
    render: (block) => <FractionStrip parts={Number(block.payload.parts)} filled={Number(block.payload.filled)}
      label={typeof block.payload.label === 'string' ? block.payload.label : undefined}
      accessibleLabel={typeof block.payload.labelAlt === 'string' ? block.payload.labelAlt : undefined} />,
  },
  'core.figure@1': {
    validate: (payload) => typeof payload.alt === 'string' && !!payload.primitive && typeof payload.primitive === 'object' && (payload.primitive as Record<string, unknown>).kind === 'fraction_strip' && validFraction(payload.primitive as Record<string, unknown>),
    render: (block) => {
      const primitive = block.payload.primitive as Record<string, unknown>;
      const caption = typeof block.payload.caption === 'string' ? block.payload.caption : typeof primitive.label === 'string' ? primitive.label : undefined;
      // role="img" hides descendants, so alt alone names the figure and the caption may carry math.
      return <div role="img" aria-label={block.payload.alt as string}><FractionStrip parts={Number(primitive.parts)} filled={Number(primitive.filled)} label={caption} accessibleLabel={block.payload.alt as string} /></div>;
    },
  },
  'core.scene@1': {
    validate: validScene,
    render: (block) => <SceneFigure width={Number(block.payload.width)} height={Number(block.payload.height)}
      items={block.payload.items as SceneItem[]} alt={block.payload.alt as string}
      caption={typeof block.payload.caption === 'string' ? block.payload.caption : undefined} />,
  },
  'math.fraction_sequence@1': {
    validate: validSequence,
    render: (block) => <FractionSequence parts={Number(block.payload.parts)} frames={block.payload.frames as StripFrame[]} alt={block.payload.alt as string}
      frameMs={typeof block.payload.frameMs === 'number' ? block.payload.frameMs : undefined}
      loop={block.payload.loop === true} autoplay={block.payload.autoplay === true} />,
  },
  'math.fraction_builder@1': {
    validate: validBuilder,
    render: (block) => <FractionBuilder parts={Number(block.payload.parts)} target={Number(block.payload.target)}
      start={typeof block.payload.start === 'number' ? block.payload.start : undefined}
      prompt={block.payload.prompt as string}
      promptAlt={typeof block.payload.promptAlt === 'string' ? block.payload.promptAlt : undefined}
      successText={typeof block.payload.successText === 'string' ? block.payload.successText : undefined} />,
  },
  'core.problem_set@1': {
    validate: (payload, context) => Array.isArray(payload.problemVersionIds) && payload.problemVersionIds.length > 0 && payload.problemVersionIds.every((id) => typeof id === 'string' && context.problems.some((problem) => problem.problemVersionId === id)),
    render: (block, context) => <div className="problem-set">{(block.payload.problemVersionIds as string[]).map((id) => <div key={id}>{context.renderProblem(context.problems.find((problem) => problem.problemVersionId === id)!)}</div>)}</div>,
  },
};

export function unsupportedRequiredBlocks(blocks: ContentBlock[], problems: PublicProblem[] = []): boolean {
  const context: BlockContext = { problems, renderProblem: () => null, glossary: noGlossary };
  return blocks.some((block) => block.required && !registry[`${block.kind}@${block.typeVersion}`]?.validate(block.payload, context));
}

export function ContentBlocks({ blocks, problems = [], renderProblem = () => null, glossary = noGlossary }: { blocks: ContentBlock[]; problems?: PublicProblem[]; renderProblem?: BlockContext['renderProblem']; glossary?: GlossaryContext }) {
  const context: BlockContext = { problems, renderProblem, glossary };
  return <div className="content-blocks">{blocks.map((block) => {
    const renderer = registry[`${block.kind}@${block.typeVersion}`];
    if (!renderer?.validate(block.payload, context)) return <div key={block.blockId} className={block.required ? 'unsupported-block' : 'optional-block'} role={block.required ? 'alert' : undefined}>
      <strong>{block.required ? '이 학습 내용은 현재 버전에서 열 수 없어요.' : '추가 콘텐츠'}</strong>
      <p>{block.fallback ?? '지원하지 않는 콘텐츠 형식이에요.'}</p>
      {block.required && <p>필수 내용이므로 이 단계를 완료할 수 없어요. 최신 버전에서 다시 열어 주세요.</p>}
    </div>;
    return <div key={block.blockId} className={`content-block block-${block.kind.replaceAll('.', '-')}`}>{renderer.render(block, context)}</div>;
  })}</div>;
}
