import { readFileSync, readdirSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { applyAnswer, conceptGraph, nextConcept, placementScope, type Placement, type PlacementSource } from '@/core/concept-graph';
import { parseContentBundle } from '@/core/content-bundle';
import type { StoredLesson } from '@/core/content';

/**
 * How long placing a learner takes on the catalogue that is actually installed.
 *
 * The first placement asked about every concept and wanted two right answers each, so its length was
 * twice the catalogue — which is why it was replaced. These tests hold the replacement to being
 * short **and** to being right: a descent that skipped questions by guessing would be short too.
 */
const lessons = readdirSync('prisma/seed').filter((name) => name.endsWith('.json')).sort()
  .flatMap((name) => parseContentBundle(JSON.parse(readFileSync(`prisma/seed/${name}`, 'utf8'))).lessons as StoredLesson[])
  .map((lesson) => lesson.public);
const graph = conceptGraph(lessons);

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
    ({ placed, source } = applyAnswer(graph, scope, placed, source, key, known.has(key)));
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
    expect(worst).toBeLessThanOrEqual(9);
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
