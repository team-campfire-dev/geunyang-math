'use client';
import { useState, type FormEvent } from 'react';
import type { ActionResponse, DiagnosticOffering, DiagnosticView, LearningAction, PublicLesson, ConceptReadiness } from '@/shared/api';
import { AnswerChoices } from './answer-choices';
import { ContentBlocks } from './content-blocks';
import { ReadinessList } from './readiness-list';
import { MathAnswerField } from './math-answer-field';

export function DiagnosticPanel({ diagnostic, offering, dispatch, busy, onBack, nextLesson, readiness, onOpenLesson, targetTitle = null, onChooseTarget }: {
  nextLesson?: PublicLesson; readiness: ConceptReadiness[]; onOpenLesson: (key: string) => void;
  diagnostic: DiagnosticView | null; offering: DiagnosticOffering | null; dispatch: (action: LearningAction) => Promise<ActionResponse>; busy: boolean; onBack: () => void;
  /** The course this learner came for, which is what the placement has to settle the way to. */
  targetTitle?: string | null; onChooseTarget?: () => void;
}) {
  const [answer, setAnswer] = useState('');
  const [error, setError] = useState('');
  async function start() {
    try { await dispatch({ action: 'diagnostic.start' }); } catch { /* Shared banner displays the error. */ }
  }
  async function save(value: string | null) {
    if (!diagnostic?.currentProblem || busy) return;
    setError('');
    try {
      const response = await dispatch({ action: 'diagnostic.answer', diagnosticId: diagnostic.id,
        problemVersionId: diagnostic.currentProblem.problemVersionId, answer: value });
      if (response.result?.status === 'invalid') { setError(response.result.message); return; }
      setAnswer('');
    } catch (reason) { setError(reason instanceof Error ? reason.message : '저장하지 못했어요. 다시 시도해 주세요.'); }
  }
  /**
   * The options of the question being asked, when it is answered by picking one.
   *
   * The bank has asked this way since the NCS courses landed — sixty-five of its questions do — and
   * for as long as this screen knew only how to draw a box to write in, those arrived with their
   * options missing. A learner met 「이 일은 수리능력의 어느 영역인가요?」 above a number pad.
   */
  const current = diagnostic?.currentProblem;
  const options = current?.responseSpec.kind === 'choice' ? current.responseSpec.options ?? [] : null;
  return <section className="diagnostic-panel">
    <button className="back-button" onClick={onBack} disabled={busy}>← 내 학습으로</button>
    <div className="page-heading"><h1>어디서 시작하면 편할까요?</h1><p>{!diagnostic && offering ? offering.description : "모르는 문제는 건너뛰어도 괜찮아요. 나의 속도로 확인해 보세요."}</p></div>
    {!diagnostic ? offering ? <div className="lesson-sheet placement-intro"><h2>{offering.title} · 개념 {offering.scope}개</h2>
      {targetTitle ? <p><b>{targetTitle}</b>까지 가는 데 필요한 것만 확인해요.</p>
        : <p>아직 배우려는 과정을 고르지 않아서, <b>전체 과정</b>을 기준으로 확인해요. {onChooseTarget && <button className="text-button" type="button" disabled={busy} onClick={onChooseTarget}>배우려는 과정 고르기</button>}</p>}
      <ul className="placement-facts">
        <li>답에 따라 다음 문제가 달라져요. 한 문제를 풀면 그 위나 아래의 개념까지 함께 정해지기 때문에, 대개 훨씬 적게 풀고 끝나요.</li>
        <li>모르는 문제는 건너뛰어도 괜찮아요. 오답으로 기록하지 않아요.</li>
        <li>점수를 매기는 자리가 아니에요. 지금 필요한 수업을 찾는 데만 써요.</li>
        <li>저장한 답은 바꿀 수 없고, 결과는 마지막에 함께 확인해요.</li>
        <li>중간에 그만둬도 이어서 할 수 있고, 확인 없이 수업부터 시작해도 괜찮아요.</li>
      </ul>
      <button className="button primary" disabled={busy} onClick={() => void start()}>시작점 확인하기</button></div> : <p>시작점 확인을 준비하고 있어요. 수업에서 학습을 시작할 수 있어요.</p>
      : diagnostic.status === 'completed' ? <div className="lesson-sheet"><h2>시작점을 확인했어요.</h2><p>{diagnostic.results.length}문제로 개념 {diagnostic.settled}개의 자리를 찾았어요. 그중 {diagnostic.inferred}개는 직접 묻지 않고 앞의 답에서 이어진 것이에요. 건너뛴 {diagnostic.results.filter(a => a.status === 'skipped').length}문제는 아직 모르는 상태로 두었어요.</p>
          {/* What to do next comes before the reading that produced it: a learner who has just
              finished answering wants the door, not the report. The report stays underneath. */}
          {nextLesson && <div className="diagnostic-next"><span className="eyebrow">여기서 시작하면 좋아요</span><h3>{nextLesson.title}</h3><p>{nextLesson.summary}</p><button className="button primary" onClick={() => onOpenLesson(nextLesson.lessonKey)}>이 수업 펼치기</button></div>}
          <p className="muted small">이 결과는 잠정적인 추천에만 사용해요. 이후 실제 수업과 제출한 복습 기록을 우선 반영해요.</p><ReadinessList readiness={readiness} />
          <button className="text-button" onClick={onBack}>내 학습으로 돌아가기</button></div>
        : current && <article className="lesson-sheet" key={current.problemVersionId}>
          <p className="eyebrow">{diagnostic.answered + 1}번째 문제 · 개념 {diagnostic.scope}개 중 {diagnostic.settled}개 확인 · {diagnostic.answered ? '앞의 답안은 저장됐어요' : '편하게 시작해 보세요'}</p>
          <progress aria-label="시작점 확인 진행" value={diagnostic.settled} max={diagnostic.scope} />
          <ContentBlocks blocks={current.promptContent} />
          <form className={options ? 'answer-form is-choice' : 'answer-form'} onSubmit={(event: FormEvent) => { event.preventDefault(); if (answer.trim()) void save(answer.trim()); }}>
            {options
              ? <AnswerChoices name={`placement-${current.problemVersionId}`} options={options} value={answer} disabled={busy} onPick={setAnswer} />
              : <MathAnswerField label="나의 답" value={answer} disabled={busy}
                  integerOnly={current.responseSpec.kind === 'integer'}
                  placeholder={current.responseSpec.kind === 'integer' ? '정수를 입력해 주세요' : '예: 3/4'}
                  onChange={setAnswer} />}
            <button className="button primary" disabled={busy || !answer.trim()}>{busy ? '저장 중…' : '저장하고 다음으로'}</button>
          </form>
          {error && <p className="field-error" role="alert">{error}</p>}
          <button className="text-button" disabled={busy} onClick={() => void save(null)}>아직 모르겠어요 · 건너뛰기</button>
          <p className="input-help">건너뛰기는 오답으로 기록하지 않아요. 남은 개념이 모두 정해지면 결과를 함께 확인해요.</p>
          {/* Leaving is a thing to do, not a thing to find. The arrow at the top of the screen is
              the way back everywhere else in the app, so here it needs saying in words. */}
          <button className="text-button placement-pause" disabled={busy} onClick={onBack}>오늘은 여기까지 · 나중에 이어서 하기</button>
        </article>}
  </section>;
}
