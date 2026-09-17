'use client';
import { useState, type FormEvent } from 'react';
import type { ActionResponse, DiagnosticOffering, DiagnosticView, LearningAction, PublicLesson, ConceptReadiness } from '@/shared/api';
import { ContentBlocks } from './content-blocks';

export function DiagnosticPanel({ diagnostic, offering, dispatch, busy, onBack, nextLesson, readiness, onOpenLesson }: {
  nextLesson?: PublicLesson; readiness: ConceptReadiness[]; onOpenLesson: (key: string) => void;
  diagnostic: DiagnosticView | null; offering: DiagnosticOffering | null; dispatch: (action: LearningAction) => Promise<ActionResponse>; busy: boolean; onBack: () => void;
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
  return <section className="diagnostic-panel">
    <button className="back-button" onClick={onBack} disabled={busy}>← 내 학습으로</button>
    <div className="page-heading"><div className="eyebrow">FIND YOUR STARTING POINT</div><h1>어디서 시작하면 편할까요?</h1><p>{!diagnostic && offering ? offering.description : "모르는 문제는 건너뛰어도 괜찮아요. 나의 속도로 확인해 보세요."}</p></div>
    {!diagnostic ? offering ? <div className="lesson-sheet"><h2>{offering.title} · {offering.total}문제</h2><p>약 {offering.estimatedMinutes}분이 걸려요. 점수를 매기기보다 지금 필요한 수업을 찾는 데 사용해요. 저장한 답은 변경할 수 없고, 결과는 마지막에 함께 확인해요.</p><p>나중에 돌아와도 저장한 문제 다음부터 이어갈 수 있어요. 진단 없이 수업에서 바로 시작해도 괜찮아요.</p><button className="button primary" disabled={busy} onClick={() => void start()}>시작점 확인하기</button></div> : <p>시작점 확인을 준비하고 있어요. 수업에서 학습을 시작할 수 있어요.</p>
      : diagnostic.status === 'completed' ? <div className="lesson-sheet"><h2>시작점을 확인했어요.</h2><p>{diagnostic.total}문제 중 {diagnostic.results.filter(a => a.status === 'correct').length}문제에서 풀이를 확인했어요. 건너뛴 {diagnostic.results.filter(a => a.status === 'skipped').length}문제는 아직 모르는 상태로 두었어요.</p><p>이 결과는 잠정적인 추천에만 사용해요. 이후 실제 수업과 제출한 복습 기록을 우선 반영해요.</p><div className="readiness-list">{readiness.map((concept) => <span key={concept.key} className={`readiness ${concept.readiness}`}><strong>{concept.label}</strong> · {concept.readiness === 'ready' ? '다음 개념 준비' : concept.readiness === 'needs-practice' ? '한 번 더 연습' : '아직 확인 전'}</span>)}</div>
          {nextLesson && <div className="diagnostic-next"><span className="eyebrow">다음 추천 수업</span><h3>{nextLesson.title}</h3><p>{nextLesson.summary}</p><button className="button primary" onClick={() => onOpenLesson(nextLesson.lessonKey)}>이 수업 펼치기</button></div>}
          <button className="text-button" onClick={onBack}>내 학습으로 돌아가기</button></div>
        : diagnostic.currentProblem && <article className="lesson-sheet" key={diagnostic.currentProblem.problemVersionId}>
          <p className="eyebrow">{diagnostic.answered + 1} / {diagnostic.total} · {diagnostic.answered ? '앞의 답안은 저장됐어요' : '편하게 시작해 보세요'}</p>
          <progress aria-label="시작점 확인 진행" value={diagnostic.answered} max={diagnostic.total} />
          <ContentBlocks blocks={diagnostic.currentProblem.promptContent} />
          <form className="answer-form" onSubmit={(event: FormEvent) => { event.preventDefault(); if (answer.trim()) void save(answer.trim()); }}>
            <label>나의 답<input aria-label="진단 답안" value={answer} maxLength={128} onChange={event => setAnswer(event.target.value)} disabled={busy} autoComplete="off" placeholder={diagnostic.currentProblem.responseSpec.kind === 'integer' ? '정수를 입력해 주세요' : '예: 3/4'} /></label>
            <button className="button primary" disabled={busy || !answer.trim()}>{busy ? '저장 중…' : diagnostic.answered + 1 === diagnostic.total ? '저장하고 결과 보기' : '저장하고 다음 문제'}</button>
          </form>
          {error && <p className="field-error" role="alert">{error}</p>}
          <button className="text-button" disabled={busy} onClick={() => void save(null)}>아직 모르겠어요 · 건너뛰기</button>
          <p className="input-help">건너뛰기는 오답으로 기록하지 않아요. 결과는 마지막 문제를 마친 뒤 함께 확인해요.</p>
        </article>}
  </section>;
}
