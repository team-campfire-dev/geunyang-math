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

/** A recorded answer drawn the way it was written: the choice's own text, math, or the raw text. */
function Written({ attempt, problem }: { attempt: ConfusionAttempt; problem: ConfusionEvidence }) {
  const option = problem.responseSpec.options?.find(item => item.id === attempt.answer.trim());
  const written = answerLatex(attempt.answer);
  return option ? <RichText text={option.text} /> : written ? <RichText text={`$${written}$`} /> : <span className="confusion-written">{attempt.answer}</span>;
}

/**
 * One question whose first answer was missed, read again as it was asked: the question, the first
 * answer struck through, the one that put it right if there was one, and what the answer gave away.
 */
function MistakeCard({ problem, busy, onOpenLesson }: { problem: ConfusionEvidence; busy?: boolean; onOpenLesson: (key: string) => void }) {
  const fixed = problem.corrections.find(attempt => attempt.status === 'correct');
  const lessonKey = problem.first.source.lessonKey;
  return <article className="mistake-card">
    <div className="mistake-prompt"><ContentBlocks blocks={problem.promptContent} /></div>
    <div className="mistake-answers">
      <div className="is-wrong"><small>첫 답</small><div className="mistake-struck"><Written attempt={problem.first} problem={problem} /></div><Icon name="close" size={14} /></div>
      {fixed && <div className="is-right"><small>다시 쓴 답</small><Written attempt={fixed} problem={problem} /><Icon name="check" size={14} /></div>}
    </div>
    {problem.first.signal && <p className="mistake-signal">답에서 읽은 단서: <b>{problem.first.signal.label}</b></p>}
    <div className="mistake-foot">
      <span>{sourceLabels[problem.first.source.kind]} · {problem.first.source.title} · <time dateTime={problem.first.createdAt}>{day(problem.first.createdAt)}</time>{problem.first.hintUsed ? ' · 힌트 사용' : ''}</span>
      <span className="mistake-tools">
        <ConceptHelp key={problem.first.id} attemptId={problem.first.id} context="history" busy={busy} />
        {lessonKey && <button className="text-button" disabled={busy} onClick={() => onOpenLesson(lessonKey)}>수업 보기</button>}
      </span>
    </div>
  </article>;
}

/**
 * A mistake made on more than one question, with those questions under it. The first one on the
 * page asks for practice with the one ink button there is; the others ask more quietly, because a
 * page where five buttons say the same thing has not said which to press.
 */
