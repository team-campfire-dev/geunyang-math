'use client';

import { useState } from 'react';
import type { ContentBlock } from '@/shared/api';
import { displayedAnswer, type AnswerInput } from '@/shared/authoring-checks';
import { answerSpec, answerText, type AnswerSpec } from '@/shared/answer';
import {
  copyProblem, insertAfter, moveBlock, newProblem, nextProblemBlockId, nextProblemVersionId, problemBlockForms,
  problemGist, problemsOfBlock, type DraftProblem, type ConceptChoice, type DefinitionChoice,
} from '@/shared/authoring';
import { Icon } from '@/features/learning/icons';
import { AddBlock, BlockCard } from './block-editor';
import { useRemovalNotice } from './edit-history';
import { useExpertMode } from './expert-mode';

/**
 * An author writes the answer the way a learner will type it, and the same reader decides both. A
 * whole number asks for a whole number; a fraction or a decimal accepts any equivalent value.
 */
function AnswerField({ spec, input, onInput, onChange }: { spec: AnswerSpec; input?: AnswerInput; onInput: (input: AnswerInput) => void; onChange: (next: AnswerSpec) => void }) {
  const written = displayedAnswer(spec, input);
  const requiredForm = spec.kind === 'rational' ? spec.requiredForm : undefined;
  const write = (next: string, form: 'reduced_fraction' | null) => {
    const read = answerSpec(next, form);
    const parsed: AnswerSpec | null = spec.kind === 'rational' && read?.kind === 'integer' ? { kind: 'rational', numerator: read.value, denominator: 1, ...(form ? { requiredForm: form } : {}) } : read;
    onInput({ text: next, spec: JSON.stringify(parsed ?? spec) });
    if (parsed) onChange(parsed);
  };
  const parsed = answerSpec(written, requiredForm ?? null);
  return <div className="editor-answer">
    <label className="editor-field">
      <span className="editor-label">정답 · 숫자</span>
      <input value={written} aria-invalid={!parsed} onChange={event => write(event.target.value, requiredForm ?? null)} placeholder="예: -3, 2.5, 1/4" />
      {parsed ? <small>{spec.kind === 'integer' ? '정수로 답하는 문제예요. 소수나 분수도 허용하려면 아래에서 답안 형식을 바꾸세요.' : '정수·소수·분수 중 값이 같은 답을 정답으로 인정해요.'}</small>
        : <small className="editor-warn" role="alert">숫자 정답을 확인해 주세요. 이 입력을 고치기 전에는 저장하거나 발행할 수 없어요.</small>}
    </label>
    <label className="editor-field"><span className="editor-label">답안 형식</span>
      <select value={spec.kind} disabled={!parsed} onChange={event => {
        const next: AnswerSpec = event.target.value === 'rational'
          ? spec.kind === 'integer' ? { kind: 'rational', numerator: spec.value, denominator: 1 } : spec
          : { kind: 'integer', value: spec.kind === 'integer' ? spec.value : spec.numerator / spec.denominator };
        onInput({ text: answerText(next), spec: JSON.stringify(next) }); onChange(next);
      }}><option value="rational">숫자 · 정수, 소수, 분수</option><option value="integer" disabled={spec.kind === 'rational' && spec.numerator % spec.denominator !== 0}>정수만</option></select>
    </label>
    {spec.kind === 'rational' && <details className="answer-options"><summary>답의 표현 조건</summary><label className="editor-check">
      <input type="checkbox" checked={!!requiredForm} disabled={!parsed} onChange={event => {
        const next: AnswerSpec = { kind: 'rational', numerator: spec.numerator, denominator: spec.denominator, ...(event.target.checked ? {requiredForm: 'reduced_fraction' as const} : {}) };
        onInput({text:written,spec:JSON.stringify(next)}); onChange(next);
      }} /><span>기약분수로 쓴 답만 인정</span></label></details>}
    <p className="editor-note">자동 채점은 숫자 답안을 지원해요. 문자식·좌표쌍·증명은 설명이나 예시로 작성해 주세요.</p>
  </div>;
}

/** The concepts this lesson teaches, named the way the catalogue names them rather than by key. */
export function ConceptPicker({ concepts, chosen, onChange, label = '이 문제가 확인하는 개념' }: {
  concepts: ConceptChoice[]; chosen: string[]; onChange: (next: string[]) => void; label?: string;
}) {
  const [query, setQuery] = useState('');
  const found = concepts.filter((concept) => chosen.includes(concept.key) || concept.label.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()));
  return <div className="editor-concepts">
    <span className="editor-label">{label}</span>
    <label className="editor-field"><input type="search" aria-label={`${label} 검색`} placeholder="개념 이름으로 찾기" value={query} onChange={(event) => setQuery(event.target.value)} /></label>
    {!found.length && <p className="editor-note">{concepts.length ? '찾은 개념이 없어요.' : '선택할 수 있는 개념이 없어요.'}</p>}
    <div className="editor-concept-buttons">
      {found.map((concept) => <label key={concept.key} className="editor-check">
        <input type="checkbox" checked={chosen.includes(concept.key)}
          onChange={() => onChange(chosen.includes(concept.key) ? chosen.filter((item) => item !== concept.key) : [...chosen, concept.key])} />
        <span>{concept.label}</span>
      </label>)}
    </div>
  </div>;
}

