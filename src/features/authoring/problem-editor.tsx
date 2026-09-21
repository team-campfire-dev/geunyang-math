'use client';

import { useState } from 'react';
import type { ContentBlock } from '@/shared/api';
import { displayedAnswer, type AnswerInput } from '@/shared/authoring-checks';
import { answerSpec, answerText, choiceIssue, choiceLimits, type AnswerOption, type AnswerSpec } from '@/shared/answer';
import {
  copyProblem, insertAfter, moveBlock, newProblem, nextProblemBlockId, nextProblemVersionId, problemBlockForms,
  problemGist, type DraftProblem, type ConceptChoice, type DefinitionChoice, type ProblemSetChoice,
} from '@/shared/authoring';
import { Icon } from '@/features/learning/icons';
import { AddBlock, BlockCard } from './block-editor';
import { useRemovalNotice } from './edit-history';
import { useExpertMode } from './expert-mode';

/** A fresh set of options, so switching to a picked answer lands on something writable. */
const blankChoices = (): AnswerSpec => ({ kind: 'choice', options: [{ id: 'a', text: '' }, { id: 'b', text: '' }], correct: 'a' });
const optionNames = 'abcdef';

/**
 * A question answered by picking. The author writes each option and marks one of them, and the
 * option's name — not its text — is what the answer is compared by, so rewording an option later
 * does not silently change which answer was right.
 */
function ChoiceField({ spec, onChange }: { spec: Extract<AnswerSpec, { kind: 'choice' }>; onChange: (next: AnswerSpec) => void }) {
  const issue = choiceIssue(spec);
  const write = (options: AnswerOption[], correct = spec.correct) =>
    onChange({ kind: 'choice', options, correct: options.some((option) => option.id === correct) ? correct : options[0].id });
  return <div className="editor-answer">
    <span className="editor-label">정답 · 객관식</span>
    <ul className="editor-choices">
      {spec.options.map((option, index) => <li key={option.id}>
        <label className="editor-choice-correct">
          <input type="radio" name={`correct-${spec.options.map((item) => item.id).join('')}`} checked={spec.correct === option.id}
            onChange={() => write(spec.options, option.id)} />
          <span className="sr-only">{index + 1}번째 보기를 정답으로</span>
        </label>
        <input aria-label={`${index + 1}번째 보기`} value={option.text} maxLength={choiceLimits.maxText} placeholder="보기 내용"
          onChange={(event) => write(spec.options.map((item) => item.id === option.id ? { ...item, text: event.target.value } : item))} />
        <button type="button" className="icon-button" aria-label={`${index + 1}번째 보기 지우기`} disabled={spec.options.length <= 2}
          onClick={() => write(spec.options.filter((item) => item.id !== option.id))}><Icon name="close" size={15} /></button>
      </li>)}
    </ul>
    <div className="editor-choice-actions">
      <button type="button" className="text-button" disabled={spec.options.length >= choiceLimits.maxOptions}
        onClick={() => write([...spec.options, { id: optionNames[spec.options.length] ?? `o${spec.options.length}`, text: '' }])}>보기 추가</button>
      <button type="button" className="text-button" onClick={() => onChange({ kind: 'integer', value: 0 })}>숫자 답으로 바꾸기</button>
    </div>
    {issue ? <small className="editor-warn" role="alert">{issue} 이 입력을 고치기 전에는 저장하거나 발행할 수 없어요.</small>
      : <small>동그라미를 친 보기가 정답이에요. 보기의 순서대로 학습자에게 보여요.</small>}
  </div>;
}

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
  if (spec.kind === 'choice') return <ChoiceField spec={spec} onChange={onChange} />;
  const parsed = answerSpec(written, requiredForm ?? null);
  // Said in the summary so the fold can stay shut: what a question accepts is worth knowing at a
  // glance, while changing it is rare enough not to hold a place on the screen.
  const range = spec.kind === 'integer' ? '정수만 인정'
    : requiredForm ? '기약분수로 쓴 답만 인정' : '값이 같으면 정수·소수·분수 모두 인정';
  return <div className="editor-answer">
    <label className="editor-field">
      <span className="editor-label">정답 · 숫자</span>
      <input value={written} aria-invalid={!parsed} onChange={event => write(event.target.value, requiredForm ?? null)} placeholder="예: -3, 2.5, 1/4" />
      {parsed ? <small>{range}</small>
        : <small className="editor-warn" role="alert">숫자 정답을 확인해 주세요. 이 입력을 고치기 전에는 저장하거나 발행할 수 없어요.</small>}
    </label>
    <details className="editor-fold answer-options">
      <summary>답 인정 범위 바꾸기</summary>
      <label className="editor-field"><span className="editor-label">답안 형식</span>
        <select value={spec.kind} disabled={!parsed} onChange={event => {
          if (event.target.value === 'choice') { onChange(blankChoices()); return; }
          const next: AnswerSpec = event.target.value === 'rational'
            ? spec.kind === 'integer' ? { kind: 'rational', numerator: spec.value, denominator: 1 } : spec
            : { kind: 'integer', value: spec.kind === 'integer' ? spec.value : spec.numerator / spec.denominator };
          onInput({ text: answerText(next), spec: JSON.stringify(next) }); onChange(next);
        }}><option value="rational">숫자 · 정수, 소수, 분수</option><option value="integer" disabled={spec.kind === 'rational' && spec.numerator % spec.denominator !== 0}>정수만</option><option value="choice">객관식 · 보기에서 고르기</option></select>
      </label>
      {spec.kind === 'rational' && <label className="editor-check">
        <input type="checkbox" checked={!!requiredForm} disabled={!parsed} onChange={event => {
          const next: AnswerSpec = { kind: 'rational', numerator: spec.numerator, denominator: spec.denominator, ...(event.target.checked ? {requiredForm: 'reduced_fraction' as const} : {}) };
          onInput({text:written,spec:JSON.stringify(next)}); onChange(next);
        }} /><span>기약분수로 쓴 답만 인정</span></label>}
      <p className="editor-note">자동 채점은 숫자 답안과 객관식을 지원해요. 문자식·좌표쌍·증명은 설명이나 예시로 작성해 주세요.</p>
    </details>
  </div>;
}

