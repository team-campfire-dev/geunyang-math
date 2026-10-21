import 'server-only';
import { randomUUID } from 'node:crypto';
import type { Prisma, PrismaClient } from '@prisma/client';
import { z } from 'zod';
import { practicePolicy } from '@/core/assignment';
import type { StoredProblem } from '@/core/content';
import { aiPracticeLimits, checkHypothesis, coursesLabel, scopeConcepts, scopeEvidence, scopeHolds, scopeKey, type Hypothesis, type HypothesisCheck, type PracticeScope, type Prediction } from '@/shared/ai-practice';
import { courseStageLabels, type ConceptState, type CourseStage, type PublicLesson } from '@/shared/api';
import { renameProblem } from '@/shared/authoring';
import type { ConfusionAttempt, ConfusionEvidence, ConfusionSummary } from '@/shared/confusion';
import { hypothesisKey, isHypothesisKey, misconceptionOf } from '@/shared/misconception';
import { generatedPrefix, indexGeneratedProblems, publishedProblemRecords } from './content-store';
import { keyOf, plain, said, stored } from './learner-generation';
import { generateProblems, type ProblemModel } from './problem-generation';
import { notYet } from './stage-range';

/**
 * AI 맞춤 연습. The app writes down what a learner did; a model reads it, guesses what went wrong,
 * and decides what to practise; the writer, the solver and the checker then do for each thing what
 * they do for any question.
 *
 * The app does not decide what a mistake was. It sets out each question the learner met — what was
 * asked, what they wrote first and after, whether a hint came before the answer, where and when —
 * and the clues it read off answers go along only as clues. The model guesses, and a guess has to
 * point at the questions it came from. A guess the catalogue has a name for takes that name, so it
 * still adds up across learners; one it has no name for is named for its set alone, and the
 * questions written for it must still hold the wrong answer it predicts to a computation the server
 * does. The learner's first answers to those questions are then what the guess predicted, or not,
 * and the next plan reads that.
 *
 * What it says to the learner (the diagnosis, the guesses, a reason per question) is stored with
 * the set, because the learner reads it beside questions that are frozen.
 */

/** What the planner returns, as the response format constrains it. The guesses come first, so the plan is read from them. */
export const planSchema = z.object({
  hypotheses: z.array(z.object({
    name: z.string(),
    how: z.string(),
    evidence: z.array(z.number()),
    confidence: z.enum(['low', 'medium', 'high']),
    misconception: z.string(),
  })),
  diagnosis: z.string(),
  targets: z.array(z.object({
    conceptKey: z.string(),
    focus: z.enum(['confused', 'weak', 'reinforce']),
    hypothesis: z.number(),
    reason: z.string(),
    count: z.number(),
  })),
});
export type RawPlan = z.infer<typeof planSchema>;
export type PlanTarget = { conceptKey: string; focus: RawPlan['targets'][number]['focus']; hypothesis: string; reason: string; count: number };
/** The plan as the server acts on it: guesses named for this set, targets pointing at them by key. */
export type PracticePlan = { diagnosis: string; hypotheses: Hypothesis[]; targets: PlanTarget[] };

/** What the learning service already knows, handed in so this does not work it out again. */
export type LearnerRecord = {
  userId: string;
  summary: ConfusionSummary;
  concepts: { key: string; label: string; state: ConceptState }[];
  lessons: PublicLesson[];
  courses: { key: string; title: string; stage?: CourseStage | null }[];
};

type ProfileConcept = { key: string; label: string; state: ConceptState; right: number; wrong: number };
/** One question the learner met, numbered so a guess can point at it. */
export type ProfileItem = { number: number; evidence: ConfusionEvidence; problem: StoredProblem | undefined;
  /** What an earlier guess predicted this question's wrong answer would be, when it was written to check one. */
  predicted: { name: string; answer: string }[] };