function MistakeGroup({ item, shown, records, onGather, busy, continuing, onOpenLesson, lead }: {
  item: RepeatedConfusion; shown: string[]; records: Map<string, ConfusionEvidence>; onGather: Gather; busy?: boolean;
  continuing: boolean; onOpenLesson: (key: string) => void; lead: boolean;
}) {
  const [error, setError] = useState('');
  const [starting, setStarting] = useState(false);
  const pending = useRef(false);
  async function gather() {
    if (pending.current) return;
    pending.current = true; setStarting(true); setError('');
    try { await onGather(item.key); }
    catch (reason) { setError(reason instanceof Error ? reason.message : '문제를 준비하지 못했어요. 다시 눌러 주세요.'); }
    finally { pending.current = false; setStarting(false); }
  }
  return <section className={`mistake-group is-${item.status}`} id={item.kind === 'misconception' ? confusionCardId(item.key) : undefined} tabIndex={-1} aria-labelledby={`mistake-${item.kind}-${item.key}`}>
    <header>
      <div>
        <span className="mistake-group-kind">되풀이된 실수 <span className="confusion-badge">{item.status === 'improving' ? '최근에는 스스로 해결' : `${item.evidenceIds.length}문제에서 반복`}</span></span>
        <h3 id={`mistake-${item.kind}-${item.key}`}>{item.label}</h3>
        <div className="confusion-note"><RichText text={item.note} /></div>
        {item.status === 'improving' && <p className="muted small">{item.description}</p>}
      </div>
      {item.kind === 'misconception' && item.status === 'repeated'
        && <button className={lead ? 'button primary' : 'button secondary'} disabled={busy || starting} onClick={() => void gather()}>
          {starting ? '문제 준비 중… (새로 만들면 30초쯤)' : continuing ? '모아 풀기 이어서' : '이것만 모아 풀기'}</button>}
    </header>
    {error && <p className="field-error" role="alert">{error}</p>}
    {shown.length > 0 && <div className="mistake-cards">{shown.map(id => records.get(id) && <MistakeCard key={id} problem={records.get(id)!} busy={busy} onOpenLesson={onOpenLesson} />)}</div>}
    {item.improvementEvidenceIds.length > 0 && <Evidence ids={item.improvementEvidenceIds} records={records} label="이후 스스로 푼 근거" />}
  </section>;
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

/**
 * 오답 노트: every question whose first answer was missed, gathered under the mistake it showed.
 * A mistake seen on two different questions heads its own group; a slip seen once waits with the
 * others at the end. What was put right afterwards stays on the card, struck-through answer and all.
 */
export function ConfusionSummary({ summary, onOpenLesson, onGather, busy, continuingKeys = [] }: {
  summary: Summary; onOpenLesson: (key: string) => void; onGather: Gather; busy?: boolean; continuingKeys?: string[];
}) {
  const [onlyOpen, setOnlyOpen] = useState(false);
  const records = confusionRecords(summary);
  const wrong = summary.evidence.filter(item => item.first.status === 'incorrect');
  const unfixed = wrong.filter(item => !item.corrections.some(attempt => attempt.status === 'correct'));
  const shown = new Set((onlyOpen ? unfixed : wrong).map(item => item.problemVersionId));
  const grouped = new Set(summary.repeated.flatMap(item => item.evidenceIds));
  const loose = (onlyOpen ? unfixed : wrong).filter(item => !grouped.has(item.problemVersionId));
  const lead = summary.repeated.find(item => item.kind === 'misconception' && item.status === 'repeated');
  const missed = summary.concepts.filter(item => item.state === 'missed').length;
  return <section className="mistake-note" aria-label="오답 노트" id="confusion-summary" tabIndex={-1}>
    <div className="mistake-note-bar">
      <dl className="mistake-note-counts">
        <div><dt>푼 문제</dt><dd>{summary.evidence.length}</dd></div>
        <div><dt>첫 답 놓침</dt><dd>{wrong.length}</dd></div>
        <div><dt>아직 못 고침</dt><dd>{unfixed.length}</dd></div>
      </dl>
      {wrong.length > 0 && <div className="mistake-filter" role="group" aria-label="보여 줄 문제">
        <button className={!onlyOpen ? 'active' : ''} aria-pressed={!onlyOpen} onClick={() => setOnlyOpen(false)}>전체</button>
        <button className={onlyOpen ? 'active' : ''} aria-pressed={onlyOpen} onClick={() => setOnlyOpen(true)}>아직 못 고친 것</button>
      </div>}
    </div>
    <details className="history-guide"><summary>기록을 읽는 기준</summary><p>수업과 제출한 문제집의 첫 답을 함께 살펴봤어요. 같은 문제를 여러 번 풀어도 한 문제로 세고, 고쳐 쓴 답은 따로 보여줘요. 서로 다른 두 문제 이상에서 같은 실수가 나오면 「되풀이된 실수」로 모아요. 답에서 읽은 단서라 이유를 단정하지는 않아요.</p></details>
    {!summary.evidence.length && <p className="empty-inline">아직 살펴볼 풀이가 없어요. 수업에서 답하거나 문제집을 제출하면 여기에 모여요.</p>}
    {summary.evidence.length > 0 && !wrong.length && !summary.repeated.length && <p className="empty-inline">아직 첫 답을 놓친 문제가 없어요.</p>}
    {onlyOpen && wrong.length > 0 && !unfixed.length && <p className="empty-inline">놓친 문제는 모두 다시 풀어 맞혔어요.</p>}
    {summary.repeated.map(item => <MistakeGroup key={`${item.kind}:${item.key}`} item={item} shown={item.evidenceIds.filter(id => shown.has(id))}
      records={records} onGather={onGather} busy={busy} continuing={continuingKeys.includes(item.key)} onOpenLesson={onOpenLesson} lead={item === lead} />)}
    {loose.length > 0 && <section className="mistake-group">
      <header><div><h3>{summary.repeated.length ? '그 밖에 놓친 문제' : '첫 답을 놓친 문제'}</h3></div></header>
      <div className="mistake-cards">{loose.map(item => <MistakeCard key={item.problemVersionId} problem={item} busy={busy} onOpenLesson={onOpenLesson} />)}</div>
    </section>}
    {missed > 0 && <p className="confusion-pointer">서로 다른 문제에서 첫 답을 놓친 개념 {missed}개는 아래 「코스별 학습 상태」에서 코스를 펼치면 볼 수 있어요.</p>}
  </section>;
}
