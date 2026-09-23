import { nextConcept, settleConcept, type ConceptGraph, type Outcome, type Placement, type PlacementSource } from './concept-graph';

/** Two right answers, the bar the first placement set so a lucky guess could not stand for knowing. */
const requiredCorrect = 2;

/** A question a placement can put to someone. The bank a run was started with never changes. */
export type PlacementProblem = { problemVersionId: string; conceptKeys: string[] };
export type PlacementAnswer = { problemVersionId: string; status: 'correct' | 'incorrect' | 'skipped' };
/** What a placement has settled so far, and how each concept came to be settled. */
export type PlacementState = { scope: string[]; placed: Placement; source: PlacementSource };
/**
 * A stretch of answers and the scope they were put under, by the index of the first of them.
 *
 * A run used to have one scope for its whole length, because what a learner is on the way to was
 * decided before the first question and frozen. Then they change their mind — 일차방정식 was what
 * they came for on Monday and 연립방정식 is what they came for on Tuesday — and the honest thing is
 * to ask about what the new one needs rather than to finish asking about the old one.
 *
 * The scope cannot simply be replaced. Every verdict here is derived by replaying the answers, and
 * the descent chooses each question by what it would settle **among everything still open** — so a
 * wider scope makes it choose differently, and the answers already stored stop matching what it
 * would have asked. Measured on the published bank, even a scope that strictly contains the old one
 * disagrees from the third answer on.
 *
 * So the scope is not replaced but appended to, and each answer keeps the scope it was given under.
 * Replaying walks the stretches in order, which is deterministic for the same reason one scope was:
 * everything still follows from the answers, in the order they were given.
 */
export type PlacementStretch = { from: number; scope: string[] };
/** How a run says what it was asked under: one scope throughout, or a scope per stretch. */
export type PlacementScope = string[] | PlacementStretch[];

/** Reads either form as stretches. A bare list of concepts is one stretch from the beginning. */
function stretchesOf(scope: PlacementScope): PlacementStretch[] {
  if (!scope.length) return [{ from: 0, scope: [] }];
  return typeof scope[0] === 'string' ? [{ from: 0, scope: scope as string[] }] : (scope as PlacementStretch[]);
}

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
 *
 * It is handed the questions that ask about the concept rather than the whole bank, and reads the
 * answers in place rather than a copy of them, because `placement` asks this of every open concept
 * after every answer — on the published bank that is a hundred and sixty concepts, a hundred and
 * fifty times over.
 */
function verdict(asked: Set<string>, answers: PlacementAnswer[], read: number): Outcome | null {
  let given = 0;
  let skipped = false;
  for (let i = 0; i < read; i += 1) {
    if (!asked.has(answers[i].problemVersionId)) continue;
    if (answers[i].status === 'incorrect') return 'needs-practice';
    if (answers[i].status === 'skipped') skipped = true;
    given += 1;
  }
  if (skipped) return 'unknown';
  return given >= requiredCorrect ? 'ready' : null;
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
  graph: ConceptGraph, scope: PlacementScope, bank: PlacementProblem[], answers: PlacementAnswer[],
): { state: PlacementState; next: PlacementProblem | null; consumed: number } {
  const stretches = stretchesOf(scope);
  /** The scope the answer about to be read was given under — the last stretch that had begun. */
  const inForce = (read: number) => stretches.reduce((held, stretch) => stretch.from <= read ? stretch.scope : held, stretches[0].scope);
  /**
   * Everything that has been in scope up to here. A concept an earlier stretch was asking about is
   * still settled when a later answer decides it: the learner answered that question, and changing
   * where they are going does not unask it.
   */
  const seen = (read: number) => [...new Set(stretches.filter((stretch) => stretch.from <= read).flatMap((stretch) => stretch.scope))];
  let placed: Placement = {};
  let source: PlacementSource = {};
  const used = new Set<string>();
  let read = 0;
  // Which questions ask about a concept never changes during a run, so the bank is read once here
  // instead of once per concept per answer. Bank order is kept: a concept's first unused question is
  // the one the descent puts next.
  const asking = new Map<string, PlacementProblem[]>();
  const askedAbout = new Map<string, Set<string>>();
  for (const problem of bank) {
    for (const key of problem.conceptKeys) {
      let list = asking.get(key);
      if (!list) { list = []; asking.set(key, list); askedAbout.set(key, new Set()); }
      list.push(problem);
      askedAbout.get(key)!.add(problem.problemVersionId);
    }
  }
  const nothing = new Set<string>();
  const unused = (key: string) => (asking.get(key) ?? []).find((problem) => !used.has(problem.problemVersionId)) ?? null;
  const settleWhatIsDecided = (over: string[]) => {
    for (let again = true; again;) {
      again = false;
      for (const key of over) {
        if (key in placed) continue;
        const outcome = verdict(askedAbout.get(key) ?? nothing, answers, read);
        if (!outcome) continue;
        ({ placed, source } = settleConcept(graph, over, placed, source, key, outcome));
        again = true;
      }
    }
  };
  for (;;) {
    settleWhatIsDecided(seen(read));
    const scope = inForce(read);
    const askable = scope.filter((key) => !(key in placed) && unused(key) !== null);
    const concept = nextConcept(graph, scope, placed, { among: askable });
    if (!concept) break;
    const problem = unused(concept)!;
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
  const reached = seen(read);
  for (const key of reached) {
    if (key in placed) continue;
    const about = askedAbout.get(key) ?? nothing;
    if (answers.slice(0, read).some((answer) => about.has(answer.problemVersionId))) {
      ({ placed, source } = settleConcept(graph, reached, placed, source, key, 'unknown'));
    }
  }
  // What a screen counts progress against is where the learner is going now, not everywhere they
  // have been going. A verdict reached under an earlier stretch is kept but no longer counted.
  return { state: { scope: inForce(read), placed, source }, next: null, consumed: read };
}

/** What a screen can honestly say about how far along a placement is. */
export function placementProgress(state: PlacementState) {
  const settled = state.scope.filter((key) => key in state.placed);
  return { scope: state.scope.length, settled: settled.length,
    asked: settled.filter((key) => state.source[key] === 'asked').length,
    inferred: settled.filter((key) => state.source[key] === 'inferred').length };
}
