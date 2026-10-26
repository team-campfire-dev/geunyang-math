'use client';

import { useEffect, useState } from 'react';
import { reasonLabel, type FeedbackReason } from '@/shared/feedback';
import { clientLabel, type LearnerListing, type LearnerSessionsDetail, type Sitting, type SittingEvent } from '@/shared/learner-sessions';
import { learnerSessionsApi } from './api-client';

const messageOf = (reason: unknown) => (reason instanceof Error ? reason.message : '불러오지 못했어요. 다시 시도해 주세요.');
const zone = { timeZone: 'Asia/Seoul' } as const;
const dayOf = (iso: string) => new Intl.DateTimeFormat('ko-KR', { ...zone, month: 'long', day: 'numeric', weekday: 'short' }).format(new Date(iso));
const clock = (iso: string) => new Intl.DateTimeFormat('ko-KR', { ...zone, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(new Date(iso));
const clockSeconds = (iso: string) => new Intl.DateTimeFormat('ko-KR', { ...zone, hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' }).format(new Date(iso));
const when = (iso: string | null) => (iso ? `${dayOf(iso)} ${clock(iso)}` : '아직 없음');
/** A length of time the way it is said: 「3초」, 「1분 35초」, 「2시간 5분」. */
export const lasting = (seconds: number) => {
  if (seconds < 60) return `${seconds}초`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}분${seconds % 60 ? ` ${seconds % 60}초` : ''}`;
  return `${Math.floor(seconds / 3600)}시간${Math.floor((seconds % 3600) / 60) ? ` ${Math.floor((seconds % 3600) / 60)}분` : ''}`;
};
const spanOf = (sitting: Sitting) => Math.round((new Date(sitting.endedAt).getTime() - new Date(sitting.startedAt).getTime()) / 1000);
const statusNames = { correct: '맞음', incorrect: '틀림', invalid: '읽지 못함' } as const;
const visitNames = { login: 'Google로 로그인했어요', open: '페이지를 열었어요', return: '페이지로 돌아왔어요', logout: '로그아웃했어요' } as const;

/** One line of a sitting: what happened, and how long it took where that is known. */
function EventLine({ event, sameClient }: { event: SittingEvent; sameClient: boolean }) {
  const line = (text: React.ReactNode, meta?: React.ReactNode, tone?: string) => <li className={`sitting-event${tone ? ` is-${tone}` : ''}`}>
    <time dateTime={event.at}>{clockSeconds(event.at)}</time><span className="sitting-what">{text}</span>{meta && <span className="sitting-meta">{meta}</span>}</li>;
  switch (event.kind) {
    case 'joined': return line('계정을 만들었어요', undefined, 'quiet');
    // The browser is said where it changes; the sitting's heading already names the first one.
    case 'visit': return line(visitNames[event.visit], sameClient ? undefined : clientLabel(event.client), 'quiet');
    case 'course': return line(`${event.by}이(가) 「${event.courseTitle}」을(를) 정해 줬어요`, undefined, 'quiet');
    case 'lesson': return line(event.phase === 'start' ? <>「{event.lessonTitle}」 시작 <small>· {event.courseTitle}</small></> : <strong>「{event.lessonTitle}」 완료</strong>);
    case 'section': return line(<>{event.position}/{event.of} 「{event.sectionTitle}」 끝냄</>, event.seconds === null ? undefined : lasting(event.seconds));
    case 'answer': return line(<>
      <span className={`pill${event.status === 'correct' ? '' : ' warn'}`}>{statusNames[event.status]}</span>
      「{event.prompt}」 → <code>{event.answer}</code>{event.attempt > 1 && <small> · {event.attempt}번째</small>}{event.hint && <small> · 힌트 보고</small>}
    </>, event.seconds === null ? undefined : lasting(event.seconds), event.status === 'correct' ? undefined : 'wrong');
    case 'hint': return line(<>힌트를 열었어요 · 「{event.prompt}」</>);
    case 'assignment': return line(event.phase === 'given' ? `「${event.title}」 과제가 생겼어요` : <strong>「{event.title}」 제출</strong>, undefined, event.phase === 'given' ? 'quiet' : undefined);
    case 'diagnostic': return line(event.phase === 'start' ? '시작점 확인을 시작했어요' : <strong>시작점 확인을 마쳤어요</strong>);
    case 'feedback': return line(<>의견 · 「{event.lessonTitle}」{reasonLabel(event.reason as FeedbackReason | null) && <> · {reasonLabel(event.reason as FeedbackReason | null)}</>}
      {event.quote && <small> “{event.quote}”</small>}{event.body && <> — {event.body}</>}</>);
    case 'practice': return line(`AI 맞춤 연습을 ${event.status === 'pending' ? '만드는 중이에요' : '만들지 못했어요'}${event.scope ? ` · ${event.scope}` : ''}`, undefined, 'wrong');
  }
}

/** Whether a visit came in the same browser as the visit before it in the sitting, or is the sitting's first. */
const sameAsBefore = (events: SittingEvent[], index: number) => {
  const event = events[index];
  if (event.kind !== 'visit') return false;
  const before = events.slice(0, index).reverse().find((item) => item.kind === 'visit');
  return !before || (before.kind === 'visit' && clientLabel(before.client) === clientLabel(event.client));
};

function SittingCard({ sitting }: { sitting: Sitting }) {
  const length = spanOf(sitting);
  return <article className={`sitting${sitting.learnerActive ? '' : ' is-outside'}`}>
    <header>
      <h3>{dayOf(sitting.startedAt)} {clock(sitting.startedAt)}–{clock(sitting.endedAt)}<small>{sitting.learnerActive ? (length ? lasting(length) : '잠깐') : '학습자 없이 있었던 일'}</small></h3>
      {sitting.clients.length > 0 && <p className="editor-note">{sitting.clients.map(clientLabel).join(', ')}</p>}
    </header>
    {sitting.notes.length > 0 && <ul className="sitting-notes" aria-label="이 세션에서 읽히는 것">{sitting.notes.map((note, index) =>
      <li key={index} className={`is-${note.kind}`}>{note.text}</li>)}</ul>}
    <ol className="sitting-events">{sitting.events.map((event, index) => <EventLine key={index} event={event} sameClient={event.kind === 'visit' && sameAsBefore(sitting.events, index)} />)}</ol>
  </article>;
}

/**
 * Learners' sittings read back, for the operator: who has learned lately, and for one of them every
 * sitting — when, in what, and what they did from one moment to the next, with what that says
 * written above it. It is what used to take a database query and the proxy's logs to find out.
 */
export function LearnerSessionsPanel() {
  const [learners, setLearners] = useState<LearnerListing[] | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [detail, setDetail] = useState<LearnerSessionsDetail | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    let live = true;
    learnerSessionsApi.list().then((response) => { if (live) setLearners(response.list.learners); }, (reason) => { if (live) setError(messageOf(reason)); });
    return () => { live = false; };
  }, []);
  useEffect(() => {
    if (!selected) return;
    let live = true;
    setDetail(null); setError('');
    learnerSessionsApi.detail(selected).then((response) => { if (live) setDetail(response.detail); }, (reason) => { if (live) setError(messageOf(reason)); });
    return () => { live = false; };
  }, [selected]);

  if (!learners) return <section className="dashboard-section">{error ? <p className="error-banner" role="alert">{error}</p> : <p className="editor-note">불러오는 중이에요.</p>}</section>;
  return <section className="dashboard-section learner-sessions">
    <div className="section-heading"><div><h2>학습 세션</h2>
      <p className="editor-note">학습자가 언제, 어떤 기기로 들어와서 무엇을 했는지 시간순으로 보여 줘요. 30분 넘게 아무것도 하지 않으면 다른 세션으로 나눠요. 시간은 한국 시간이에요.</p></div></div>
    {error && <p className="error-banner" role="alert">{error}</p>}

    <fieldset className="editor-panel">
      <legend>학습자</legend>
      <div className="usage-table-wrap"><table className="usage-table">
        <thead><tr><th>이름</th><th>마지막 학습</th><th>최근 30일 세션</th><th>마친 수업</th><th>답</th><th>마지막 기기</th></tr></thead>
        <tbody>{learners.map((learner) => <tr key={learner.userId} className={selected === learner.userId ? 'is-selected' : undefined}>
          <td><button type="button" className="text-button" aria-pressed={selected === learner.userId} onClick={() => setSelected(learner.userId)}>{learner.displayName}</button></td>
          <td>{when(learner.lastActiveAt)}</td><td>{learner.recentSittings}</td><td>{learner.lessonsCompleted}</td><td>{learner.answers}</td>
          <td>{learner.lastClient ? clientLabel(learner.lastClient) : '—'}</td>
        </tr>)}</tbody>
      </table></div>
      <p className="editor-note">기기는 이 화면이 생긴 뒤의 방문부터 남아요. 그전 기록에는 단계마다 걸린 시간과 기기가 없어요.</p>
    </fieldset>

    {selected && !detail && !error && <p className="editor-note">불러오는 중이에요.</p>}
    {detail && <div className="sitting-list">
      <h3 className="sitting-who">{detail.learner.displayName}<small>{dayOf(detail.learner.joinedAt)} 가입 · 세션 {detail.sittings.filter((item) => item.learnerActive).length}번</small></h3>
      {detail.sittings.map((sitting) => <SittingCard key={sitting.startedAt} sitting={sitting} />)}
    </div>}
  </section>;
}
