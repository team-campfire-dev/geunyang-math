'use client';

import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import katex from 'katex';
import type { ContentBlock, GlossaryEntry, PublicProblem } from '@/shared/api';
import {
  changeFor, cssColor, frameLimits, itemBounds, itemInZone, nextFrameIndex, placeInZone, placementOffset,
  removeFromZone, sceneItemKinds, sceneLimits, stepFrameIndex, taskComplete, zoneAt, zoneOf,
  type ScenePlacement, type SceneFrame, type SceneItem, type SceneTask, type SceneZone,
} from '@/shared/scene';
import { locateTerms, splitRichText, termRefId, type TermAnnotation } from '@/shared/rich-text';
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
  // Holds the scoped reference, not the bare key: two scopes may use the same key.
  const [openTerm, setOpenTerm] = useState<string | null>(null);
  const panelId = useId();
  const entryOf = (ref: string) => glossary.entries.find((entry) => termRefId(entry) === ref);
  // A caption renders inline inside figcaption, where an expanding panel has nowhere to open.
  const spans = asCaption ? [] : locateTerms(text, terms.filter((term) => entryOf(termRefId(term)))).spans;
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
      const entry = entryOf(span.ref)!;
      const expanded = openTerm === span.ref;
      pushText(text.slice(cursor, span.start), cursor);
      nodes.push(<button key={span.start} type="button" aria-expanded={expanded} aria-controls={expanded ? panelId : undefined}
        className={`term-mark${glossary.reviewSkillKeys?.includes(entry.skillKey) ? ' needs-review' : ''}${expanded ? ' open' : ''}`}
        onClick={() => setOpenTerm(expanded ? null : span.ref)}>{text.slice(span.start, span.end)}</button>);
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
export function SceneFigure({ width, height, items, alt, caption, frames, frameMs = frameLimits.defaultMs, loop = false, autoplay = false }:
{ width: number; height: number; items: SceneItem[]; alt: string; caption?: string; frames?: SceneFrame[]; frameMs?: number; loop?: boolean; autoplay?: boolean }) {
  const [index, setIndex] = useState(0);
  const [playing, setPlaying] = useState(false);
  const total = frames?.length ?? 0;
  const frame = total ? frames![Math.min(index, total - 1)] : undefined;
  const atEnd = !loop && index === total - 1;
  useEffect(() => {
    if (!autoplay || !total || window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    setPlaying(true);
  }, [autoplay, total]);
  useEffect(() => {
    if (!playing || !total) return;
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
  // A drawing that moves is still one picture: alt names the whole movement, as it named the still.
  return <figure className="scene-figure" role={total ? undefined : 'img'} aria-label={alt}>
    <svg viewBox={`0 0 ${width} ${height}`} style={{ aspectRatio: `${width} / ${height}` }} aria-hidden="true" focusable="false">
      <SceneShapes items={items} frame={frame} animated={!!total} />
    </svg>
    {(caption || frame?.caption) && <figcaption><RichText text={frame?.caption || caption || ''} asCaption /></figcaption>}
    {total > 1 && <div className="figure-controls">
      <button type="button" className="icon-button" aria-label="이전 장면" disabled={index === 0} onClick={() => step(-1)}><Icon name="back" size={16} /></button>
      <button type="button" className="control-button" onClick={toggle}>
        <Icon name={playing ? 'pause' : 'play'} size={14} />{playing ? '멈춤' : atEnd ? '다시 보기' : '재생'}
      </button>
      <button type="button" className="icon-button" aria-label="다음 장면" disabled={index === total - 1} onClick={() => step(1)}><Icon name="arrow" size={16} /></button>
      <span className="sequence-count" aria-live="polite">장면 {index + 1} / {total}</span>
    </div>}
  </figure>;
}

/**
 * A drawing the learner arranges. A shape is picked up by pointer, by tap, or from the keyboard —
 * choosing a shape and then a zone does the same thing a drag does, so nothing here depends on
 * dragging. Nothing is reported to the server: this is a thing to try, not a thing that is marked.
 */
export function SceneTaskFigure({ width, height, items, zones, task, alt, caption }:
{ width: number; height: number; items: SceneItem[]; zones: SceneZone[]; task: SceneTask; alt: string; caption?: string }) {
  const [placement, setPlacement] = useState<ScenePlacement>({});
  const [held, setHeld] = useState<string | null>(null);
  const [drag, setDrag] = useState<{ id: string; dx: number; dy: number; fromX: number; fromY: number } | null>(null);
  const surface = useRef<SVGSVGElement>(null);
  const done = taskComplete(zones, placement);
  const movable = items.filter((item) => item.draggable && item.id);

  const at = (event: React.PointerEvent) => {
    const box = surface.current?.getBoundingClientRect();
    if (!box) return { x: 0, y: 0 };
    return { x: ((event.clientX - box.left) / box.width) * width, y: ((event.clientY - box.top) / box.height) * height };
  };
  const offsetOf = (item: SceneItem) => {
    // Only a named shape can be the one being held; an unnamed shape never matches a drag.
    if (drag && item.id && drag.id === item.id) return { dx: drag.dx, dy: drag.dy };
    const zone = zones.find((current) => current.id === zoneOf(placement, item.id));
    return zone ? placementOffset(item, zone) : { dx: 0, dy: 0 };
  };
  /** Choosing a zone is the other half of a drag, and the only half a keyboard has. */
  const putInto = (zone: SceneZone) => {
    if (!held) return;
    setPlacement(placeInZone(placement, held, zone));
    setHeld(null);
  };
  const status = done
    ? task.successText ?? '다 놓았어요.'
    : held
      ? `${items.find((item) => item.id === held)?.label ?? '도형'}을 들고 있어요. 놓을 자리를 골라 주세요.`
      : `${zones.length}곳 중 ${zones.filter((zone) => itemInZone(placement, zone.id)).length}곳을 채웠어요.`;

  return <div className="scene-task" role="group" aria-label={task.promptAlt ?? task.prompt}>
    <div className="builder-prompt"><RichText text={task.prompt} asCaption /></div>
    <div className="scene-figure">
      <svg ref={surface} viewBox={`0 0 ${width} ${height}`} style={{ aspectRatio: `${width} / ${height}` }}
        onPointerMove={(event) => {
          if (!drag) return;
          const point = at(event);
          setDrag({ ...drag, dx: point.x - drag.fromX, dy: point.y - drag.fromY });
        }}
        onPointerUp={(event) => {
          if (!drag) return;
          const point = at(event);
          const zone = zoneAt(zones, point, drag.id);
          setPlacement(zone ? placeInZone(placement, drag.id, zone) : removeFromZone(placement, drag.id));
          setDrag(null);
        }}
        onPointerCancel={() => setDrag(null)}>
        {zones.map((zone) => {
          const filled = itemInZone(placement, zone.id);
          return <g key={zone.id}>
            <rect x={zone.x} y={zone.y} width={zone.width} height={zone.height} rx={3}
              className={`scene-zone${filled ? ' filled' : ''}${held ? ' open' : ''}`} />
            {/* The zone is a control in its own right, so a tap or the keyboard can choose it. */}
            <rect x={zone.x} y={zone.y} width={zone.width} height={zone.height} fill="transparent"
              role="button" tabIndex={0} aria-label={`${zone.label}${filled ? ', 채움' : ', 비어 있음'}`}
              style={{ cursor: held ? 'pointer' : 'default' }}
              onClick={() => putInto(zone)}
              onKeyDown={(event) => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); putInto(zone); } }} />
          </g>;
        })}
        <SceneShapes items={items} offsetOf={offsetOf} />
        {movable.map((item) => {
          const bounds = itemBounds(item);
          const shift = offsetOf(item);
          return <rect key={item.id} x={bounds.x + shift.dx - 2} y={bounds.y + shift.dy - 2}
            width={Math.max(bounds.width + 4, 8)} height={Math.max(bounds.height + 4, 8)} fill="transparent"
            role="button" tabIndex={0} aria-pressed={held === item.id}
            aria-label={`${item.label}${zoneOf(placement, item.id) ? ', 놓음' : ''}`}
            style={{ cursor: 'grab', touchAction: 'none' }}
            onPointerDown={(event) => {
              event.currentTarget.setPointerCapture(event.pointerId);
              const point = at(event);
              setHeld(item.id!);
              setDrag({ id: item.id!, dx: shift.dx, dy: shift.dy, fromX: point.x - shift.dx, fromY: point.y - shift.dy });
            }}
            onKeyDown={(event) => {
              if (event.key !== 'Enter' && event.key !== ' ') return;
              event.preventDefault();
              setHeld(held === item.id ? null : item.id!);
            }} />;
        })}
      </svg>
    </div>
    <p className={`builder-status ${done ? 'matched' : 'building'}`} aria-live="polite">{status}</p>
    <div className="builder-actions">
      <span className="editor-note">{alt}</span>
      <button type="button" className="text-button" onClick={() => { setPlacement({}); setHeld(null); }}>처음으로</button>
    </div>
    {caption && <p className="scene-task-caption"><RichText text={caption} asCaption /></p>}
  </div>;
}

