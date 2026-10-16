'use client';

import { useState } from 'react';
import { answerText } from '@/shared/answer';
import { problemGist, type ConceptChoice, type DraftProblem } from '@/shared/authoring';
import {
  generationIssueLabel, generationLimits, generationVerdictLabels, mayTake,
  type GeneratedProblem, type GenerationForm, type GenerationRequest, type GenerationResult,
} from '@/shared/generation';
import { misconceptionLabel, misconceptions } from '@/shared/misconception';
import { Icon } from '@/features/learning/icons';
import { RichText } from '@/features/learning/content-blocks';
import { ConceptPicker } from './problem-editor';

const forms: { value: GenerationForm; label: string }[] = [
  { value: 'mixed', label: '섞어서' }, { value: 'choice', label: '객관식' }, { value: 'written', label: '답 쓰기' },
];
const mistakes: ConceptChoice[] = misconceptions.map((record) => ({ key: record.key, label: record.label, assessable: true }));
const blockText = (problem: DraftProblem, part: 'promptContent' | 'hints' | 'solution') =>
  problem[part].map((block) => String(block.payload.text ?? ''));

/**
 * One question as it came back, with what the checks found. A question that passed is offered to
 * take; one that needs reading says why above the button; one that is wrong for certain has no button.
 */
function Candidate({ generated, taken, expert, onTake }: { generated: GeneratedProblem; taken: boolean; expert: boolean; onTake: () => void }) {
  const { problem, verdict } = generated;
  const spec = problem.gradingSpec;
  const shown = generated.issues.filter((issue) => expert || issue.level !== 'warning');
  return <article className={`generated-problem generated-${verdict}`}>
    <header>
      <span className="generated-verdict">{generationVerdictLabels[verdict]}</span>
      {expert && generated.strength && <small>{generated.strength}</small>}
    </header>
    {blockText(problem, 'promptContent').map((text, at) => <RichText key={at} text={text} />)}
    {spec.kind === 'choice'
      ? <ul className="generated-options">{spec.options.map((option) => <li key={option.id} className={option.id === spec.correct ? 'correct' : undefined}>
        {option.id === spec.correct && <Icon name="check" size={13} />}<RichText text={option.text} asCaption />
        {problem.misreadings?.find((m) => m.answer === option.id) && <small>{misconceptionLabel(problem.misreadings.find((m) => m.answer === option.id)!.misconception)}</small>}
      </li>)}</ul>
      // A question the editor could not hold has no answer of its own to show, only the placeholder.
      : !generated.issues.some((issue) => issue.code === 'output-invalid') ? <p className="generated-answer">정답 <strong>{answerText(spec)}</strong>
        {problem.misreadings?.map((m) => <small key={m.answer}> · {m.answer}: {misconceptionLabel(m.misconception)}</small>)}</p> : null}
    {shown.length > 0 && <ul className="generated-issues">
      {shown.map((issue, at) => <li key={at} className={issue.level}>{generationIssueLabel(issue)}
        {expert && <small> {issue.code}: {issue.message}</small>}</li>)}
    </ul>}
    {(problem.hints.length > 0 || problem.solution.length > 0) && <details>
      <summary>힌트와 해설</summary>
      {blockText(problem, 'hints').map((text, at) => <div key={`h${at}`} className="generated-part"><span className="editor-label">힌트</span><RichText text={text} /></div>)}
      {blockText(problem, 'solution').map((text, at) => <div key={`s${at}`} className="generated-part"><span className="editor-label">해설</span><RichText text={text} /></div>)}
    </details>}
    {expert && <p className="generated-claim"><code>{generated.claim}</code>
      {generated.computed !== undefined && <small> 계산: {generated.computed}</small>}
      {generated.independent !== undefined && <small> 따로 푼 답: {generated.independent}</small>}</p>}
    {mayTake(generated)
      ? <button type="button" className={verdict === 'verified' ? 'button secondary' : 'text-button'} disabled={taken} onClick={onTake}>
        {taken ? '넣었어요' : verdict === 'verified' ? <><Icon name="plus" size={14} />활동에 넣기</> : '읽어 봤어요, 넣기'}</button>
      : <p className="editor-note">틀린 곳이 확실해서 넣을 수 없어요.</p>}
  </article>;
}

