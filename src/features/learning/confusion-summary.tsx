'use client';

import { useRef, useState } from 'react';
import type { ConfusionAttempt, ConfusionConcept, ConfusionEvidence, ConfusionSummary as Summary, ConfusionSignal, RepeatedConfusion } from '@/shared/confusion';
import { ContentBlocks, RichText } from './content-blocks';
import { ConceptHelp } from './concept-help';
import { Icon } from './icons';
import { answerLatex } from '@/shared/answer';

const sourceLabels = { lesson: '수업', homework: '과제', exam: '시험', review: '복습', practice: '연습' };
/** The year is said only when it is not this one — a record is read this year far more often than not. */
const withYear = (value: string) => new Date(value).getFullYear() !== new Date().getFullYear() ? { year: 'numeric' as const } : {};
const day = (value: string) => new Date(value).toLocaleDateString('ko-KR', { ...withYear(value), month: 'long', day: 'numeric' });
const moment = (value: string) => new Date(value).toLocaleString('ko-KR', { ...withYear(value), month: 'long', day: 'numeric', hour: '2-digit', minute: '2-digit' });

function Answer({ attempt, problem, first }: { attempt: ConfusionAttempt; problem: ConfusionEvidence; first: boolean }) {
  const option = problem.responseSpec.options?.find(item => item.id === attempt.answer.trim());
  const written = answerLatex(attempt.answer);
  return <li>
    <div className="confusion-answer"><strong>{first ? '첫 답' : '다시 쓴 답'}</strong>
      {option ? <RichText text={option.text} /> : written ? <RichText text={`$${written}$`} /> : <span className="confusion-written">{attempt.answer}</span>}
      <span>{attempt.status === 'correct' ? '맞힘' : '놓침'} · {attempt.hintUsed ? '힌트 사용' : '힌트 없이'}</span>
    </div>
    <p className="muted small">{sourceLabels[attempt.source.kind]} · {attempt.source.title} · <time dateTime={attempt.createdAt}>{moment(attempt.createdAt)}</time></p>
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
export const confusionRecords = (summary: Summary) => new Map(summary.evidence.map(item => [item.problemVersionId, item]));
/** A summary link always reads one of its own visible wrong attempts, preferably the named signal. */
export function reviewAttempt(ids: string[], records: Map<string, ConfusionEvidence>, signal?: ConfusionSignal) {
  const wrong = ids.flatMap(id => {
    const record = records.get(id);
    return record ? [record.first, ...record.corrections].filter(attempt => attempt.status === 'incorrect') : [];
  }).sort((a, b) => b.createdAt.localeCompare(a.createdAt) || b.id.localeCompare(a.id));
  return (signal && wrong.find(attempt => attempt.signal?.kind === signal.kind && attempt.signal.key === signal.key)) || wrong[0];
}
type Gather = (key: string) => void | Promise<void>;
type PatternProps = {
  item: RepeatedConfusion; records: Map<string, ConfusionEvidence>; onGather: Gather; busy?: boolean; continuing: boolean;
  onOpenLesson: (key: string) => void;
};

function Standing({ item }: { item: RepeatedConfusion }) {
  return <span className="confusion-meta">
    <span className="confusion-badge">{item.status === 'improving' ? '최근에는 스스로 해결' : `${item.evidenceIds.length}문제에서 반복`}</span>
    <time dateTime={item.lastSeenAt}>{day(item.lastSeenAt)}</time>
  </span>;
}

/**
 * What a repeated mistake is and what to do about it. The first one on the page asks for practice
 * with the one ink button there is; the ones folded under it ask more quietly, because a page where
 * five buttons say the same thing has not said which to press.
 */
function PatternBody({ item, records, onGather, busy, continuing, onOpenLesson, lead }: PatternProps & { lead: boolean }) {
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
  return <>
    <div className="confusion-note"><RichText text={item.note} /></div>
    {item.status === 'improving' && <p className="muted small">{item.description}</p>}
    <div className="confusion-tools">
      {item.kind === 'misconception' && item.status === 'repeated'
        && <button className={lead ? 'button primary' : 'button secondary'} disabled={busy || starting} onClick={() => void gather()}>
          {starting ? '문제 준비 중…' : continuing ? '모아 풀기 이어서' : '이것만 모아 풀기'}</button>}
      {attempt && <ConceptHelp key={attempt.id} attemptId={attempt.id} context="history" busy={busy || starting} />}
      {!(item.kind === 'misconception' && item.status === 'repeated') && lessonKey
        && <button className="text-button" disabled={busy} onClick={() => onOpenLesson(lessonKey)}>관련 수업 다시 보기</button>}
    </div>
    {error && <p className="field-error" role="alert">{error}</p>}
    <Evidence ids={item.evidenceIds} records={records} />
    {item.improvementEvidenceIds.length > 0 && <Evidence ids={item.improvementEvidenceIds} records={records} label="이후 스스로 푼 근거" />}
  </>;
}

/** A concept missed on two different questions, opened from its course in 「코스별 학습 상태」. */
export function MissedConcept({ concept, records, busy, onOpenLesson }: {
  concept: ConfusionConcept; records: Map<string, ConfusionEvidence>; busy?: boolean; onOpenLesson: (key: string) => void;
}) {
  const attempt = reviewAttempt(concept.evidenceIds, records);
  return <div className="missed-concept">
    <div className="confusion-tools">
      {attempt && <ConceptHelp key={attempt.id} attemptId={attempt.id} context="history" conceptKey={concept.key} buttonLabel="이 개념 설명" busy={busy} />}
      {concept.lessonKey && <button className="text-button" disabled={busy} onClick={() => onOpenLesson(concept.lessonKey!)}>이 개념의 수업 보기</button>}
    </div>
    {concept.evidenceIds.length > 0 && <Evidence ids={concept.evidenceIds} records={records} />}
  </div>;
}

export function ConfusionSummary({ summary, onOpenLesson, onGather, busy, continuingKeys = [] }: {
  summary: Summary; onOpenLesson: (key: string) => void; onGather: Gather; busy?: boolean; continuingKeys?: string[];
}) {
  const records = confusionRecords(summary);
  // One thing asked for at a time: the most recent mistake still repeating. The rest wait folded.
  const lead = summary.repeated.find(item => item.status === 'repeated');
  const rest = summary.repeated.filter(item => item !== lead);
  const missed = summary.concepts.filter(item => item.state === 'missed').length;
  const common = (item: RepeatedConfusion) => ({ item, records, busy, onGather, onOpenLesson, continuing: continuingKeys.includes(item.key) });
  const id = (item: RepeatedConfusion) => item.kind === 'misconception' ? confusionCardId(item.key) : undefined;
  return <section className="dashboard-section confusion-summary" aria-label="헷갈림 요약" id="confusion-summary" tabIndex={-1}>
    <div className="section-heading"><div><span className="eyebrow">다시 살펴볼 것</span><h2>헷갈림 요약</h2></div>
      {summary.latestAt && <span className="muted small">최근 풀이 <time dateTime={summary.latestAt}>{day(summary.latestAt)}</time></span>}
    </div>
    <details className="history-guide"><summary>기록을 읽는 기준</summary><p>수업과 제출한 문제집의 첫 답을 함께 살펴봤어요. 같은 문제를 여러 번 풀어도 한 문제로 세고, 고쳐 쓴 답은 따로 보여줘요. 서로 다른 두 문제 이상에서 같은 실수가 나오면 「되풀이된 실수」로 모아요. 답에서 읽은 단서라 이유를 단정하지는 않아요. 풀이 근거를 펼치면 당시의 답과 힌트 사용 여부를 볼 수 있어요.</p></details>
    {!summary.evidence.length && <p className="empty-inline">아직 살펴볼 풀이가 없어요. 수업에서 답하거나 문제집을 제출하면 여기에 모여요.</p>}
    {lead && <article className="confusion-card confusion-lead is-repeated" id={id(lead)} tabIndex={-1}>
      <div className="confusion-card-heading"><h3>{lead.label}</h3><Standing item={lead} /></div>
      <PatternBody {...common(lead)} lead />
    </article>}
    {rest.length > 0 && <div className="confusion-more">
      <h3>{lead ? '그 밖에 되풀이된 실수' : '되풀이된 실수와 최근 변화'} <span className="count-label">{rest.length}</span></h3>
      <ul className="confusion-list">{rest.map(item => <li key={`${item.kind}:${item.key}`}>
        <details className={`confusion-card is-${item.status}`} id={id(item)} tabIndex={-1}>
          <summary><span className="confusion-name">{item.label}</span><Standing item={item} /><Icon name="chevron" size={16} /></summary>
          <div className="confusion-fold"><PatternBody {...common(item)} lead={false} /></div>
        </details>
      </li>)}</ul>
    </div>}
    {summary.evidence.length > 0 && !summary.repeated.length && <p className="empty-inline">아직 되풀이된 실수는 없어요.</p>}
    {missed > 0 && <p className="confusion-pointer">서로 다른 문제에서 첫 답을 놓친 개념 {missed}개는 아래 「코스별 학습 상태」에서 코스를 펼치면 볼 수 있어요.</p>}
  </section>;
}