function ProblemBlocks({ label, hint, part, problem, blocks, taken, definitionChoices, omitText, onChange }: {
  label: string; hint?: string; part: 'prompt' | 'hint' | 'solution'; problem: DraftProblem;
  blocks: ContentBlock[]; taken: string[]; definitionChoices: DefinitionChoice[]; omitText?: boolean;
  onChange: (next: ContentBlock[]) => void;
}) {
  return <div className="editor-problem-part">
    <span className="editor-label">{label}</span>
    {hint && <p className="editor-note">{hint}</p>}
    {blocks.map((block, index) => <BlockCard key={block.blockId} block={block} index={index} total={blocks.length}
      omit={omitText && block.kind === 'core.rich_text' ? ['text'] : undefined}
      arrangingRefusal="문항 안에서는 놓아 보게 만들 수 없어요. 놓은 결과는 채점되지 않는데 답 칸 옆에 있으면 답으로 읽혀요."
      definitionChoices={definitionChoices}
      onChange={(next) => onChange(blocks.map((item, position) => (position === index ? next : item)))}
      onMove={(delta) => onChange(moveBlock(blocks, index, delta))}
      onRemove={() => onChange(blocks.filter((_, position) => position !== index))} />)}
    <AddBlock label={`${label} 블록 추가`} forms={problemBlockForms}
      blockId={() => nextProblemBlockId(problem.problemVersionId, part, taken)}
      onAdd={(block) => onChange([...blocks, block])} />
  </div>;
}

/**
 * One question, opened on its own. The prompt is written on the sheet where it will be read, so what
 * is left here is everything a prompt cannot show: the answer it accepts, the concepts it claims, and
 * the help that only appears when someone asks for it.
 */
export function ProblemPanel({ problem, number, total, concepts, taken, definitionChoices, answerInput, onAnswerInput, onChange, onMove, onCopy, onRemove }: {
  answerInput?: AnswerInput; onAnswerInput: (input: AnswerInput) => void;
  problem: DraftProblem; number: number; total: number; concepts: ConceptChoice[]; taken: string[]; definitionChoices: DefinitionChoice[];
  onChange: (next: DraftProblem) => void; onMove: (delta: number) => void; onCopy: () => void; onRemove: () => void;
}) {
  const expert = useExpertMode();
  const notifyRemoval = useRemovalNotice();
  return <section className="editor-block">
    <header>
      <div>
        <strong>{number}번 문항</strong>
        {expert && <small>{problem.problemVersionId}</small>}
      </div>
      <div className="editor-block-tools">
        <button type="button" className="icon-button" aria-label="문항 복제" title="문항 복제" onClick={onCopy}><Icon name="copy" size={15} /></button>
        <button type="button" className="icon-button" aria-label="문항 위로" disabled={number <= 1} onClick={() => onMove(-1)}>↑</button>
        <button type="button" className="icon-button" aria-label="문항 아래로" disabled={number >= total} onClick={() => onMove(1)}>↓</button>
        <button type="button" className="icon-button" aria-label="문항 삭제"
          onClick={() => { notifyRemoval('문항'); onRemove(); }}><Icon name="close" size={15} /></button>
      </div>
    </header>
    <p className="editor-note">문제 지문은 수업 화면에서 바로 씁니다. 여기에는 지문이 보여 주지 않는 것들이 있어요.</p>
    <AnswerField spec={problem.gradingSpec} input={answerInput} onInput={onAnswerInput} onChange={(gradingSpec) => onChange({ ...problem, gradingSpec })} />
    <ConceptPicker concepts={concepts} chosen={problem.conceptKeys} onChange={(next) => onChange({ ...problem, conceptKeys: next })} />
    <ProblemBlocks label="문제" part="prompt" problem={problem} blocks={problem.promptContent} taken={taken} definitionChoices={definitionChoices}
      hint="글은 수업 화면에서 고치고, 그림처럼 지문에 더 넣을 것이 있으면 여기에서 더합니다."
      onChange={(promptContent) => onChange({ ...problem, promptContent })} omitText />
    <ProblemBlocks label="힌트" part="hint" problem={problem} blocks={problem.hints} taken={taken} definitionChoices={definitionChoices}
      hint="힌트를 하나라도 두면 학습 화면에 힌트 버튼이 생겨요. 힌트를 열고 맞히면 도움을 받은 풀이로 기록합니다."
      onChange={(hints) => onChange({ ...problem, hints })} />
    <ProblemBlocks label="해설" part="solution" problem={problem} blocks={problem.solution} taken={taken} definitionChoices={definitionChoices}
      hint="해설을 작성해 보관할 수 있어요. 현재 학습 화면에서는 해설을 제공하지 않습니다."
      onChange={(solution) => onChange({ ...problem, solution })} />
    {problem.solution.length === 0 && <p className="editor-note editor-warn">해설이 없는 문제예요. 시작점 확인처럼 해설을 보여 주지 않는 곳이 아니라면 한 블록 이상 두는 편이 좋아요.</p>}
  </section>;
}

