'use client';

import { useEffect, useRef, type ReactNode, type RefObject } from 'react';
import type { AttemptView, ContentBlock, LessonSection } from '@/shared/api';
import {
  blockFormOf, sectionRoleLabels, toPublicProblem,
  type DraftIssue, type DraftMeta, type DraftProblem, type DefinitionChoice,
} from '@/shared/authoring';
import { ContentBlocks, type GlossaryContext } from '@/features/learning/content-blocks';
import { ConceptExplorer } from '@/features/learning/concept-explorer';
import { definitionRefId } from '@/shared/rich-text';
import { canExploreDefinitions, leafGlossary } from '@/shared/definition-exploration';
import { ProblemCard, type ProblemActions } from '@/features/learning/problem-card';
import { Icon } from '@/features/learning/icons';
import { useExpertMode } from './expert-mode';
import { useDefinitionMentions } from './definition-mentions';

/**
 * A text box the height of what it holds. A paragraph opened for writing then takes the room the
 * finished paragraph takes, so choosing one does not shove the rest of the lesson down the page.
 */
function useAutoHeight(area: RefObject<HTMLTextAreaElement | null>, value: string) {
  useEffect(() => {
    const node = area.current;
    if (!node) return;
    node.style.height = 'auto';
    node.style.height = `${node.scrollHeight}px`;
  }, [area, value]);
}

/** Typing into the thing itself: a heading that is the heading, not a field that names one. */
function InlineText({ value, label, placeholder, className, maxLength, onChange }: {
  value: string; label: string; placeholder?: string; className: string; maxLength?: number; onChange: (next: string) => void;
}) {
  const area = useRef<HTMLTextAreaElement>(null);
  useAutoHeight(area, value);
  return <textarea ref={area} rows={1} className={`sheet-inline ${className}`} value={value} aria-label={label} aria-invalid={!value.trim()}
    placeholder={placeholder} maxLength={maxLength} spellCheck={false}
    onChange={(event) => onChange(event.target.value)} />;
}

/**
 * Moves the caret into a paragraph the moment it is chosen, so picking one and writing in it are a
 * single move. It lands at the end: what is on screen is the source, and mapping a click on drawn
 * text back to a position in that source is not something a formula or a definition link survives.
 */
function useWritingFocus(area: RefObject<HTMLTextAreaElement | null>, writing: boolean) {
  useEffect(() => {
    const node = area.current;
    if (!writing || !node || document.activeElement === node) return;
    node.focus();
    node.setSelectionRange(node.value.length, node.value.length);
  }, [area, writing]);
}

function PlainParagraph({ block, focus, onChange }: { block: ContentBlock; focus: boolean; onChange: (next: ContentBlock) => void }) {
  const area = useRef<HTMLTextAreaElement>(null);
  const text = typeof block.payload.text === 'string' ? block.payload.text : '';
  useAutoHeight(area, text);
  useWritingFocus(area, focus);
  return <textarea ref={area} rows={1} className="sheet-paragraph" value={text} aria-label="글" spellCheck={false}
    onChange={(event) => onChange({ ...block, payload: { ...block.payload, text: event.target.value } })} />;
}

function MentionParagraph({ block, definitions, focus, onChange }: {
  block: ContentBlock; definitions: DefinitionChoice[]; focus: boolean; onChange: (next: ContentBlock) => void;
}) {
  const { bind, picker } = useDefinitionMentions({ payload: block.payload, definitions,
    onChange: (payload) => onChange({ ...block, payload }) });
  useAutoHeight(bind.ref, bind.value);
  useWritingFocus(bind.ref, focus);
  return <div className="sheet-writing">
    <textarea {...bind} rows={1} className="sheet-paragraph" aria-label="글" spellCheck={false} />
    {picker}
  </div>;
}

/** A paragraph opened for writing, wherever it sits: a lesson's own text or a question's prompt. */
function Paragraph({ block, definitions, focus, onChange }: {
  block: ContentBlock; definitions: DefinitionChoice[]; focus: boolean; onChange: (next: ContentBlock) => void;
}) {
  return block.typeVersion === 3
    ? <MentionParagraph block={block} definitions={definitions} focus={focus} onChange={onChange} />
    : <PlainParagraph block={block} focus={focus} onChange={onChange} />;
}

