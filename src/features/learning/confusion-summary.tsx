'use client';

import { useRef, useState } from 'react';
import { confusionStateLabels, type ConfusionAttempt, type ConfusionEvidence, type ConfusionSummary as Summary, type ConfusionSignal, type RepeatedConfusion } from '@/shared/confusion';
import { ContentBlocks, RichText } from './content-blocks';
import { ConceptHelp } from './concept-help';
import { answerLatex } from '@/shared/answer';

const sourceLabels = { lesson: '수업', homework: '과제', exam: '시험', review: '복습', practice: '연습' };
const date = (value: string) => new Date(value).toLocaleString('ko-KR', { year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });

function Answer({ attempt, problem, first }: { attempt: ConfusionAttempt; problem: ConfusionEvidence; first: boolean }) {
  const option = problem.responseSpec.options?.find(item => item.id === attempt.answer.trim());
  const written = answerLatex(attempt.answer);
  return <li>
    <div className="confusion-answer"><strong>{first ? '첫 답' : '다시 쓴 답'}</strong>
      {option ? <RichText text={option.text} /> : written ? <RichText text={`$${written}$`} /> : <span className="confusion-written">{attempt.answer}</span>}
      <span>{attempt.status === 'correct' ? '맞힘' : '놓침'} · {attempt.hintUsed ? '힌트 사용' : '힌트 없이'}</span>
    </div>
    <p className="muted small">{sourceLabels[attempt.source.kind]} · {attempt.source.title} · <time dateTime={attempt.createdAt}>{date(attempt.createdAt)}</time></p>
    {attempt.signal && <p className="small">답에서 읽은 단서: {attempt.signal.label}</p>}
    {attempt.status === 'incorrect' && <ConceptHelp key={attempt.id} attemptId={attempt.id} context="history" />}
  </li>;
}

function Evidence({ ids, records, label = '풀이 근거 보기' }: { ids: string[]; records: Map<string, ConfusionEvidence>; label?: string }) {
  const [open, setOpen] = useState(false);
  const [limit, setLimit] = useState(5);
  return <details className="confusion-evidence" onToggle={event => setOpen(event.currentTarget.open)}>
    <summary>{label} · {ids.length}문제</summary>
    {open && <div>{ids.slice().reverse().slice(0, limit).map(id => {
      const item = records.get(id);
      return item && <article key={id}>
        <ContentBlocks blocks={item.promptContent} />
        <ol className="confusion-attempts"><Answer attempt={item.first} problem={item} first />
          {item.corrections.map(attempt => <Answer key={attempt.id} attempt={attempt} problem={item} first={false} />)}</ol>
      </article>;
    })}{ids.length > limit && <button className="text-button" onClick={() => setLimit(limit + 5)}>이전 풀이 더 보기</button>}</div>}
  </details>;
}

export const confusionCardId = (key: string) => `confusion-misconception-${encodeURIComponent(key)}`;
/** A summary link always reads one of its own visible wrong attempts, preferably the named signal. */
export function reviewAttempt(ids: string[], records: Map<string, ConfusionEvidence>, signal?: ConfusionSignal) {
  const wrong = ids.flatMap(id => {
    const record = records.get(id);
    return record ? [record.first, ...record.corrections].filter(attempt => attempt.status === 'incorrect') : [];
  }).sort((a, b) => b.createdAt.localeCompare(a.createdAt) || b.id.localeCompare(a.id));
  return (signal && wrong.find(attempt => attempt.signal?.kind === signal.kind && attempt.signal.key === signal.key)) || wrong[0];
}
type Gather = (key: string) => void | Promise<void>;
function RepeatedCard({ item, records, onGather, busy, continuing, onOpenLesson }: {
  item: RepeatedConfusion; records: Map<string, ConfusionEvidence>; onGather: Gather; busy?: boolean; continuing: boolean;
  onOpenLesson: (key: string) => void;
}) {
  const attempt = reviewAttempt(item.evidenceIds, records, item);
  const [error, setError] = useState('');
  const [starting, setStarting] = useState(false);
  const pending = useRef(false);
  const lessonKey = attempt?.source.lessonKey;
  async function gather() {
    if (pending.current) return;
    pending.current = true; setStarting(true); setError('');
    try { await onGather(item.key); }
    catch (reason) { setError(reason instanceof Error ? reason.message : '문제를 준비하지 못했어요. 다시 눌러 주세요.'); }
    finally { pending.current = false; setStarting(false); }
  }
  return <article className={`confusion-card confusion-pattern is-${item.status}`} id={item.kind === 'misconception' ? confusionCardId(item.key) : undefined} tabIndex={-1}>
    <div className="confusion-card-heading"><h4>{item.label}</h4><span className="confusion-badge">{item.status === 'improving' ? '최근에는 스스로 해결' : `${item.evidenceIds.length}문제에서 반복`}</span></div>
    <p>{item.description}</p><div className="confusion-note"><RichText text={item.note} /></div>
    <p className="muted small">마지막으로 같은 실수가 나온 때: <time dateTime={item.lastSeenAt}>{date(item.lastSeenAt)}</time></p>
    {attempt && <ConceptHelp key={attempt.id} attemptId={attempt.id} context="history" busy={busy || starting} />}
    {item.kind === 'misconception' && item.status === 'repeated'
      ? <div className="confusion-next"><p className="muted small">같은 실수를 다루는 문제로 다시 연습해 보세요.</p>
        <button className="button primary" disabled={busy || starting} onClick={() => void gather()}>{starting ? '문제 준비 중…' : continuing ? '모아 풀기 이어서' : '이것만 모아 풀기'}</button>
        {error && <p className="field-error" role="alert">{error}</p>}</div>
      : lessonKey && <button className="text-button" disabled={busy} onClick={() => onOpenLesson(lessonKey)}>관련 수업 다시 보기</button>}
    <Evidence ids={item.evidenceIds} records={records} />
    {item.improvementEvidenceIds.length > 0 && <Evidence ids={item.improvementEvidenceIds} records={records} label="이후 스스로 푼 근거" />}
  </article>;
}

