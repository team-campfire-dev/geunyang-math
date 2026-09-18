import { readFileSync, readdirSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { conceptGraph, placementScope } from '@/core/concept-graph';
import { placement, placementProgress, type PlacementAnswer, type PlacementProblem } from '@/core/placement';
import { parseContentBundle } from '@/core/content-bundle';
import type { StoredLesson } from '@/core/content';

/**
 * Running a placement against the bank that is actually published.
 *
 * The first placement put every question of the bank to every learner in a fixed order. These tests
 * hold the replacement to asking fewer while deciding the same way: two right answers still make a
 * concept ready, and a question that was never asked is never counted as one that was.
 */
const seeds = readdirSync('prisma/seed').filter((name) => name.endsWith('.json')).sort()
  .map((name) => parseContentBundle(JSON.parse(readFileSync(`prisma/seed/${name}`, 'utf8'))));
const lessons = seeds.flatMap((seed) => (seed.lessons as StoredLesson[]).map((lesson) => lesson.public));
const graph = conceptGraph(lessons);
const scope = placementScope(graph, []);
const definition = seeds.flatMap((seed) => seed.diagnostics).find((item) => item.diagnosticKey === 'catalogue-placement')!;
const bank: PlacementProblem[] = seeds.flatMap((seed) => seed.problemSets)
  .find((set) => set.versionId === definition.problemSet.problemSetVersionId)!
  .problems.filter((problem) => definition.problemSet.problemVersionIds.includes(problem.problemVersionId))
  .map((problem) => ({ problemVersionId: problem.problemVersionId, conceptKeys: problem.conceptKeys }));

/** Plays a whole placement through, answering each question by `decide`. */
function play(decide: (problem: PlacementProblem) => PlacementAnswer['status']) {
  const answers: PlacementAnswer[] = [];
  for (let guard = 0; guard <= bank.length; guard += 1) {
    const { state, next } = placement(graph, scope, bank, answers);
    if (!next) return { state, answers };
    answers.push({ problemVersionId: next.problemVersionId, status: decide(next) });
  }
  throw new Error('배치가 끝나지 않는다');
}
const settledAs = (state: { placed: Record<string, string> }, outcome: string) =>
  Object.entries(state.placed).filter(([, value]) => value === outcome).map(([key]) => key).sort();

describe('placing someone against the published bank', () => {
  it('puts far fewer questions to a learner than the bank holds', () => {
    const { answers } = play(() => 'correct');
    expect(bank.length).toBeGreaterThan(30);
    expect(answers.length * 2, `${bank.length}문항 중 ${answers.length}문항을 물었다`).toBeLessThan(bank.length);
    // Never the same question twice, however the descent moved.
    expect(new Set(answers.map((answer) => answer.problemVersionId)).size).toBe(answers.length);
  });

  it('still wants two right answers before calling a concept ready', () => {
    const asked = new Map<string, number>();
    const { state } = play((problem) => {
      for (const key of problem.conceptKeys) asked.set(key, (asked.get(key) ?? 0) + 1);
      return 'correct';
    });
    for (const key of settledAs(state, 'ready')) {
      const direct = state.source[key] === 'asked';
      // Carried concepts were never asked; the ones that were had to answer twice.
      if (direct) expect(asked.get(key) ?? 0, `${key}는 한 번만 묻고 준비됨이 됐다`).toBeGreaterThanOrEqual(2);
    }
  });

  it('leaves a concept unknown when its one right answer could not be confirmed', () => {
    const single: PlacementProblem[] = [{ problemVersionId: 'only', conceptKeys: ['fraction'] }];
    const { state } = placement(graph, ['fraction'], single, [{ problemVersionId: 'only', status: 'correct' }]);
    expect(state.placed.fraction).toBe('unknown');
  });

  it('settles a concept on the first wrong answer without asking about it again', () => {
    // The descent picks what it asks about, so the concept under test is whichever it went to first.
    const opening = placement(graph, scope, bank, []).next!;
    const { state, answers } = play((problem) => (problem.problemVersionId === opening.problemVersionId ? 'incorrect' : 'correct'));
    for (const key of opening.conceptKeys) {
      expect(state.placed[key], key).toBe('needs-practice');
      // Everything built on it is deferred, and none of that was put to the learner.
      for (const above of graph.dependents(key)) {
        if (!scope.includes(above) || state.source[above] === 'asked') continue;
        expect(state.placed[above], above).toBe('needs-practice');
        expect(state.source[above], above).toBe('inferred');
      }
    }
    // Settled by that one answer: the second question is already about something else.
    const afterOne = placement(graph, scope, bank, [{ problemVersionId: opening.problemVersionId, status: 'incorrect' }]);
    for (const key of opening.conceptKeys) expect(afterOne.state.placed[key], key).toBe('needs-practice');
    expect(answers.length).toBeGreaterThan(1);
  });

  it('leaves a skipped concept unknown and does not come back to it', () => {
    const opening = placement(graph, scope, bank, []).next!;
    const { state, answers } = play((problem) => (problem.problemVersionId === opening.problemVersionId ? 'skipped' : 'correct'));
    for (const key of opening.conceptKeys) {
      expect(state.placed[key], key).toBe('unknown');
      // Unknown carries nowhere: a skip says nothing about what stands above or below it.
      expect(state.source[key], key).toBe('asked');
    }
    expect(answers.filter((answer) => answer.problemVersionId === opening.problemVersionId).length).toBe(1);
  });

  it('marks every concept a wrong answer asked about, since it cannot tell which one went wrong', () => {
    // The bank's last question asks about two concepts at once. Getting it right takes both, and
    // getting it wrong says only that one of them is missing — so neither is counted on.
    const both = bank.find((problem) => problem.conceptKeys.length > 1)!;
    const { state } = placement(graph, scope, bank, [
      { problemVersionId: bank.find((p) => p.conceptKeys.includes(both.conceptKeys[1]) && p !== both)!.problemVersionId, status: 'correct' },
      { problemVersionId: both.problemVersionId, status: 'incorrect' },
    ]);
    for (const key of both.conceptKeys) {
      expect(state.placed[key], key).toBe('needs-practice');
      expect(state.source[key], key).toBe('asked');
    }
  });

  it('places the concepts a bank cannot ask about, by the ones it can', () => {
    // The published bank asks about every concept now, so this is checked against one that does not:
    // a bank with nothing about decimals still has to place them, or a gap in the questions becomes
    // a gap in the placement. It was the published bank's own shape until this version.
    const withoutDecimals = bank.filter((problem) => !problem.conceptKeys.some((key) => key.startsWith('decimal')));
    expect(withoutDecimals.length).toBeLessThan(bank.length);
    const answers: PlacementAnswer[] = [];
    for (let guard = 0; guard <= withoutDecimals.length; guard += 1) {
      const { state, next } = placement(graph, scope, withoutDecimals, answers);
      if (!next) {
        expect(state.placed.decimal).toBe('needs-practice');
        expect(state.source.decimal).toBe('inferred');
        return;
      }
      answers.push({ problemVersionId: next.problemVersionId, status: 'incorrect' });
    }
    throw new Error('배치가 끝나지 않는다');
  });

  it('leaves nothing in the scope undecided, now that the bank reaches every concept', () => {
    for (const status of ['correct', 'incorrect'] as const) {
      const { state } = play(() => status);
      expect(placementProgress(state).settled, `모두 ${status}일 때`).toBe(scope.length);
    }
  });

  it('counts what it asked apart from what it worked out', () => {
    const { state, answers } = play(() => 'incorrect');
    const progress = placementProgress(state);
    expect(progress.asked + progress.inferred).toBe(progress.settled);
    expect(progress.asked).toBe(answers.length);
    expect(progress.inferred).toBeGreaterThan(0);
  });

  it('refuses a stored run whose answers are not the ones it would have asked', () => {
    const { answers } = play(() => 'correct');
    const tampered = [...answers.slice(0, -1), { problemVersionId: 'fraction-placement-v3:q9', status: 'correct' as const }];
    expect(() => placement(graph, scope, bank, tampered)).toThrow(/어긋난다/);
  });

  it('asks the same questions of the same answers, so a run can be resumed', () => {
    const { answers } = play(() => 'correct');
    for (let taken = 0; taken < answers.length; taken += 1) {
      const resumed = placement(graph, scope, bank, answers.slice(0, taken));
      expect(resumed.next?.problemVersionId, `${taken}개까지 답한 뒤`).toBe(answers[taken].problemVersionId);
      expect(resumed.consumed).toBe(taken);
    }
  });
});
