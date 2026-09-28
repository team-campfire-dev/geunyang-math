import { readFileSync, readdirSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { parseContentBundle, validateReferences } from '@/core/content-bundle';
import { toPublicLesson } from '@/core/content';
import { gradeAnswer } from '@/core/grading';
import { assembleLesson } from './fixtures/content';

const foundationConcepts = readdirSync('prisma/seed').filter(name => name.endsWith('.json')).flatMap(name => JSON.parse(readFileSync(`prisma/seed/${name}`, 'utf8')).concepts);
const dictionary = JSON.parse(readFileSync('content/glossary-v43.json', 'utf8'));
const bundles = ['numeracy', 'applied', 'statistics', 'data'].map(name =>
  parseContentBundle({ ...JSON.parse(readFileSync(`prisma/seed/ncs-${name}.json`, 'utf8')), definitions: dictionary.definitions }));
const lessons = bundles.flatMap(bundle => bundle.lessons);
const sets = bundles.flatMap(bundle => [...new Map(bundle.problemSets.map(set => [set.problemSetId, set])).values()]);
const problems = sets.flatMap(set => set.problems);
const problem = (key: string) => problems.find(p => p.problemVersionId.startsWith(`${key}:v`))!;
const lesson = (key: string) => lessons.find(l => l.public.lessonKey === key)!;

// These guard the audited learning failures: missing source data, missing explanations and
// questions that only repeated rules instead of asking the learner to use the taught concept.
describe('NCS teaching and independent practice', () => {
  it('resolves every lesson, question and dictionary link, and exposes available solutions', () => {
    for (const bundle of bundles) {
      // The shared dictionary also names concepts taught in the other NCS courses.
      const allConcepts = [...new Map([...foundationConcepts, ...dictionary.concepts, ...bundle.concepts].map(c => [c.key, c])).values()];
      expect(() => validateReferences({ ...bundle, concepts: allConcepts })).not.toThrow();
      for (const stored of bundle.lessons) {
        const document = toPublicLesson(assembleLesson(stored, bundle.problemSets), bundle.courses[0].key);
        expect(document.problems.length).toBeGreaterThan(0);
        expect(document.problems.every(p => p.solutionAvailable), stored.public.lessonKey).toBe(true);
        expect(JSON.stringify(document)).not.toContain('gradingSpec');
      }
    }
    for (const p of problems) {
      expect(p.solution.length, p.problemVersionId).toBeGreaterThan(0);
      expect(p.hints.length, p.problemVersionId).toBeGreaterThan(0);
    }
  });

  it('keeps the source table or graph on the worked example screen', () => {
    for (const [key, kind] of [
      ['ncs-data-reading', 'core.table'], ['ncs-data-change', 'core.table'],
      ['ncs-data-compare', 'core.table'], ['ncs-chart-basics', 'core.table'],
      ['ncs-condition', 'core.table'], ['ncs-graph', 'core.scene'],
    ]) {
      const example = lesson(key).sections.find(section => section.role === 'worked_example')!;
      expect(example.contentBlocks.some(block => block.kind === kind), key).toBe(true);
    }
  });

  it('requires actual graph reading, including units and a stacked segment', () => {
    for (const [key, answer, commonMistake] of [
      ['ncs-graph:practice-2', '20000', '20'], ['ncs-graph:check-1', '60', '100'],
      ['ncs-graph:check-2', '2.5', '21'],
    ]) {
      const p = problem(key);
      expect(p.promptContent.some(block => block.kind === 'core.scene'), key).toBe(true);
      expect(gradeAnswer(answer, p.gradingSpec).status).toBe('correct');
      expect(gradeAnswer(commonMistake, p.gradingSpec).status).toBe('incorrect');
    }
  });

  it('assesses compound interest and spread by calculation', () => {
    for (const [key, answer, commonMistake] of [
      ['ncs-interest:check-3', '121', '120'], ['ncs-interest:homework-3', '42', '242'],
      ['ncs-spread:practice-4', '4', '0'], ['ncs-spread:check-3', '3', '9'],
    ]) {
      const p = problem(key);
      expect(gradeAnswer(answer, p.gradingSpec).status, key).toBe('correct');
      expect(gradeAnswer(commonMistake, p.gradingSpec).status, key).toBe('incorrect');
    }
  });

  it('selects a supplier from actual constraints and from weighted evaluation scores', () => {
    for (const key of ['ncs-condition:practice-1', 'ncs-condition:check-2']) {
      const p = problem(key);
      expect(p.promptContent.some(block => block.kind === 'core.table')).toBe(true);
      const spec = p.responseSpec;
      expect(spec.kind).toBe('choice');
      if (spec.kind !== 'choice' || !spec.options) throw new Error('Expected supplier choices');
      const correct = spec.options.find(option => option.text === 'C업체')!;
      const wrong = spec.options.find(option => option.text === 'A업체')!;
      expect(gradeAnswer(correct.id, p.gradingSpec).status).toBe('correct');
      expect(gradeAnswer(wrong.id, p.gradingSpec).status).toBe('incorrect');
    }
  });
});