/**
 * The questions one activity holds. A question belongs to exactly one activity, so this is where a
 * question is written, changed and removed; removing one here drops it from the version being
 * written, while every published version keeps the question it was published with.
 */
export function ProblemSetEditor({ block, problems, lessonKey, role, versionId, concepts, onPick, onChange }: {
  block: ContentBlock; problems: DraftProblem[]; lessonKey: string; role: string; versionId: string;
  concepts: ConceptChoice[]; onPick: (problemVersionId: string) => void;
  onChange: (block: ContentBlock, problems: DraftProblem[]) => void;
}) {
  const notifyRemoval = useRemovalNotice();
  const ids = Array.isArray(block.payload.problemVersionIds) ? (block.payload.problemVersionIds as string[]) : [];
  const chosen = problemsOfBlock(block, problems);
  // An activity and its questions are one change: writing them separately would leave the activity
  // naming a question the document no longer holds, or holding one nothing names.
  const write = (nextIds: string[], nextProblems: DraftProblem[]) =>
    onChange({ ...block, payload: { ...block.payload, problemVersionIds: nextIds } }, nextProblems);
  const add = () => {
    const created = newProblem(nextProblemVersionId(lessonKey, role, versionId, problems.map((item) => item.problemVersionId)),
      chosen[0]?.conceptKeys ?? problems[0]?.conceptKeys ?? concepts.slice(0, 1).map((concept) => concept.key));
    write([...ids, created.problemVersionId], [...problems, created]);
    onPick(created.problemVersionId);
  };
  const copy = (problem: DraftProblem, at: number) => {
    const made = copyProblem(problem, lessonKey, role, versionId, problems.map((item) => item.problemVersionId));
    write(insertAfter(ids, at, made.problemVersionId), [...problems, made]);
    onPick(made.problemVersionId);
  };
  return <div className="editor-problems">
    <p className="editor-note">문항은 수업 화면에서 눌러 고칩니다. 여기에서는 순서를 바꾸고, 더하고, 복제하고, 뺍니다.</p>
    {chosen.map((problem, index) => <div key={problem.problemVersionId} className="editor-problem-row">
      <button type="button" className="editor-problem-open" onClick={() => onPick(problem.problemVersionId)}>
        <strong>{index + 1}번</strong>
        <small>{problemGist(problem) || '아직 비어 있어요'}</small>
      </button>
      <div className="editor-block-tools">
        <button type="button" className="icon-button" aria-label={`${index + 1}번 문항 복제`} title="복제"
          onClick={() => copy(problem, index)}><Icon name="copy" size={14} /></button>
        <button type="button" className="icon-button" aria-label={`${index + 1}번 문항 위로`} disabled={index === 0}
          onClick={() => write(moveBlock(ids, index, -1), problems)}>↑</button>
        <button type="button" className="icon-button" aria-label={`${index + 1}번 문항 아래로`} disabled={index === chosen.length - 1}
          onClick={() => write(moveBlock(ids, index, 1), problems)}>↓</button>
        <button type="button" className="icon-button" aria-label={`${index + 1}번 문항 삭제`}
          onClick={() => { notifyRemoval('문항');
            write(ids.filter((item) => item !== problem.problemVersionId),
              problems.filter((item) => item.problemVersionId !== problem.problemVersionId)); }}><Icon name="close" size={14} /></button>
      </div>
    </div>)}
    {ids.length > chosen.length && <p className="editor-note editor-warn">
      이 활동이 가리키는 문항 중 {ids.length - chosen.length}개가 이 판본에 없어요. 발행 전에 지우거나 다시 만들어 주세요.</p>}
    <button type="button" className="button secondary" onClick={add}><Icon name="plus" size={14} />문항 추가</button>
  </div>;
}