/** What the sheet is being asked about: one block of the step, or one question inside an activity. */
export type Picked = { kind: 'block'; index: number } | { kind: 'problem'; id: string };

/**
 * The lesson as the learner will read it, and the place it is written. There is no second rendering
 * to keep in step with the first: the learner's own renderer draws every block, and the editor only
 * puts a frame around each so it can be picked. A paragraph is the exception — chosen, it becomes
 * the text it is made of, because a paragraph is written by typing into it.
 */
export function LessonSheet({ meta, section, index, problems, definitions, glossary, courseTitle, selected, published, issues, trying, onMeta, onSection, onBlocks, onProblem, onSelect, add }: {
  meta: DraftMeta; section: LessonSection; index: number; problems: DraftProblem[]; definitions: DefinitionChoice[]; glossary: GlossaryContext; courseTitle: string;
  selected: Picked | null; published: boolean;
  /** What publishing refused, so the lesson can show where rather than list it somewhere else. */
  issues: DraftIssue[];
  /**
   * Set while the lesson is being tried rather than written. Questions are answered for real, and
   * nothing on the page may be picked or typed into — an author trying their own lesson should meet
   * exactly the screen a learner meets, with no handles on it.
   */
  trying?: { actions: (problemVersionId: string) => ProblemActions; attempts: Record<string, AttemptView>; busy: boolean };
  onMeta: (next: DraftMeta) => void; onSection: (next: LessonSection) => void;
  onBlocks: (blocks: ContentBlock[]) => void; onProblem: (next: DraftProblem) => void;
  onSelect: (next: Picked | null) => void; add: ReactNode;
}) {
  const expert = useExpertMode();
  const publicProblems = problems.map(toPublicProblem);
  const fixed = published || !!trying;
  const write = (position: number, next: ContentBlock) =>
    onBlocks(section.contentBlocks.map((item, at) => (at === position ? next : item)));
  /** Where a question sits in the activity that holds it, which is what it is called on the page. */
  const numberOf = (problemVersionId: string) => {
    for (const block of section.contentBlocks) {
      const ids = Array.isArray(block.payload.problemVersionIds) ? (block.payload.problemVersionIds as string[]) : [];
      const at = ids.indexOf(problemVersionId);
      if (at >= 0) return at + 1;
    }
    return 0;
  };

  return <ConceptExplorer key={section.sectionId} glossary={glossary} browserHistory={false} loadDefinition={async (path) => {
    const found = glossary.entries.find(entry => definitionRefId(entry) === definitionRefId(path.at(-1)!));
    if (!found) throw new Error('이 뜻풀이를 불러올 수 없어요. 저장한 뒤 다시 확인해 주세요.');
    return found;
  }}>{(readingGlossary) => <div className="editor-sheet" id="lesson-preview">
    <div className="lesson-header sheet-header">
      <div>
        <span className="eyebrow">{courseTitle} · {meta.estimatedMinutes}분 수업</span>
        {fixed
          ? <h1>{meta.title}</h1>
          : <InlineText className="sheet-class-title" label="수업 제목" value={meta.title} maxLength={191}
              placeholder="수업 제목" onChange={(title) => onMeta({ ...meta, title })} />}
      </div>
    </div>

    {/* Clicking the paper, rather than anything on it, is how a choice is let go of. */}
    {issues.some(issue => issue.field === 'title' && !issue.sectionId && !issue.blockId && !issue.problemVersionId) && <p className="editor-warn" role="alert">수업 제목을 적어 주세요.</p>}
    <article className="lesson-sheet" onClick={() => !fixed && onSelect(null)}>
      <div className="lesson-step-label">{String(index + 1).padStart(2, '0')}<i />{sectionRoleLabels[section.role]}</div>
      {fixed
        ? <h2>{section.title}</h2>
        : <InlineText className="sheet-section-title" label="단계 제목" value={section.title} maxLength={500}
            placeholder="단계 제목" onChange={(title) => onSection({ ...section, title })} />}

      <ContentBlocks glossary={canExploreDefinitions(section.role) ? readingGlossary : glossary} blocks={section.contentBlocks} problems={publicProblems}
        renderProblem={(problem) => {
          if (trying) return <ProblemCard key={problem.problemVersionId} problem={problem} attempt={trying.attempts[problem.problemVersionId]}
            glossary={glossary} recordsLearning={false} actions={trying.actions(problem.problemVersionId)} busy={trying.busy} submitLabel="정답 확인" />;
          // A question is picked and written the way a block is: it is a thing on the page, not a
          // row in a list that happens to appear somewhere else.
          const held = problems.find((item) => item.problemVersionId === problem.problemVersionId);
          const chosen = selected?.kind === 'problem' && selected.id === problem.problemVersionId;
          const trouble = issues.some((issue) => issue.problemVersionId === problem.problemVersionId);
          const writeProblem = (position: number, next: ContentBlock) => held && onProblem({ ...held,
            promptContent: held.promptContent.map((item, at) => (at === position ? next : item)) });
          const first = held?.promptContent.findIndex((item) => item.kind === 'core.rich_text') ?? -1;
          return <div key={problem.problemVersionId} className={`sheet-block sheet-problem${chosen ? ' chosen' : ''}${trouble ? ' amiss' : ''}`}
            onClick={(event) => { event.stopPropagation(); onSelect({ kind: 'problem', id: problem.problemVersionId }); }}>
            <button type="button" className="sheet-block-pick" aria-pressed={chosen}
              onClick={(event) => { event.stopPropagation(); onSelect(chosen ? null : { kind: 'problem', id: problem.problemVersionId }); }}>
              {numberOf(problem.problemVersionId)}번 문항</button>
            <div className="problem-card">
              <div className="problem-kicker"><Icon name="pencil" size={14} />문항 미리보기{expert && <span>{problem.problemVersionId}</span>}</div>
              <ContentBlocks glossary={{ ...glossary, entries: leafGlossary(glossary.entries, problem.conceptKeys) }} blocks={problem.promptContent}
                wrap={(block, position, drawn, className) => (chosen && !published && held && block.kind === 'core.rich_text'
                  ? <div key={block.blockId} className={className}>
                    <Paragraph block={block} definitions={definitions} focus={position === first} onChange={(next) => writeProblem(position, next)} />
                  </div>
                  : <div key={block.blockId} className={className}>{drawn}</div>)} />
            </div>
            {chosen && !published && <a className="sheet-edit-link text-button" href="#lesson-inspector" onClick={event => event.stopPropagation()}>정답·힌트 편집하기 ↓</a>}
          </div>;
        }}
        wrap={(block, position, drawn, className) => {
          if (trying) return <div key={block.blockId} className={className}>{drawn}</div>;
          const chosen = selected?.kind === 'block' && selected.index === position;
          const writing = chosen && !published && block.kind === 'core.rich_text';
          const trouble = issues.some((issue) => issue.blockId === block.blockId);
          const label = blockFormOf(block)?.label ?? `${block.kind}@${block.typeVersion}`;
          return <div key={block.blockId} className={`sheet-block${chosen ? ' chosen' : ''}${writing ? ' writing' : ''}${trouble ? ' amiss' : ''}`}
            onClick={(event) => { event.stopPropagation(); onSelect({ kind: 'block', index: position }); }}>
            {/* The frame's own handle, so a block can be chosen and named without a pointer. */}
            <button type="button" className="sheet-block-pick" aria-pressed={chosen}
              onClick={(event) => { event.stopPropagation(); onSelect(chosen ? null : { kind: 'block', index: position }); }}>{label}</button>
            <div className={className}>
              {writing
                ? <Paragraph block={block} definitions={definitions} focus onChange={(next) => write(position, next)} />
                : block.kind === 'core.scene' && Array.isArray(block.payload.items) && !block.payload.items.length
                  ? <p className="sheet-empty">그림을 선택해 수직선·좌표평면·도형을 넣어 주세요.</p>
                  : block.kind === 'core.problem_set' && Array.isArray(block.payload.problemVersionIds) && !block.payload.problemVersionIds.length
                    ? <p className="sheet-empty">문제 묶음을 선택해 문항을 추가해 주세요.</p> : drawn}
            </div>
            {chosen && !published && <a className="sheet-edit-link text-button" href="#lesson-inspector" onClick={event => event.stopPropagation()}>이 블록 편집하기 ↓</a>}
          </div>;
        }} />

      {!fixed && <div className="sheet-add" onClick={(event) => event.stopPropagation()}>{add}</div>}
    </article>
  </div>}</ConceptExplorer>;
}
