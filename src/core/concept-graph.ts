import type { PublicLesson } from '@/shared/api';

/**
 * Where a learner already is, worked out from the concepts a catalogue teaches.
 *
 * The first placement asked about every concept and needed two right answers each, so its length
 * grew with the catalogue — 22 concepts meant 44 questions, and a comprehensive catalogue would mean
 * hundreds. This finds the same boundary by descending a graph instead of walking a list: one
 * answer settles every concept above or below the one that was asked.
 *
 * The graph is **derived, not declared.** A lesson already names what it teaches and what it takes
 * for granted, so every concept a lesson teaches is recorded as depending on every concept that
 * lesson asks for. Nothing new has to be written or kept in step by hand. The cost is that the
 * relation is per lesson, not per concept: a lesson that teaches two concepts gives both of them all
 * of its prerequisites, which is wider than the truth when only one of them needed all of it. Being
 * too generous makes a right answer carry further than it should, so a lesson whose concepts differ
 * in what they need is a lesson to split.
 */
export type ConceptGraph = {
  /** Every concept any lesson teaches or asks for, in a stable order. */
  keys: string[];
  /** What this concept is built on, one step up. */
  prerequisites: (key: string) => string[];
  /** Everything it is built on, all the way up. Answering it right settles these. */
  ancestors: (key: string) => Set<string>;
  /** Everything built on it, all the way down. Answering it wrong defers these. */
  dependents: (key: string) => Set<string>;
  /** How many steps of prerequisite lie above it. 0 for a concept nothing precedes. */
  depth: (key: string) => number;
  /** Concepts that lie on a prerequisite cycle. Empty for a catalogue that can be taught in order. */
  cycles: () => string[];
};

type LessonShape = Pick<PublicLesson, 'conceptKeys' | 'prerequisiteConceptKeys'>;

export function conceptGraph(lessons: LessonShape[]): ConceptGraph {
  const up = new Map<string, Set<string>>();
  const down = new Map<string, Set<string>>();
  const touch = (key: string) => {
    if (!up.has(key)) up.set(key, new Set());
    if (!down.has(key)) down.set(key, new Set());
  };
  for (const lesson of lessons) {
    for (const key of lesson.conceptKeys) touch(key);
    for (const key of lesson.prerequisiteConceptKeys) touch(key);
    for (const taught of lesson.conceptKeys) {
      for (const needed of lesson.prerequisiteConceptKeys) {
        // A lesson that lists a concept as both taught and assumed is teaching it here, not before.
        if (needed === taught) continue;
        up.get(taught)!.add(needed);
        down.get(needed)!.add(taught);
      }
    }
  }
  const keys = [...up.keys()].sort();
  // A cycle would be a content mistake, not a shape to handle, but reachability must still finish.
  const reach = (edges: Map<string, Set<string>>) => {
    const cache = new Map<string, Set<string>>();
    return (key: string) => {
      const known = cache.get(key);
      if (known) return known;
      const out = new Set<string>();
      const stack = [...(edges.get(key) ?? [])];
      while (stack.length) {
        const next = stack.pop()!;
        if (out.has(next)) continue;
        out.add(next);
        stack.push(...(edges.get(next) ?? []));
      }
      cache.set(key, out);
      return out;
    };
  };
  const ancestors = reach(up);
  const dependents = reach(down);
  const depths = new Map<string, number>();
  const depth = (key: string): number => {
    const seen = depths.get(key);
    if (seen !== undefined) return seen;
    // Measured against its own prerequisites, and a concept on a cycle is its own, so guard first.
    depths.set(key, 0);
    const above = [...(up.get(key) ?? [])].filter((next) => !ancestors(next).has(key));
    const value = above.length ? 1 + Math.max(...above.map(depth)) : 0;
    depths.set(key, value);
    return value;
  };
  return {
    keys,
    prerequisites: (key) => [...(up.get(key) ?? [])].sort(),
    ancestors,
    dependents,
    depth,
    cycles: () => keys.filter((key) => ancestors(key).has(key)),
  };
}

