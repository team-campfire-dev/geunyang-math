import initial from './fractions-v1.json';
import { parseContentBundle, type ContentBundle } from '@/core/content-bundle';
import { problemSetRefs, storedLessonOf, type LessonRecord, type StoredLesson, type StoredProblem, type StoredProblemSet } from '@/core/content';

// Historical v1 content: keeps compatibility and learning-policy tests stable as the live curriculum changes.
// The production seed has separate contract tests in seed-content.test.ts.
const bundle = parseContentBundle(initial);
function deepFreeze<T>(value: T): T {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    for (const item of Object.values(value)) deepFreeze(item);
    Object.freeze(value);
  }
  return value;
}
/** A lesson with the questions its references resolve to, the way the application reads one. */
export function assembleLesson(lesson: StoredLesson, sets: StoredProblemSet[]): LessonRecord {
  const problems = new Map<string, StoredProblem>();
  for (const ref of problemSetRefs(lesson)) {
    const set = sets.find((item) => item.versionId === ref.problemSetVersionId);
    for (const id of ref.problemVersionIds) {
      const problem = set?.problems.find((item) => item.problemVersionId === id);
      if (problem && !problems.has(id)) problems.set(id, problem);
    }
  }
  return { ...lesson, problems: [...problems.values()] };
}
/**
 * The problem sets a record's references name, rebuilt from the record's own questions — so a
 * record a test edited publishes what it holds, under the set names its blocks already carry.
 */
export function setsOf(record: LessonRecord, courseKey = 'fractions'): StoredProblemSet[] {
  const sets = new Map<string, StoredProblemSet>();
  for (const ref of problemSetRefs(record)) {
    const set = sets.get(ref.problemSetVersionId) ?? { problemSetId: ref.problemSetId, courseKey, name: null, versionId: ref.problemSetVersionId, problems: [] };
    for (const id of ref.problemVersionIds) {
      const problem = record.problems.find((item) => item.problemVersionId === id);
      if (problem && !set.problems.some((item) => item.problemVersionId === id)) set.problems.push(problem);
    }
    sets.set(ref.problemSetVersionId, set);
  }
  return [...sets.values()];
}
/** A bundle that publishes these records: their course, the lessons, and the sets they reference. */
export function lessonBundle(records: LessonRecord[], course: { key: string; title: string } = { key: 'fractions', title: '분수' }): ContentBundle {
  return { schemaVersion: 1, concepts: [...bundle.concepts], diagnostics: [], definitions: [],
    courses: [{ key: course.key, title: course.title, lessons: records.map((record, index) => ({ key: record.public.lessonKey, order: 1000 + index })), diagnostics: [] }],
    lessons: records.map(storedLessonOf), problemSets: records.flatMap((record) => setsOf(record, course.key)) };
}
export const seedProblemSets = deepFreeze(bundle.problemSets);
export const seedLessons = deepFreeze(bundle.lessons.map((lesson) => assembleLesson(lesson, bundle.problemSets)));
export const conceptLabels = deepFreeze(Object.fromEntries(bundle.concepts.map(s => [s.key, s.label])));
/** The questions the seeded diagnostic asks, in its order: it references a set, the way a lesson step does. */
export const diagnosticProblems = deepFreeze(bundle.diagnostics[0].problemSet.problemVersionIds.map((id) =>
  bundle.problemSets.find((set) => set.versionId === bundle.diagnostics[0].problemSet.problemSetVersionId)!.problems.find((problem) => problem.problemVersionId === id)!));
export const diagnosticVersion = bundle.diagnostics[0].versionId;
