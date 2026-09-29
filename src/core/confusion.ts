import 'server-only';
import type { GradeResult, PublicConcept, PublicLesson } from '@/shared/api';
import type { ConfusionAttempt, ConfusionConcept, ConfusionEvidence, ConfusionSignal, ConfusionSource, ConfusionSummary, RepeatedConfusion } from '@/shared/confusion';
import { misconceptionOf } from '@/shared/misconception';
import { misreadingAdvice, misreadingLabels } from '@/shared/misreading';
import type { StoredProblem } from './content';
import { gradeAnswer } from './grading';

export type ConfusionObservation = {
  id: string; answer: string; result: GradeResult; hintUsed: boolean; createdAt: Date;
  problem: StoredProblem; source: ConfusionSource; check: boolean; delayed: boolean;
};

function signalOf(row: ConfusionObservation): ConfusionSignal | null {
  // Interpret the saved answer with today's annotations and the question's frozen grading rule.
  // Never rewrite the stored grade, and never interpret a correct/invalid answer as a mistake.
  if (row.result.status !== 'incorrect') return null;
  const interpreted = gradeAnswer(row.answer, row.problem.gradingSpec, row.hintUsed, row.problem.misreadings);
  const named = interpreted.misconception && misconceptionOf(interpreted.misconception);
  if (named) return { kind: 'misconception', ...named };
  const key = interpreted.misreading;
  return key ? { kind: 'misreading', key, label: misreadingLabels[key], note: misreadingAdvice[key] } : null;
}

function attemptOf(row: ConfusionObservation): ConfusionAttempt {
  return { id: row.id, answer: row.answer, status: row.result.status as ConfusionAttempt['status'],
    hintUsed: row.hintUsed || row.result.assisted, createdAt: row.createdAt.toISOString(), source: row.source, signal: signalOf(row) };
}

/** Whether a new question could supply evidence about this particular mistake. */
function canCheck(row: ConfusionObservation, signal: ConfusionSignal): boolean {
  if (signal.kind === 'misconception') return row.problem.misreadings?.some(item => item.misconception === signal.key) ?? false;
  const spec = row.problem.gradingSpec;
  if (spec.kind === 'choice') return false;
  if (spec.kind === 'expression') return false;
  if (signal.key === 'unreduced') return spec.kind === 'rational' && spec.requiredForm === 'reduced_fraction';
  if (signal.key === 'reciprocal') return spec.kind === 'rational' && spec.denominator !== 1 && spec.numerator !== 0;
  if (signal.key === 'off-by-one') return spec.kind === 'integer' || spec.numerator % spec.denominator === 0;
  return (spec.kind === 'integer' ? spec.value : spec.numerator) !== 0;
}

