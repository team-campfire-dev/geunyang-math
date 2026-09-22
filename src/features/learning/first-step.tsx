'use client';

import { useState } from 'react';
import { courseStageLabels, courseTrackLabels, courseTracks, stagesOf, type PublicCourse } from '@/shared/api';
import { Icon } from './icons';

/**
 * Somewhere in the catalogue a learner can say they are coming from: a year of school, or a line
 * that keeps no years. It is asked first because thirty-eight courses in one list is not a question
 * anybody can answer — 「중2까지 했어요」 is, and it leaves six courses to choose between.
 */
type Ground = { id: string; label: string; note: string; courses: PublicCourse[] };

function groundsOf(courses: PublicCourse[]): Ground[] {
  const grounds: Ground[] = [];
  for (const track of courseTracks) {
    const held = courses.filter((course) => course.track === track);
    if (!held.length) continue;
    const years = stagesOf(track).map((stage) => ({ stage, courses: held.filter((course) => course.stage === stage) }))
      .filter((year) => year.courses.length);
    // A line that keeps no years is one ground; the rest are one ground per year that has courses.
    if (!years.length) { grounds.push({ id: track, label: courseTrackLabels[track], note: `${held.length}개 과정`, courses: held }); continue; }
    const loose = held.filter((course) => !years.some((year) => year.courses.includes(course)));
    if (loose.length) grounds.push({ id: track, label: courseTrackLabels[track], note: `${loose.length}개 과정`, courses: loose });
    for (const year of years) {
      grounds.push({ id: `${track}:${year.stage}`, label: `${courseTrackLabels[track]} ${courseStageLabels[year.stage]}`,
        note: `${year.courses.length}개 과정`, courses: year.courses });
    }
  }
  return grounds;
}

/**
 * The first thing a learner is asked, and until now the thing nobody was asked at all.
 *
 * 「배우려는 과정」 decides what a placement has to settle and which way a recommendation leans, and
 * it lived behind a button in the sidebar that a new learner has no reason to press. Left empty it
 * makes everyone the same person: the placement covers the whole school line and the recommendation
 * falls back to the catalogue's own order, so whatever somebody came for, they were handed 분수 1강.
 *
 * So it is asked here, in three small questions rather than one list of thirty-eight, and every one
 * of them can be answered with 「잘 모르겠어요」 — that answer is what the placement is for.
 */
export function FirstStep({ courses, displayName, busy, error, onSave, onLater }: {
  courses: PublicCourse[]; displayName: string; busy: boolean; error?: string;
  onSave: (choice: { targetCourseKey: string | null; dailyMinutes: number }) => void;
  onLater: () => void;
}) {
  const grounds = groundsOf(courses);
  const [step, setStep] = useState<'ground' | 'course' | 'minutes'>('ground');
  const [ground, setGround] = useState<Ground | null>(null);
  const [target, setTarget] = useState<string | null>(null);
  const [minutes, setMinutes] = useState(10);
  // Somebody who could not name a year cannot name a course inside one either, so that step is
  // skipped rather than shown empty. They arrive at the placement with the whole line as its scope.
  const pickGround = (next: Ground | null) => { setGround(next); setTarget(null); setStep(next ? 'course' : 'minutes'); };
  const pickCourse = (key: string | null) => { setTarget(key); setStep('minutes'); };
  const chosen = courses.find((course) => course.key === target);
  return <div className="first-step">
    <span className="modal-symbol"><Icon name="spark" size={27} /></span>
    <h2 id="modal-title">{step === 'ground' ? `${displayName}님, 반가워요.` : step === 'course' ? `${ground!.label}에서 오셨군요.` : '마지막 하나만요.'}</h2>
    <p>{step === 'ground' ? '세 가지만 여쭤볼게요. 답에 맞춰 시작점과 추천이 정해지고, 나중에 언제든 바꿀 수 있어요.'
      : step === 'course' ? '배우려는 과정을 고르면 시작점 확인이 거기까지 가는 데 필요한 것만 묻고, 추천도 그쪽을 향해요.'
      : '하루에 얼마나 함께할지에 맞춰 오늘의 분량과 복습 과제의 문항 수를 정해요.'}</p>
    <ol className="first-step-track" aria-label="첫 걸음 진행">
      {(['ground', 'course', 'minutes'] as const).map((name, index) => <li key={name}
        className={name === step ? 'active' : ''} aria-current={name === step ? 'step' : undefined}>{index + 1}</li>)}
    </ol>
    {step === 'ground' && <div className="first-step-choices">
      {grounds.map((item) => <button key={item.id} className="first-step-choice" disabled={busy} onClick={() => pickGround(item)}>
        <strong>{item.label}</strong><small>{item.note}</small><Icon name="chevron" size={16} />
      </button>)}
      <button className="first-step-choice is-unsure" disabled={busy} onClick={() => pickGround(null)}>
        <strong>잘 모르겠어요</strong><small>시작점 확인이 대신 찾아 줘요</small><Icon name="chevron" size={16} />
      </button>
    </div>}
    {step === 'course' && ground && <div className="first-step-choices">
      {ground.courses.map((course) => <button key={course.key} className="first-step-choice" disabled={busy} onClick={() => pickCourse(course.key)}>
        <strong>{course.title}</strong><small>{course.summary || '설명을 읽고, 직접 풀며 한 단계씩 이해해요.'}</small><Icon name="chevron" size={16} />
      </button>)}
      <button className="first-step-choice is-unsure" disabled={busy} onClick={() => pickCourse(null)}>
        <strong>아직 못 고르겠어요</strong><small>고르지 않아도 시작할 수 있어요</small><Icon name="chevron" size={16} />
      </button>
      <button className="text-button" disabled={busy} onClick={() => setStep('ground')}><Icon name="back" size={15} />앞으로 돌아가기</button>
    </div>}
    {step === 'minutes' && <div className="first-step-choices">
      <div className="first-step-minutes" role="group" aria-label="하루 학습 시간">
        {[5, 10, 20].map((value) => <button key={value} className={minutes === value ? 'active' : ''} aria-pressed={minutes === value}
          disabled={busy} onClick={() => setMinutes(value)}>{value}분</button>)}
      </div>
      <p className="first-step-summary">{chosen ? <>배우려는 과정은 <b>{chosen.title}</b>, 하루 {minutes}분씩.</> : <>배우려는 과정 없이, 하루 {minutes}분씩. 시작점 확인으로 자리부터 찾아봐요.</>}</p>
      {error && <p role="alert" className="field-error">{error}</p>}
      <button className="button primary full-width" disabled={busy} onClick={() => onSave({ targetCourseKey: target, dailyMinutes: minutes })}>{busy ? '저장 중…' : '이렇게 시작할게요'}<Icon name="check" size={17} /></button>
      <button className="text-button" disabled={busy} onClick={() => setStep(ground ? 'course' : 'ground')}><Icon name="back" size={15} />앞으로 돌아가기</button>
    </div>}
    <button className="text-button first-step-later" disabled={busy} onClick={onLater}>나중에 고를게요</button>
  </div>;
}
