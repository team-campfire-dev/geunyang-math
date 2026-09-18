import { describe, expect, it } from 'vitest';
import { applyAnswer, conceptGraph, nextConcept, placementScope, type Placement, type PlacementSource } from '@/core/concept-graph';

/**
 * A small catalogue to reason about by hand: `half` stands on `whole`, `quarter` stands on `half`,
 * and `share` is a second branch off `whole` that `quarter` knows nothing about.
 *
 *   whole ─┬─ half ── quarter
 *          └─ share
 */
const lessons = [
  { conceptKeys: ['whole'], prerequisiteConceptKeys: [] },
  { conceptKeys: ['half'], prerequisiteConceptKeys: ['whole'] },
  { conceptKeys: ['quarter'], prerequisiteConceptKeys: ['half'] },
  { conceptKeys: ['share'], prerequisiteConceptKeys: ['whole'] },
];
const graph = conceptGraph(lessons);

describe('the graph a catalogue implies', () => {
  it('reads a dependency out of what a lesson teaches and what it assumes', () => {
    expect(graph.keys).toEqual(['half', 'quarter', 'share', 'whole']);
    expect(graph.prerequisites('quarter')).toEqual(['half']);
    expect(graph.prerequisites('whole')).toEqual([]);
  });

  it('gives every concept a lesson teaches all of that lesson’s prerequisites', () => {
    const wide = conceptGraph([{ conceptKeys: ['sum', 'carry'], prerequisiteConceptKeys: ['digit'] }]);
    expect(wide.prerequisites('sum')).toEqual(['digit']);
    expect(wide.prerequisites('carry')).toEqual(['digit']);
  });

  it('never makes a concept its own prerequisite when a lesson both teaches and assumes it', () => {
    const revisit = conceptGraph([{ conceptKeys: ['half'], prerequisiteConceptKeys: ['half', 'whole'] }]);
    expect(revisit.prerequisites('half')).toEqual(['whole']);
    expect(revisit.cycles()).toEqual([]);
  });

  it('reaches all the way up and all the way down, not one step', () => {
    expect([...graph.ancestors('quarter')].sort()).toEqual(['half', 'whole']);
    expect([...graph.dependents('whole')].sort()).toEqual(['half', 'quarter', 'share']);
    expect([...graph.dependents('quarter')]).toEqual([]);
  });

  it('measures depth from the longest chain above, not the shortest', () => {
    expect(graph.depth('whole')).toBe(0);
    expect(graph.depth('share')).toBe(1);
    expect(graph.depth('quarter')).toBe(2);
  });

  it('names the concepts on a cycle instead of hanging on them', () => {
    const tangled = conceptGraph([
      { conceptKeys: ['a'], prerequisiteConceptKeys: ['b'] },
      { conceptKeys: ['b'], prerequisiteConceptKeys: ['a'] },
      { conceptKeys: ['c'], prerequisiteConceptKeys: [] },
    ]);
    expect(tangled.cycles()).toEqual(['a', 'b']);
    // Depth cannot mean anything on a cycle, but it still has to answer.
    expect(Number.isFinite(tangled.depth('a'))).toBe(true);
    expect(tangled.depth('c')).toBe(0);
  });
});

describe('the concepts a placement has to settle', () => {
  it('is what the target stands on, and leaves the rest of the catalogue out', () => {
    expect(placementScope(graph, ['quarter'])).toEqual(['half', 'quarter', 'whole']);
    // `share` is the branch the learner did not come for, and asking about it would be the old way.
    expect(placementScope(graph, ['quarter'])).not.toContain('share');
  });

  it('merges several targets and ignores a name no lesson uses', () => {
    expect(placementScope(graph, ['share', 'half'])).toEqual(['half', 'share', 'whole']);
    expect(placementScope(graph, ['quarter', 'nonsense'])).toEqual(['half', 'quarter', 'whole']);
  });

  it('falls back to the whole catalogue when nothing was chosen', () => {
    expect(placementScope(graph, [])).toEqual(graph.keys);
  });
});

describe('the question a placement asks next', () => {
  it('picks the one that settles the most either way, not the first in the list', () => {
    // Of half/quarter/whole, `half` settles 2 up and 2 down; the ends settle 1 against 3.
    expect(nextConcept(graph, placementScope(graph, ['quarter']), {})).toBe('half');
  });

  it('stops once nothing is left to settle', () => {
    const placed: Placement = { half: 'ready', quarter: 'ready', whole: 'ready' };
    expect(nextConcept(graph, placementScope(graph, ['quarter']), placed)).toBeNull();
  });

  it('asks the same question of the same answers, so a run can be resumed', () => {
    const scope = placementScope(graph, []);
    expect(nextConcept(graph, scope, {})).toBe(nextConcept(graph, [...scope].reverse(), {}));
  });
});

describe('what one answer settles', () => {
  const scope = placementScope(graph, ['quarter']);

  it('carries a right answer up the prerequisites it was built on', () => {
    const { placed, source } = applyAnswer(graph, scope, {}, {}, 'half', true);
    expect(placed).toEqual({ half: 'ready', whole: 'ready' });
    expect(source).toEqual({ half: 'asked', whole: 'inferred' });
    // Nothing is claimed about what stands on it — that is still to be asked.
    expect(placed.quarter).toBeUndefined();
  });

  it('defers everything that stands on a wrong answer, and says it was not asked', () => {
    const { placed, source } = applyAnswer(graph, scope, {}, {}, 'half', false);
    expect(placed).toEqual({ half: 'needs-practice', quarter: 'needs-practice' });
    expect(source).toEqual({ half: 'asked', quarter: 'inferred' });
    expect(placed.whole).toBeUndefined();
  });

  it('stays inside the scope, so an untargeted branch is never claimed', () => {
    const { placed } = applyAnswer(graph, scope, {}, {}, 'whole', false);
    expect(placed.share).toBeUndefined();
    expect(placed).toEqual({ whole: 'needs-practice', half: 'needs-practice', quarter: 'needs-practice' });
  });

  it('never rewrites an answer already settled, whichever way it came', () => {
    const placed: Placement = { whole: 'needs-practice' };
    const source: PlacementSource = { whole: 'asked' };
    const after = applyAnswer(graph, scope, placed, source, 'half', true);
    expect(after.placed.whole).toBe('needs-practice');
    expect(after.source.whole).toBe('asked');
    expect(after.placed.half).toBe('ready');
  });

  it('ignores a concept outside the scope or already settled', () => {
    const placed: Placement = { half: 'ready' };
    expect(applyAnswer(graph, scope, placed, { half: 'asked' }, 'half', false).placed).toBe(placed);
    expect(applyAnswer(graph, scope, placed, { half: 'asked' }, 'share', true).placed).toBe(placed);
  });
});
