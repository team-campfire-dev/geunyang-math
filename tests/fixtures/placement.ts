import { conceptGraph, placementScope } from '@/core/concept-graph';
import { placement, type PlacementAnswer, type PlacementProblem, type PlacementState } from '@/core/placement';

/**
 * Runs a placement to the end, answering whatever it asks.
 *
 * A placement chooses its own questions now, so a test cannot hand it a list of answers in bank
 * order and expect them to line up. It says what it would answer to each question instead, and gets
 * back what the run settled — which is what `conceptReadiness` reads.
 */
export function playPlacement(
  lessons: { conceptKeys: string[]; prerequisiteConceptKeys: string[] }[],
  bank: PlacementProblem[],
  respond: (problemVersionId: string) => PlacementAnswer['status'],
): { state: PlacementState; answers: PlacementAnswer[] } {
  const graph = conceptGraph(lessons);
  const scope = placementScope(graph, []);
  const answers: PlacementAnswer[] = [];
  for (let guard = 0; guard <= bank.length; guard += 1) {
    const { state, next } = placement(graph, scope, bank, answers);
    if (!next) return { state, answers };
    answers.push({ problemVersionId: next.problemVersionId, status: respond(next.problemVersionId) });
  }
  throw new Error('배치가 끝나지 않는다');
}
