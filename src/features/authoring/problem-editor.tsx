'use client';

import { useState } from 'react';
import type { ContentBlock } from '@/shared/api';
import { answerSpec, answerText, type AnswerSpec } from '@/shared/answer';
import {
  moveBlock, newProblem, nextProblemBlockId, nextProblemVersionId, problemBlockForms, problemsOfBlock,
  type DraftProblem, type TermChoice,
} from '@/shared/authoring';
import { Icon } from '@/features/learning/icons';
import { AddBlock, BlockCard } from './block-editor';

/**
 * An author writes the answer the way a learner will type it, and the same reader decides both. A
 * whole number asks for a whole number; a fraction or a decimal accepts any equivalent value.
 */
function AnswerField({ spec, onChange }: { spec: AnswerSpec; onChange: (next: AnswerSpec) => void }) {
  const [written, setWritten] = useState(() => answerText(spec));
  const requiredForm = spec.kind === 'rational' ? spec.requiredForm : undefined;
  const write = (next: string, form: 'reduced_fraction' | null) => {
    setWritten(next);
    const parsed = answerSpec(next, form);
    if (parsed) onChange(parsed);
  };
  const parsed = answerSpec(written, requiredForm ?? null);
  return <div className="editor-answer">
    <label className="editor-field">
      <span className="editor-label">정답</span>
      <input value={written} onChange={(event) => write(event.target.value, requiredForm ?? null)} placeholder="3 또는 1/2" />
      {parsed
        ? <small>{parsed.kind === 'integer' ? '정수로 답하는 문항이에요. 1/2 같은 분수는 오답으로 봅니다.' : '값이 같으면 정답이에요. 0.5와 2/4도 1/2과 같은 값으로 봅니다.'}</small>
        : <small className="editor-warn">정답으로 읽을 수 없어요. 3 또는 1/2처럼 써 주세요. 고치기 전까지는 이전 정답이 남아 있어요.</small>}
    </label>
    {parsed?.kind === 'rational' && <label className="editor-check">
      <input type="checkbox" checked={!!requiredForm}
        onChange={(event) => write(written, event.target.checked ? 'reduced_fraction' : null)} />
      <span className="editor-label">기약분수로 써야 정답</span>
    </label>}
  </div>;
}

function SkillPicker({ skillKeys, chosen, onChange }: { skillKeys: string[]; chosen: string[]; onChange: (next: string[]) => void }) {
  if (!skillKeys.length) return null;
  return <div className="editor-skills">
    <span className="editor-label">다루는 개념</span>
    <div className="editor-skill-buttons">
      {skillKeys.map((key) => <label key={key} className="editor-check">
        <input type="checkbox" checked={chosen.includes(key)}
          onChange={() => onChange(chosen.includes(key) ? chosen.filter((item) => item !== key) : [...chosen, key])} />
        <span>{key}</span>
      </label>)}
    </div>
  </div>;
}

function ProblemBlocks({ label, hint, part, problem, blocks, taken, termChoices, onChange }: {
  label: string; hint?: string; part: 'prompt' | 'hint' | 'solution'; problem: DraftProblem;
  blocks: ContentBlock[]; taken: string[]; termChoices: TermChoice[]; onChange: (next: ContentBlock[]) => void;
}) {
  return <div className="editor-problem-part">
    <span className="editor-label">{label}</span>
    {hint && <p className="editor-note">{hint}</p>}
    {blocks.map((block, index) => <BlockCard key={block.blockId} block={block} index={index} total={blocks.length}
      arrangingRefusal="문항 안에서는 놓아 보게 만들 수 없어요. 놓은 결과는 채점되지 않는데 답 칸 옆에 있으면 답으로 읽혀요."
      termChoices={termChoices}
      onChange={(next) => onChange(blocks.map((item, position) => (position === index ? next : item)))}
      onMove={(delta) => onChange(moveBlock(blocks, index, delta))}
      onRemove={() => onChange(blocks.filter((_, position) => position !== index))} />)}
    <AddBlock label={`${label} 블록 추가`} forms={problemBlockForms}
      blockId={() => nextProblemBlockId(problem.problemVersionId, part, taken)}
      onAdd={(block) => onChange([...blocks, block])} />
  </div>;
}