/**
 * The concepts this lesson teaches, named the way the catalogue names them rather than by key. What
 * is chosen is shown; the rest is searched for. The catalogue grows with the service, and a list
 * that grows with it turns choosing three concepts into reading thirty.
 */
export function ConceptPicker({ concepts, chosen, onChange, label = '이 문제가 확인하는 개념' }: {
  concepts: ConceptChoice[]; chosen: string[]; onChange: (next: string[]) => void; label?: string;
}) {
  const [query, setQuery] = useState('');
  const asked = query.trim().toLocaleLowerCase();
  const picked = concepts.filter((concept) => chosen.includes(concept.key));
  const offered = asked
    ? concepts.filter((concept) => !chosen.includes(concept.key) && concept.label.toLocaleLowerCase().includes(asked)).slice(0, 8)
    : [];
  return <div className="editor-concepts">
    <span className="editor-label">{label}</span>
    <div className="editor-chips">
      {picked.length
        ? picked.map((concept) => <span key={concept.key} className="editor-chip">{concept.label}
          <button type="button" className="icon-button" aria-label={`${concept.label} 빼기`} title="빼기"
            onClick={() => onChange(chosen.filter((item) => item !== concept.key))}><Icon name="close" size={12} /></button></span>)
        : <span className="editor-note">{concepts.length ? '아직 고른 개념이 없어요.' : '선택할 수 있는 개념이 없어요.'}</span>}
    </div>
    {!!concepts.length && <label className="editor-field">
      <input type="search" aria-label={`${label} 검색`} placeholder="개념 이름으로 찾아 더하기" value={query}
        onChange={(event) => setQuery(event.target.value)} /></label>}
    {!!asked && !offered.length && <p className="editor-note">찾은 개념이 없어요.</p>}
    {!!offered.length && <div className="editor-concept-buttons">
      {offered.map((concept) => <button key={concept.key} type="button" className="editor-chip-add"
        onClick={() => { onChange([...chosen, concept.key]); setQuery(''); }}><Icon name="plus" size={12} />{concept.label}</button>)}
    </div>}
  </div>;
}

