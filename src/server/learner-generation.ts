import 'server-only';
import { randomUUID } from 'node:crypto';
import type { PrismaClient } from '@prisma/client';
import { parseAssignmentPolicy } from '@/core/assignment';
import type { StoredProblem } from '@/core/content';
import { gradeAnswer } from '@/core/grading';
import { answerText } from '@/shared/answer';
import type { GradeResult } from '@/shared/api';
import { renameProblem, responseSpecOf, type DraftProblem } from '@/shared/authoring';
import { misconceptionOf } from '@/shared/misconception';
import { generatedPrefix, indexGeneratedProblems, publishedProblemRecords } from './content-store';
import { generateProblems, type ProblemModel } from './problem-generation';

/**
 * Questions a model writes for one learner, to fill a set gathered for one mistake.
 *
 * 「이것만 모아 풀기」 first takes what the catalogue already has — questions people wrote and
 * named for that mistake. Only when that comes to fewer than a set holds does a model write the
 * rest, and it writes from this learner's own wrong answers: what they were asked and what they
 * wrote. The same three steps as the editor's — write, solve from the prompt alone, check — and
 * here only `verified` survives, because no author reads these before a learner does. A question is
 * kept only if one of its expected wrong answers is named for the very mistake it is meant to
 * catch; otherwise answering it wrongly would say nothing about that mistake.
 *
 * What is kept is frozen before anyone answers it (PublishedProblem rows of kind 'generated'), so
 * a wrong answer to it keeps its meaning. It is this learner's alone.
 */

/** Requests a learner may cause a day. Every request costs, including one where nothing passed. */
export const dailyGenerations = 5;
/** How many of the learner's wrong answers the writer reads. */
const shownMistakes = 4;

type Db = PrismaClient;
export type LearnerGeneration = { problemVersionIds: string[]; reason?: 'limit' | 'no-evidence' | 'failed' };

const plain = (problem: StoredProblem) => problem.promptContent.map((block) => String(block.payload.text ?? '')).join(' ').trim();
/** An answer as words a model can read: a picked option is its text, not its name. */
function said(problem: StoredProblem, answer: string): string {
  const spec = problem.gradingSpec;
  return spec.kind === 'choice' ? spec.options.find((option) => option.id === answer)?.text ?? answer : answer;
}
const keyOf = (problem: StoredProblem) => {
  const spec = problem.gradingSpec;
  return spec.kind === 'choice' ? spec.options.find((option) => option.id === spec.correct)?.text ?? spec.correct : answerText(spec);
};

/**
 * The learner's wrong answers that were this mistake, newest first, read the way the confusion
 * summary reads them: with today's names on the question's frozen grading rule. A grade an exam is
 * still holding back is not read — the learner has not been told it.
 */
async function mistakesOf(db: Db, userId: string, misconception: string) {
  const attempts = await db.attempt.findMany({ where: { userId }, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    select: { problemVersionId: true, answer: true, hintUsed: true, result: true,
      submission: { select: { status: true, recipient: { select: { assignment: { select: { policy: true } } } } } } } });
  const wrong = attempts.filter((attempt) => (attempt.result as GradeResult).status === 'incorrect'
    && !(attempt.submission && attempt.submission.status !== 'submitted'
      && parseAssignmentPolicy(attempt.submission.recipient.assignment.policy).results === 'after-submission'));
  const problems = await publishedProblemRecords(db, [...new Set(wrong.map((attempt) => attempt.problemVersionId))]);
  const seen = new Set<string>();
  const found: { problem: StoredProblem; answer: string }[] = [];
  for (const attempt of wrong) {
    const problem = problems.get(attempt.problemVersionId);
    if (!problem || seen.has(problem.problemVersionId)) continue;
    if (gradeAnswer(attempt.answer, problem.gradingSpec, attempt.hintUsed, problem.misreadings).misconception !== misconception) continue;
    seen.add(problem.problemVersionId);
    found.push({ problem, answer: attempt.answer });
  }
  return found;
}

