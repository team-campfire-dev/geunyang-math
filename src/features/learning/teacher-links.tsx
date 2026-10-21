'use client';

import { useState, type FormEvent } from 'react';
import type { PublicCourse } from '@/shared/api';
import { inviteLength, normalizeInvite, setByName, type LearnerTeaching, type SetBy } from '@/shared/teaching';
import { Icon } from './icons';

/** What a course somebody set is called where the learner meets it: whose it is, in a few words. */
export const assignedLabel = (by: SetBy) => {
  if (by.kind === 'operator') return '정해진 과정';
  const name = setByName(by);
  // A name that already ends in an honorific — 「김민재 선생님」, 「AI 선생님」 — is not given another.
  return `${name}${name.endsWith('님') ? '' : '님'}이 정한 과정`;
};

/**
 * Who teaches this learner, in their own settings. Nobody has to be here: every public course is
 * open without a teacher, and saying so is the first thing this shows to somebody with none. A code
 * is how a link is made, because typing it is the learner saying yes — nobody is linked to a person
 * by that person's choice alone.
 */
export function TeacherLinks({ teaching, courses, busy, onJoin, onLeave }: {
  teaching: LearnerTeaching; courses: PublicCourse[]; busy: boolean;
  onJoin: (code: string) => Promise<boolean>; onLeave: (linkId: string) => Promise<boolean>;
}) {
  const [code, setCode] = useState('');
  const [leaving, setLeaving] = useState<string | null>(null);
  const ready = normalizeInvite(code).length === inviteLength;
  const join = async (event: FormEvent) => {
    event.preventDefault();
    if (ready && await onJoin(code)) setCode('');
  };
  const title = (key: string) => courses.find((course) => course.key === key)?.title;
  // A course kept from this learner since it was set is nowhere they can go, so it is not listed.
  const assigned = teaching.assignedCourses.filter((course) => title(course.courseKey));
  return <section className="teacher-links" aria-labelledby="teacher-links-title">
    <h3 id="teacher-links-title">함께 배우는 선생님</h3>
    {teaching.teachers.length ? <ul className="teacher-list">
      {teaching.teachers.map((teacher) => <li key={teacher.linkId}>
        <span><strong>{teacher.name}</strong><small>{new Date(teacher.since).toLocaleDateString('ko-KR')}부터</small></span>
        {leaving === teacher.linkId
          ? <span className="teacher-leave" role="group" aria-label={`${teacher.name}님과 연결 끊기 확인`}>
            <small>이 선생님이 정해 준 과정도 함께 빠져요. 내 학습 기록은 그대로예요.</small>
            <button type="button" className="text-button" disabled={busy} onClick={async () => { if (await onLeave(teacher.linkId)) setLeaving(null); }}>끊기</button>
            <button type="button" className="text-button" disabled={busy} onClick={() => setLeaving(null)}>그만두기</button>
          </span>
          : <button type="button" className="text-button" disabled={busy} onClick={() => setLeaving(teacher.linkId)}>연결 끊기</button>}
      </li>)}
    </ul> : <p className="muted small">혼자서도 모든 공개 과정을 배울 수 있어요. 선생님이나 보호자에게 받은 초대 코드가 있으면 아래에 넣어 주세요.</p>}
    {assigned.length > 0 && <div className="assigned-courses">
      <span className="form-label">정해 준 과정</span>
      <ul>{assigned.map((course) => <li key={course.courseKey}><strong>{title(course.courseKey)}</strong><small>{setByName(course.setBy)}</small></li>)}</ul>
      <p className="muted small">시작점 확인과 추천이 배우려는 과정과 함께 이 과정들을 향해요.</p>
    </div>}
    <form className="invite-form" onSubmit={join}>
      <label className="form-label">초대 코드
        <input value={code} onChange={(event) => setCode(event.target.value)} disabled={busy}
          autoComplete="off" autoCapitalize="characters" spellCheck={false} maxLength={20} placeholder="ABCD-2345" /></label>
      <button className="button secondary" type="submit" disabled={busy || !ready}><Icon name="check" size={16} />연결하기</button>
    </form>
    <p className="muted small">연결하면 그 선생님이 내 이름을 보고 배울 과정을 정해 줄 수 있어요. 언제든 끊을 수 있어요.</p>
  </section>;
}
