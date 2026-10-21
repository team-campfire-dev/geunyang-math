'use client';

import { useEffect, useState } from 'react';
import { courseStageLabels, courseTrackLabels, type CourseStage, type CourseTrack } from '@/shared/api';
import { formatInvite, setByName, visibilityNames, courseVisibilities,
  type CourseVisibility, type TaughtLearner, type TeachingAction, type TeachingCourse, type TeachingView } from '@/shared/teaching';
import { Icon } from '@/features/learning/icons';
import { teachingApi } from './api-client';

const messageOf = (reason: unknown) => (reason instanceof Error ? reason.message : '요청을 처리하지 못했어요. 다시 시도해 주세요.');
/** Where a course sits, said the way a teacher would: 「중2」, or the line it is on when it has no year. */
const placeOf = (course: Pick<TeachingCourse, 'track' | 'stage'>) =>
  course.stage ? courseStageLabels[course.stage as CourseStage] : courseTrackLabels[course.track as CourseTrack];

/**
 * The people this account teaches. A teacher hands out a code, and a learner who types it is linked;
 * nobody appears here any other way, so a teacher never sees somebody who did not say yes. For each
 * learner the teacher sets the courses they are heading for — an exam's worth at once — and takes
 * off what they set. An operator also finds any learner by name and decides who may see each course.
 */
export function TeachingPanel({ userId }: { userId: string }) {
  const [view, setView] = useState<TeachingView | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [query, setQuery] = useState('');
  const [matches, setMatches] = useState<TaughtLearner[] | null>(null);
  const [ending, setEnding] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    teachingApi.view().then((response) => { if (live) setView(response.teaching); }, (reason) => { if (live) setError(messageOf(reason)); });
    return () => { live = false; };
  }, []);

  const act = async (action: TeachingAction) => {
    if (busy) return;
    setBusy(true); setError('');
    try {
      const response = await teachingApi.act(action, userId);
      setView(response.teaching);
      if (response.matches) setMatches(response.matches);
      // A learner just changed in the list is changed in what was found, too.
      else if (matches) setMatches(matches.map((learner) => response.teaching.learners.find((item) => item.userId === learner.userId) ?? learner));
    } catch (reason) { setError(messageOf(reason)); }
    finally { setBusy(false); }
  };

  if (!view) return <section className="dashboard-section">{error ? <p className="error-banner" role="alert">{error}</p> : <p className="editor-note">불러오는 중이에요.</p>}</section>;
  const title = (key: string) => view.courses.find((course) => course.key === key)?.title ?? key;
  const listed = new Set(view.learners.map((learner) => learner.userId));

  return <section className="dashboard-section teaching-panel">
    <div className="section-heading"><div><h2>가르치는 학습자</h2>
      <p className="editor-note">학습자는 배정이 없어도 모든 공개 코스로 혼자 배울 수 있어요. 여기서 정해 준 과정은 그 학습자의 시작점 확인과 추천이 향하는 곳이 돼요.</p></div></div>
    {error && <p className="error-banner" role="alert">{error}</p>}

    <fieldset className="editor-panel">
      <legend>초대 코드</legend>
      <p className="editor-note">학습자가 학습 화면의 설정에서 이 코드를 넣으면 연결돼요. 코드를 새로 만들면 예전 코드는 더 이상 쓸 수 없고, 이미 연결된 학습자는 그대로예요.</p>
      <div className="editor-actions">
        {view.invite ? <strong className="invite-code" aria-label={`초대 코드 ${view.invite.split('').join(' ')}`}>{formatInvite(view.invite)}</strong>
          : <span className="editor-note">아직 초대 코드가 없어요.</span>}
        <button type="button" className="button secondary" disabled={busy} onClick={() => void act({ action: 'invite.renew' })}>{view.invite ? '새 코드 만들기' : '초대 코드 만들기'}</button>
      </div>
    </fieldset>

    <fieldset className="editor-panel">
      <legend>{view.operator ? '연결되었거나 직접 배정한 학습자' : '연결된 학습자'}</legend>
      {view.learners.length ? <div className="taught-list">{view.learners.map((learner) => <LearnerRow key={learner.userId} learner={learner} courses={view.courses}
        busy={busy} title={title} ending={ending === learner.userId} onEnding={(on) => setEnding(on ? learner.userId : null)} onAct={act} />)}</div>
        : <p className="empty-inline">아직 연결된 학습자가 없어요. 초대 코드를 건네 보세요.</p>}
    </fieldset>

    {view.operator && <fieldset className="editor-panel">
      <legend>학습자 찾기</legend>
      <p className="editor-note">운영자는 연결 없이도 학습자에게 과정을 정해 줄 수 있어요. 이름의 일부로 찾습니다.</p>
      <div className="editor-actions">
        <label className="editor-field"><span className="editor-label">이름</span>
          <input value={query} onChange={(event) => setQuery(event.target.value)}
            onKeyDown={(event) => { if (event.key === 'Enter' && query.trim().length >= 2) void act({ action: 'learner.find', query: query.trim() }); }} /></label>
        <button type="button" className="button secondary" disabled={busy || query.trim().length < 2} onClick={() => void act({ action: 'learner.find', query: query.trim() })}>찾기</button>
      </div>
      {matches && (matches.length ? <div className="taught-list">{matches.filter((learner) => !listed.has(learner.userId)).map((learner) => <LearnerRow key={learner.userId}
        learner={learner} courses={view.courses} busy={busy} title={title} ending={false} onEnding={() => {}} onAct={act} />)}
        {matches.every((learner) => listed.has(learner.userId)) && <p className="editor-note">찾은 학습자가 모두 위 목록에 있어요.</p>}</div>
        : <p className="empty-inline">그런 이름의 계정이 없어요.</p>)}
    </fieldset>}

    {view.operator && <fieldset className="editor-panel">
      <legend>코스 공개 범위</legend>
      <p className="editor-note">「배정한 학습자에게만」으로 두면 그 코스는 배정받은 학습자와 이미 시작한 학습자에게만 보여요. 교사는 모두에게 공개된 코스만 배정할 수 있어요.</p>
      <div className="role-list">{view.courses.map((course) => <div key={course.key} className="role-row">
        <span className="role-who"><strong>{course.title}</strong><small>{placeOf(course)}</small></span>
        <select aria-label={`${course.title} 공개 범위`} value={course.visibility} disabled={busy}
          onChange={(event) => void act({ action: 'course.visibility', courseKey: course.key, visibility: event.target.value as CourseVisibility })}>
          {courseVisibilities.map((visibility) => <option key={visibility} value={visibility}>{visibilityNames[visibility]}</option>)}
        </select>
      </div>)}</div>
    </fieldset>}
  </section>;
}

