import 'server-only';
import { randomUUID } from 'node:crypto';
import type { Prisma, PrismaClient } from '@prisma/client';
import { z } from 'zod';
import { practicePolicy } from '@/core/assignment';
import type { StoredProblem } from '@/core/content';
import { aiPracticeLimits, scopeConcepts, scopeEvidence, scopeKey, type PracticeScope } from '@/shared/ai-practice';
import type { ConceptState, PublicLesson } from '@/shared/api';
import { renameProblem } from '@/shared/authoring';
import type { ConfusionEvidence, ConfusionSummary } from '@/shared/confusion';
import { misconceptionOf } from '@/shared/misconception';
import { generatedPrefix, indexGeneratedProblems, publishedProblemRecords } from './content-store';
import { keyOf, plain, said, stored } from './learner-generation';
import { generateProblems, type ProblemModel } from './problem-generation';
import { plannerSystem } from './problem-prompts';

/**
 * AI 맞춤 연습. A model reads a learner's record over a range and decides what to practise; the
 * writer, the solver and the checker then do for each thing what they do for any question.
 *
 * The record is not read raw. The server sums it up first — each concept's state, the mistakes that
 * repeat, the questions answered wrongly with what was written — so the model reads what the
 * learning record already says rather than inventing its own measure of it, and it may only pick
 * concepts that summary names. What it says to the learner (the diagnosis, a reason per question)
 * is stored with the set, because the learner reads it beside questions that are frozen.
 */

/** What the planner returns, as the response format constrains it. */
export const planSchema = z.object({
  diagnosis: z.string(),
  targets: z.array(z.object({
    conceptKey: z.string(),
    focus: z.enum(['confused', 'weak', 'reinforce']),
    misconception: z.string(),
    reason: z.string(),
    count: z.number(),
  })),
});
export type PracticePlan = z.infer<typeof planSchema>;
export type PlanTarget = PracticePlan['targets'][number];

/** What the learning service already knows, handed in so this does not work it out again. */
export type LearnerRecord = {
  summary: ConfusionSummary;
  concepts: { key: string; label: string; state: ConceptState }[];
  lessons: PublicLesson[];
  courses: { key: string; title: string }[];
};

type ProfileConcept = { key: string; label: string; state: ConceptState; right: number; wrong: number };
export type Profile = {
  scope: PracticeScope; scopeLabel: string; evidence: ConfusionEvidence[];
  concepts: ProfileConcept[];
  repeated: { kind: 'misconception' | 'misreading'; key: string; label: string; status: string; problems: number }[];
  wrong: { evidence: ConfusionEvidence; problem: StoredProblem | undefined }[];
};

export function scopeLabel(scope: PracticeScope, record: Pick<LearnerRecord, 'lessons' | 'courses'>): string {
  if (scope.kind === 'all') return '전체 기록';
  if (scope.kind === 'course') return record.courses.find((course) => course.key === scope.key)?.title ?? scope.key;
  return record.lessons.find((lesson) => lesson.lessonKey === scope.key)?.title ?? scope.key;
}