function ProblemBlocks({ label, hint, part, problem, blocks, taken, definitionChoices, omitText, named = true, onChange }: {
  label: string; hint?: string; part: 'prompt' | 'hint' | 'solution'; problem: DraftProblem;
  blocks: ContentBlock[]; taken: string[]; definitionChoices: DefinitionChoice[]; omitText?: boolean; named?: boolean;
  onChange: (next: ContentBlock[]) => void;
}) {
  return <div className="editor-problem-part">
    {named && <span className="editor-label">{label}</span>}
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
export function ProblemPanel({ problem, number, total, concepts, taken, definitionChoices, answerInput, offSheet = false, onAnswerInput, onChange, onMove, onCopy, onRemove }: {
  answerInput?: AnswerInput; onAnswerInput: (input: AnswerInput) => void;
  problem: DraftProblem; number: number; total: number; concepts: ConceptChoice[]; taken: string[]; definitionChoices: DefinitionChoice[];
  /** A question no step shows, so its text has nowhere else to be written and is written here. */
  offSheet?: boolean;
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
    <p className="editor-note">{offSheet
      ? '이 문항은 수업 화면에 나오지 않아요. 지문도 여기에서 씁니다.'
      : '문제 지문은 수업 화면에서 바로 씁니다. 여기에는 지문이 보여 주지 않는 것들이 있어요.'}</p>
    <AnswerField spec={problem.gradingSpec} input={answerInput} onInput={onAnswerInput} onChange={(gradingSpec) => onChange({ ...problem, gradingSpec })} />
    <ConceptPicker concepts={concepts} chosen={problem.conceptKeys} onChange={(next) => onChange({ ...problem, conceptKeys: next })} />
    <ProblemBlocks label="문제" part="prompt" problem={problem} blocks={problem.promptContent} taken={taken} definitionChoices={definitionChoices}
      hint={offSheet ? '이 문항의 지문은 여기에만 있어요. 글과 그림을 모두 여기에서 씁니다.'
        : '글은 수업 화면에서 고치고, 그림처럼 지문에 더 넣을 것이 있으면 여기에서 더합니다.'}
      onChange={(promptContent) => onChange({ ...problem, promptContent })} omitText={!offSheet} />
    <ProblemBlocks label="힌트" part="hint" problem={problem} blocks={problem.hints} taken={taken} definitionChoices={definitionChoices}
      hint="힌트를 하나라도 두면 학습 화면에 힌트 버튼이 생겨요. 힌트를 열고 맞히면 도움을 받은 풀이로 기록합니다."
      onChange={(hints) => onChange({ ...problem, hints })} />
    {/* Kept, and kept shut: the learning screen does not show a solution today, so it earns a line
        rather than a third of the panel. */}
    <details className="editor-fold">
      <summary>해설 · {problem.solution.length ? `${problem.solution.length}개` : '없음'}</summary>
      <p className="editor-note">해설을 작성해 보관할 수 있어요. 현재 학습 화면에서는 해설을 제공하지 않습니다.</p>
      <ProblemBlocks label="해설" part="solution" problem={problem} blocks={problem.solution} taken={taken}
        definitionChoices={definitionChoices} named={false}
        onChange={(solution) => onChange({ ...problem, solution })} />
      {problem.solution.length === 0 && <p className="editor-note editor-warn">해설이 없는 문제예요. 시작점 확인처럼 해설을 보여 주지 않는 곳이 아니라면 한 블록 이상 두는 편이 좋아요.</p>}
    </details>
  </section>;
}

/**
 * The questions one activity holds. A question belongs to exactly one activity, so this is where a
 * question is written, changed and removed; removing one here drops it from the version being
 * written, while every published version keeps the question it was published with.
 */
/**
 * The questions a list names, and what may be done to the list. An activity holds one; so does a
 * lesson's own review pool, which no activity names and no section shows.
 */
export function ProblemList({ ids, problems, lessonKey, role, versionId, concepts, note, onPick, onChange }: {
  ids: string[]; problems: DraftProblem[]; lessonKey: string; role: string; versionId: string;
  concepts: ConceptChoice[]; note: string; onPick: (problemVersionId: string) => void;
  onChange: (ids: string[], problems: DraftProblem[]) => void;
}) {
  const notifyRemoval = useRemovalNotice();
  const held = new Map(problems.map((problem) => [problem.problemVersionId, problem]));
  const chosen = ids.flatMap((problemId) => { const problem = held.get(problemId); return problem ? [problem] : []; });
  // A list and its questions are one change: writing them separately would leave the list naming a
  // question the document no longer holds, or holding one nothing names.
  const write = (nextIds: string[], nextProblems: DraftProblem[]) => onChange(nextIds, nextProblems);
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
    <p className="editor-note">{note}</p>
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
      여기가 가리키는 문항 중 {ids.length - chosen.length}개가 이 판본에 없어요. 발행 전에 지우거나 다시 만들어 주세요.</p>}
    <button type="button" className="button secondary" onClick={add}><Icon name="plus" size={14} />문항 추가</button>
  </div>;
}

/** An activity's own list, which is its block's `problemVersionIds`. */
export function ProblemSetEditor({ block, onChange, ...rest }: {
  block: ContentBlock; problems: DraftProblem[]; lessonKey: string; role: string; versionId: string;
  concepts: ConceptChoice[]; onPick: (problemVersionId: string) => void;
  onChange: (block: ContentBlock, problems: DraftProblem[]) => void;
}) {
  const ids = Array.isArray(block.payload.problemVersionIds) ? (block.payload.problemVersionIds as string[]) : [];
  return <ProblemList {...rest} ids={ids} note="문항은 수업 화면에서 눌러 고칩니다. 여기에서는 순서를 바꾸고, 더하고, 복제하고, 뺍니다."
    onChange={(nextIds, problems) => onChange({ ...block, payload: { ...block.payload, problemVersionIds: nextIds } }, problems)} />;
}

/**
 * What a problem set is, above the questions it holds.
 *
 * Most sets are made in place and used by one lesson; nothing here matters for those beyond a name.
 * A set several lessons hold is a shared thing, and this is where that is said — because editing its
 * questions changes it for all of them, and the alternative has to be one click away rather than a
 * thing an author discovers afterwards.
 */
export function ProblemSetPanel({ block, sets, courseKey, lessonTitle, mayName, onName, onTakeUp, onSplit }: {
  block: ContentBlock; sets: ProblemSetChoice[]; lessonTitle: (lessonKey: string) => string;
  /** The course this lesson is in. A set belongs to one course and is offered to no other. */
  courseKey: string | null;
  mayName: boolean;
  onName: (name: string) => void;
  onTakeUp: (set: ProblemSetChoice) => void;
  onSplit: () => void;
}) {
  const problemSetId = String(block.payload.problemSetId ?? '');
  const mine = sets.find((set) => set.problemSetId === problemSetId);
  const [name, setName] = useState(mine?.name ?? '');
  const [takingUp, setTakingUp] = useState(false);
  // Sharing is what the lessons say, not what the name says: a set with a name nobody else took up
  // is this lesson's own, and one without a name that two lessons hold is shared all the same.
  const others = (mine?.lessonKeys ?? []).filter((lessonKey) => lessonKey !== undefined);
  const shared = others.length > 1;
  const reusable = sets.filter((set) => set.problemSetId !== problemSetId && set.name && set.latestVersionId && set.courseKey === courseKey);
  return <div className="editor-problem-set">
    {mayName && <label className="editor-field">
      <span className="editor-label">문제집 이름</span>
      <input value={name} maxLength={191} placeholder="이름을 지으면 다른 수업에서 가져다 쓸 수 있어요"
        onChange={(event) => setName(event.target.value)}
        onBlur={() => { if ((mine?.name ?? '') !== name.trim()) onName(name.trim()); }} />
      <small>이름은 판본이 아니라 문제집의 것이라, 바꿔도 발행된 것은 그대로예요.</small>
    </label>}
    {shared && <div className="editor-note editor-warn" role="status">
      <strong>이 문제집은 수업 {others.length}개가 함께 써요.</strong>
      <span>{others.map(lessonTitle).join(' · ')}</span>
      <span>여기에서 문항을 고치면 그 수업들도 새 판본으로 함께 발행돼요. 이 수업에서만 고치려면 따로 두세요.</span>
      <button type="button" className="button secondary" onClick={onSplit}>이 수업만 따로 두기</button>
    </div>}
    {reusable.length > 0 && (takingUp
      ? <label className="editor-field">
        <span className="editor-label">가져다 쓸 문제집</span>
        <select defaultValue="" onChange={(event) => {
          const chosen = reusable.find((set) => set.problemSetId === event.target.value);
          if (chosen) { onTakeUp(chosen); setTakingUp(false); }
        }}>
          <option value="" disabled>문제집을 고르세요</option>
          {reusable.map((set) => <option key={set.problemSetId} value={set.problemSetId}>{set.name}</option>)}
        </select>
        <small>지금 이 활동의 문항 대신 그 문제집의 문항이 들어와요. 두 수업이 같은 문제집을 쓰게 됩니다.</small>
      </label>
      : <button type="button" className="text-button" onClick={() => setTakingUp(true)}>다른 문제집 가져다 쓰기</button>)}
  </div>;
}
