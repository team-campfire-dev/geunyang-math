'use client';

import { useId, useState, type ReactNode } from 'react';
import katex from 'katex';
import type { ContentBlock, GlossaryEntry, PublicProblem } from '@/shared/api';
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

export function FractionStrip({ parts, filled, label, accessibleLabel }: { parts: number; filled: number; label?: string; accessibleLabel?: string }) {
  // KaTeX gives the caption its own MathML; an aria-label would instead be read as raw markup.
  const named = accessibleLabel ?? (label && !label.includes('$') ? label : `${parts}등분 중 ${filled}개`);
  return <figure className="fraction-figure" aria-label={named}>
    <div className="fraction-strip" style={{ gridTemplateColumns: `repeat(${parts}, minmax(0, 1fr))`, minWidth: parts > 24 ? `${parts * 7}px` : undefined }} aria-hidden="true">{Array.from({ length: parts }, (_, index) => <span key={index} className={index < filled ? 'filled' : ''} />)}</div>
    {label && <figcaption><RichText text={label} asCaption /></figcaption>}
  </figure>;
}

type BlockContext = { problems: PublicProblem[]; renderProblem: (problem: PublicProblem) => ReactNode; glossary: GlossaryContext };
type Renderer = { validate: (payload: Record<string, unknown>, context: BlockContext) => boolean; render: (block: ContentBlock, context: BlockContext) => ReactNode };
const validFraction = (payload: Record<string, unknown>) => Number.isInteger(payload.parts) && Number(payload.parts) >= 1 && Number(payload.parts) <= 100 && Number.isInteger(payload.filled) && Number(payload.filled) >= 0 && Number(payload.filled) <= Number(payload.parts);
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