/** The course a question was published in, so what is written stays at that level. */
async function courseOf(db: Db, problemVersionId: string) {
  const owner = await db.publishedProblem.findFirst({ where: { problemVersionId, ownerKind: 'problem_set' }, orderBy: { ownerVersionId: 'asc' }, select: { ownerVersionId: true } });
  if (!owner) return null;
  const version = await db.problemSetVersion.findUnique({ where: { id: owner.ownerVersionId },
    select: { problemSet: { select: { course: { select: { key: true, title: true } } } } } });
  return version?.problemSet.course ?? null;
}

/** A checked question as it is frozen: the editor's shape with the half a learner sees worked out. */
const stored = (problem: DraftProblem): StoredProblem => ({
  problemVersionId: problem.problemVersionId, conceptKeys: problem.conceptKeys, promptContent: problem.promptContent,
  responseSpec: responseSpecOf(problem.gradingSpec), hintAvailable: problem.hints.length > 0,
  gradingSpec: problem.gradingSpec, hints: problem.hints, solution: problem.solution,
  ...(problem.misreadings?.length ? { misreadings: problem.misreadings } : {}),
});

/**
 * Writes up to `needed` questions for `misconception` and freezes the ones that pass. `beside` is
 * what the set already holds, so the new ones neither repeat it nor share its answers. Returns the
 * names of the questions kept; a failure of the model is not the learner's problem, so it returns
 * nothing and says why rather than throwing.
 */
export async function generateForLearner(db: Db, model: ProblemModel, userId: string, misconception: string, needed: number, beside: string[]): Promise<LearnerGeneration> {
  const record = misconceptionOf(misconception);
  if (!record || needed < 1) return { problemVersionIds: [] };
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000);
  if (await db.generatedProblemSet.count({ where: { userId, createdAt: { gte: since } } }) >= dailyGenerations) return { problemVersionIds: [], reason: 'limit' };
  const mistakes = (await mistakesOf(db, userId, misconception)).slice(0, shownMistakes);
  const conceptKeys = [...new Set(mistakes.flatMap(({ problem }) => problem.conceptKeys))].slice(0, 10);
  if (!mistakes.length || !conceptKeys.length) return { problemVersionIds: [], reason: 'no-evidence' };
  const [concepts, course, besideProblems] = await Promise.all([
    db.concept.findMany({ where: { key: { in: conceptKeys } }, select: { key: true, label: true } }),
    courseOf(db, mistakes[0].problem.problemVersionId),
    publishedProblemRecords(db, beside),
  ]);
  const known = conceptKeys.filter((key) => concepts.some((concept) => concept.key === key));
  let result;
  try {
    result = await generateProblems(model, {
      conceptKeys: known, misconceptions: [misconception], count: needed, form: 'mixed', note: '',
      existing: [...mistakes.map(({ problem }) => problem), ...besideProblems.values()].map((problem) => ({ prompt: plain(problem), answer: keyOf(problem) })),
      mistakes: mistakes.map(({ problem, answer }) => ({ prompt: plain(problem), wrote: said(problem, answer), answer: keyOf(problem) })),
    }, { courseTitle: course?.title ?? null, lessonTitle: `「${record.label}」 다시 연습하기`,
      concepts: known.map((key) => concepts.find((concept) => concept.key === key)!) });
  } catch (reason) {
    console.warn(JSON.stringify({ event: 'learner_generation_failed', reason: reason instanceof Error ? reason.message : String(reason) }));
    return { problemVersionIds: [], reason: 'failed' };
  }
  const setId = `${generatedPrefix}${randomUUID()}`;
  const kept = result.problems
    .filter((generated) => generated.verdict === 'verified' && generated.problem.misreadings?.some((m) => m.misconception === misconception))
    .slice(0, needed)
    .map((generated, index) => stored(renameProblem(structuredClone(generated.problem), `${setId}:${index + 1}`)));
  await db.$transaction(async (tx) => {
    await tx.generatedProblemSet.create({ data: { id: setId, userId, misconception, courseKey: course?.key ?? null,
      model: result.model, requested: needed, kept: kept.length } });
    await indexGeneratedProblems(tx, setId, kept);
  });
  console.info(JSON.stringify({ event: 'learner_generation', misconception, requested: needed, written: result.problems.length,
    verified: result.problems.filter((generated) => generated.verdict === 'verified').length, kept: kept.length }));
  return { problemVersionIds: kept.map((problem) => problem.problemVersionId) };
}
