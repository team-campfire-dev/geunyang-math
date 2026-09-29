'use client';

import { useState } from 'react';
import { confusionStateLabels, type ConfusionAttempt, type ConfusionEvidence, type ConfusionSummary as Summary } from '@/shared/confusion';
import { ContentBlocks, RichText } from './content-blocks';
import { ConceptHelp } from './concept-help';

const sourceLabels = { lesson: '수업', homework: '과제', exam: '시험', review: '복습', practice: '연습' };
const date = (value: string) => new Date(value).toLocaleString('ko-KR', { year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });

function Answer({ attempt, problem, first }: { attempt: ConfusionAttempt; problem: ConfusionEvidence; first: boolean }) {
  const option = problem.responseSpec.options?.find(item => item.id === attempt.answer.trim());
  return <li>
    <div className="confusion-answer"><strong>{first ? '첫 답' : '다시 쓴 답'}</strong>
      {option ? <RichText text={option.text} /> : <span className="confusion-written">{attempt.answer}</span>}
      <span>{attempt.status === 'correct' ? '맞힘' : '놓침'} · {attempt.hintUsed ? '힌트 사용' : '힌트 없이'}</span>
    </div>
    <p className="muted small">{sourceLabels[attempt.source.kind]} · {attempt.source.title} · <time dateTime={attempt.createdAt}>{date(attempt.createdAt)}</time></p>
    {attempt.signal && <p className="small">답에서 읽은 단서: {attempt.signal.label}</p>}
    {attempt.status === 'incorrect' && <ConceptHelp key={attempt.id} attemptId={attempt.id} />}
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

export function ConfusionSummary({ summary, onOpenLesson, onGather, busy }: {
  summary: Summary; onOpenLesson: (key: string) => void; onGather: (key: string) => void; busy?: boolean;
}) {
  const [showAll, setShowAll] = useState(false);
  const records = new Map(summary.evidence.map(item => [item.problemVersionId, item]));
  const observed = summary.concepts.filter(item => item.evidenceIds.length);
  const concepts = (showAll ? summary.concepts : observed).slice().sort((a, b) =>
    Number(b.state === 'missed') - Number(a.state === 'missed') || (b.latestAt ?? '').localeCompare(a.latestAt ?? ''));
  return <section className="dashboard-section confusion-summary" aria-label="헷갈림 요약">
    <div className="section-heading"><h2>헷갈림 요약</h2>
      {summary.latestAt && <span className="muted small">최근 풀이 <time dateTime={summary.latestAt}>{date(summary.latestAt)}</time></span>}
    </div>
    <p className="muted small">수업과 제출한 문제집의 첫 답을 함께 살펴봤어요. 같은 문제를 여러 번 풀어도 한 문제로 세고, 고쳐 쓴 답은 따로 보여줘요.</p>
    {!summary.evidence.length && <p className="empty-inline">아직 살펴볼 풀이가 없어요. 수업에서 답하거나 문제집을 제출하면 여기에 모여요.</p>}
    {summary.repeated.length > 0 && <div className="confusion-patterns"><h3>되풀이된 실수와 최근 변화</h3>
      {summary.repeated.map(item => <article className="confusion-card" key={`${item.kind}:${item.key}`}>
        <div className="confusion-card-heading"><h4>{item.label}</h4><span className="confusion-badge">{item.status === 'improving' ? '최근에는 스스로 해결' : `${item.evidenceIds.length}문제에서 반복`}</span></div>
        <p>{item.description}</p><p className="muted small"><RichText text={item.note} /></p>
        <p className="muted small">마지막으로 같은 실수가 나온 때: <time dateTime={item.lastSeenAt}>{date(item.lastSeenAt)}</time></p>
        <Evidence ids={item.evidenceIds} records={records} />
        {item.improvementEvidenceIds.length > 0 && <Evidence ids={item.improvementEvidenceIds} records={records} label="이후 스스로 푼 근거" />}
        {item.kind === 'misconception' && item.status === 'repeated' && <button className="button secondary" disabled={busy} onClick={() => onGather(item.key)}>이것만 모아 풀기</button>}
      </article>)}
    </div>}
    <div className="confusion-concept-heading"><h3>개념별로 살펴보기</h3>
      <label><input type="checkbox" checked={showAll} onChange={event => setShowAll(event.target.checked)} /> 아직 풀지 않은 개념도 보기</label></div>
    <div className="confusion-concepts">{concepts.map(item => <article key={item.key} className={`confusion-card is-${item.state}`}>
      <div className="confusion-card-heading"><h4>{item.label}</h4><span className="confusion-badge">{confusionStateLabels[item.state]}</span></div>
      <p>{item.description}</p>
      {item.evidenceIds.length > 0 && <Evidence ids={item.evidenceIds} records={records} />}
      {item.lessonKey && <button className="text-button" disabled={busy} onClick={() => onOpenLesson(item.lessonKey!)}>이 개념의 수업 보기</button>}
    </article>)}</div>
  </section>;
}