/** The shapes alone, so the editor's canvas draws exactly what the learner will see. */
export function SceneShapes({ items, frame, animated = false, offsetOf }:
{ items: SceneItem[]; frame?: SceneFrame; animated?: boolean; offsetOf?: (item: SceneItem) => { dx: number; dy: number } }) {
  const paint = (item: SceneItem) => ({
    fill: cssColor(item.fill), stroke: cssColor(item.stroke), strokeWidth: item.strokeWidth ?? (item.stroke ? 1 : 0),
    strokeDasharray: item.dash ? '4 3' : undefined, opacity: item.opacity, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const,
    transform: item.rotate ? rotateAround(item) : undefined,
  });
  return <>
    <defs><marker id="scene-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
      <path d="M0 0 L10 5 L0 10 z" fill="context-stroke" /></marker></defs>
    {items.map((item, index) => {
      const change = changeFor(frame, item);
      const placed = offsetOf?.(item);
      const painted = change?.fill ? { ...item, fill: change.fill } : item;
      const style = paint(painted);
      const shift = placed ?? { dx: change?.dx ?? 0, dy: change?.dy ?? 0 };
      const moved = (shape: ReactNode) => change || animated || (placed && (placed.dx || placed.dy))
        ? <g key={index} style={{
            transform: `translate(${shift.dx}px, ${shift.dy}px)${change?.rotate ? ` rotate(${change.rotate}deg)` : ''}`,
            transformOrigin: 'center', transformBox: 'fill-box',
            opacity: change?.hidden ? 0 : change?.opacity ?? 1,
            transition: 'transform .45s ease, opacity .45s ease',
          }}>{shape}</g>
        : shape;
      return moved(renderShape(painted, style, index));
    })}
  </>;

  function renderShape(item: SceneItem, style: ReturnType<typeof paint>, index: number) {
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
        if (item.kind === 'strip') {
          // A fraction bar: `fill` paints the filled cells, `stroke` draws every cell's border.
          const gap = Math.min(2, item.width / Math.max(item.parts * 8, 1));
          const cell = (item.width - gap * (item.parts - 1)) / item.parts;
          return <g key={index} transform={style.transform} opacity={item.opacity}>
            {Array.from({ length: item.parts }, (_, cellIndex) => <rect key={cellIndex}
              x={item.x + cellIndex * (cell + gap)} y={item.y} width={Math.max(cell, 0)} height={item.height} rx={1}
              fill={cellIndex < item.filled ? cssColor(item.fill, '#8daa69') : '#e5ecd7'}
              stroke={cssColor(item.stroke, '#dce5c9')} strokeWidth={item.strokeWidth ?? 0.5} />)}
          </g>;
        }
    return <text key={index} x={item.x} y={item.y} textAnchor={item.anchor ?? 'start'} fontSize={item.size ?? 14}
      fontWeight={item.weight === 'bold' ? 600 : 400} {...style} stroke="none" fill={cssColor(item.fill, 'var(--ink)')}>{item.text}</text>;
  }
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

type BlockContext = { problems: PublicProblem[]; renderProblem: (problem: PublicProblem) => ReactNode; glossary: GlossaryContext };
type Renderer = { validate: (payload: Record<string, unknown>, context: BlockContext) => boolean; render: (block: ContentBlock, context: BlockContext) => ReactNode };
const validFraction = (payload: Record<string, unknown>) => Number.isInteger(payload.parts) && Number(payload.parts) >= 1 && Number(payload.parts) <= 100 && Number.isInteger(payload.filled) && Number(payload.filled) >= 0 && Number(payload.filled) <= Number(payload.parts);
// The shape of a scene, checked the way the other blocks are: enough to know the renderer can draw
// it. The publishing schema is the authority on what a scene may contain.
const validScene = (payload: Record<string, unknown>) => typeof payload.alt === 'string' && payload.alt.length > 0
  && Number.isFinite(payload.width) && Number.isFinite(payload.height) && Number(payload.width) > 0 && Number(payload.height) > 0
  && Array.isArray(payload.items) && payload.items.length <= sceneLimits.maxItems
  && payload.items.every((item) => !!item && typeof item === 'object' && sceneItemKinds.includes((item as SceneItem).kind))
  && (payload.frames === undefined || (Array.isArray(payload.frames) && payload.frames.length <= frameLimits.maxFrames
    && payload.frames.every((frame) => !!frame && typeof frame === 'object' && Array.isArray((frame as SceneFrame).changes))))
  // A drawing to arrange needs both halves: somewhere to put things, and a task that says what for.
  && (payload.zones === undefined || (Array.isArray(payload.zones)
    && payload.zones.every((zone) => !!zone && typeof zone === 'object' && typeof (zone as SceneZone).id === 'string' && typeof (zone as SceneZone).label === 'string')
    && (!payload.zones.length || (!!payload.task && typeof (payload.task as SceneTask).prompt === 'string'))));
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
    render: (block) => Array.isArray(block.payload.zones) && block.payload.zones.length
      ? <SceneTaskFigure width={Number(block.payload.width)} height={Number(block.payload.height)}
          items={block.payload.items as SceneItem[]} zones={block.payload.zones as SceneZone[]}
          task={block.payload.task as SceneTask} alt={block.payload.alt as string}
          caption={typeof block.payload.caption === 'string' ? block.payload.caption : undefined} />
      : <SceneFigure width={Number(block.payload.width)} height={Number(block.payload.height)}
      items={block.payload.items as SceneItem[]} alt={block.payload.alt as string}
      caption={typeof block.payload.caption === 'string' ? block.payload.caption : undefined}
      frames={Array.isArray(block.payload.frames) ? block.payload.frames as SceneFrame[] : undefined}
      frameMs={typeof block.payload.frameMs === 'number' ? block.payload.frameMs : undefined}
      loop={block.payload.loop === true} autoplay={block.payload.autoplay === true} />,
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

export function ContentBlocks({ blocks, problems = [], renderProblem = () => null, glossary = noGlossary, wrap }: {
  blocks: ContentBlock[]; problems?: PublicProblem[]; renderProblem?: BlockContext['renderProblem']; glossary?: GlossaryContext;
  /**
   * Puts something of the caller's own around each block. A lesson needs nothing around one, so this
   * is normally absent; the editor draws the same lesson but has to make every block pickable, and
   * without this it would need a second renderer that could drift from the one that ships.
   */
  wrap?: (block: ContentBlock, index: number, drawn: ReactNode, className: string) => ReactNode;
}) {
  const context: BlockContext = { problems, renderProblem, glossary };
  return <div className="content-blocks">{blocks.map((block, index) => {
    const renderer = registry[`${block.kind}@${block.typeVersion}`];
    const supported = !!renderer?.validate(block.payload, context);
    const className = supported
      ? `content-block block-${block.kind.replaceAll('.', '-')}`
      : block.required ? 'unsupported-block' : 'optional-block';
    const drawn = supported ? renderer.render(block, context) : <>
      <strong>{block.required ? '이 학습 내용은 현재 버전에서 열 수 없어요.' : '추가 콘텐츠'}</strong>
      <p>{block.fallback ?? '지원하지 않는 콘텐츠 형식이에요.'}</p>
      {block.required && <p>필수 내용이므로 이 단계를 완료할 수 없어요. 최신 버전에서 다시 열어 주세요.</p>}
    </>;
    if (wrap) return wrap(block, index, drawn, className);
    return <div key={block.blockId} className={className} role={!supported && block.required ? 'alert' : undefined}>{drawn}</div>;
  })}</div>;
}
