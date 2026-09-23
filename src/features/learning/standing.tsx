'use client';

import { useState } from 'react';
import { conceptStateLabels, type ConceptReadiness, type ConceptState, type PublicCourse, type PublicLesson } from '@/shared/api';
import { conceptsByCourse } from '@/shared/standing';
import { Icon } from './icons';

/** How many courses of the way ahead are drawn before the rest are counted instead of named. */
const shownAhead = 5;

/**
 * How far along the way to what a learner came for they are, course by course.
 *
 * 「지금 어디쯤인가」 used to be answerable only by opening a fold and reading a hundred and sixty-four
 * concept chips, most of them saying 「아직 확인 전」. That is not an answer: a list that long is not
 * a place. The courses those concepts belong to are — four or five names, in an order the learner
 * already understands, ending at the one they said they wanted.
 *
 * What is behind them is counted rather than named, because a course already finished is not a
 * thing to look at. What is ahead is named, in order, with how much of it is settled.
 */
export function WayThere({ courses, lessons, readiness, onTheWay, targetCourseKey, onChooseTarget, onOpenHistory }: {
  courses: PublicCourse[]; lessons: PublicLesson[]; readiness: ConceptReadiness[];
  onTheWay: string[]; targetCourseKey: string | null;
  onChooseTarget: () => void; onOpenHistory: () => void;
}) {
  // Without a course named there is nothing to be on the way to: `onTheWay` is the whole catalogue,
  // and drawing a path through thirty-eight courses would be a picture of nothing in particular.
  if (!targetCourseKey) return <div className="way-there is-unset">
    <div><strong>배우려는 과정을 고르면 여기에 길이 보여요.</strong>
      <p>거기까지 가는 데 필요한 코스와, 그중 어디까지 왔는지를 한 줄로 보여 드려요.</p></div>
    <button className="button secondary" onClick={onChooseTarget}>배우려는 과정 고르기<Icon name="arrow" size={16} /></button>
  </div>;
  const settled = new Map(readiness.map((item) => [item.key, item.readiness]));
  const counted = conceptsByCourse({ lessons, courses, conceptKeys: onTheWay }).map((entry) => ({
    course: entry.course, total: entry.conceptKeys.length,
    ready: entry.conceptKeys.filter((key) => settled.get(key) === 'ready').length,
  }));
  if (!counted.length) return null;
  const behind = counted.filter((entry) => entry.ready === entry.total);
  const ahead = counted.filter((entry) => entry.ready < entry.total);
  const target = courses.find((course) => course.key === targetCourseKey);
  if (!ahead.length) return <div className="way-there is-arrived">
    <div><strong>{target?.title ?? '배우려는 과정'}까지 필요한 건 모두 확인했어요.</strong>
      <p>코스 {behind.length}개를 지나왔어요. 이제 그 과정의 수업을 이어가면 돼요.</p></div>
    <button className="text-button" onClick={onOpenHistory}>자세히 보기<Icon name="arrow" size={15} /></button>
  </div>;
  // The last one is kept whatever happens: it is what they came for, and a path that does not show
  // where it ends is a path to nowhere.
  const drawn = ahead.length > shownAhead ? [...ahead.slice(0, shownAhead - 1), ahead[ahead.length - 1]] : ahead;
  const hidden = ahead.length - drawn.length;
  return <section className="way-there" aria-label="배우려는 과정까지 가는 길">
    <div className="way-heading">
      <strong>여기까지 왔어요</strong>
      <span className="muted small">{behind.length ? `지나온 코스 ${behind.length}개 · ` : ''}남은 코스 {ahead.length}개</span>
      <button className="text-button" onClick={onOpenHistory}>자세히 보기<Icon name="arrow" size={15} /></button>
    </div>
    <ol className="way-list">
      {drawn.map((entry, index) => <li key={entry.course.key} className={entry.course.key === targetCourseKey ? 'is-target' : ''}>
        {/* The gap the count stands in for, drawn where it falls rather than after everything. */}
        {hidden > 0 && index === drawn.length - 1 && <span className="way-gap" aria-label={`사이에 코스 ${hidden}개`}>… {hidden}개</span>}
        <span className="way-name">{entry.course.title}{entry.course.key === targetCourseKey && <em>배우려는 과정</em>}</span>
        <span className="way-bar" aria-hidden="true"><i style={{ width: `${Math.round((entry.ready / entry.total) * 100)}%` }} /></span>
        <span className="way-count">개념 {entry.total}개 중 {entry.ready}개</span>
      </li>)}
    </ol>
  </section>;
}