/**
 * The record over one range, summed up for a reader. Null when the range holds too few first
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
  const wrongEvidence = evidence.filter((item) => item.first.status === 'incorrect')
    .sort((a, b) => b.first.createdAt.localeCompare(a.first.createdAt)).slice(0, 12);
  const problems = await publishedProblemRecords(db, wrongEvidence.map((item) => item.problemVersionId));
  return { scope, scopeLabel: scopeLabel(scope, record), evidence, concepts, repeated,
    wrong: wrongEvidence.map((item) => ({ evidence: item, problem: problems.get(item.problemVersionId) })) };
}

const stateWords: Record<ConceptState, string> = { unknown: '아직 확인 전', practicing: '연습하는 중', independent: '스스로 해결', retained: '꾸준히 기억' };
const evidenceText = (item: ConfusionEvidence) => item.promptContent.map((block) => String(block.payload.text ?? '')).join(' ').trim();

/** The profile as the planner reads it. Keys are shown in brackets because the plan must name them. */
export function plannerRequest(profile: Profile): string {
  const lines = [`범위: ${profile.scopeLabel}`, `첫 답 수: ${profile.evidence.length}문제`, '', '개념별 상태:'];
  for (const concept of profile.concepts) {
    lines.push(`- ${concept.label} [${concept.key}]: ${stateWords[concept.state]}, 첫 답 맞음 ${concept.right} · 틀림 ${concept.wrong}`);
  }
  if (profile.repeated.length) {
    lines.push('', '되풀이된 실수(서로 다른 문제의 첫 답):');
    for (const item of profile.repeated) {
      lines.push(`- ${item.label}${item.kind === 'misconception' ? ` [${item.key}]` : ' (답의 모양으로 읽은 실수)'}: ${item.problems}문제, ${item.status === 'repeated' ? '아직 되풀이됨' : '최근에는 나아짐'}`);
    }
  }
  if (profile.wrong.length) {
    lines.push('', '최근 첫 답이 틀린 문제:');
    profile.wrong.forEach(({ evidence, problem }, index) => {
      const labels = evidence.conceptKeys.map((key) => profile.concepts.find((concept) => concept.key === key)?.label).filter(Boolean).join(', ');
      const wrote = problem ? said(problem, evidence.first.answer) : evidence.first.answer;
      lines.push(`${index + 1}. [${labels}] ${evidenceText(evidence).slice(0, 200)} → 학습자: ${wrote}${problem ? ` (정답: ${keyOf(problem)})` : ''}${evidence.first.signal ? ` · 읽힌 실수: ${evidence.first.signal.label}` : ''}`);
    });
  }
  return lines.join('\n');
}

/**
 * The plan as the server will act on it. Only concepts the profile names and mistakes the catalogue
 * knows survive; the counts are made to add up to what a set holds. When nothing the model said can
 * be used, the record itself decides — the concepts answered wrongly most — rather than failing.
 */
