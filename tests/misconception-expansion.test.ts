import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { parseContentBundle } from '@/core/content-bundle';
import { gradeAnswer } from '@/core/grading';
import { summarizeConfusion, type ConfusionObservation } from '@/core/confusion';
import { writtenAnswer } from './fixtures/content';

const courses = ['fractions', 'ratios', 'decimals', 'integers', 'expressions', 'equations', 'factors', 'factorization'];
const bundles = courses.map(name => parseContentBundle(JSON.parse(readFileSync(`prisma/seed/${name}.json`, 'utf8'))));
const problems = new Map(bundles.flatMap(bundle => bundle.problemSets.flatMap(set => set.problems)).map(problem => [problem.problemVersionId, problem]));
const problem = (id: string) => {
  const found = problems.get(id);
  if (!found) throw new Error(`Missing regression question: ${id}`);
  return found;
};

// Independently reproduce representative wrong procedures; an arbitrary wrong number is not a diagnosis.
const procedures = [
  ['fractions:drill-14:v1', `${1 + 1}/6`, 'keep-numerators-on-common'],
  ['ratio-meaning:practice-2:v1', `${20}/${5}`, 'reverse-ratio'],
  ['ratios:drill-4:v1', `${8}/${20 - 8}`, 'part-over-part'],
  ['percentage-of:practice-1:v1', String(5000 * 20), 'percent-as-count'],
  ['percentage-of:practice-2:v1', String(30000 * 10 / 100), 'part-instead-of-total'],
  ['decimal-addition:practice-2:v1', `${102 + 35}/100`, 'decimal-place-shift'],
  ['signed-addition:homework-2:v1', `${-1 + 1}/${2 + 4}`, 'add-denominators'],
  ['expression-value:practice-1:v1', String(3 + 4 - 5), 'product-as-sum'],
  ['linear-expression:practice-3:v1', '2', 'distribute-first-term-only'],
  ['linear-expression:homework-1:v1', '-5', 'sign-on-distribute'],
  ['equation-meaning:practice-1:v1', String(10 + 6), 'move-without-sign'],
  ['equation-meaning:practice-3:v1', String(14 - 2), 'move-a-factor'],
  ['linear-equation:homework-1:v1', String(2 / (3 - 1)), 'distribute-first-term-only'],
  ['prime-factorization:practice-3:v1', String(3 * 2), 'divisor-count-without-one'],
  ['prime-factorization:practice-3:v1', String((3 + 1) + (2 + 1)), 'add-divisor-counts'],
  ['gcd-lcm:practice-1:v2', '36', 'gcd-lcm-swapped'],
  ['gcd-lcm:practice-2:v2', String(12 * 18), 'product-as-lcm'],
  ['common-factor:practice-1:v1', '9', 'forgets-to-divide-inside'],
  ['factorization:drill-6:v1', '0', 'square-termwise'],
] as const;

describe('expanded misconception annotations', () => {
  it.each(procedures)('reads the wrong procedure in %s', (id, answer, misconception) => {
    const p = problem(id);
    expect(gradeAnswer(answer, p.gradingSpec, false, p.misreadings)).toMatchObject({ status: 'incorrect', misconception });
    expect(gradeAnswer(writtenAnswer(p), p.gradingSpec, false, p.misreadings)).toMatchObject({ status: 'correct' });
  });

  it('does not change grades, including accepted equivalent forms and invalid inputs', () => {
    for (const p of problems.values()) {
      const answers = [...(p.misreadings ?? []).map(item => item.answer), writtenAnswer(p), '0.5', '1/2', 'not an answer'];
      for (const answer of answers) {
        expect(gradeAnswer(answer, p.gradingSpec, false, p.misreadings).status, `${p.problemVersionId}: ${answer}`)
          .toBe(gradeAnswer(answer, p.gradingSpec).status);
      }
    }
  });

  it('uses the grading rule rather than prose to distinguish unreduced correct and incorrect answers', () => {
    const flexible = problem('fraction-equivalence:practice-2:v3');
    const reduced = problem('decimals:drill-7:v1');
    expect(gradeAnswer('6/9', flexible.gradingSpec, false, flexible.misreadings).status).toBe('correct');
    for (const answer of ['25/100', '2/8', '0.25']) {
      expect(gradeAnswer(answer, reduced.gradingSpec, false, reduced.misreadings)).toMatchObject({ status: 'incorrect', misconception: 'stop-reducing-early' });
    }
    expect(gradeAnswer('1/4', reduced.gradingSpec, false, reduced.misreadings).status).toBe('correct');
    expect(gradeAnswer('0.4', problem('percentage-meaning:practice-1:v1').gradingSpec).status).toBe('invalid');
  });

  it('keeps every diagnostic bank free of practice annotations', () => {
    for (const bundle of bundles) {
      const banks = new Set(bundle.diagnostics.map(item => item.problemSet.problemSetVersionId));
      for (const set of bundle.problemSets.filter(item => banks.has(item.versionId))) {
        expect(set.problems.every(item => !item.misreadings?.length), set.versionId).toBe(true);
      }
    }
  });

  it('lets historical unlabelled answers become a repeated pattern in the new summary', () => {
    const observations: ConfusionObservation[] = ['linear-expression:practice-3:v1', 'linear-expression:check-1:v1'].map((id, index) => ({
      id: `old-${index}`, problem: problem(id), answer: index === 0 ? '2' : '4',
      result: { status: 'incorrect', message: 'old feedback', assisted: false }, hintUsed: false,
      createdAt: new Date(Date.UTC(2026, 8, index + 1)), check: true, delayed: false,
      source: { kind: 'lesson', id: 'old-enrollment', title: '일차식의 계산', lessonKey: 'linear-expression' },
    }));
    const result = summarizeConfusion(observations, [], []);
    expect(result.repeated).toMatchObject([{ kind: 'misconception', key: 'distribute-first-term-only', status: 'repeated' }]);
    expect(observations.every(item => !item.result.misconception)).toBe(true);
  });
});