/** The four states in the order they are earned, so a bar reads left to right as progress. */
const order: ConceptState[] = ['retained', 'independent', 'practicing', 'unknown'];

/**
 * What the record says, course by course.
 *
 * The same hundred and sixty-four concepts, in the courses that teach them: thirty-eight rows
 * instead of a hundred and sixty-four, each one a name the learner recognises. The concepts are
 * still here — a row opens onto exactly the chips that were there before — but they are something
 * to go and read rather than something to scroll past on the way to everything else.
 */
export function StandingByCourse({ courses, lessons, concepts, busy = false }: {
  courses: PublicCourse[]; lessons: PublicLesson[];
  concepts: { key: string; label: string; state: ConceptState }[]; busy?: boolean;
}) {
  const [open, setOpen] = useState<string | null>(null);
  const state = new Map(concepts.map((concept) => [concept.key, concept]));
  const rows = conceptsByCourse({ lessons, courses, conceptKeys: concepts.map((concept) => concept.key) }).map((entry) => {
    const held = entry.conceptKeys.flatMap((key) => state.get(key) ?? []);
    const count = (name: ConceptState) => held.filter((concept) => concept.state === name).length;
    return { course: entry.course, held, counts: Object.fromEntries(order.map((name) => [name, count(name)])) as Record<ConceptState, number> };
  });
  if (!rows.length) return <p className="empty-inline">아직 학습 상태를 말할 개념이 없어요.</p>;
  // A course where nothing has been touched says the same thing as every other untouched course, so
  // they are counted together at the end rather than filling the list with the same sentence.
  const touched = rows.filter((row) => row.counts.unknown < row.held.length);
  const untouched = rows.filter((row) => row.counts.unknown === row.held.length);
  const row = (entry: typeof rows[number]) => {
    const shown = open === entry.course.key;
    return <div className={shown ? 'standing-course is-open' : 'standing-course'} key={entry.course.key}>
      <h3><button aria-expanded={shown} aria-controls={`standing-${entry.course.key}`} disabled={busy}
        onClick={() => setOpen(shown ? null : entry.course.key)}>
        <span className="standing-name">{entry.course.title}</span>
        <span className="standing-bar" aria-hidden="true">
          {order.map((name) => entry.counts[name] > 0
            && <i key={name} className={name} style={{ flexGrow: entry.counts[name] }} />)}
        </span>
        <span className="standing-count">{entry.held.length - entry.counts.unknown} / {entry.held.length}</span>
        <Icon name="chevron" size={16} />
      </button></h3>
      {shown && <div className="concept-list" id={`standing-${entry.course.key}`}>{entry.held.map((concept) => <div key={concept.key}>
        <span className={`concept-dot ${concept.state}`} /><strong>{concept.label}</strong>
        <span className={`concept-state ${concept.state}`}>{conceptStateLabels[concept.state]}</span>
      </div>)}</div>}
    </div>;
  };
  return <>
    {/* The placement settles concepts, and deliberately does not make any of them 「스스로 해결」 —
        that is earned by answering, not by being placed. So a learner who has only been placed finds
        this empty, and being told why is better than being handed a single folded line. */}
    {!touched.length && <p className="empty-inline">아직 수업이나 문제집에서 확인한 개념이 없어요. 시작점 확인으로 정한 자리는 「내 학습」의 길에서 보이고, 여기에는 직접 풀어서 쌓인 것만 남아요.</p>}
    {touched.length > 0 && <div className="standing-courses">{touched.map(row)}</div>}
    {untouched.length > 0 && <details className="standing-untouched">
      <summary>아직 시작하지 않은 코스 {untouched.length}개</summary>
      <div className="standing-courses">{untouched.map(row)}</div>
    </details>}
  </>;
}
