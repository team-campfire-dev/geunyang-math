'use client';

import { useRef, useState, type FormEvent } from 'react';
import { leafGlossary } from '@/shared/definition-exploration';
import type { AttemptView, ContentBlock, PublicProblem } from '@/shared/api';
import { ContentBlocks, RichText, unsupportedRequiredBlocks, type GlossaryContext } from './content-blocks';
import { Icon } from './icons';

const messageOf = (error: unknown) => (error instanceof Error ? error.message : '문제가 생겼어요. 다시 시도해 주세요.');

/**
 * What answering a question does. A lesson sends it to the learning API and keeps a record; the
 * editor sends it to the draft it is writing and keeps nothing. The card is the same either way,
 * which is the point: an author trying their own question meets the screen a learner will.
 */
export type ProblemActions = {
  /** Sends an answer. The same request id repeats an unfinished send rather than starting another. */
  submit: (answer: string, requestId: string) => Promise<void>;
  openHint: () => Promise<ContentBlock[]>;
};

/**
 * One question as a learner answers it: the prompt, a box to write in, what the server said about
 * the last answer, and a hint if the question carries one. The answer itself is never here — it is
 * sent away and judged, and this only shows the judgement.
 */
export function ProblemCard({ problem, attempt, actions, busy, disabled, ready = true, onReady, readyNote, submitLabel = '정답 확인', onDraftChange, glossary, recordsLearning = true }: {
  problem: PublicProblem; attempt?: AttemptView | null; actions: ProblemActions;
  busy: boolean; disabled?: boolean;
  /** Whether answering is possible yet. A lesson not started is the reason it is usually not. */
  ready?: boolean; onReady?: () => void; readyNote?: string;
  submitLabel?: string; recordsLearning?: boolean;
  onDraftChange?: (id: string, dirty: boolean) => void; glossary?: GlossaryContext;
}) {
  glossary = glossary ? { ...glossary, entries: leafGlossary(glossary.entries, problem.conceptKeys), onOpenDefinition: undefined, activeDefinition: undefined, panelId: undefined } : undefined;
  const [answer, setAnswer] = useState(attempt?.answer ?? '');
  const [hint, setHint] = useState<ContentBlock[] | null>(null);
  const [localError, setLocalError] = useState('');
  const requestRef = useRef<{ answer: string; id: string } | null>(null);
  const unsupported = unsupportedRequiredBlocks(problem.promptContent);
  const options = problem.responseSpec.kind === 'choice' ? problem.responseSpec.options ?? [] : null;
  const changed = answer.trim() !== attempt?.answer;
  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!ready) { onReady?.(); return; }
    if (!answer.trim() || busy || disabled || unsupported) return;
    setLocalError('');
    const value = answer.trim();
    if (requestRef.current?.answer !== value) requestRef.current = { answer: value, id: crypto.randomUUID() };
    try {
      await actions.submit(value, requestRef.current.id);
      requestRef.current = null;
      onDraftChange?.(problem.problemVersionId, false);
    } catch (error) { setLocalError(messageOf(error)); }
  }
  async function openHint() {
    if (!ready) { onReady?.(); return; }
    try { setHint(await actions.openHint()); setLocalError(''); }
    catch (error) { setLocalError(messageOf(error)); }
  }
  return <article className="problem-card">
    <div className="problem-kicker"><Icon name="pencil" size={15} />직접 생각해 보기{attempt?.hintUsed && <span>힌트와 함께 푼 문제</span>}</div>
    <ContentBlocks blocks={problem.promptContent} glossary={glossary} />
    <form onSubmit={submit} className={options ? 'answer-form is-choice' : 'answer-form'}>
      {options
        // The option's name is the answer; its text is only what the learner reads. Two options may
        // read alike and still be different answers, so nothing is compared by what it says.
        ? <fieldset className="answer-choices" disabled={busy || disabled || unsupported || !ready}>
            <legend>답 고르기</legend>
            {options.map((option) => <label key={option.id} className={answer === option.id ? 'answer-choice is-picked' : 'answer-choice'}>
              <input type="radio" name={`answer-${problem.problemVersionId}`} value={option.id} checked={answer === option.id}
                onChange={() => { setAnswer(option.id); onDraftChange?.(problem.problemVersionId, option.id !== (attempt?.answer ?? '')); }} />
              <span><RichText text={option.text} /></span>
            </label>)}
          </fieldset>
        : <label>나의 답<input aria-label="나의 답" type="text" inputMode="text" maxLength={100} placeholder={problem.responseSpec.kind === 'rational' ? '예: 3/4 또는 0.75' : '정수를 입력해 주세요'} value={answer} onChange={(event) => { setAnswer(event.target.value); onDraftChange?.(problem.problemVersionId, event.target.value.trim() !== (attempt?.answer ?? '')); }} disabled={busy || disabled || unsupported || !ready} autoComplete="off" spellCheck={false} /></label>}
      <button className="button primary" disabled={busy || disabled || unsupported || !ready || !answer.trim()} type="submit">{busy ? '저장 중…' : submitLabel}</button>
    </form>
    {problem.responseSpec.requiredForm && <p className="input-help">답안 형식: {problem.responseSpec.requiredForm === 'simplest' || problem.responseSpec.requiredForm === 'simplest_fraction' || problem.responseSpec.requiredForm === 'reduced_fraction' ? '기약분수' : problem.responseSpec.requiredForm}</p>}
    {attempt && <div className={`answer-feedback ${changed ? 'draft-feedback' : attempt.result.status}`} role="status"><Icon name={attempt.result.status === 'correct' && !changed ? 'check' : 'pencil'} size={18} /><span>{changed ? recordsLearning ? '답안을 수정했어요. 다시 저장하면 학습 기록에 반영돼요.' : '답안을 수정했어요. 다시 확인해 보세요.' : attempt.result.message}{!changed && attempt.result.assisted && <small>{recordsLearning ? '도움받은 풀이로 기록했어요.' : '힌트를 사용한 풀이예요. 학습 기록에는 남지 않아요.'}</small>}</span></div>}
    {localError && <p className="field-error" role="alert">{localError}</p>}
    {problem.hintAvailable && <div className="hint-area"><button className="text-button hint-button" disabled={busy || disabled || unsupported} onClick={openHint}><Icon name="lightbulb" size={16} />{hint ? '힌트 다시 보기' : '조금만 도움받기'}</button>{hint && <div className="hint-content"><ContentBlocks blocks={hint} glossary={glossary} /></div>}</div>}
    {!ready && readyNote && <p className="input-help">{readyNote}</p>}
  </article>;
}