/**
 * Asking a model for questions for this activity.
 *
 * The author says what the questions are about and which mistakes they should catch; the server
 * writes them, has them answered from the prompt alone, and checks both (docs/problem-verification.md).
 * Nothing lands in the activity until the author takes it, and what is taken is an ordinary
 * question from then on — edited, saved and published like one written by hand.
 */
export function ProblemGenerator({ concepts, held, expert, onGenerate, onTake }: {
  concepts: ConceptChoice[];
  /** The activity's questions, so new ones neither repeat them nor share their answers. */
  held: DraftProblem[];
  expert: boolean;
  /** Rejects with a message an author can read when nothing came back. */
  onGenerate: (request: GenerationRequest) => Promise<GenerationResult>;
  onTake: (generated: GeneratedProblem) => void;
}) {
  const [conceptKeys, setConceptKeys] = useState<string[]>(() => held[0]?.conceptKeys.filter((key) => concepts.some((c) => c.key === key)) ?? concepts.slice(0, 1).map((c) => c.key));
  const [aimed, setAimed] = useState<string[]>([]);
  const [count, setCount] = useState(3);
  const [form, setForm] = useState<GenerationForm>('mixed');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<GenerationResult | null>(null);
  const [taken, setTaken] = useState<Set<number>>(new Set());
  const [failure, setFailure] = useState<string | null>(null);
  const generate = async () => {
    setBusy(true); setFailure(null);
    try {
      const next = await onGenerate({ conceptKeys, misconceptions: aimed, count, form, note,
        existing: held.slice(0, generationLimits.maxExisting).map((problem) => ({
          prompt: problemGist(problem, generationLimits.maxExistingText), answer: answerText(problem.gradingSpec).slice(0, generationLimits.maxExistingText) })) });
      setResult(next); setTaken(new Set());
    } catch (reason) {
      // What was asked stays in the form, so asking again is one press.
      setFailure(reason instanceof Error && reason.message ? reason.message : '문제를 만들지 못했어요.');
    } finally { setBusy(false); }
  };
  const counts = result && { verified: result.problems.filter((p) => p.verdict === 'verified').length, all: result.problems.length };
  return <details className="editor-generator">
    <summary><Icon name="spark" size={14} />AI로 문제 만들기</summary>
    <p className="editor-note">만든 문제는 서버가 정답을 직접 계산해 대조하고, 지문만 보고 따로 푼 답과도 비교해요. 넣기 전에는 이 활동에 아무것도 들어가지 않아요.</p>
    <ConceptPicker concepts={concepts} chosen={conceptKeys} onChange={setConceptKeys} label="다룰 개념" />
    <ConceptPicker concepts={mistakes} chosen={aimed} label="겨냥할 실수 (고르지 않으면 알아서 골라요)" noun="실수"
      onChange={(next) => setAimed(next.slice(0, generationLimits.maxMisconceptions))} />
    <div className="editor-row">
      <label className="editor-field"><span className="editor-label">문제 수</span>
        <select value={count} onChange={(event) => setCount(Number(event.target.value))}>
          {Array.from({ length: generationLimits.maxCount }, (_, at) => <option key={at} value={at + 1}>{at + 1}개</option>)}
        </select></label>
      <label className="editor-field"><span className="editor-label">형식</span>
        <select value={form} onChange={(event) => setForm(event.target.value as GenerationForm)}>
          {forms.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}
        </select></label>
    </div>
    <label className="editor-field"><span className="editor-label">더 바라는 것</span>
      <textarea rows={2} maxLength={generationLimits.maxNote} value={note} placeholder="예: 실생활 상황으로, 분모가 10 이하인 수로"
        onChange={(event) => setNote(event.target.value)} /></label>
    <button type="button" className="button primary" disabled={busy || !conceptKeys.length} onClick={() => void generate()}>
      {busy ? '만들고 확인하는 중… (1분쯤 걸려요)' : '만들기'}</button>
    {failure && <p className="editor-note editor-warn" role="alert">{failure}</p>}
    {result && counts && <div className="generated-list" aria-live="polite">
      <p className="editor-note">{counts.all}개 중 {counts.verified}개가 검증을 통과했어요.{counts.verified < counts.all ? ' 나머지는 이유를 읽고 고르세요.' : ''}</p>
      {result.problems.map((generated, at) => <Candidate key={at} generated={generated} taken={taken.has(at)} expert={expert}
        onTake={() => { onTake(generated); setTaken((current) => new Set(current).add(at)); }} />)}
    </div>}
  </details>;
}
