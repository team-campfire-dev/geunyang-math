import { nextConcept, settleConcept, type ConceptGraph, type Outcome, type Placement, type PlacementSource } from './concept-graph';

/** Two right answers, the bar the first placement set so a lucky guess could not stand for knowing. */
const requiredCorrect = 2;

/** A question a placement can put to someone. The bank a run was started with never changes. */
export type PlacementProblem = { problemVersionId: string; conceptKeys: string[] };
export type PlacementAnswer = { problemVersionId: string; status: 'correct' | 'incorrect' | 'skipped' };
/** What a placement has settled so far, and how each concept came to be settled. */
export type PlacementState = { scope: string[]; placed: Placement; source: PlacementSource };

/**
 * What the answers so far say about one concept, or nothing yet if it has not been answered enough.
 *
 * **This is the rule the first placement used, unchanged.** A wrong answer is enough to say practice
 * is needed; a skipped one leaves the concept unknown; a right one on its own does not settle
 * anything, because one right answer is a guess away from being right. What the new placement
 * changes is how many concepts have to be answered at all, not what an answer means.
 *
 * A question names every concept it asks about, and its answer counts for all of them. Right is easy:
 * doing it took all of them. Wrong does not say which one went wrong, and the honest reading of that
 * is that none of them can be counted on yet — so all of them are marked as needing practice. That
 * errs towards offering a lesson someone did not need, rather than towards skipping one they did.
 */
function verdict(bank: PlacementProblem[], answers: PlacementAnswer[], key: string): Outcome | null {
  const about = new Set(bank.filter((problem) => problem.conceptKeys.includes(key)).map((problem) => problem.problemVersionId));
  const given = answers.filter((answer) => about.has(answer.problemVersionId));
  if (given.some((answer) => answer.status === 'incorrect')) return 'needs-practice';
  if (given.some((answer) => answer.status === 'skipped')) return 'unknown';
  return given.length >= requiredCorrect ? 'ready' : null;
}

/**
 * A placement run against a bank of questions.
 *
 * The descent says which concept is worth asking about next; this puts a question to the learner,
 * reads what the answers add up to, and carries each verdict as far up or down the graph as it goes.
 * The concepts that are never asked about are where the saving is: on the bank published today a
 * learner answers five questions where before they answered thirteen.
 *
 * A concept the bank cannot ask about is never chosen as a question but stays in the scope and can
 * still be settled by a neighbour. The bank asks about fractions only, so this is how the concepts
 * of the other three courses are placed at all.
 *
 * Everything is derived from the answers in the order they were given, so the same answers always
 * produce the same placement: a run can be resumed, replayed, and checked against what it stored.
 */
export function placement(
  graph: ConceptGraph, scope: string[], bank: PlacementProblem[], answers: PlacementAnswer[],
): { state: PlacementState; next: PlacementProblem | null; consumed: number } {
  let placed: Placement = {};
  let source: PlacementSource = {};
  const used = new Set<string>();
  let read = 0;
  const unused = (key: string) => bank.filter((problem) => problem.conceptKeys.includes(key) && !used.has(problem.problemVersionId));
  const settleWhatIsDecided = () => {
    for (let again = true; again;) {
      again = false;
      for (const key of scope) {
        if (key in placed) continue;
        const outcome = verdict(bank, answers.slice(0, read), key);
        if (!outcome) continue;
        ({ placed, source } = settleConcept(graph, scope, placed, source, key, outcome));
        again = true;
      }
    }
  };
  for (;;) {
    settleWhatIsDecided();
    const askable = scope.filter((key) => !(key in placed) && unused(key).length > 0);
    const concept = nextConcept(graph, scope, placed, { among: askable });
    if (!concept) break;
    const problem = unused(concept)[0];
    const answer = answers[read];
    if (!answer) return { state: { scope, placed, source }, next: problem, consumed: read };
    if (answer.problemVersionId !== problem.problemVersionId) {
      // The stored run and the descent disagree about what was asked, so nothing here can be trusted.
      throw new Error(`배치 기록이 어긋난다: ${problem.problemVersionId}를 물었어야 하는데 ${answer.problemVersionId}이(가) 저장돼 있다`);
    }
    read += 1;
    used.add(problem.problemVersionId);
  }
  // Asked, and the bank ran out before the answers added up to anything. Not wrong, just not known.
  for (const key of scope) {
    if (key in placed) continue;
    const about = new Set(bank.filter((problem) => problem.conceptKeys.includes(key)).map((problem) => problem.problemVersionId));
    if (answers.slice(0, read).some((answer) => about.has(answer.problemVersionId))) {
      ({ placed, source } = settleConcept(graph, scope, placed, source, key, 'unknown'));
    }
  }
  return { state: { scope, placed, source }, next: null, consumed: read };
}

/** What a screen can honestly say about how far along a placement is. */
export function placementProgress(state: PlacementState) {
  const settled = state.scope.filter((key) => key in state.placed);
  return { scope: state.scope.length, settled: settled.length,
    asked: settled.filter((key) => state.source[key] === 'asked').length,
    inferred: settled.filter((key) => state.source[key] === 'inferred').length };
}