export function ConfusionSummary({ summary, onOpenLesson, onGather, busy, continuingKeys = [] }: {
  summary: Summary; onOpenLesson: (key: string) => void; onGather: Gather; busy?: boolean; continuingKeys?: string[];
}) {
  const [showAll, setShowAll] = useState(false);
  const records = new Map(summary.evidence.map(item => [item.problemVersionId, item]));
  const observed = summary.concepts.filter(item => item.evidenceIds.length);
  const concepts = (showAll ? summary.concepts : observed).slice().sort((a, b) =>
    Number(b.state === 'missed') - Number(a.state === 'missed') || (b.latestAt ?? '').localeCompare(a.latestAt ?? ''));
  return <section className="dashboard-section confusion-summary" aria-label="헷갈림 요약" id="confusion-summary" tabIndex={-1}>
    <div className="section-heading"><div><span className="eyebrow">다시 살펴볼 것</span><h2>헷갈림 요약</h2></div>
      {summary.latestAt && <span className="muted small">최근 풀이 <time dateTime={summary.latestAt}>{date(summary.latestAt)}</time></span>}
    </div>
    <p className="history-description">헷갈렸던 개념을 읽고, 관련 문제로 다시 연습해 보세요.</p>
    <details className="history-guide"><summary>기록을 읽는 기준</summary><p>수업과 제출한 문제집의 첫 답을 함께 살펴봤어요. 같은 문제를 여러 번 풀어도 한 문제로 세고, 고쳐 쓴 답은 따로 보여줘요. 풀이 근거를 펼치면 당시의 답과 힌트 사용 여부를 볼 수 있어요.</p></details>
    {!summary.evidence.length && <p className="empty-inline">아직 살펴볼 풀이가 없어요. 수업에서 답하거나 문제집을 제출하면 여기에 모여요.</p>}
    {summary.repeated.length > 0 && <div className="confusion-patterns"><h3>되풀이된 실수와 최근 변화</h3>
      {summary.repeated.map(item => <RepeatedCard key={`${item.kind}:${item.key}`} item={item} records={records}
        busy={busy} continuing={continuingKeys.includes(item.key)} onGather={onGather} onOpenLesson={onOpenLesson} />)}
    </div>}
    <div className="confusion-concept-heading"><h3>개념별로 살펴보기</h3>
      <label><input type="checkbox" checked={showAll} onChange={event => setShowAll(event.target.checked)} /> 아직 풀지 않은 개념도 보기</label></div>
    <div className="confusion-concepts">{concepts.map(item => { const attempt = reviewAttempt(item.evidenceIds, records); return <article key={item.key} className={`confusion-card confusion-concept is-${item.state}`}>
      <div className="confusion-card-heading"><h4>{item.label}</h4><span className="confusion-badge">{confusionStateLabels[item.state]}</span></div>
      <p>{item.description}</p>
      <div className="confusion-concept-tools">
        {attempt && <ConceptHelp key={attempt.id} attemptId={attempt.id} context="history" conceptKey={item.key} buttonLabel="이 개념 설명" busy={busy} />}
        {item.lessonKey && <button className="text-button" disabled={busy} onClick={() => onOpenLesson(item.lessonKey!)}>이 개념의 수업 보기</button>}
      </div>
      {item.evidenceIds.length > 0 && <Evidence ids={item.evidenceIds} records={records} />}
    </article>; })}</div>
  </section>;
}