/** A guess from an earlier set, with what the questions written for it found. */
export type PastHypothesis = Hypothesis & { at: string; check: HypothesisCheck };
export type Profile = {
  scope: PracticeScope; scopeLabel: string; evidence: ConfusionEvidence[];
  concepts: ProfileConcept[];
  repeated: { kind: 'misconception' | 'misreading'; key: string; label: string; status: string; problems: number }[];
  items: ProfileItem[];
  past: PastHypothesis[];
  /** The stages of the courses the questions came from, so what is said to the learner stays inside them. */
  stages: CourseStage[];
};

/** How much of the record is written out. Every question troubled is worth more than one answered cleanly. */
const shown = { troubled: 24, clean: 12, past: 6, pastSets: 6 } as const;

export function scopeLabel(scope: PracticeScope, record: Pick<LearnerRecord, 'lessons' | 'courses'>): string {
  if (scope.kind === 'all') return '전체 기록';
  if (scope.kind === 'course') return record.courses.find((course) => course.key === scope.key)?.title ?? scope.key;
  if (scope.kind === 'courses') return coursesLabel(scope.keys.map((key) => record.courses.find((course) => course.key === key)?.title ?? key));
  return record.lessons.find((lesson) => lesson.lessonKey === scope.key)?.title ?? scope.key;
}

/** A first answer that was not simply right on its own: wrong, helped by a hint, or answered again. */
const troubled = (item: ConfusionEvidence) => item.first.status === 'incorrect' || item.first.hintUsed || item.corrections.length > 0;

/** A set's plan as the database hands it back, read defensively: an older set has no guesses. */
export function storedGuesses(plan: unknown): { hypotheses: Hypothesis[]; predictions: Record<string, Prediction[]> } {
  const value = (plan ?? {}) as { hypotheses?: unknown; predictions?: unknown };
  const hypotheses = (Array.isArray(value.hypotheses) ? value.hypotheses : []).flatMap((item): Hypothesis[] => {
    const h = item as Partial<Hypothesis>;
    if (typeof h.key !== 'string' || !isHypothesisKey(h.key) || typeof h.name !== 'string') return [];
    return [{ key: h.key, name: h.name, how: typeof h.how === 'string' ? h.how : '', confidence: h.confidence === 'high' || h.confidence === 'low' ? h.confidence : 'medium',
      misconception: typeof h.misconception === 'string' ? h.misconception : '',
      evidence: Array.isArray(h.evidence) ? h.evidence.filter((id): id is string => typeof id === 'string') : [],
      conceptKeys: Array.isArray(h.conceptKeys) ? h.conceptKeys.filter((key): key is string => typeof key === 'string') : [] }];
  });
  const predictions: Record<string, Prediction[]> = {};
  if (value.predictions && typeof value.predictions === 'object') {
    for (const [id, list] of Object.entries(value.predictions as Record<string, unknown>)) {
      const kept = (Array.isArray(list) ? list : []).filter((p): p is Prediction => typeof (p as Prediction)?.answer === 'string' && typeof (p as Prediction)?.hypothesis === 'string');
      if (kept.length) predictions[id] = kept;
    }
  }
  return { hypotheses, predictions };
}

/**
 * The record over one range, set out for a reader. Null when the range holds too few first
 * answers to say anything — a model asked to diagnose three questions' worth of nothing invents.
 */