export type Outcome = 'ready' | 'needs-practice' | 'unknown';
export type Placement = Record<string, Outcome>;
/** Whether a concept was settled by its own question or by one above or below it. */
export type PlacementSource = Record<string, 'asked' | 'inferred'>;

/**
 * The concepts a placement has to settle before it can say where to begin.
 *
 * Asking about the whole catalogue is what made the first placement long, and it stays long however
 * cleverly it descends — a descent shortens chains, and a catalogue is wide as well as deep. What
 * bounds it is the learner saying what they came for: to place someone for one lesson only what that
 * lesson stands on has to be settled, and a catalogue that grows elsewhere does not lengthen it.
 *
 * With no targets this is every concept there is, which is the behaviour to fall back to and not the
 * one to aim for.
 */
export function placementScope(graph: ConceptGraph, targets: string[]): string[] {
  if (!targets.length) return [...graph.keys];
  const scope = new Set<string>();
  for (const target of targets) {
    if (!graph.keys.includes(target)) continue;
    scope.add(target);
    for (const key of graph.ancestors(target)) scope.add(key);
  }
  return graph.keys.filter((key) => scope.has(key));
}

/**
 * Which concept to ask about next: the one whose answer settles the most either way.
 *
 * A question is worth asking for what it rules out as much as for what it confirms, so the one to
 * pick is the one whose two outcomes are closest to even — that is what makes the descent halve
 * rather than creep. Ties go to the question that settles more in total, then to the name, so that
 * the same answers always produce the same next question.
 */
export function nextConcept(
  graph: ConceptGraph, scope: string[], placed: Placement, options: { among?: string[] } = {},
): string | null {
  const open = scope.filter((key) => !(key in placed));
  if (!open.length) return null;
  // What a question is worth is measured against everything still open, but only a concept there is
  // something to ask about can be the question. Settling the rest by inference is the point.
  const remaining = new Set(open);
  const candidates = options.among ? open.filter((key) => options.among!.includes(key)) : open;
  if (!candidates.length) return null;
  const settles = (key: string) => {
    const above = [...graph.ancestors(key)].filter((other) => remaining.has(other)).length + 1;
    const below = [...graph.dependents(key)].filter((other) => remaining.has(other)).length + 1;
    return { even: Math.min(above, below), total: above + below };
  };
  return candidates.reduce((best, key) => {
    const a = settles(key);
    const b = settles(best);
    if (a.even !== b.even) return a.even > b.even ? key : best;
    if (a.total !== b.total) return a.total > b.total ? key : best;
    return key < best ? key : best;
  });
}

/**
 * What settling one concept settles. A concept someone can do carries up the concepts it was built
 * on; one they cannot defers everything built on top of it. A concept left unknown — skipped, or
 * asked without enough answers to be sure — carries nowhere, because nothing was learned about it.
 *
 * Carrying is an inference, not an observation: nobody was asked whether they can add decimals once
 * they could not say what a decimal is. The answer that would have come back is not in doubt enough
 * to be worth a learner's time, but it was not heard, so it is recorded as inferred and a screen can
 * say so rather than claiming to have checked.
 */
export function settleConcept(
  graph: ConceptGraph, scope: string[], placed: Placement, source: PlacementSource, key: string, outcome: Outcome,
): { placed: Placement; source: PlacementSource } {
  const within = new Set(scope);
  if (!within.has(key) || key in placed) return { placed, source };
  const next = { ...placed, [key]: outcome };
  const from = { ...source, [key]: 'asked' as const };
  const reached = outcome === 'ready' ? graph.ancestors(key) : outcome === 'needs-practice' ? graph.dependents(key) : new Set<string>();
  for (const other of reached) {
    if (!within.has(other) || other in next) continue;
    next[other] = outcome;
    from[other] = 'inferred';
  }
  return { placed: next, source: from };
}