/** Only released observations enter here. First means chronological across every learning context. */
export function summarizeConfusion(observations: ConfusionObservation[], concepts: PublicConcept[], lessons: PublicLesson[]): ConfusionSummary {
  const sorted = observations.filter(row => row.result.status === 'correct' || row.result.status === 'incorrect')
    .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime() || a.id.localeCompare(b.id));
  const firsts = new Map<string, ConfusionObservation>();
  const records = new Map<string, ConfusionEvidence>();
  const seenAttempts = new Set<string>();
  for (const row of sorted) {
    if (seenAttempts.has(row.id)) continue;
    seenAttempts.add(row.id);
    const id = row.problem.problemVersionId;
    const existing = records.get(id);
    if (existing) existing.corrections.push(attemptOf(row));
    else {
      firsts.set(id, row);
      records.set(id, { problemVersionId: id, conceptKeys: row.problem.conceptKeys,
        promptContent: row.problem.promptContent, responseSpec: row.problem.responseSpec,
        first: attemptOf(row), corrections: [] });
    }
  }
  const evidence = [...records.values()];
  const independent = (item: ConfusionEvidence) => item.first.status === 'correct' && !item.first.hintUsed;
  const latestAt = (items: ConfusionEvidence[]) => items.flatMap(item => [item.first, ...item.corrections])
    .reduce<string | null>((latest, attempt) => !latest || attempt.createdAt > latest ? attempt.createdAt : latest, null);
  const byConcept: ConfusionConcept[] = concepts.map(concept => {
    const items = evidence.filter(item => item.conceptKeys.includes(concept.key));
    const correct = items.filter(item => independent(item) && firsts.get(item.problemVersionId)!.check);
    const missed = items.filter(item => item.first.status === 'incorrect');
    const retained = correct.some(item => firsts.get(item.problemVersionId)!.delayed)
      && correct.some(item => !firsts.get(item.problemVersionId)!.delayed);
    const state = correct.length >= 2 ? retained ? 'retained' : 'independent' : missed.length >= 2 ? 'missed' : 'unknown';
    const latestFirst = items.at(-1)?.first;
    const description = state === 'retained' ? '힌트 없이 처음에 풀고, 시간을 둔 복습에서도 확인했어요.'
      : state === 'independent' ? '서로 다른 두 문제 이상을 힌트 없이 처음에 맞혔어요.'
      : state === 'missed' ? `서로 다른 ${missed.length}문제에서 첫 답을 놓쳤어요. 어디서 헷갈렸는지 풀이를 함께 봐요.`
      : !items.length ? '아직 이 개념의 풀이 기록이 없어요.'
      : missed.length === 1 ? '첫 답을 한 번 놓쳤어요. 한 문제만으로는 단정하지 않아요.'
      : '풀이 기록이 쌓이고 있어요. 스스로 해결했는지는 확인 문제와 복습에서 더 살펴봐요.';
    return { key: concept.key, label: concept.label, state, description: description + ((state === 'independent' || state === 'retained') && latestFirst?.status === 'incorrect'
      ? ' 최근 문제에서는 첫 답을 놓쳤지만, 앞서 스스로 푼 기록도 함께 봐요.' : ''),
      lessonKey: lessons.find(lesson => lesson.conceptKeys.includes(concept.key))?.lessonKey ?? null,
      evidenceIds: items.map(item => item.problemVersionId), latestAt: latestAt(items) };
  });

  const groups = new Map<string, ConfusionEvidence[]>();
  for (const item of evidence) {
    const signal = item.first.signal;
    if (!signal) continue;
    const key = `${signal.kind}:${signal.key}`;
    groups.set(key, [...(groups.get(key) ?? []), item]);
  }
  const repeated: RepeatedConfusion[] = [];
  for (const items of groups.values()) {
    if (items.length < 2) continue;
    const signal = items[0].first.signal!;
    // A later retry can show recurrence, but cannot increase the distinct-question count.
    const occurrences = evidence.flatMap(item => [item.first, ...item.corrections])
      .filter(attempt => attempt.signal?.kind === signal.kind && attempt.signal.key === signal.key);
    const lastSeenAt = occurrences.reduce((latest, item) => item.createdAt > latest ? item.createdAt : latest, items[0].first.createdAt);
    const affected = new Set(items.flatMap(item => item.conceptKeys));
    const improved = evidence.filter(item => independent(item) && item.first.createdAt > lastSeenAt
      && item.conceptKeys.some(key => affected.has(key)) && canCheck(firsts.get(item.problemVersionId)!, signal));
    const improving = improved.length >= 2;
    repeated.push({ ...signal, status: improving ? 'improving' : 'repeated',
      description: improving ? '이후 관련된 새 문제 두 개 이상을 힌트 없이 처음에 맞혔어요. 최근에는 스스로 해결했어요.'
        : `서로 다른 ${items.length}문제의 첫 답에서 비슷한 실수가 나왔어요. 답에서 읽은 단서라 이유를 단정하지는 않아요.`,
      evidenceIds: items.map(item => item.problemVersionId), improvementEvidenceIds: improved.map(item => item.problemVersionId), lastSeenAt });
  }
  repeated.sort((a, b) => Number(a.status === 'improving') - Number(b.status === 'improving') || b.lastSeenAt.localeCompare(a.lastSeenAt) || a.key.localeCompare(b.key));
  return { version: 1, latestAt: latestAt(evidence), concepts: byConcept, repeated, evidence };
}
