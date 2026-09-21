import { readFileSync, readdirSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { conceptGraph, nextConcept, placementScope, settleConcept, type Placement, type PlacementSource } from '@/core/concept-graph';
import { parseContentBundle } from '@/core/content-bundle';
import { isSchoolTrack, type CourseTrack } from '@/shared/api';
import type { StoredLesson } from '@/core/content';

/**
 * How long placing a learner takes on the catalogue that is actually installed.
 *
 * The first placement asked about every concept and wanted two right answers each, so its length was
 * twice the catalogue — which is why it was replaced. These tests hold the replacement to being
 * short **and** to being right: a descent that skipped questions by guessing would be short too.
 */
const bundles = readdirSync('prisma/seed').filter((name) => name.endsWith('.json')).sort()
  .map((name) => parseContentBundle(JSON.parse(readFileSync(`prisma/seed/${name}`, 'utf8'))));
const lessons = bundles.flatMap((bundle) => (bundle.lessons as StoredLesson[]).map((lesson) => lesson.public));
const graph = conceptGraph(lessons);
/** The lessons on the line the catalogue is ordered along, which is what an unchosen placement covers. */
const schoolLine = (() => {
  const tracks = new Map(bundles.flatMap((bundle) => bundle.courses.flatMap((course) => course.lessons.map((lesson) => [lesson.key, course.track ?? 'middle'] as const))));
  return lessons.filter((lesson) => isSchoolTrack((tracks.get(lesson.lessonKey) ?? 'middle') as CourseTrack));
})();

/** Runs a whole placement against a learner who knows exactly `known`, and reports what it cost. */
function place(scope: string[], known: Set<string>) {
  let placed: Placement = {};
  let source: PlacementSource = {};
  let asked = 0;
  for (;;) {
    const key = nextConcept(graph, scope, placed);
    if (!key) break;
    asked += 1;
    // One question per concept here. A real run may need a second to be sure of a right answer.
    ({ placed, source } = settleConcept(graph, scope, placed, source, key, known.has(key) ? "ready" : "needs-practice"));
    // Every question must settle at least itself, or the loop is not descending anywhere.
    expect(Object.keys(placed).length, `${key}가 아무것도 정하지 못했다`).toBeGreaterThanOrEqual(asked);
    if (asked > scope.length) throw new Error('하강이 끝나지 않는다');
  }
  return { asked, placed, source };
}

/** Everything a learner would know on the way to `target` — the concept itself still ahead of them. */
const readyFor = (target: string) => new Set(graph.ancestors(target));

describe('the graph the installed catalogue implies', () => {
  it('can be taught in order, with nothing standing on itself', () => {
    expect(graph.cycles(), '선수 관계가 순환한다').toEqual([]);
  });

  it('is deep enough for a descent to have somewhere to go', () => {
    // A flat catalogue would make every question independent and the descent pointless.
    expect(Math.max(...graph.keys.map(graph.depth))).toBeGreaterThan(2);
    expect(graph.keys.length).toBeGreaterThan(10);
  });
});

describe('placing a learner', () => {
  it('ends up exactly where the learner really is, for every starting point', () => {
    for (const target of graph.keys) {
      const scope = placementScope(graph, [target]);
      const known = readyFor(target);
      const { placed } = place(scope, known);
      const ready = new Set(scope.filter((key) => placed[key] === 'ready'));
      expect([...ready].sort(), `${target}을(를) 배우려는 사람의 배치`).toEqual([...known].sort());
      // Nothing in scope may be left undecided — a placement that shrugs is not a placement.
      expect(scope.filter((key) => !(key in placed))).toEqual([]);
    }
  });

  it('marks what it inferred as inferred, and only what it asked as asked', () => {
    const target = graph.keys.reduce((a, b) => (graph.ancestors(a).size >= graph.ancestors(b).size ? a : b));
    const scope = placementScope(graph, [target]);
    const { asked, source } = place(scope, readyFor(target));
    const directly = Object.values(source).filter((value) => value === 'asked').length;
    expect(directly).toBe(asked);
    // The saving is exactly the concepts never put to the learner.
    expect(Object.values(source).filter((value) => value === 'inferred').length).toBe(scope.length - asked);
  });

  it('asks far fewer questions than naming every concept twice', () => {
    const exhaustive = graph.keys.length * 2;
    const worst = Math.max(...graph.keys.flatMap((target) => {
      const scope = placementScope(graph, [target]);
      // The cost against every learner this target can have, not just the average one.
      return [...scope, null].map((known) => place(scope, known ? new Set([known, ...graph.ancestors(known)]) : new Set()).asked);
    }));
    expect(worst, `최악 ${worst}문항, 전수 ${exhaustive}문항`).toBeLessThan(exhaustive / 2);
    // 52 concepts, so 104 questions to name them all twice. The catalogue more than doubled when the
    // middle-school courses landed and this went 9 to 12, because the descent pays for depth, not
    // size. It went 12 to 14 for 농도, and that is the same rule read again: a course beside the
    // school line stands on two strands at once — 비와 비율 and 일차방정식 — so what it stands on is
    // the union of both. Only somebody who came for it is ever asked that much.
    // 14 to 16 for 이차부등식, which is that rule a third time and now on the school line itself: it
    // stands on 이차함수 and 일차부등식 together, so its scope is 41 concepts deep. The catalogue has
    // grown past 90 concepts meanwhile, so the descent is still asking for about a sixth of them.
    expect(worst).toBeLessThanOrEqual(16);
  });

  it('does not put a course beside the school line to somebody who chose nothing', () => {
    // Saying nothing is not asking for everything. Without a target the placement covers the line
    // the catalogue is ordered along and no more — the same 48 concepts it covered before 응용계산
    // was installed beside it, although the graph now holds 52.
    const line = placementScope(graph, schoolLine.flatMap((lesson) => lesson.conceptKeys));
    // 48 before 제곱근과 실수, 54 before 인수분해와 이차방정식, 63 before 이차함수와 다항식,
    // 70 before 복소수와 이차부등식, 78 before 경우의 수와 집합·명제 added seven more.
    expect(line).toHaveLength(85);
    expect(graph.keys.length).toBeGreaterThan(line.length);
    for (const key of ['cost-price', 'discount-rate', 'concentration', 'speed']) expect(line).not.toContain(key);
  });

  it('costs an old starting point exactly what it cost before the catalogue grew', () => {
    // Measured on the four courses that shipped first, before 문자와 식 and everything above it.
    for (const [target, worst] of [['percentage-of', 9], ['rational-number', 9], ['percentage', 8],
      ['decimal-addition', 6], ['reduce', 4], ['ratio', 4], ['fraction', 1]] as const) {
      const scope = placementScope(graph, [target]);
      const costs = [...scope, null].map((known) => place(scope, known ? new Set([known, ...graph.ancestors(known)]) : new Set()).asked);
      expect(Math.max(...costs), `${target}을(를) 배우려는 사람이 더 오래 걸린다`).toBe(worst);
    }
  });

  it('does not get longer because the catalogue grew somewhere else', () => {
    const target = 'equivalent-fraction';
    const scope = placementScope(graph, [target]);
    const before = place(scope, readyFor(target)).asked;
    // A course bolted on above, sharing nothing with what this learner came for.
    const wider = conceptGraph([...lessons, { conceptKeys: ['derivative'], prerequisiteConceptKeys: ['limit'] },
      { conceptKeys: ['limit'], prerequisiteConceptKeys: ['sequence'] }, { conceptKeys: ['sequence'], prerequisiteConceptKeys: [] }]);
    expect(wider.keys.length).toBeGreaterThan(graph.keys.length);
    expect(placementScope(wider, [target])).toEqual(scope);
    expect(before).toBeLessThan(graph.keys.length);
  });
});
