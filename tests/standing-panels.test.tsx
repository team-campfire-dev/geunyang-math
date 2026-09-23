// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from './render';
import { StandingByCourse, WayThere } from '@/features/learning/standing';
import type { ConceptReadiness, ConceptState, PublicCourse, PublicLesson } from '@/shared/api';

const lesson = (lessonKey: string, courseKey: string, conceptKeys: string[]): PublicLesson =>
  ({ lessonKey, versionId: `${lessonKey}:v1`, title: lessonKey, summary: '', estimatedMinutes: 10,
    conceptKeys, prerequisiteConceptKeys: [], sectionCount: 2, courseKey });
const courses: PublicCourse[] = [
  { key: 'fractions', title: '분수', summary: '', track: 'basics' },
  { key: 'ratios', title: '비와 비율', summary: '', track: 'basics' },
  { key: 'integers', title: '정수와 유리수', summary: '', track: 'middle', stage: 'middle-1' },
  { key: 'equations', title: '일차방정식', summary: '', track: 'middle', stage: 'middle-1' },
  { key: 'systems', title: '연립방정식', summary: '', track: 'middle', stage: 'middle-2' },
  { key: 'functions', title: '일차함수', summary: '', track: 'middle', stage: 'middle-2' },
];
const lessons = courses.map((course, index) => lesson(`l${index}`, course.key, [`${course.key}-a`, `${course.key}-b`]));
const ready = (keys: string[]): ConceptReadiness[] => lessons.flatMap((item) => item.conceptKeys)
  .map((key) => ({ key, label: key, readiness: keys.includes(key) ? 'ready' : 'unknown', source: keys.includes(key) ? 'diagnostic' : 'none' }));
const way = lessons.flatMap((item) => item.conceptKeys);

const path = (props: Partial<Parameters<typeof WayThere>[0]> = {}) => render(
  <WayThere courses={courses} lessons={lessons} readiness={ready([])} onTheWay={way}
    targetCourseKey="functions" onChooseTarget={vi.fn()} onOpenHistory={vi.fn()} {...props} />);
const names = () => [...document.querySelectorAll('.way-name')].map((node) => node.firstChild?.textContent);

/**
 * 「지금 어디쯤인가」, which a hundred and sixty-six concept chips could not answer. A list that
 * long is not a place; the courses those concepts belong to are.
 */
describe('the way to what a learner came for', () => {
  it('counts what is behind and names what is ahead, ending at the course they came for', () => {
    // Everything of 분수 and 비와 비율 settled: two courses behind, four still ahead.
    path({ readiness: ready(['fractions-a', 'fractions-b', 'ratios-a', 'ratios-b']) });
    expect(screen.getByText(/지나온 코스 2개 · 남은 코스 4개/)).toBeTruthy();
    expect(names()).toEqual(['정수와 유리수', '일차방정식', '연립방정식', '일차함수']);
    expect(document.querySelector('.way-list li.is-target')!.textContent).toContain('일차함수');
  });

  it('says how much of a course is settled rather than only whether it is', () => {
    path({ readiness: ready(['integers-a']) });
    const half = [...document.querySelectorAll('.way-list li')].find((node) => node.textContent?.includes('정수와 유리수'))!;
    expect(half.textContent).toContain('개념 2개 중 1개');
    expect(half.querySelector('.way-bar i')!.getAttribute('style')).toContain('width: 50%');
  });

  it('counts the middle of a long way instead of naming all of it, and still shows where it ends', () => {
    const long: PublicCourse[] = [...courses, { key: 'later', title: '이차함수', summary: '', track: 'middle', stage: 'middle-3' }];
    const longLessons = [...lessons, lesson('l6', 'later', ['later-a'])];
    path({ courses: long, lessons: longLessons, targetCourseKey: 'later',
      onTheWay: longLessons.flatMap((item) => item.conceptKeys), readiness: ready([]) });
    // Seven ahead, five drawn: four from the front, the target, and a count for what is between.
    expect(names()).toEqual(['분수', '비와 비율', '정수와 유리수', '일차방정식', '이차함수']);
    expect(screen.getByText('… 2개')).toBeTruthy();
  });

  it('offers to be told where to go rather than drawing a path through the whole catalogue', () => {
    const onChooseTarget = vi.fn();
    path({ targetCourseKey: null, onChooseTarget });
    expect(document.querySelector('.way-list')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: /배우려는 과정 고르기/ }));
    expect(onChooseTarget).toHaveBeenCalled();
  });

  it('says so when there is nothing left on the way', () => {
    path({ readiness: ready(way) });
    expect(screen.getByText(/일차함수까지 필요한 건 모두 확인했어요/)).toBeTruthy();
    expect(document.querySelector('.way-list')).toBeNull();
  });
});

/** The record, in the courses that teach it rather than as one list of every concept there is. */
describe('the standing a learner has, course by course', () => {
  const concepts = (over: Record<string, ConceptState> = {}) =>
    lessons.flatMap((item) => item.conceptKeys).map((key) => ({ key, label: `개념 ${key}`, state: over[key] ?? 'unknown' as ConceptState }));
  const standing = (over: Record<string, ConceptState> = {}) => render(
    <StandingByCourse courses={courses} lessons={lessons} concepts={concepts(over)} />);
  const rowNames = () => [...document.querySelectorAll('.standing-courses')[0].querySelectorAll('.standing-name')].map((node) => node.textContent);

  it('folds away the courses nothing has been touched in, instead of repeating the same row', () => {
    standing({ 'fractions-a': 'independent' });
    expect(rowNames()).toEqual(['분수']);
    const folded = screen.getByText('아직 시작하지 않은 코스 5개').closest('details')!;
    expect(folded.hasAttribute('open')).toBe(false);
    // Folded, not dropped: every course is still there to open.
    expect(folded.textContent).toContain('일차함수');
  });

  it('says why it is empty rather than handing over one folded line', () => {
    // Being placed settles concepts without earning any of them, so somebody who has only answered
    // the placement finds this section empty — and the reason is worth a sentence.
    standing();
    expect(screen.getByText(/직접 풀어서 쌓인 것만 남아요/)).toBeTruthy();
    expect(document.querySelectorAll('.standing-courses')).toHaveLength(1);
    expect(screen.getByText('아직 시작하지 않은 코스 6개')).toBeTruthy();
  });

  it('opens onto the concepts themselves, which is where they went rather than where they were lost', () => {
    standing({ 'fractions-a': 'retained', 'fractions-b': 'practicing' });
    expect(document.querySelector('.concept-list')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: /분수/, expanded: false }));
    const list = document.querySelector('.standing-course.is-open .concept-list')!;
    expect(list.textContent).toContain('개념 fractions-a');
    expect(list.textContent).toContain('꾸준히 기억');
    expect(list.textContent).toContain('연습하는 중');
  });

  it('counts a course by what is no longer unknown in it', () => {
    standing({ 'ratios-a': 'independent' });
    const row = [...document.querySelectorAll('.standing-course')].find((node) => node.textContent?.includes('비와 비율'))!;
    expect(row.querySelector('.standing-count')!.textContent).toBe('1 / 2');
    // One bar segment per state that has anything in it, weighted by how many.
    expect([...row.querySelectorAll('.standing-bar i')].map((node) => node.className)).toEqual(['independent', 'unknown']);
  });
});
