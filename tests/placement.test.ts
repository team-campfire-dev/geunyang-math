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
// Earlier versions of the bank ship beside the current one, since a published version is never
// rewritten. A learner is placed against the last one.
const published = seeds.flatMap((seed) => seed.diagnostics).filter((item) => item.diagnosticKey === 'catalogue-placement');
const definition = published[published.length - 1];
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
    // One of the bank's questions asks about two concepts at once. Getting it right takes both, and
    // getting it wrong says only that one of them is missing — so neither is counted on.
    const both = bank.find((problem) => problem.conceptKeys.length > 1)!;
    // Which questions come up is the descent's to decide, so the run is played through rather than
    // written out: everything is answered right except the one question that names two concepts.
    // Only the concepts still open when it was asked are this rule's to decide — one already settled
    // by a neighbour keeps the verdict it was given, since a settled concept is never reopened.
    const answers: PlacementAnswer[] = [];
    let open: string[] = [];
    for (let guard = 0; guard <= bank.length; guard += 1) {
      const { state, next } = placement(graph, scope, bank, answers);
      if (!next) break;
      const wrong = next.problemVersionId === both.problemVersionId;
      if (wrong) open = both.conceptKeys.filter((key) => !(key in state.placed));
      answers.push({ problemVersionId: next.problemVersionId, status: wrong ? 'incorrect' : 'correct' });
    }
    expect(answers.some((answer) => answer.status === 'incorrect'), '두 개념을 함께 묻는 문항이 끝내 나오지 않았다').toBe(true);
    expect(open.length, '물었을 때 이미 둘 다 정해져 있었다').toBeGreaterThan(0);
    const { state } = placement(graph, scope, bank, answers);
    for (const key of open) {
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

/**
 * A learner who changes their mind about what they came for, halfway through being placed.
 *
 * The scope cannot simply be replaced: every verdict is derived by replaying the answers, and the
 * descent chooses each question by what it settles among everything still open, so a different
 * scope makes it choose differently and the stored answers stop matching. Measured on this bank,
 * even a scope that strictly contains the old one disagrees from the third answer on.
 */
describe('a placement whose scope changes partway through', () => {
  const courses = seeds.flatMap((seed) => seed.courses);
  const conceptsOf = (courseKey: string) => {
    const held = new Set(courses.find((course) => course.key === courseKey)!.lessons.map((lesson) => lesson.key));
    return lessons.filter((lesson) => held.has(lesson.lessonKey)).flatMap((lesson) => lesson.conceptKeys);
  };
  const equations = placementScope(graph, conceptsOf('equations'));
  const systems = placementScope(graph, conceptsOf('systems'));
  /** Answers `count` questions correctly under one scope, the way a run would have stored them. */
  const answerSome = (only: string[], count: number) => {
    const answers: PlacementAnswer[] = [];
    for (let index = 0; index < count; index += 1) {
      const { next } = placement(graph, only, bank, answers);
      if (!next) break;
      answers.push({ problemVersionId: next.problemVersionId, status: 'correct' });
    }
    return answers;
  };

  it('cannot simply be handed the new scope, which is why the stretches exist', () => {
    // 연립방정식 needs everything 일차방정식 needs and more, and it still disagrees.
    expect(equations.every((key) => systems.includes(key)), '연립방정식이 일차방정식을 품지 않는다').toBe(true);
    const answers = answerSome(equations, 4);
    expect(() => placement(graph, systems, bank, answers)).toThrow(/배치 기록이 어긋난다/);
  });

  it('replays cleanly when each answer keeps the scope it was given under', () => {
    const answers = answerSome(equations, 4);
    const carried = placement(graph, [{ from: 0, scope: equations }, { from: answers.length, scope: systems }], bank, answers);
    // Nothing thrown, nothing unasked: every verdict the first stretch reached is still here.
    const before = placement(graph, equations, bank, answers).state;
    for (const [key, outcome] of Object.entries(before.placed)) expect(carried.state.placed[key]).toBe(outcome);
    // And it carries on, into what the new course needs rather than what the old one did.
    expect(carried.next).toBeTruthy();
    expect(carried.consumed).toBe(answers.length);
  });

  it('counts progress against where the learner is going now, not everywhere they have been', () => {
    const answers = answerSome(equations, 4);
    const carried = placement(graph, [{ from: 0, scope: equations }, { from: answers.length, scope: systems }], bank, answers);
    expect(carried.state.scope).toEqual(systems);
    expect(placementProgress(carried.state).scope).toBe(systems.length);
  });

  it('never puts a question twice, however often somebody changes their mind', () => {
    const first = answerSome(equations, 3);
    const stretches = [{ from: 0, scope: equations }, { from: first.length, scope: systems }];
    const answers = [...first];
    for (let guard = 0; guard <= bank.length; guard += 1) {
      const { next } = placement(graph, stretches, bank, answers);
      if (!next) break;
      answers.push({ problemVersionId: next.problemVersionId, status: 'correct' });
    }
    expect(new Set(answers.map((answer) => answer.problemVersionId)).size).toBe(answers.length);
  });

  it('asks nothing more when the new way is one the answers have already settled', () => {
    // Narrowing is not a case of its own: a scope holding only what is already decided simply has
    // nothing left to ask, which is what «좁아지면 아무것도 하지 않는다» amounts to in the mechanism.
    const answers = answerSome(equations, 40);
    const decided = Object.keys(placement(graph, equations, bank, answers).state.placed);
    const narrowed = placement(graph, [{ from: 0, scope: equations }, { from: answers.length, scope: decided }], bank, answers);
    expect(narrowed.next, '이미 정해진 곳을 다시 묻는다').toBeNull();
    expect(narrowed.consumed).toBe(answers.length);
  });
});