export async function buildProfile(db: Prisma.TransactionClient, record: LearnerRecord, scope: PracticeScope): Promise<Profile | null> {
  const evidence = scopeEvidence(record.summary, scope, record.lessons);
  if (evidence.length < aiPracticeLimits.minimumEvidence) return null;
  const taught = scopeConcepts(scope, record.lessons);
  const ids = new Set(evidence.map((item) => item.problemVersionId));
  const tally = new Map<string, { right: number; wrong: number }>();
  for (const item of evidence) for (const key of item.conceptKeys) {
    if (taught && !taught.has(key)) continue;
    const entry = tally.get(key) ?? { right: 0, wrong: 0 };
    if (item.first.status === 'correct') entry.right += 1; else entry.wrong += 1;
    tally.set(key, entry);
  }
  // A lesson or course may also ask about what it teaches and has not yet been answered.
  const keys = new Set([...tally.keys(), ...(taught ?? [])]);
  const concepts = [...keys].flatMap((key) => {
    const known = record.concepts.find((concept) => concept.key === key);
    return known ? [{ ...known, ...(tally.get(key) ?? { right: 0, wrong: 0 }) }] : [];
  }).sort((a, b) => b.wrong - a.wrong || a.right - b.right || a.label.localeCompare(b.label));
  const repeated = record.summary.repeated.map((item) => ({ item, problems: item.evidenceIds.filter((id) => ids.has(id)).length }))
    .filter(({ problems }) => problems > 0)
    .map(({ item, problems }) => ({ kind: item.kind, key: item.key, label: item.label, status: item.status, problems }));

  const newest = [...evidence].sort((a, b) => b.first.createdAt.localeCompare(a.first.createdAt));
  const picked = [...newest.filter(troubled).slice(0, shown.troubled), ...newest.filter((item) => !troubled(item)).slice(0, shown.clean)]
    .sort((a, b) => a.first.createdAt.localeCompare(b.first.createdAt));

  // Earlier guesses about this learner, and what the questions written for them found.
  const sets = await db.generatedProblemSet.findMany({ where: { userId: record.userId, scope: { not: null }, status: 'done' },
    orderBy: { createdAt: 'desc' }, take: shown.pastSets, select: { plan: true, createdAt: true } });
  const guesses = sets.map((set) => ({ at: set.createdAt.toISOString(), ...storedGuesses(set.plan) }));
  const problems = await publishedProblemRecords(db, [...picked.map((item) => item.problemVersionId),
    ...guesses.flatMap((set) => Object.keys(set.predictions))]);
  // First answers as the record holds them: a set still open is read once the learner finishes it.
  const firsts = new Map(record.summary.evidence.flatMap((item) => {
    const problem = problems.get(item.problemVersionId);
    return problem ? [[item.problemVersionId, { answer: item.first.answer, status: item.first.status, spec: problem.gradingSpec }] as const] : [];
  }));
  const past = guesses.flatMap((set) => set.hypotheses.map((hypothesis) => ({ ...hypothesis, at: set.at, check: checkHypothesis(hypothesis.key, set.predictions, firsts) })))
    .filter((hypothesis) => !taught || hypothesis.conceptKeys.some((key) => taught.has(key)))
    .slice(0, shown.past);
  const predictedFor = new Map<string, { name: string; answer: string }[]>();
  for (const set of guesses) for (const [id, list] of Object.entries(set.predictions)) for (const prediction of list) {
    const name = set.hypotheses.find((hypothesis) => hypothesis.key === prediction.hypothesis)?.name;
    if (name) predictedFor.set(id, [...(predictedFor.get(id) ?? []), { name, answer: prediction.answer }]);
  }
  const items = picked.map((item, index) => ({ number: index + 1, evidence: item, problem: problems.get(item.problemVersionId),
    predicted: predictedFor.get(item.problemVersionId) ?? [] }));
  const courseOf = (lessonKey: string | null) => record.lessons.find((lesson) => lesson.lessonKey === lessonKey)?.courseKey;
  const stages = [...new Set(items.flatMap((item) => {
    const stage = record.courses.find((course) => course.key === courseOf(item.evidence.first.source.lessonKey))?.stage;
    return stage ? [stage] : [];
  }))];
  return { scope, scopeLabel: scopeLabel(scope, record), evidence, concepts, repeated, items, past, stages };
}

const stateWords: Record<ConceptState, string> = { unknown: '아직 확인 전', practicing: '연습하는 중', independent: '스스로 해결', retained: '꾸준히 기억' };
const sourceWords: Record<ConfusionAttempt['source']['kind'], string> = { lesson: '수업', homework: '과제', exam: '시험', review: '복습', practice: '연습' };
const confidenceWords: Record<Hypothesis['confidence'], string> = { low: '낮음', medium: '중간', high: '높음' };
const evidenceText = (item: ConfusionEvidence) => item.promptContent.map((block) => String(block.payload.text ?? '')).join(' ').replace(/\s+/g, ' ').trim();
const day = (iso: string) => new Intl.DateTimeFormat('ko-KR', { timeZone: 'Asia/Seoul', month: 'numeric', day: 'numeric' }).format(new Date(iso));