function LearnerRow({ learner, courses, busy, title, ending, onEnding, onAct }: {
  learner: TaughtLearner; courses: TeachingCourse[]; busy: boolean; title: (key: string) => string;
  ending: boolean; onEnding: (on: boolean) => void; onAct: (action: TeachingAction) => Promise<void>;
}) {
  const [adding, setAdding] = useState('');
  const set = new Set(learner.courses.map((course) => course.courseKey));
  // Grouped by year, which is how a teacher thinks of a range: 「중2 2학기」 is three of these.
  const open = courses.filter((course) => course.mayAssign && !set.has(course.key));
  const places = [...new Set(open.map(placeOf))];
  return <div className="taught-row">
    <div className="taught-who">
      <strong>{learner.displayName}</strong>
      <small>{learner.since ? `${new Date(learner.since).toLocaleDateString('ko-KR')}에 연결` : '연결 없이 운영자가 배정'}</small>
    </div>
    <ul className="taught-courses" aria-label={`${learner.displayName}님에게 정한 과정`}>
      {learner.courses.length ? learner.courses.map((course) => <li key={course.courseKey} className="pill">
        {title(course.courseKey)}{!course.mine && <small> · {setByName(course.setBy)}</small>}
        {course.mine && <button type="button" className="pill-remove" disabled={busy} aria-label={`${title(course.courseKey)} 배정 빼기`}
          onClick={() => void onAct({ action: 'course.unassign', learnerUserId: learner.userId, courseKey: course.courseKey })}><Icon name="close" size={12} /></button>}
      </li>) : <li className="editor-note">정한 과정이 없어요. 공개된 과정은 모두 스스로 고를 수 있어요.</li>}
    </ul>
    <div className="editor-actions taught-actions">
      <select aria-label={`${learner.displayName}님에게 정할 과정`} value={adding} disabled={busy || !open.length} onChange={(event) => setAdding(event.target.value)}>
        <option value="">과정 고르기</option>
        {places.map((place) => <optgroup key={place} label={place}>
          {open.filter((course) => placeOf(course) === place).map((course) => <option key={course.key} value={course.key}>{course.title}</option>)}
        </optgroup>)}
      </select>
      <button type="button" className="button secondary" disabled={busy || !adding}
        onClick={async () => { await onAct({ action: 'course.assign', learnerUserId: learner.userId, courseKey: adding }); setAdding(''); }}><Icon name="plus" size={15} />정해 주기</button>
      {learner.linkId && (ending
        ? <span className="taught-ending" role="group" aria-label="연결 끊기 확인">
          <small>끊으면 내가 정해 준 과정도 함께 빠져요. 학습자의 기록은 그대로예요.</small>
          <button type="button" className="text-button" disabled={busy} onClick={async () => { await onAct({ action: 'link.end', learnerUserId: learner.userId }); onEnding(false); }}>끊기</button>
          <button type="button" className="text-button" disabled={busy} onClick={() => onEnding(false)}>그만두기</button>
        </span>
        : <button type="button" className="text-button" disabled={busy} onClick={() => onEnding(true)}><Icon name="close" size={14} />연결 끊기</button>)}
    </div>
  </div>;
}
