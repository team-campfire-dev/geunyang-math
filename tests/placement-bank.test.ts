import { readFileSync, readdirSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { parseContentBundle } from '@/core/content-bundle';
import { conceptGraph } from '@/core/concept-graph';
import { parseAnswer } from '@/shared/answer';
import { gradeAnswer } from '@/core/grading';
import type { StoredLesson } from '@/core/content';

/**
 * The bank the placement asks from.
 *
 * It used to ask about fractions only — thirteen questions for seven concepts — so the thirteen
 * concepts of the other three courses could never be settled by answering, however long a learner
 * kept going. The bank now reaches every concept the catalogue teaches, and it lives in a course of
 * its own because it belongs to none of them. That includes the courses beside the school line: a
 * learner is only asked about those when they say that is what they came for, but when they do say
 * so the bank has to be able to ask.
 */
const seeds = readdirSync('prisma/seed').filter((name) => name.endsWith('.json')).sort()
  .map((name) => ({ name, bundle: parseContentBundle(JSON.parse(readFileSync(`prisma/seed/${name}`, 'utf8'))) }));
const bundles = seeds.map((seed) => seed.bundle);
const lessons = bundles.flatMap((bundle) => (bundle.lessons as StoredLesson[]).map((lesson) => lesson.public));
// Several versions of the bank ship side by side, since a published one is never rewritten. The
// placement asks from the last one, so that is the one these rules are about.
const versions = bundles.flatMap((bundle) => bundle.diagnostics).filter((item) => item.diagnosticKey === 'catalogue-placement');
const definition = versions[versions.length - 1];
const set = bundles.flatMap((bundle) => bundle.problemSets).find((item) => item.versionId === definition.problemSet.problemSetVersionId)!;
const asked = definition.problemSet.problemVersionIds;
const problems = set.problems.filter((problem) => asked.includes(problem.problemVersionId));

describe('the placement bank', () => {
  it('asks about every concept the catalogue teaches, twice', () => {
    const graph = conceptGraph(lessons);
    const count = new Map<string, number>();
    for (const problem of problems) for (const key of problem.conceptKeys) count.set(key, (count.get(key) ?? 0) + 1);
    for (const key of graph.keys) {
      // Two is what readiness takes: one right answer is a guess away from being right.
      expect(count.get(key) ?? 0, `${key}를 묻는 문항이 모자란다`).toBeGreaterThanOrEqual(2);
    }
    expect([...count.keys()].filter((key) => !graph.keys.includes(key)), '가르치지 않는 개념을 묻는다').toEqual([]);
  });

  it('belongs to a course of its own, which holds no lessons and so never appears in the catalogue', () => {
    const placement = bundles.flatMap((bundle) => bundle.courses).find((course) => course.key === set.courseKey)!;
    expect(placement.lessons, '배치 과정에 수업이 있으면 수업 목록에 나온다').toEqual([]);
    expect(placement.diagnostics).toEqual([definition.diagnosticKey]);
    // And no lesson claims it, which is what keeps it out of the public catalogue.
    expect(lessons.some((lesson) => lesson.lessonKey && placement.lessons.length)).toBe(false);
  });

  it('shows neither hint nor worked solution, since a placement is not a lesson', () => {
    for (const problem of problems) {
      expect(problem.hintAvailable, problem.problemVersionId).toBe(false);
      expect(problem.hints, problem.problemVersionId).toHaveLength(0);
      expect(problem.solution, problem.problemVersionId).toHaveLength(0);
    }
  });

  it('marks its own answer key correct, and a wrong answer wrong', () => {
    for (const problem of problems) {
      // The bank asks by writing and by picking. A concept like 「어느 영역인가」 has no number for
      // an answer, and refusing it would mean the bank could not ask about it at all.
      if (problem.gradingSpec.kind === 'choice') {
        const spec = problem.gradingSpec;
        expect(gradeAnswer(spec.correct, spec, false).status, `${problem.problemVersionId}의 정답 ${spec.correct}`).toBe('correct');
        const other = spec.options.find((option) => option.id !== spec.correct)!.id;
        expect(gradeAnswer(other, spec, false).status, `${problem.problemVersionId}의 오답 ${other}`).toBe('incorrect');
        continue;
      }
      const spec = problem.gradingSpec as { kind: 'integer'; value: number } | { kind: 'rational'; numerator: number; denominator: number };
      const written = spec.kind === 'integer' ? String(spec.value)
        : spec.denominator === 1 ? String(spec.numerator) : `${spec.numerator}/${spec.denominator}`;
      expect(gradeAnswer(written, spec, false).status, `${problem.problemVersionId}의 정답 ${written}`).toBe('correct');
      expect(parseAnswer(written), problem.problemVersionId).not.toBeNull();
      const other = spec.kind === 'integer' ? String(spec.value + 1) : `${spec.numerator + 1}/${spec.denominator}`;
      expect(gradeAnswer(other, spec, false).status, `${problem.problemVersionId}의 오답 ${other}`).toBe('incorrect');
    }
  });

  it('never asks two questions about one concept that take the same answer', () => {
    const byConcept = new Map<string, string[]>();
    for (const problem of problems) {
      // A question that names several concepts is the shared one; it is compared under each of them.
      for (const key of problem.conceptKeys) byConcept.set(key, [...(byConcept.get(key) ?? []), JSON.stringify(problem.gradingSpec)]);
    }
    for (const [key, specs] of byConcept) {
      expect(new Set(specs).size, `${key}의 문항들이 같은 답을 받는다`).toBe(specs.length);
    }
  });

  it('leaves every earlier bank published exactly as it was', () => {
    const earlier = bundles.flatMap((bundle) => bundle.problemSets).find((item) => item.versionId === 'placement:v1')!;
    expect(earlier.problems).toHaveLength(39);
    expect(versions.map((item) => item.versionId)).toEqual(['placement-v4', 'placement-v5', 'placement-v6', 'placement-v7', 'placement-v8', 'placement-v9', 'placement-v10', 'placement-v11', 'placement-v12', 'placement-v13', 'placement-v14', 'placement-v15', 'placement-v16', 'placement-v17', 'placement-v18']);
  });

  it('leaves the fraction-only bank published exactly as it was', () => {
    const fractions = seeds.find((seed) => seed.name === 'fractions.json')!.bundle;
    const old = fractions.problemSets.find((item) => item.versionId === 'starting-point:v3')!;
    expect(old.problems).toHaveLength(13);
    expect(fractions.diagnostics.map((item) => item.versionId)).toContain('fraction-placement-v3');
  });
});