/** How long after the first answer another came, the way a person would say it. */
function after(from: string, to: string): string {
  const minutes = Math.round((Date.parse(to) - Date.parse(from)) / 60_000);
  if (minutes < 1) return '바로';
  if (minutes < 60) return `${minutes}분 뒤`;
  if (minutes < 24 * 60) return `${Math.round(minutes / 60)}시간 뒤`;
  return `${Math.round(minutes / (24 * 60))}일 뒤`;
}

/** One answer as words: what was written, whether it was right, and whether a hint came first. */
function answerLine(attempt: ConfusionAttempt, problem: StoredProblem | undefined): string {
  const wrote = problem ? said(problem, attempt.answer) : attempt.answer;
  return `${wrote} — ${attempt.status === 'correct' ? '맞음' : '틀림'}, ${attempt.hintUsed ? '힌트를 보고' : '힌트 없이'}`;
}

/** One question the learner met, set out as what happened. Nothing here says why. */
function itemText(item: ProfileItem, labels: Map<string, string>): string[] {
  const { evidence, problem } = item;
  const concepts = evidence.conceptKeys.map((key) => labels.get(key)).filter(Boolean).join(', ');
  const where = `${sourceWords[evidence.first.source.kind]} 「${evidence.first.source.title}」 · ${day(evidence.first.createdAt)}`;
  const lines = [`#${item.number} [${concepts}] ${where}`, `  지문: ${evidenceText(evidence).slice(0, 300)}`];
  const spec = problem?.gradingSpec;
  if (spec?.kind === 'choice') lines.push(`  보기: ${spec.options.map((option) => `${option.id}) ${option.text}`).join('  ')}`);
  if (problem) lines.push(`  정답: ${keyOf(problem)}`);
  lines.push(`  첫 답: ${answerLine(evidence.first, problem)}`);
  if (evidence.corrections.length) {
    lines.push(`  이어서: ${evidence.corrections.map((attempt) => `${answerLine(attempt, problem)} (${after(evidence.first.createdAt, attempt.createdAt)})`).join(' → ')}`);
  }
  if (evidence.first.signal) lines.push(`  앱이 답에서 읽은 단서: ${evidence.first.signal.label}${evidence.first.signal.kind === 'misconception' ? ` [${evidence.first.signal.key}]` : ''}`);
  for (const prediction of item.predicted) {
    const wrote = problem ? said(problem, prediction.answer) : prediction.answer;
    lines.push(`  지난 추측 「${prediction.name}」이 예측한 오답: ${wrote}`);
  }
  return lines;
}

/** What the questions written for an earlier guess found, in words. */
function checkText(check: HypothesisCheck): string {
  if (!check.answered) return `확인 문제 ${check.asked}개를 아직 풀지 않음`;
  return `확인 문제 ${check.asked}개 중 ${check.answered}개를 풂 — 예측한 오답 ${check.predicted}번, 맞힘 ${check.correct}번, 다른 오답 ${check.other}번`;
}

/** The profile as the planner reads it. Keys are shown in brackets because the plan must name them. */
export function plannerRequest(profile: Profile): string {
  const labels = new Map(profile.concepts.map((concept) => [concept.key, concept.label]));
  const lines = [`범위: ${profile.scopeLabel}`, `첫 답이 있는 문제: ${profile.evidence.length}개 (아래에는 그중 ${profile.items.length}개)`];
  // The diagnosis and the reasons are read by the learner, in the words of what they have learned.
  for (const stage of profile.stages) if (notYet[stage]) lines.push(`학년 범위(${courseStageLabels[stage]}): ${notYet[stage]} 진단과 이유도 그렇게 쓴다.`);
  lines.push('', '개념별 상태:');
  for (const concept of profile.concepts) {
    lines.push(`- ${concept.label} [${concept.key}]: ${stateWords[concept.state]}, 첫 답 맞음 ${concept.right} · 틀림 ${concept.wrong}`);
  }
  lines.push('', '풀이 기록 (오래된 것부터, 추측의 근거는 이 번호로 댄다):');
  for (const item of profile.items) lines.push(...itemText(item, labels));
  if (profile.repeated.length) {
    lines.push('', '앱이 서로 다른 문제의 첫 답에서 되풀이해 읽은 단서 (참고만 한다):');
    for (const item of profile.repeated) {
      lines.push(`- ${item.label}${item.kind === 'misconception' ? ` [${item.key}]` : ' (답의 모양으로 읽은 것)'}: ${item.problems}문제, ${item.status === 'repeated' ? '아직 되풀이됨' : '최근에는 나아짐'}`);
    }
  }
  if (profile.past.length) {
    lines.push('', '지난 추측과 확인 결과 (최근 것부터):');
    for (const hypothesis of profile.past) {
      lines.push(`- 「${hypothesis.name}」 (${day(hypothesis.at)}, 확신 ${confidenceWords[hypothesis.confidence]}): ${checkText(hypothesis.check)}`);
    }
  }
  return lines.join('\n');
}

