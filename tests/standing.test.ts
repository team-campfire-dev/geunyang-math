import { describe, expect, it } from 'vitest';
import { conceptsByCourse } from '@/shared/standing';
import type { PublicCourse, PublicLesson } from '@/shared/api';

const lesson = (lessonKey: string, courseKey: string, conceptKeys: string[]): PublicLesson =>
  ({ lessonKey, versionId: `${lessonKey}:v1`, title: lessonKey, summary: '', estimatedMinutes: 10,
    conceptKeys, prerequisiteConceptKeys: [], sectionCount: 2, courseKey });
const courses: PublicCourse[] = [
  { key: 'fractions', title: '분수', summary: '', track: 'basics' },
  { key: 'ratios', title: '비와 비율', summary: '', track: 'basics' },
  { key: 'integers', title: '정수와 유리수', summary: '', track: 'middle', stage: 'middle-1' },
];
const lessons = [
  lesson('meaning', 'fractions', ['fraction', 'denominator']),
  lesson('adding', 'fractions', ['fraction-add']),
  // 분수 is used again here, having been introduced above.
  lesson('ratio', 'ratios', ['ratio', 'fraction']),
  lesson('negative', 'integers', ['negative']),
];

describe('gathering concepts into the courses that teach them', () => {
  it('keeps the catalogue’s order, and each course’s own lesson order inside it', () => {
    const grouped = conceptsByCourse({ lessons, courses, conceptKeys: ['negative', 'fraction-add', 'ratio', 'fraction', 'denominator'] });
    expect(grouped.map((entry) => entry.course.key)).toEqual(['fractions', 'ratios', 'integers']);
    expect(grouped[0].conceptKeys).toEqual(['fraction', 'denominator', 'fraction-add']);
  });

  it('gives a concept to the course that introduces it, not to every course that uses it', () => {
    const grouped = conceptsByCourse({ lessons, courses, conceptKeys: ['fraction', 'ratio'] });
    // 분수 is taught in 분수 and used again in 비와 비율; where somebody stands is decided by where
    // it was introduced, or every later course would look like it owed them the same concept twice.
    expect(grouped.find((entry) => entry.course.key === 'fractions')!.conceptKeys).toEqual(['fraction']);
    expect(grouped.find((entry) => entry.course.key === 'ratios')!.conceptKeys).toEqual(['ratio']);
  });

  it('leaves out a course none of the concepts belong to, rather than showing it empty', () => {
    const grouped = conceptsByCourse({ lessons, courses, conceptKeys: ['negative'] });
    expect(grouped.map((entry) => entry.course.key)).toEqual(['integers']);
  });

  it('drops a concept no lesson teaches, because it is a word rather than a step', () => {
    const grouped = conceptsByCourse({ lessons, courses, conceptKeys: ['fraction', 'term.only-in-the-glossary'] });
    expect(grouped.flatMap((entry) => entry.conceptKeys)).toEqual(['fraction']);
  });
});
