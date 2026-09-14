import { describe, expect, it } from 'vitest';
import { getActivityProblemIds, supportedBlockTypes, toPublicClass, validateClass } from '@/core/content';
import { seedClasses, skillLabels } from './fixtures/content';

describe('versioned class content', () => {
  it('ships three complete sample classes with separate practice, checks, and homework', () => {
    expect(seedClasses).toHaveLength(3);
    const allProblemIds: string[] = [];
    for (const record of seedClasses) {
      expect(() => validateClass(record)).not.toThrow();
      expect(record.sections.map((section) => section.role)).toEqual(['explanation', 'worked_example', 'practice', 'check', 'summary']);
      expect(record.homeworkProblemIds).toHaveLength(2);
      expect(record.problems).toHaveLength(5);
      const activityIds = record.sections.flatMap((section) => getActivityProblemIds(record, section.sectionId));
      expect(activityIds).toHaveLength(3);
      expect(activityIds.some((id) => record.homeworkProblemIds.includes(id))).toBe(false);
      expect([...activityIds, ...record.homeworkProblemIds].sort()).toEqual(record.problems.map((problem) => problem.problemVersionId).sort());
      expect(record.public.skillKeys.every((skill) => skill in skillLabels)).toBe(true);
      allProblemIds.push(...record.problems.map((problem) => problem.problemVersionId));
    }
    expect(new Set(allProblemIds).size).toBe(15);
  });

  it('publishes explicit problem DTOs without answers, hints, or solutions', () => {
    const publicClass = toPublicClass(seedClasses[0]);
    expect(publicClass.problems).toHaveLength(5);
    for (const problem of publicClass.problems) {
      expect(Object.keys(problem).sort()).toEqual(['hintAvailable', 'problemVersionId', 'promptContent', 'responseSpec', 'skillKeys']);
      expect(problem).not.toHaveProperty('gradingSpec');
      expect(problem).not.toHaveProperty('hints');
      expect(problem).not.toHaveProperty('solution');
    }
    expect(publicClass).not.toHaveProperty('homeworkProblemIds');
    publicClass.problems[0].promptContent[0].payload.text = 'changed by a caller';
    publicClass.sections[0].contentBlocks[0].payload.text = 'changed by a caller';
    expect(seedClasses[0].problems[0].promptContent[0].payload.text).not.toBe('changed by a caller');
    expect(seedClasses[0].sections[0].contentBlocks[0].payload.text).not.toBe('changed by a caller');
  });

  it('keeps published seed records immutable, including answer specifications', () => {
    expect(Object.isFrozen(seedClasses)).toBe(true);
    expect(Object.isFrozen(seedClasses[0])).toBe(true);
    expect(Object.isFrozen(seedClasses[0].problems[0].gradingSpec)).toBe(true);
    expect(() => { seedClasses[0].problems[0].gradingSpec.numerator = 99; }).toThrow();
  });

  it.each(['kind', 'typeVersion'] as const)('rejects an unsupported required block %s', (field) => {
    const record = structuredClone(seedClasses[0]);
    const block = record.sections[0].contentBlocks[0];
    if (field === 'kind') block.kind = 'future.graph';
    else block.typeVersion = 999;
    expect(() => validateClass(record)).toThrow(/Unsupported block/);
  });

  it('permits a future optional block only when a fallback is present', () => {
    const record = structuredClone(seedClasses[0]);
    const block = record.sections[0].contentBlocks[0];
    block.kind = 'future.graph';
    block.required = false;
    expect(() => validateClass(record)).toThrow(/optional blocks need a text fallback/);
    block.fallback = '이 그래프는 새 버전에서 표시됩니다.';
    expect(() => validateClass(record)).not.toThrow();
  });

  it('registers both figure and fraction strip formats and validates their payload', () => {
    expect(supportedBlockTypes).toContainEqual({ kind: 'core.figure', typeVersion: 1 });
    expect(supportedBlockTypes).toContainEqual({ kind: 'math.fraction_strip', typeVersion: 1 });
    const record = structuredClone(seedClasses[0]);
    record.sections[1].contentBlocks[1].payload.filled = 6;
    expect(() => validateClass(record)).toThrow(/filled must not exceed parts/);
    const figureRecord = structuredClone(seedClasses[0]);
    figureRecord.sections[0].contentBlocks[1].payload.primitive = { kind: 'fraction_strip', parts: 0, filled: 0 };
    expect(() => validateClass(figureRecord)).toThrow(/Invalid payload/);
  });

  it('rejects an incorrect section count and duplicate identities', () => {
    const record = structuredClone(seedClasses[0]);
    record.public.sectionCount = 6;
    expect(() => validateClass(record)).toThrow(/sectionCount/);
    record.public.sectionCount = 5;
    record.sections[1].sectionId = record.sections[0].sectionId;
    expect(() => validateClass(record)).toThrow(/Duplicate section IDs/);
  });

  it('rejects missing immutable problem references instead of selecting a latest version', () => {
    const record = structuredClone(seedClasses[0]);
    record.sections[2].contentBlocks[0].payload.problemVersionIds = ['fraction-meaning:practice-1:v2'];
    expect(() => validateClass(record)).toThrow(/Missing immutable problem version/);
    const homeworkRecord = structuredClone(seedClasses[0]);
    homeworkRecord.homeworkProblemIds[0] = 'fraction-meaning:homework-1:v2';
    expect(() => validateClass(homeworkRecord)).toThrow(/Missing immutable problem version/);
  });

  it('rejects inconsistent public answer requirements and private grading rules', () => {
    const record = structuredClone(seedClasses[1]);
    delete record.problems[1].responseSpec.requiredForm;
    expect(() => validateClass(record)).toThrow(/form requirements must match/);
    const hintsRecord = structuredClone(seedClasses[0]);
    hintsRecord.problems[0].hintAvailable = false;
    expect(() => validateClass(hintsRecord)).toThrow(/hintAvailable/);
  });

  it.each(['promptContent', 'hints', 'solution'] as const)('rejects a recursive problem group inside %s', (field) => {
    const record = structuredClone(seedClasses[0]);
    const problem = record.problems[0];
    problem[field].push({
      blockId: `nested:${field}:v1`, kind: 'core.problem_set', typeVersion: 1, required: true,
      payload: { problemVersionIds: [problem.problemVersionId] },
    });
    expect(() => validateClass(record)).toThrow(/core.problem_set is not allowed inside a problem/);
  });

  it('rejects an optional future problem group inside a problem even with a fallback', () => {
    const record = structuredClone(seedClasses[0]);
    record.problems[0].hints.push({
      blockId: 'nested:future:v1', kind: 'core.problem_set', typeVersion: 2, required: false,
      payload: {}, fallback: '다른 문제도 풀어 보세요.',
    });
    expect(() => validateClass(record)).toThrow(/core.problem_set is not allowed inside a problem/);
  });

  it('rejects a practice question reused in the check without losing other references', () => {
    const record = structuredClone(seedClasses[0]);
    const practiceId = getActivityProblemIds(record, record.sections[2].sectionId)[0];
    const check = record.sections[3].contentBlocks[0];
    (check.payload.problemVersionIds as string[]).push(practiceId);
    expect(() => validateClass(record)).toThrow(/Reused problem version across activities/);
  });

  it.each([2, 3])('rejects a section %s question reused as homework', (sectionIndex) => {
    const record = structuredClone(seedClasses[0]);
    record.homeworkProblemIds.push(getActivityProblemIds(record, record.sections[sectionIndex].sectionId)[0]);
    expect(() => validateClass(record)).toThrow(/Reused problem version across activities/);
  });

  it('rejects duplicate questions split across two blocks in the same activity', () => {
    const record = structuredClone(seedClasses[0]);
    const duplicateBlock = structuredClone(record.sections[2].contentBlocks[0]);
    duplicateBlock.blockId = 'second-practice-group:v1';
    record.sections[2].contentBlocks.push(duplicateBlock);
    expect(() => validateClass(record)).toThrow(/Reused problem version across activities/);
  });

  it('rejects a class that requires a skill it is meant to teach', () => {
    const record = structuredClone(seedClasses[1]);
    record.public.prerequisiteSkillKeys.push(record.public.skillKeys[0]);
    expect(() => validateClass(record)).toThrow(/cannot require its own skill as a prerequisite/);
  });

  it('lets a figure caption carry math while the accessible name stays plain', () => {
    const record = structuredClone(seedClasses[0]);
    const figure = record.sections[0].contentBlocks[1];
    figure.payload.caption = '같은 크기의 4칸 중 3칸 = $\\frac{3}{4}$';
    expect(() => validateClass(record)).not.toThrow();
    figure.payload.alt = '$\\frac{3}{4}$를 채운 막대';
    expect(() => validateClass(record)).toThrow(/math markup/);
  });

  it('requires a plain labelAlt when a standalone strip label carries math', () => {
    const record = structuredClone(seedClasses[0]);
    const strip = record.sections[1].contentBlocks[1];
    expect(strip.kind).toBe('math.fraction_strip');
    strip.payload.label = '먹은 양 $\\frac{2}{5}$';
    expect(() => validateClass(record)).toThrow(/labelAlt/);
    strip.payload.labelAlt = '먹은 양은 5분의 2';
    expect(() => validateClass(record)).not.toThrow();
    strip.payload.labelAlt = '먹은 양 $\\frac{2}{5}$';
    expect(() => validateClass(record)).toThrow(/math markup/);
  });

  it('allows a new catalog entry to retain existing immutable content IDs', () => {
    const record = structuredClone(seedClasses[0]);
    record.public.classKey = 'alternative-curriculum';
    record.public.versionId = 'alternative-curriculum:v1';
    expect(() => validateClass(record)).not.toThrow();
  });

  it('bounds a class to 50 sections', () => {
    const record = structuredClone(seedClasses[0]);
    for (let index = 5; index < 50; index++) record.sections.push({
      sectionId: `extra-summary:${index}:v1`, role: 'summary', title: '복습',
      contentBlocks: [{ blockId: `extra-summary:${index}:text:v1`, kind: 'core.rich_text', typeVersion: 1, required: true, payload: { text: '오늘 배운 내용을 기억해 보세요.' } }],
    });
    record.public.sectionCount = 50;
    expect(() => validateClass(record)).not.toThrow();
    record.sections.push({
      sectionId: 'extra-summary:50:v1', role: 'summary', title: '복습',
      contentBlocks: [{ blockId: 'extra-summary:50:text:v1', kind: 'core.rich_text', typeVersion: 1, required: true, payload: { text: '오늘 배운 내용을 기억해 보세요.' } }],
    });
    record.public.sectionCount = 51;
    expect(() => validateClass(record)).toThrow(/At most 50 sections per class/);
  });

  it('bounds a class to 200 distinct questions', () => {
    const record = structuredClone(seedClasses[0]);
    const addQuestion = (index: number) => {
      const problem = structuredClone(record.problems[0]);
      problem.problemVersionId = `extra-homework:${index}:v1`;
      for (const [field, blocks] of Object.entries({ prompt: problem.promptContent, hint: problem.hints, solution: problem.solution })) {
        blocks.forEach((block, blockIndex) => { block.blockId = `extra-homework:${index}:${field}:${blockIndex}:v1`; });
      }
      record.problems.push(problem);
      record.homeworkProblemIds.push(problem.problemVersionId);
    };
    for (let index = 5; index < 200; index++) addQuestion(index);
    expect(() => validateClass(record)).not.toThrow();
    addQuestion(200);
    expect(() => validateClass(record)).toThrow(/At most 200 problems per class/);
  });

  it.each(['section', 'promptContent', 'hints', 'solution'] as const)('bounds blocks in %s content arrays', (location) => {
    const record = structuredClone(seedClasses[0]);
    const blocks = location === 'section' ? record.sections[0].contentBlocks : record.problems[0][location];
    while (blocks.length < 100) blocks.push({
      blockId: `extra-text:${blocks.length}:v1`, kind: 'core.rich_text', typeVersion: 1, required: true,
      payload: { text: '분모는 전체를 같은 크기로 나눈 조각 수예요.' },
    });
    expect(() => validateClass(record)).not.toThrow();
    blocks.push({ blockId: 'extra-text:100:v1', kind: 'core.rich_text', typeVersion: 1, required: true, payload: { text: '분자는 그중 고른 조각 수예요.' } });
    expect(() => validateClass(record)).toThrow(/At most 100 blocks per content array/);
  });

  it('fails clearly for a section that is not in the pinned class version', () => {
    expect(() => getActivityProblemIds(seedClasses[0], 'missing:v2')).toThrow(/Unknown section/);
  });
});