/**
 * The plan as the server will act on it. A guess survives only if it points at questions the
 * profile holds; it takes the catalogue's name only when that name is real, and otherwise a name
 * for this set. Targets survive only for concepts the profile names, and the counts are made to add
 * up to what a set holds. When nothing the model said can be used, the record itself decides — the
 * concepts answered wrongly most — rather than failing.
 */
export function settlePlan(raw: RawPlan, profile: Profile): PracticePlan {
  const byNumber = new Map(profile.items.map((item) => [item.number, item]));
  const hypotheses: Hypothesis[] = [];
  const keyOfIndex = new Map<number, string>();
  raw.hypotheses.forEach((guess, index) => {
    const name = guess.name.trim().slice(0, 80);
    const items = [...new Set(guess.evidence.map((n) => Math.round(n)))].flatMap((n) => byNumber.get(n) ?? []);
    if (!name || !items.length || hypotheses.length >= aiPracticeLimits.maxTargets) return;
    const key = hypothesisKey(hypotheses.length + 1);
    keyOfIndex.set(index + 1, key);
    const misconception = guess.misconception.trim();
    hypotheses.push({ key, name, how: guess.how.trim().slice(0, 300), confidence: guess.confidence,
      misconception: misconceptionOf(misconception) ? misconception : '',
      evidence: items.map((item) => item.evidence.problemVersionId), conceptKeys: [...new Set(items.flatMap((item) => item.evidence.conceptKeys))] });
  });
  const known = new Set(profile.concepts.map((concept) => concept.key));
  const seen = new Set<string>();
  let targets = raw.targets.flatMap((target): PlanTarget[] => {
    const conceptKey = target.conceptKey.trim();
    const hypothesis = keyOfIndex.get(Math.round(target.hypothesis)) ?? '';
    const id = `${conceptKey}/${hypothesis}`;
    if (!known.has(conceptKey) || seen.has(id)) return [];
    seen.add(id);
    // Aiming at a mistake needs a guess to aim at; without one it is practice on the concept.
    const focus = target.focus === 'confused' && !hypothesis ? 'weak' : target.focus;
    return [{ conceptKey, focus, hypothesis, reason: target.reason.trim().slice(0, 200), count: Math.max(1, Math.round(target.count) || 1) }];
  }).slice(0, aiPracticeLimits.maxTargets);
  if (!targets.length) {
    targets = profile.concepts.filter((concept) => concept.wrong > 0 || concept.state === 'practicing').slice(0, 2)
      .map((concept) => ({ conceptKey: concept.key, focus: 'weak' as const, hypothesis: '', count: 1,
        reason: `「${concept.label}」에서 첫 답이 틀린 문제가 있었어요. 다른 숫자로 다시 풀어 봐요.` }));
    if (!targets.length && profile.concepts[0]) targets = [{ conceptKey: profile.concepts[0].key, focus: 'reinforce', hypothesis: '', count: 1,
      reason: `「${profile.concepts[0].label}」을 다른 상황에서 한 번 더 확인해요.` }];
  }
  const total = aiPracticeLimits.questions;
  const sum = targets.reduce((n, target) => n + target.count, 0);
  const scaled = targets.map((target) => ({ ...target, count: Math.max(1, Math.round((target.count * total) / sum)) }));
  // Rounding can miss by one or two; the largest target takes the difference.
  let drift = total - scaled.reduce((n, target) => n + target.count, 0);
  const order = [...scaled.keys()].sort((a, b) => scaled[b].count - scaled[a].count);
  for (let i = 0; drift !== 0 && i < 20; i++) {
    const target = scaled[order[i % order.length]];
    if (drift > 0) { target.count += 1; drift -= 1; } else if (target.count > 1) { target.count -= 1; drift += 1; }
  }
  // A guess no target aims at has nothing to check it, so it is not kept.
  const aimed = new Set(scaled.map((target) => target.hypothesis));
  return { diagnosis: raw.diagnosis.trim().slice(0, 600) || `${profile.scopeLabel}의 기록에서 다시 풀어 볼 부분을 골랐어요.`,
    hypotheses: hypotheses.filter((hypothesis) => aimed.has(hypothesis.key)), targets: scaled };
}

