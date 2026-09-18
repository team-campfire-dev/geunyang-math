import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { conceptReadiness, recommend } from '@/core/personalization';
import { parseContentBundle } from '@/core/content-bundle';
import type { DiagnosticAnswer, PublicLesson } from '@/shared/api';

/**
 * Whether the starting-point diagnostic can actually place someone. It could not: `conceptReadiness`
 * only calls a concept ready when the diagnostic asked about it **twice**, and five of the seven
 * concepts had one question each, so a perfect score left every lesson unknown and recommended the
 * first one — exactly what a learner who skipped the diagnostic gets.
 */
// Answer keys live in the platform seed and nowhere else; `content/` bundles carry no answers.
const seedFile = readFileSync('prisma/seed/fractions.json', 'utf8');
const bundle = parseContentBundle(JSON.parse(seedFile));
const seed = JSON.parse(seedFile);
const diagnostic = bundle.diagnostics.at(-1)!;
const questionSet = bundle.problemSets.find((set) => set.versionId === diagnostic.problemSet.problemSetVersionId)!;
const lessons: PublicLesson[] = seed.lessons.map((lesson: { public: PublicLesson }) => lesson.public);
const labels = Object.fromEntries(seed.concepts.map((concept: { key: string; label: string }) => [concept.key, concept.label]));
const questions = questionSet.problems.map((problem) => ({ problemVersionId: problem.problemVersionId, conceptKeys: problem.conceptKeys }));
const answering = (decide: (conceptKeys: string[]) => DiagnosticAnswer['status']): DiagnosticAnswer[] =>
  questions.map((question) => ({ problemVersionId: question.problemVersionId, status: decide(question.conceptKeys) } as DiagnosticAnswer));
const advise = (answers: DiagnosticAnswer[] | null, goal: 'foundation-recovery' | 'algebra-ready' = 'foundation-recovery') => recommend({
  lessons, enrollments: [], assignments: [], dailyMinutes: 10, goal, now: new Date(),
  readiness: conceptReadiness(labels, answers ? { answers, problems: questions } : null, []),
}).recommendations[0];
const suggest = (answers: DiagnosticAnswer[] | null) => advise(answers)?.lessonKey;
const readinessOf = (answers: DiagnosticAnswer[]) => conceptReadiness(labels, { answers, problems: questions }, []);

describe('the starting-point diagnostic', () => {
  it('asks about every concept at least twice, which is what readiness needs', () => {
    const asked = new Map<string, number>();
    for (const question of questions) for (const key of question.conceptKeys) asked.set(key, (asked.get(key) ?? 0) + 1);
    const taught = [...new Set(lessons.flatMap((lesson) => [...lesson.conceptKeys, ...lesson.prerequisiteConceptKeys]))];
    // One question is a guess away from being right, so one question never makes a concept ready.
    for (const key of taught) expect(asked.get(key) ?? 0, `${key}는 진단 문항이 둘 이상이어야 한다`).toBeGreaterThanOrEqual(2);
  });

  it('lets a perfect score mean something, which it could not before', () => {
    const perfect = answering(() => 'correct');
    // Every concept the course teaches is now shown, where before none of them could be.
    expect(readinessOf(perfect).every((item) => item.readiness === 'ready')).toBe(true);

    const everything = advise(perfect);
    const nothing = advise(null);
    // The course is three lessons long and linear, so someone who knows all of it has nowhere
    // further to go; the rules send them to a lesson to apply it. What changed is that the screen
    // no longer tells them they have not shown the very concepts they just showed.
    expect(nothing!.reason).toMatch(/아직 충분히 확인하지 않았어요/);
    expect(everything!.reason).not.toBe(nothing!.reason);
    expect(everything!.reason).toMatch(/확인한 기초/);
    // And with the other goal the diagnostic now moves the lesson itself.
    expect(advise(perfect, 'algebra-ready')!.lessonKey).toBe('fraction-addition');
    expect(advise(null, 'algebra-ready')!.lessonKey).toBe('fraction-meaning');
  });

  it('sends someone to the first lesson whose concepts they have not shown', () => {
    const knows = (keys: string[]) => (conceptKeys: string[]) => conceptKeys.every((key) => keys.includes(key)) ? 'correct' as const : 'skipped' as const;
    expect(suggest(answering(knows(['fraction', 'numerator', 'denominator'])))).toBe('fraction-equivalence');
    expect(suggest(answering(knows(['fraction', 'numerator', 'denominator', 'equivalent-fraction', 'reduce'])))).toBe('fraction-addition');
  });

  it('keeps someone at a concept they got wrong even when they knew the rest', () => {
    const oneWrong = answering((conceptKeys) => conceptKeys.includes('denominator') ? 'incorrect' : 'correct');
    expect(suggest(oneWrong)).toBe('fraction-meaning');
  });

  it('holds its answers to the shape the publisher accepts', () => {
    expect(diagnostic.problemSet.problemVersionIds).toHaveLength(13);
    expect(diagnostic.diagnosticKey).toBe('starting-point');
    // The version it replaces stays exactly as it was published.
    expect(bundle.diagnostics.find((item) => item.versionId === 'fraction-placement-v2')!.problemSet.problemVersionIds).toHaveLength(8);
    // Questions carry no hints or worked solutions: a diagnostic shows neither.
    for (const problem of questionSet.problems) {
      expect(problem.hintAvailable).toBe(false);
      expect(problem.hints).toHaveLength(0);
    }
  });
});
