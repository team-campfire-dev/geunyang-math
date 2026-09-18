import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { conceptReadiness, recommend } from '@/core/personalization';
import { parseContentBundle } from '@/core/content-bundle';
import type { PublicLesson } from '@/shared/api';
import { placement, type PlacementAnswer, type PlacementState } from '@/core/placement';
import { conceptGraph, placementScope } from '@/core/concept-graph';
import { playPlacement } from './fixtures/placement';

/**
 * Whether the starting-point diagnostic can actually place someone. It could not: a concept is ready
 * only when two questions about it came back right, and five of the seven concepts had one question
 * each, so a perfect score left every lesson unknown and recommended the first one — exactly what a
 * learner who skipped the diagnostic gets. The bank was rebuilt with two questions per concept.
 *
 * The placement now descends the concept graph instead of reading the bank end to end, so it chooses
 * which questions to put and settles the rest by what they imply. The bar it settles by is the same.
 */
// Answer keys live in the platform seed and nowhere else; `content/` bundles carry no answers.
const seedFile = readFileSync('prisma/seed/fractions.json', 'utf8');
const bundle = parseContentBundle(JSON.parse(seedFile));
const seed = JSON.parse(seedFile);
const diagnostic = bundle.diagnostics.at(-1)!;
const questionSet = bundle.problemSets.find((set) => set.versionId === diagnostic.problemSet.problemSetVersionId)!;
const lessons: PublicLesson[] = seed.lessons.map((lesson: { public: PublicLesson }) => lesson.public);
const labels = Object.fromEntries(seed.concepts.map((concept: { key: string; label: string }) => [concept.key, concept.label]));
const questions = questionSet.problems.map((problem) => ({ problemVersionId: problem.problemVersionId, conceptKeys: problem.conceptKeys }));
const conceptsOf = (problemVersionId: string) => questions.find((question) => question.problemVersionId === problemVersionId)!.conceptKeys;
/** Plays a whole placement, deciding each question from the concepts it asks about. */
const answering = (decide: (conceptKeys: string[]) => PlacementAnswer['status']) =>
  playPlacement(lessons, questions, (id) => decide(conceptsOf(id)));
const advise = (placed: PlacementState | null, goal: 'foundation-recovery' | 'algebra-ready' = 'foundation-recovery') => recommend({
  lessons, enrollments: [], assignments: [], dailyMinutes: 10, goal, now: new Date(),
  readiness: conceptReadiness(labels, placed, []),
}).recommendations[0];
const suggest = (placed: PlacementState | null) => advise(placed)?.lessonKey;
const readinessOf = (placed: PlacementState) => conceptReadiness(labels, placed, []);

describe('the starting-point diagnostic', () => {
  it('asks about every concept at least twice, which is what readiness needs', () => {
    const asked = new Map<string, number>();
    for (const question of questions) for (const key of question.conceptKeys) asked.set(key, (asked.get(key) ?? 0) + 1);
    const taught = [...new Set(lessons.flatMap((lesson) => [...lesson.conceptKeys, ...lesson.prerequisiteConceptKeys]))];
    // One question is a guess away from being right, so one question never makes a concept ready.
    for (const key of taught) expect(asked.get(key) ?? 0, `${key}는 진단 문항이 둘 이상이어야 한다`).toBeGreaterThanOrEqual(2);
  });

  it('lets a perfect score mean something, which it could not before', () => {
    const { state: perfect, answers } = answering(() => 'correct');
    // Every concept the course teaches is now shown, where before none of them could be.
    expect(readinessOf(perfect).every((item) => item.readiness === 'ready')).toBe(true);
    // And it is shown in fewer questions than the bank holds, which is what the descent is for.
    expect(answers.length).toBeLessThan(questions.length);

    const everything = advise(perfect);
    const nothing = advise(null);
    // The course is three lessons long and linear, so someone who knows all of it has nowhere
    // further to go; the rules send them to a lesson to apply it. What changed is that the screen
    // no longer tells them they have not shown the very concepts they just showed.
    expect(nothing!.reason).toMatch(/아직 충분히 확인하지 않았어요/);
    expect(everything!.reason).not.toBe(nothing!.reason);
    expect(everything!.reason).toMatch(/확인한 기초/);
    // And with the other goal the diagnostic now moves the lesson itself.
    expect(advise(perfect, 'algebra-ready')!.lessonKey).toBe('fraction-addition');
    expect(advise(null, 'algebra-ready')!.lessonKey).toBe('fraction-meaning');
  });

  it('sends someone to the first lesson whose concepts they have not shown', () => {
    const knows = (keys: string[]) => (conceptKeys: string[]) => conceptKeys.every((key) => keys.includes(key)) ? 'correct' as const : 'skipped' as const;
    expect(suggest(answering(knows(['fraction', 'numerator', 'denominator'])).state)).toBe('fraction-equivalence');
    expect(suggest(answering(knows(['fraction', 'numerator', 'denominator', 'equivalent-fraction', 'reduce'])).state)).toBe('fraction-addition');
  });

  it('keeps someone at the concept they got wrong, and everything built on it', () => {
    // Whatever the descent opens with, since it is the descent that chooses what to ask.
    const graph = conceptGraph(lessons);
    const opening = placement(graph, placementScope(graph, []), questions, []).next!;
    const wrong = new Set(conceptsOf(opening.problemVersionId));
    const { state } = answering((conceptKeys) => conceptKeys.some((key) => wrong.has(key)) ? 'incorrect' : 'correct');
    for (const key of wrong) expect(state.placed[key], key).toBe('needs-practice');
    // Everything standing on it is deferred with it, without being asked about.
    for (const key of [...wrong].flatMap((key) => [...graph.dependents(key)])) {
      expect(state.placed[key], key).toBe('needs-practice');
      expect(state.source[key], key).toBe('inferred');
    }
    // And the lesson offered is the one that teaches what went wrong, not one above it.
    const offered = lessons.find((lesson) => lesson.lessonKey === suggest(state))!;
    expect(offered.conceptKeys.some((key) => wrong.has(key)), `${offered.lessonKey}을(를) 권했다`).toBe(true);
  });

  it('does not put a concept to someone whose later answer already covered it', () => {
    // The descent opens above the ground, so a right answer there carries the concepts underneath.
    // Those questions are never asked — the saving, and the risk, of placing by implication.
    const { state, answers } = answering(() => 'correct');
    const asked = new Set(answers.flatMap((answer) => conceptsOf(answer.problemVersionId)));
    const carried = Object.keys(state.placed).filter((key) => state.source[key] === 'inferred');
    expect(carried.length, '앞의 답에서 이어진 개념이 없다').toBeGreaterThan(0);
    for (const key of carried) expect(asked.has(key), `${key}는 직접 물었는데 이어졌다고 적혔다`).toBe(false);
  });

  it('holds its answers to the shape the publisher accepts', () => {
    expect(diagnostic.problemSet.problemVersionIds).toHaveLength(13);
    expect(diagnostic.diagnosticKey).toBe('starting-point');
    // The version it replaces stays exactly as it was published.
    expect(bundle.diagnostics.find((item) => item.versionId === 'fraction-placement-v2')!.problemSet.problemVersionIds).toHaveLength(8);
    // Questions carry no hints or worked solutions: a diagnostic shows neither.
    for (const problem of questionSet.problems) {
      expect(problem.hintAvailable).toBe(false);
      expect(problem.hints).toHaveLength(0);
    }
  });
});