const focusWords: Record<PlanTarget['focus'], string> = {
  confused: '이 학습자에게서 추측한 실수를 확인하는 문제를 쓴다. 그 실수를 하면 답이 바로 예상 오답이 되고, 하지 않으면 정답이 되게 한다.',
  weak: '아직 약한 개념을 다지는 문제를 쓴다. 쉬운 것에서 시작해 한 단계씩 어렵게 한다.',
  reinforce: '혼자 풀었던 개념을 다른 상황과 다른 수로 다시 확인하는 문제를 쓴다.',
};

export type WrittenSet = { problems: StoredProblem[]; reasons: Record<string, string>; predictions: Record<string, Prediction[]> };

/**
 * The writer's instructions are the same long text (about 14k tokens) for every target. Sent all
 * at once, every request misses the cache and writes it again at 1.25× the input price, which was
 * more than half of what a set cost (2026-10-21). So the first write goes alone and the others wait
 * for it, then read the cache at a tenth of the price. Only writes wait: the first target's solving
 * goes on meanwhile, and a first write that fails still lets the others go.
 */
export function warmingFirstWrite(model: ProblemModel): ProblemModel {
  let first: Promise<unknown> | null = null;
  return { ...model, write: (system, user) => {
    if (first) return first.then(() => model.write(system, user));
    const call = model.write(system, user);
    first = call.catch(() => undefined);
    return call;
  } };
}

