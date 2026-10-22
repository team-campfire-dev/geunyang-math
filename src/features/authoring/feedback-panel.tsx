'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { feedbackReasons, reasonLabel, type FeedbackAction, type FeedbackEntry, type FeedbackInbox, type FeedbackReason } from '@/shared/feedback';
import { Icon } from '@/features/learning/icons';
import { RichText } from '@/features/learning/content-blocks';
import { feedbackApi } from './api-client';

const messageOf = (reason: unknown) => (reason instanceof Error ? reason.message : '요청을 처리하지 못했어요. 다시 시도해 주세요.');
type Showing = 'open' | 'resolved' | 'all';
const showingNames: Record<Showing, string> = { open: '처리할 의견', resolved: '처리한 의견', all: '전체' };

/**
 * What readers said about lessons while doing them, for the operator. Each note says where it points —
 * the step, and the words or the drawing — and whether that is still what the newest version shows,
 * so a note about a sentence that was since rewritten is not chased twice. From here a note opens the
 * lesson where it was left, or the lesson's draft at that step, and is marked dealt with.
 *
 * Which lessons take feedback is decided here too. A lesson is not a version, so it applies at once.
 */
export function FeedbackPanel({ userId, onEdit }: { userId: string; onEdit: (lessonKey: string, sectionId: string) => void }) {
  const [inbox, setInbox] = useState<FeedbackInbox | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [showing, setShowing] = useState<Showing>('open');
  const [lessonKey, setLessonKey] = useState('');
  /** A quick answer to see alone, or `written` for the ones somebody wrote out. */
  const [reason, setReason] = useState<FeedbackReason | 'written' | ''>('');

  const load = useCallback(async () => setInbox((await feedbackApi.inbox()).inbox), []);
  useEffect(() => { load().catch((reason) => setError(messageOf(reason))); }, [load]);

  const act = async (action: FeedbackAction) => {
    if (busy) return;
    setBusy(true); setError('');
    try { await feedbackApi.act(action, userId); await load(); }
    catch (reason) { setError(messageOf(reason)); }
    finally { setBusy(false); }
  };

  const entries = useMemo(() => (inbox?.entries ?? []).filter((entry) =>
    (showing === 'all' || entry.status === showing) && (!lessonKey || entry.lessonKey === lessonKey)
    && (!reason || (reason === 'written' ? !!entry.body : entry.reason === reason))), [inbox, showing, lessonKey, reason]);
  /** How the quick answers fall across what is shown apart from the answer chosen: where a lesson hurts, at a glance. */
  const tally = useMemo(() => {
    const counted = (inbox?.entries ?? []).filter((entry) => (showing === 'all' || entry.status === showing) && (!lessonKey || entry.lessonKey === lessonKey));
    return { reasons: feedbackReasons.map((item) => ({ ...item, count: counted.filter((entry) => entry.reason === item.key).length })),
      written: counted.filter((entry) => !!entry.body).length };
  }, [inbox, showing, lessonKey]);
  const groups = useMemo(() => {
    const byLesson = new Map<string, FeedbackEntry[]>();
    for (const entry of entries) byLesson.set(entry.lessonKey, [...(byLesson.get(entry.lessonKey) ?? []), entry]);
    return [...byLesson.values()];
  }, [entries]);

  if (!inbox) return <section className="dashboard-section">{error ? <p className="error-banner" role="alert">{error}</p> : <p className="editor-note">불러오는 중이에요.</p>}</section>;
  const lesson = inbox.lessons.find((item) => item.lessonKey === lessonKey);
  const waiting = inbox.lessons.reduce((sum, item) => sum + item.open, 0);
  const closed = inbox.lessons.filter((item) => !item.accepting);

  return <section className="dashboard-section feedback-panel">
    <div className="section-heading"><div><h2>수업 의견 <span className="count-label">{waiting}</span></h2>
      <p className="editor-note">학습자가 수업을 하다가 글을 끌어 고르거나 그림·문제 가장자리의 표시를 눌러, 빠른 답 하나를 누르거나 직접 써서 남긴 의견이에요. 남긴 사람에게는 처리했는지만 보여요.</p></div></div>
    {error && <p className="error-banner" role="alert">{error}</p>}

    <div className="feedback-filters">
      <div className="scope-toggle" role="group" aria-label="보여 줄 의견">
        {(Object.keys(showingNames) as Showing[]).map((value) => <button key={value} type="button" className={showing === value ? 'active' : ''}
          aria-pressed={showing === value} onClick={() => setShowing(value)}>{showingNames[value]}</button>)}
      </div>
      <label className="editor-field"><span className="editor-label">수업</span>
        <select value={lessonKey} onChange={(event) => setLessonKey(event.target.value)}>
          <option value="">모든 수업</option>
          {inbox.lessons.map((item) => <option key={item.lessonKey} value={item.lessonKey}>{item.courseTitle} · {item.title}{item.open ? ` (${item.open})` : ''}{item.accepting ? '' : ' · 받지 않음'}</option>)}
        </select></label>
      {lesson && <label className="feedback-accepting"><input type="checkbox" checked={lesson.accepting} disabled={busy}
        onChange={(event) => void act({ action: 'lesson.accepting', lessonKey: lesson.lessonKey, accepting: event.target.checked })} />
        이 수업에서 의견 받기</label>}
    </div>
    <div className="feedback-tally" role="group" aria-label="빠른 답으로 거르기">
      <button type="button" className={reason === '' ? 'active' : ''} aria-pressed={reason === ''} onClick={() => setReason('')}>모두</button>
      {tally.reasons.map((item) => <button key={item.key} type="button" className={reason === item.key ? 'active' : ''} aria-pressed={reason === item.key}
        disabled={!item.count && reason !== item.key} onClick={() => setReason(reason === item.key ? '' : item.key)}>{item.label} <b>{item.count}</b></button>)}
      <button type="button" className={reason === 'written' ? 'active' : ''} aria-pressed={reason === 'written'}
        onClick={() => setReason(reason === 'written' ? '' : 'written')}>직접 쓴 것 <b>{tally.written}</b></button>
    </div>
    {!lesson && closed.length > 0 && <p className="editor-note">의견을 받지 않는 수업: {closed.map((item) => item.title).join(', ')}</p>}

    {groups.length ? groups.map((group) => <article className="feedback-group" key={group[0].lessonKey}>
      <h3><small>{group[0].courseTitle}</small>{group[0].lessonTitle}</h3>
      {group.map((entry) => <div key={entry.id} className={`feedback-entry ${entry.status}`}>
        <div className="feedback-entry-place">
          <span>{entry.step ? `${entry.step}단계` : '지금은 없는 단계'} · {entry.sectionTitle}{entry.problemVersionId ? ' · 문제' : entry.blockId && !entry.quote ? ' · 그림·표' : ''}</span>
          {!entry.current && <span className="pill">지금 판본과 달라요</span>}
          {entry.status === 'resolved' && <span className="pill green">처리함</span>}
        </div>
        {entry.quote && <blockquote><RichText text={entry.quote} /></blockquote>}
        <p>{entry.reason && <span className="feedback-reason-tag">{reasonLabel(entry.reason)}</span>}{entry.body}</p>
        <div className="feedback-entry-foot">
          <span>{entry.author.name} · {new Date(entry.createdAt).toLocaleString('ko-KR', { month: 'long', day: 'numeric', hour: 'numeric', minute: '2-digit' })}</span>
          {entry.step && <a className="text-button" href={`/?lesson=${encodeURIComponent(entry.lessonKey)}${entry.step > 1 ? `&step=${entry.step}` : ''}`} target="_blank" rel="noreferrer">수업에서 보기<Icon name="arrow" size={13} /></a>}
          <button type="button" className="text-button" disabled={busy} onClick={() => onEdit(entry.lessonKey, entry.sectionId)}>고치러 가기</button>
          <button type="button" className="text-button" disabled={busy}
            onClick={() => void act({ action: entry.status === 'open' ? 'feedback.resolve' : 'feedback.reopen', feedbackId: entry.id })}>
            {entry.status === 'open' ? '처리함으로' : '다시 열기'}</button>
          <button type="button" className="text-button" disabled={busy} onClick={() => void act({ action: 'feedback.remove', feedbackId: entry.id })}>지우기</button>
        </div>
      </div>)}
    </article>) : <p className="empty-inline">{showing === 'open' ? '처리할 의견이 없어요.' : '의견이 없어요.'}</p>}
  </section>;
}
