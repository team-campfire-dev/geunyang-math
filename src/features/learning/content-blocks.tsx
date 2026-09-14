'use client';

import type { ReactNode } from 'react';
import katex from 'katex';
import type { ContentBlock, PublicProblem } from '@/shared/api';

export function RichText({ text }: { text: string }) {
  // Only the math renderer creates HTML. Text and authored content remain React text nodes.
  const fragments = text.split(/(\$\$[\s\S]+?\$\$|\\\([\s\S]+?\\\)|\$[^$\n]+?\$)/g);
  return <div className="rich-text">{fragments.map((part, index) => {
    const display = part.startsWith('$$') && part.endsWith('$$');
    const inline = (part.startsWith('\\(') && part.endsWith('\\)')) || (part.startsWith('$') && part.endsWith('$'));
    if (!display && !inline) return <span key={index}>{part}</span>;
    const equation = part.slice(display || part.startsWith('\\(') ? 2 : 1, display || part.startsWith('\\(') ? -2 : -1);
    try {
      const html = katex.renderToString(equation, { displayMode: display, throwOnError: false, trust: false, strict: 'error', maxExpand: 1000 });
      return <span key={index} className={display ? 'display-math' : undefined} dangerouslySetInnerHTML={{ __html: html }} />;
    } catch { return <span key={index}>{part}</span>; }
  })}</div>;
}

export function FractionStrip({ parts, filled, label }: { parts: number; filled: number; label?: string }) {
  return <figure className="fraction-figure" aria-label={label ?? `${parts}등분 중 ${filled}개`}>
    <div className="fraction-strip" style={{ gridTemplateColumns: `repeat(${parts}, minmax(0, 1fr))`, minWidth: parts > 24 ? `${parts * 7}px` : undefined }} aria-hidden="true">{Array.from({ length: parts }, (_, index) => <span key={index} className={index < filled ? 'filled' : ''} />)}</div>
    {label && <figcaption>{label}</figcaption>}
  </figure>;
}

type BlockContext = { problems: PublicProblem[]; renderProblem: (problem: PublicProblem) => ReactNode };
type Renderer = { validate: (payload: Record<string, unknown>, context: BlockContext) => boolean; render: (block: ContentBlock, context: BlockContext) => ReactNode };
const validFraction = (payload: Record<string, unknown>) => Number.isInteger(payload.parts) && Number(payload.parts) >= 1 && Number(payload.parts) <= 100 && Number.isInteger(payload.filled) && Number(payload.filled) >= 0 && Number(payload.filled) <= Number(payload.parts);
const registry: Record<string, Renderer> = {
  'core.rich_text@1': {
    validate: (payload) => typeof payload.text === 'string',
    render: (block) => <RichText text={block.payload.text as string} />,
  },
  'math.fraction_strip@1': {
    validate: validFraction,
    render: (block) => <FractionStrip parts={Number(block.payload.parts)} filled={Number(block.payload.filled)} label={typeof block.payload.label === 'string' ? block.payload.label : undefined} />,
  },
  'core.figure@1': {
    validate: (payload) => typeof payload.alt === 'string' && !!payload.primitive && typeof payload.primitive === 'object' && (payload.primitive as Record<string, unknown>).kind === 'fraction_strip' && validFraction(payload.primitive as Record<string, unknown>),
    render: (block) => {
      const primitive = block.payload.primitive as Record<string, unknown>;
      return <div role="img" aria-label={block.payload.alt as string}><FractionStrip parts={Number(primitive.parts)} filled={Number(primitive.filled)} label={typeof block.payload.caption === 'string' ? block.payload.caption : typeof primitive.label === 'string' ? primitive.label : undefined} /></div>;
    },
  },
  'core.problem_set@1': {
    validate: (payload, context) => Array.isArray(payload.problemVersionIds) && payload.problemVersionIds.length > 0 && payload.problemVersionIds.every((id) => typeof id === 'string' && context.problems.some((problem) => problem.problemVersionId === id)),
    render: (block, context) => <div className="problem-set">{(block.payload.problemVersionIds as string[]).map((id) => <div key={id}>{context.renderProblem(context.problems.find((problem) => problem.problemVersionId === id)!)}</div>)}</div>,
  },
};

export function unsupportedRequiredBlocks(blocks: ContentBlock[], problems: PublicProblem[] = []): boolean {
  const context: BlockContext = { problems, renderProblem: () => null };
  return blocks.some((block) => block.required && !registry[`${block.kind}@${block.typeVersion}`]?.validate(block.payload, context));
}

export function ContentBlocks({ blocks, problems = [], renderProblem = () => null }: { blocks: ContentBlock[]; problems?: PublicProblem[]; renderProblem?: BlockContext['renderProblem'] }) {
  const context: BlockContext = { problems, renderProblem };
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
