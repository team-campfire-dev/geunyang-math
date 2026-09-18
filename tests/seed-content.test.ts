import { describe, expect, it } from 'vitest';
import curriculum from '../prisma/seed/fractions.json';
import dictionary from '../content/glossary-v2.json';
import { parseContentBundle, validateReferences } from '@/core/content-bundle';
import { definitionReferences, toPublicLesson } from '@/core/content';
import { createDatabase } from '@/server/db';
import { lessonRecord, verifyContent } from '@/server/content-store';
import { assembleLesson } from './fixtures/content';

const bundle = parseContentBundle({ ...curriculum, definitions: dictionary.definitions });
const records = bundle.lessons.map(lesson => assembleLesson(lesson, bundle.problemSets));

describe('atomic-concept curriculum', () => {
  it('publishes three lessons whose concepts and glossary refer to the same atomic identities', () => {
    expect(() => validateReferences(bundle)).not.toThrow();
    expect(bundle.concepts.map(c => c.label)).toEqual(['분수', '분자', '분모', '동치분수', '약분', '통분', '덧셈']);
    expect(bundle.concepts).toEqual(dictionary.concepts);
    expect(records).toHaveLength(3);
    expect(new Set(bundle.definitions.map(d => d.conceptKey))).toEqual(new Set(bundle.concepts.map(c => c.key)));
    for (const record of records) {
      const links = definitionReferences(record).map(ref => ref.conceptKey);
      for (const key of record.public.conceptKeys) expect(links).toContain(key);
      const blocks = record.sections.flatMap(section => section.contentBlocks);
      expect(blocks.some(block => block.kind === 'core.scene')).toBe(true);
      expect(blocks.some(block => ['core.figure', 'math.fraction_strip'].includes(block.kind))).toBe(false);
      expect(JSON.stringify(toPublicLesson(record, 'fractions'))).not.toContain('gradingSpec');
    }
  });
  it('distinguishes numerator from denominator evidence', () => {
    const practice = bundle.problemSets.find(set => set.problemSetId === 'fraction-meaning:practice')!.problems;
    const numerator = practice.find(p => p.conceptKeys.includes('numerator'))!;
    const denominator = practice.find(p => p.conceptKeys.includes('denominator'))!;
    // Each speaks for one concept only, so answering it is evidence about that concept and no other.
    expect(numerator.conceptKeys).toEqual(['numerator']);
    expect(denominator.conceptKeys).toEqual(['denominator']);
    // And they cannot be answered with the same number, or one answer would pass for both.
    expect(JSON.stringify(numerator.gradingSpec)).not.toEqual(JSON.stringify(denominator.gradingSpec));
  });
  it('asks the diagnostic about every concept the course teaches', () => {
    const diagnostics = bundle.problemSets.filter(set => set.problemSetId === 'starting-point');
    expect(diagnostics.length).toBeGreaterThan(0);
    for (const set of diagnostics) {
      expect(new Set(set.problems.flatMap(p => p.conceptKeys)), set.versionId).toEqual(new Set(bundle.concepts.map(c => c.key)));
    }
  });
});

const url = process.env.TEST_DATABASE_URL;
describe.skipIf(!url)('deployed curriculum on MySQL', () => {
  it('reads every seeded lesson back whole, with its concept definitions in place', async () => {
    const parsed = new URL(url!);
    if (parsed.protocol !== 'mysql:' || !parsed.pathname.endsWith('_test')) throw new Error('Use an isolated _test database.');
    const db = createDatabase(url!);
    try {
      for (const record of records) expect(await lessonRecord(db, record.public.versionId)).toEqual(record);
      expect(await db.conceptDefinition.count({ where: { scopeKind: 'global', conceptKey: { in: bundle.concepts.map(c => c.key) } } })).toBe(7);
      expect(await db.lessonVersion.count({ where: { lessonKey: { in: records.map(record => record.public.lessonKey) } } })).toBe(3);
      expect((await verifyContent(db)).lessons).toBeGreaterThanOrEqual(3);
    } finally { await db.$disconnect(); }
  });
});