/** Writes each target's questions and keeps what passes, in the plan's order. */
export async function writeForPlan(writer: ProblemModel, plan: PracticePlan, profile: Profile, record: LearnerRecord, setId: string): Promise<WrittenSet> {
  const model = warmingFirstWrite(writer);
  const written = await Promise.all(plan.targets.map(async (target) => {
    const concept = profile.concepts.find((item) => item.key === target.conceptKey)!;
    const guess = plan.hypotheses.find((hypothesis) => hypothesis.key === target.hypothesis);
    const lesson = record.lessons.find((item) => item.conceptKeys.includes(target.conceptKey)
      && scopeHolds(profile.scope, item))
      ?? record.lessons.find((item) => item.conceptKeys.includes(target.conceptKey));
    const course = record.courses.find((item) => item.key === lesson?.courseKey);
    // What the learner wrote: for a guess, the questions it came from; otherwise this concept's wrong first answers.
    const shownItems = guess ? profile.items.filter((item) => guess.evidence.includes(item.evidence.problemVersionId))
      : profile.items.filter((item) => item.evidence.conceptKeys.includes(target.conceptKey) && item.evidence.first.status === 'incorrect').reverse();
    const mistakes = shownItems.slice(0, 4).flatMap(({ evidence, problem }) => problem ? [{ prompt: plain(problem), wrote: said(problem, evidence.first.answer), answer: keyOf(problem) }] : []);
    const existing = profile.evidence.filter((item) => item.conceptKeys.includes(target.conceptKey)).slice(0, 10)
      .map((item) => ({ prompt: evidenceText(item).slice(0, 200), answer: '' }));
    // The names a kept question's expected wrong answer may carry: the catalogue's when the guess has
    // one, or this set's. Both are offered, so a guess matched to the wrong catalogue entry still gets
    // its questions — named for the set — rather than none.
    const aims = guess ? [guess.misconception, guess.key].filter(Boolean) : [];
    const result = await generateProblems(model, {
      conceptKeys: [target.conceptKey], misconceptions: guess?.misconception ? [guess.misconception] : [], count: target.count, form: 'mixed',
      ...(guess ? { hypotheses: [{ key: guess.key, mistake: guess.how ? `${guess.name} — ${guess.how}` : guess.name }] } : {}),
      note: `${focusWords[target.focus]} 이 문제를 내는 이유: ${target.reason}`, existing, mistakes,
    }, { courseTitle: course?.title ?? null, stage: course?.stage ?? null,
      lessonTitle: lesson?.title ?? concept.label, concepts: [{ key: concept.key, label: concept.label }] }).catch((reason: unknown) => {
      console.warn(JSON.stringify({ event: 'ai_practice_target_failed', reason: reason instanceof Error ? reason.message : String(reason) }));
      return null;
    });
    // A question aimed at a mistake must be able to show it, or answering it says nothing about the guess.
    return (result?.problems ?? []).filter((generated) => generated.verdict === 'verified'
      && (!aims.length || generated.problem.misreadings?.some((m) => aims.includes(m.misconception))))
      .slice(0, target.count).map((generated) => ({ problem: generated.problem, reason: target.reason, guess, aims }));
  }));
  const reasons: Record<string, string> = {};
  const predictions: Record<string, Prediction[]> = {};
  const problems = written.flat().map(({ problem, reason, guess, aims }, index) => {
    const named = renameProblem(structuredClone(problem), `${setId}:${index + 1}`);
    reasons[named.problemVersionId] = reason;
    if (guess) predictions[named.problemVersionId] = (named.misreadings ?? []).filter((m) => aims.includes(m.misconception)).map((m) => ({ answer: m.answer, hypothesis: guess.key }));
    // A guessed name stays with the set; the frozen question carries only the catalogue's names.
    const catalogued = (named.misreadings ?? []).filter((m) => !isHypothesisKey(m.misconception));
    if (catalogued.length) named.misreadings = catalogued; else delete named.misreadings;
    return stored(named);
  });
  return { problems, reasons, predictions };
}

/** Freezes what was written and opens it as this learner's own practice. Returns the recipient. */
export async function openPracticeSet(db: PrismaClient, userId: string, setId: string, scope: PracticeScope, label: string, plan: PracticePlan, written: WrittenSet): Promise<string> {
  return db.$transaction(async (tx) => {
    const learningScope = await tx.learningScope.findUniqueOrThrow({ where: { ownerUserId: userId } });
    await indexGeneratedProblems(tx, setId, written.problems);
    const now = new Date();
    const assignment = await tx.assignment.create({ data: {
      ownerScopeId: learningScope.id, title: `AI 맞춤 연습 · ${label}`, issuerType: 'self',
      policy: practicePolicy, schedule: {}, issuedAt: now,
      policySnapshot: { version: 1, audience: 'self-study', chosenBy: 'learner',
        ai: { scope: scopeKey(scope), scopeLabel: label, diagnosis: plan.diagnosis, reasons: written.reasons,
          hypotheses: plan.hypotheses.map(({ key, name }) => ({ key, name })), predictions: written.predictions } },
      items: { create: written.problems.map((problem, position) => ({ problemVersionId: problem.problemVersionId, position })) },
      recipients: { create: { learnerUserId: userId, recommendedAt: now, submissions: { create: { submissionIndex: 1 } } } },
    }, select: { recipients: { select: { id: true } } } });
    const recipientId = assignment.recipients[0].id;
    await tx.generatedProblemSet.update({ where: { id: setId }, data: { status: 'done', kept: written.problems.length,
      plan: { ...plan, reasons: written.reasons, predictions: written.predictions, recipientId } } });
    return recipientId;
  });
}

/** A new set's id. Every generated set's id starts the same way, so none is ever taken for a version. */
export const newSetId = () => `${generatedPrefix}${randomUUID()}`;