function ProblemCard({ problem, index, total, skillKeys, taken, termChoices, onChange, onMove, onRemove }: {
  problem: DraftProblem; index: number; total: number; skillKeys: string[]; taken: string[]; termChoices: TermChoice[];
  onChange: (next: DraftProblem) => void; onMove: (delta: number) => void; onRemove: () => void;
}) {
  const [open, setOpen] = useState(false);
  return <section className="editor-problem">
    <header>
      <button type="button" className="editor-problem-open" aria-expanded={open} onClick={() => setOpen(!open)}>
        <Icon name="chevron" size={14} />
        <span><strong>{index + 1}번 문항</strong><small>{problem.problemVersionId}</small></span>
      </button>
      <div className="editor-block-tools">
        <button type="button" className="icon-button" aria-label={`${index + 1}번 문항 위로`} disabled={index === 0} onClick={() => onMove(-1)}>↑</button>
        <button type="button" className="icon-button" aria-label={`${index + 1}번 문항 아래로`} disabled={index === total - 1} onClick={() => onMove(1)}>↓</button>
        <button type="button" className="icon-button" aria-label={`${index + 1}번 문항 삭제`} onClick={onRemove}><Icon name="close" size={14} /></button>
      </div>
    </header>
    {open && <div className="editor-problem-body">
      <ProblemBlocks label="문제" part="prompt" problem={problem} blocks={problem.promptContent} taken={taken} termChoices={termChoices}
        onChange={(promptContent) => onChange({ ...problem, promptContent })} />
      <AnswerField spec={problem.gradingSpec} onChange={(gradingSpec) => onChange({ ...problem, gradingSpec })} />
      <SkillPicker skillKeys={skillKeys} chosen={problem.skillKeys} onChange={(next) => onChange({ ...problem, skillKeys: next })} />
      <ProblemBlocks label="힌트" part="hint" problem={problem} blocks={problem.hints} taken={taken} termChoices={termChoices}
        hint="힌트를 하나라도 두면 학습 화면에 힌트 버튼이 생겨요. 힌트를 열고 맞히면 도움을 받은 풀이로 기록합니다."
        onChange={(hints) => onChange({ ...problem, hints })} />
      <ProblemBlocks label="해설" part="solution" problem={problem} blocks={problem.solution} taken={taken} termChoices={termChoices}
        hint="문항을 마친 뒤에만 보여 줍니다. 한 블록 이상 있어야 발행할 수 있어요."
        onChange={(solution) => onChange({ ...problem, solution })} />
    </div>}
  </section>;
}

/**
 * The questions one activity holds. A question belongs to exactly one activity, so this is where a
 * question is written, changed and removed; removing one here drops it from the version being
 * written, while every published version keeps the question it was published with.
 */
export function ProblemSetEditor({ block, problems, skillKeys, classKey, role, versionId, taken, termChoices, onChange }: {
  block: ContentBlock; problems: DraftProblem[]; skillKeys: string[]; classKey: string; role: string; versionId: string;
  taken: string[]; termChoices: TermChoice[]; onChange: (block: ContentBlock, problems: DraftProblem[]) => void;
}) {
  const ids = Array.isArray(block.payload.problemVersionIds) ? (block.payload.problemVersionIds as string[]) : [];
  const chosen = problemsOfBlock(block, problems);
  // An activity and its questions are one change: writing them separately would leave the activity
  // naming a question the document no longer holds, or holding one nothing names.
  const write = (nextIds: string[], nextProblems: DraftProblem[]) =>
    onChange({ ...block, payload: { ...block.payload, problemVersionIds: nextIds } }, nextProblems);
  const add = () => {
    const created = newProblem(nextProblemVersionId(classKey, role, versionId, problems.map((item) => item.problemVersionId)),
      chosen[0]?.skillKeys ?? problems[0]?.skillKeys ?? skillKeys.slice(0, 1));
    write([...ids, created.problemVersionId], [...problems, created]);
  };
  return <div className="editor-problems">
    {chosen.map((problem, index) => <ProblemCard key={problem.problemVersionId} problem={problem} index={index}
      total={chosen.length} skillKeys={skillKeys} taken={taken} termChoices={termChoices}
      onChange={(next) => write(ids, problems.map((item) => (item.problemVersionId === problem.problemVersionId ? next : item)))}
      onMove={(delta) => write(moveBlock(ids, index, delta), problems)}
      onRemove={() => write(ids.filter((item) => item !== problem.problemVersionId),
        problems.filter((item) => item.problemVersionId !== problem.problemVersionId))} />)}
    {ids.length > chosen.length && <p className="editor-note editor-warn">
      이 활동이 가리키는 문항 중 {ids.length - chosen.length}개가 이 판본에 없어요. 발행 전에 지우거나 다시 만들어 주세요.</p>}
    <button type="button" className="button secondary" onClick={add}><Icon name="plus" size={14} />문항 추가</button>
  </div>;
}