export function settlePlan(raw: PracticePlan, profile: Profile): PracticePlan {
  const known = new Set(profile.concepts.map((concept) => concept.key));
  const seen = new Set<string>();
  let targets = raw.targets.flatMap((target) => {
    const conceptKey = target.conceptKey.trim();
    const misconception = misconceptionOf(target.misconception.trim()) ? target.misconception.trim() : '';
    const id = `${conceptKey}/${misconception}`;
    if (!known.has(conceptKey) || seen.has(id)) return [];
    seen.add(id);
    return [{ ...target, conceptKey, misconception, reason: target.reason.trim().slice(0, 200), count: Math.max(1, Math.round(target.count) || 1) }];
  }).slice(0, aiPracticeLimits.maxTargets);
  if (!targets.length) {
    targets = profile.concepts.filter((concept) => concept.wrong > 0 || concept.state === 'practicing').slice(0, 2)
      .map((concept) => ({ conceptKey: concept.key, focus: 'weak' as const, misconception: '', count: 1,
        reason: `「${concept.label}」에서 첫 답이 틀린 문제가 있었어요. 다른 숫자로 다시 풀어 봐요.` }));
    if (!targets.length && profile.concepts[0]) targets = [{ conceptKey: profile.concepts[0].key, focus: 'reinforce', misconception: '', count: 1,
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
  return { diagnosis: raw.diagnosis.trim().slice(0, 600) || `${profile.scopeLabel}의 기록에서 다시 풀어 볼 부분을 골랐어요.`, targets: scaled };
}

const focusWords: Record<PlanTarget['focus'], string> = {
  confused: '이 학습자가 헷갈린 부분을 다시 드러내는 문제를 쓴다. 그 실수를 하면 답이 바로 그 값이 되게 한다.',
  weak: '아직 약한 개념을 다지는 문제를 쓴다. 쉬운 것에서 시작해 한 단계씩 어렵게 한다.',
  reinforce: '혼자 풀었던 개념을 다른 상황과 다른 수로 다시 확인하는 문제를 쓴다.',
};

export type WrittenSet = { problems: StoredProblem[]; reasons: Record<string, string> };

/** Writes each target's questions and keeps what passes, in the plan's order. */
export async function writeForPlan(model: ProblemModel, plan: PracticePlan, profile: Profile, record: LearnerRecord, setId: string): Promise<WrittenSet> {
  const written = await Promise.all(plan.targets.map(async (target) => {
    const concept = profile.concepts.find((item) => item.key === target.conceptKey)!;
    const lesson = record.lessons.find((item) => item.conceptKeys.includes(target.conceptKey)
      && (profile.scope.kind === 'all' || (profile.scope.kind === 'lesson' ? item.lessonKey === profile.scope.key : item.courseKey === profile.scope.key)))
      ?? record.lessons.find((item) => item.conceptKeys.includes(target.conceptKey));
    const mistakes = profile.wrong.filter(({ evidence }) => evidence.conceptKeys.includes(target.conceptKey))
      .sort((a, b) => Number(b.evidence.first.signal?.key === target.misconception) - Number(a.evidence.first.signal?.key === target.misconception))
      .slice(0, 4).flatMap(({ evidence, problem }) => problem ? [{ prompt: plain(problem), wrote: said(problem, evidence.first.answer), answer: keyOf(problem) }] : []);
    const existing = profile.evidence.filter((item) => item.conceptKeys.includes(target.conceptKey)).slice(0, 10)
      .map((item) => ({ prompt: evidenceText(item).slice(0, 200), answer: '' }));
    const result = await generateProblems(model, {
      conceptKeys: [target.conceptKey], misconceptions: target.misconception ? [target.misconception] : [], count: target.count, form: 'mixed',
      note: `${focusWords[target.focus]} 이 문제를 내는 이유: ${target.reason}`, existing, mistakes,
    }, { courseTitle: record.courses.find((course) => course.key === lesson?.courseKey)?.title ?? null,
      lessonTitle: lesson?.title ?? concept.label, concepts: [{ key: concept.key, label: concept.label }] }).catch((reason: unknown) => {
      console.warn(JSON.stringify({ event: 'ai_practice_target_failed', reason: reason instanceof Error ? reason.message : String(reason) }));
      return null;
    });
    // A question aimed at a named mistake must be able to record it, or answering it says nothing about it.
    return (result?.problems ?? []).filter((generated) => generated.verdict === 'verified'
      && (!target.misconception || generated.problem.misreadings?.some((m) => m.misconception === target.misconception)))
      .slice(0, target.count).map((generated) => ({ problem: generated.problem, reason: target.reason }));
  }));
  const reasons: Record<string, string> = {};
  const problems = written.flat().map(({ problem, reason }, index) => {
    const named = stored(renameProblem(structuredClone(problem), `${setId}:${index + 1}`));
    reasons[named.problemVersionId] = reason;
    return named;
  });
  return { problems, reasons };
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
        ai: { scope: scopeKey(scope), scopeLabel: label, diagnosis: plan.diagnosis, reasons: written.reasons } },
      items: { create: written.problems.map((problem, position) => ({ problemVersionId: problem.problemVersionId, position })) },
      recipients: { create: { learnerUserId: userId, recommendedAt: now, submissions: { create: { submissionIndex: 1 } } } },
    }, select: { recipients: { select: { id: true } } } });
    const recipientId = assignment.recipients[0].id;
    await tx.generatedProblemSet.update({ where: { id: setId }, data: { status: 'done', kept: written.problems.length,
      plan: { ...plan, reasons: written.reasons, recipientId } } });
    return recipientId;
  });
}

/** A new set's id. Every generated set's id starts the same way, so none is ever taken for a version. */
export const newSetId = () => `${generatedPrefix}${randomUUID()}`;
