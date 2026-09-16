import { describe, expect, it } from 'vitest';
import { blockDefinitionRefs, getActivityProblemIds, supportedBlockTypes, definitionBlockSchema, definitionReferences, toPublicLesson, validateLesson } from '@/core/content';
import { seedLessons, conceptLabels } from './fixtures/content';

describe('versioned lesson content', () => {
  it('ships three complete sample lessons with separate practice, checks, and homework', () => {
    expect(seedLessons).toHaveLength(3);
    const allProblemIds: string[] = [];
    for (const record of seedLessons) {
      expect(() => validateLesson(record)).not.toThrow();
      expect(record.sections.map((section) => section.role)).toEqual(['explanation', 'worked_example', 'practice', 'check', 'summary']);
      expect(record.homeworkProblemIds).toHaveLength(2);
      expect(record.problems).toHaveLength(5);
      const activityIds = record.sections.flatMap((section) => getActivityProblemIds(record, section.sectionId));
      expect(activityIds).toHaveLength(3);
      expect(activityIds.some((id) => record.homeworkProblemIds.includes(id))).toBe(false);
      expect([...activityIds, ...record.homeworkProblemIds].sort()).toEqual(record.problems.map((problem) => problem.problemVersionId).sort());
      expect(record.public.conceptKeys.every((concept) => concept in conceptLabels)).toBe(true);
      allProblemIds.push(...record.problems.map((problem) => problem.problemVersionId));
    }
    expect(new Set(allProblemIds).size).toBe(15);
  });

  it('publishes explicit problem DTOs without answers, hints, or solutions', () => {
    const publicLesson = toPublicLesson(seedLessons[0], 'fractions');
    expect(publicLesson.problems).toHaveLength(5);
    for (const problem of publicLesson.problems) {
      expect(Object.keys(problem).sort()).toEqual(['conceptKeys', 'hintAvailable', 'problemVersionId', 'promptContent', 'responseSpec']);
      expect(problem).not.toHaveProperty('gradingSpec');
      expect(problem).not.toHaveProperty('hints');
      expect(problem).not.toHaveProperty('solution');
    }
    expect(publicLesson).not.toHaveProperty('homeworkProblemIds');
    publicLesson.problems[0].promptContent[0].payload.text = 'changed by a caller';
    publicLesson.sections[0].contentBlocks[0].payload.text = 'changed by a caller';
    expect(seedLessons[0].problems[0].promptContent[0].payload.text).not.toBe('changed by a caller');
    expect(seedLessons[0].sections[0].contentBlocks[0].payload.text).not.toBe('changed by a caller');
  });

  it('keeps published seed records immutable, including answer specifications', () => {
    expect(Object.isFrozen(seedLessons)).toBe(true);
    expect(Object.isFrozen(seedLessons[0])).toBe(true);
    expect(Object.isFrozen(seedLessons[0].problems[0].gradingSpec)).toBe(true);
    expect(() => { seedLessons[0].problems[0].gradingSpec.numerator = 99; }).toThrow();
  });

  it.each(['kind', 'typeVersion'] as const)('rejects an unsupported required block %s', (field) => {
    const record = structuredClone(seedLessons[0]);
    const block = record.sections[0].contentBlocks[0];
    if (field === 'kind') block.kind = 'future.graph';
    else block.typeVersion = 999;
    expect(() => validateLesson(record)).toThrow(/Unsupported block/);
  });

  it('permits a future optional block only when a fallback is present', () => {
    const record = structuredClone(seedLessons[0]);
    const block = record.sections[0].contentBlocks[0];
    block.kind = 'future.graph';
    block.required = false;
    expect(() => validateLesson(record)).toThrow(/optional blocks need a text fallback/);
    block.fallback = '이 그래프는 새 버전에서 표시됩니다.';
    expect(() => validateLesson(record)).not.toThrow();
  });

  it('registers both figure and fraction strip formats and validates their payload', () => {
    expect(supportedBlockTypes).toContainEqual({ kind: 'core.figure', typeVersion: 1 });
    expect(supportedBlockTypes).toContainEqual({ kind: 'math.fraction_strip', typeVersion: 1 });
    const record = structuredClone(seedLessons[0]);
    record.sections[1].contentBlocks[1].payload.filled = 6;
    expect(() => validateLesson(record)).toThrow(/filled must not exceed parts/);
    const figureRecord = structuredClone(seedLessons[0]);
    figureRecord.sections[0].contentBlocks[1].payload.primitive = { kind: 'fraction_strip', parts: 0, filled: 0 };
    expect(() => validateLesson(figureRecord)).toThrow(/Invalid payload/);
  });

  it('rejects an incorrect section count and duplicate identities', () => {
    const record = structuredClone(seedLessons[0]);
    record.public.sectionCount = 6;
    expect(() => validateLesson(record)).toThrow(/sectionCount/);
    record.public.sectionCount = 5;
    record.sections[1].sectionId = record.sections[0].sectionId;
    expect(() => validateLesson(record)).toThrow(/Duplicate section IDs/);
  });

  it('rejects missing immutable problem references instead of selecting a latest version', () => {
    const record = structuredClone(seedLessons[0]);
    record.sections[2].contentBlocks[0].payload.problemVersionIds = ['fraction-meaning:practice-1:v2'];
    expect(() => validateLesson(record)).toThrow(/Missing immutable problem version/);
    const homeworkRecord = structuredClone(seedLessons[0]);
    homeworkRecord.homeworkProblemIds[0] = 'fraction-meaning:homework-1:v2';
    expect(() => validateLesson(homeworkRecord)).toThrow(/Missing immutable problem version/);
  });

  it('rejects inconsistent public answer requirements and private grading rules', () => {
    const record = structuredClone(seedLessons[1]);
    delete record.problems[1].responseSpec.requiredForm;
    expect(() => validateLesson(record)).toThrow(/form requirements must match/);
    const hintsRecord = structuredClone(seedLessons[0]);
    hintsRecord.problems[0].hintAvailable = false;
    expect(() => validateLesson(hintsRecord)).toThrow(/hintAvailable/);
  });

  it.each(['promptContent', 'hints', 'solution'] as const)('rejects a recursive problem group inside %s', (field) => {
    const record = structuredClone(seedLessons[0]);
    const problem = record.problems[0];
    problem[field].push({
      blockId: `nested:${field}:v1`, kind: 'core.problem_set', typeVersion: 1, required: true,
      payload: { problemVersionIds: [problem.problemVersionId] },
    });
    expect(() => validateLesson(record)).toThrow(/core.problem_set is not allowed inside a problem/);
  });

  it('rejects an optional future problem group inside a problem even with a fallback', () => {
    const record = structuredClone(seedLessons[0]);
    record.problems[0].hints.push({
      blockId: 'nested:future:v1', kind: 'core.problem_set', typeVersion: 2, required: false,
      payload: {}, fallback: '다른 문제도 풀어 보세요.',
    });
    expect(() => validateLesson(record)).toThrow(/core.problem_set is not allowed inside a problem/);
  });

  it('rejects a practice question reused in the check without losing other references', () => {
    const record = structuredClone(seedLessons[0]);
    const practiceId = getActivityProblemIds(record, record.sections[2].sectionId)[0];
    const check = record.sections[3].contentBlocks[0];
    (check.payload.problemVersionIds as string[]).push(practiceId);
    expect(() => validateLesson(record)).toThrow(/Reused problem version across activities/);
  });

  it.each([2, 3])('rejects a section %s question reused as homework', (sectionIndex) => {
    const record = structuredClone(seedLessons[0]);
    record.homeworkProblemIds.push(getActivityProblemIds(record, record.sections[sectionIndex].sectionId)[0]);
    expect(() => validateLesson(record)).toThrow(/Reused problem version across activities/);
  });

  it('rejects duplicate questions split across two blocks in the same activity', () => {
    const record = structuredClone(seedLessons[0]);
    const duplicateBlock = structuredClone(record.sections[2].contentBlocks[0]);
    duplicateBlock.blockId = 'second-practice-group:v1';
    record.sections[2].contentBlocks.push(duplicateBlock);
    expect(() => validateLesson(record)).toThrow(/Reused problem version across activities/);
  });

  it('rejects a lesson that requires a concept it is meant to teach', () => {
    const record = structuredClone(seedLessons[1]);
    record.public.prerequisiteConceptKeys.push(record.public.conceptKeys[0]);
    expect(() => validateLesson(record)).toThrow(/cannot require its own concept as a prerequisite/);
  });

  it('lets a figure caption carry math while the accessible name stays plain', () => {
    const record = structuredClone(seedLessons[0]);
    const figure = record.sections[0].contentBlocks[1];
    figure.payload.caption = '같은 크기의 4칸 중 3칸 = $\\frac{3}{4}$';
    expect(() => validateLesson(record)).not.toThrow();
    figure.payload.alt = '$\\frac{3}{4}$를 채운 막대';
    expect(() => validateLesson(record)).toThrow(/math markup/);
  });

  it('requires a plain labelAlt when a standalone strip label carries math', () => {
    const record = structuredClone(seedLessons[0]);
    const strip = record.sections[1].contentBlocks[1];
    expect(strip.kind).toBe('math.fraction_strip');
    strip.payload.label = '먹은 양 $\\frac{2}{5}$';
    expect(() => validateLesson(record)).toThrow(/labelAlt/);
    strip.payload.labelAlt = '먹은 양은 5분의 2';
    expect(() => validateLesson(record)).not.toThrow();
    strip.payload.labelAlt = '먹은 양 $\\frac{2}{5}$';
    expect(() => validateLesson(record)).toThrow(/math markup/);
  });

  it('allows a new catalog entry to retain existing immutable content IDs', () => {
    const record = structuredClone(seedLessons[0]);
    record.public.lessonKey = 'alternative-curriculum';
    record.public.versionId = 'alternative-curriculum:v1';
    expect(() => validateLesson(record)).not.toThrow();
  });

  it('bounds a lesson to 50 sections', () => {
    const record = structuredClone(seedLessons[0]);
    for (let index = 5; index < 50; index++) record.sections.push({
      sectionId: `extra-summary:${index}:v1`, role: 'summary', title: '복습',
      contentBlocks: [{ blockId: `extra-summary:${index}:text:v1`, kind: 'core.rich_text', typeVersion: 1, required: true, payload: { text: '오늘 배운 내용을 기억해 보세요.' } }],
    });
    record.public.sectionCount = 50;
    expect(() => validateLesson(record)).not.toThrow();
    record.sections.push({
      sectionId: 'extra-summary:50:v1', role: 'summary', title: '복습',
      contentBlocks: [{ blockId: 'extra-summary:50:text:v1', kind: 'core.rich_text', typeVersion: 1, required: true, payload: { text: '오늘 배운 내용을 기억해 보세요.' } }],
    });
    record.public.sectionCount = 51;
    expect(() => validateLesson(record)).toThrow(/At most 50 sections per lesson/);
  });

  it('bounds a lesson to 200 distinct questions', () => {
    const record = structuredClone(seedLessons[0]);
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
    expect(() => validateLesson(record)).not.toThrow();
    addQuestion(200);
    expect(() => validateLesson(record)).toThrow(/At most 200 problems per lesson/);
  });

  it.each(['section', 'promptContent', 'hints', 'solution'] as const)('bounds blocks in %s content arrays', (location) => {
    const record = structuredClone(seedLessons[0]);
    const blocks = location === 'section' ? record.sections[0].contentBlocks : record.problems[0][location];
    while (blocks.length < 100) blocks.push({
      blockId: `extra-text:${blocks.length}:v1`, kind: 'core.rich_text', typeVersion: 1, required: true,
      payload: { text: '분모는 전체를 같은 크기로 나눈 조각 수예요.' },
    });
    expect(() => validateLesson(record)).not.toThrow();
    blocks.push({ blockId: 'extra-text:100:v1', kind: 'core.rich_text', typeVersion: 1, required: true, payload: { text: '분자는 그중 고른 조각 수예요.' } });
    expect(() => validateLesson(record)).toThrow(/At most 100 blocks per content array/);
  });

  it('fails clearly for a section that is not in the pinned lesson version', () => {
    expect(() => getActivityProblemIds(seedLessons[0], 'missing:v2')).toThrow(/Unknown section/);
  });
});

describe('glossary definition annotations in lesson text', () => {
  const annotated = (definitions: unknown[], blockIndex = 0) => {
    const record = structuredClone(seedLessons[2]);
    const block = record.sections[0].contentBlocks[blockIndex];
    block.typeVersion = 3;
    block.payload = { text: block.payload.text, definitions };
    return record;
  };

  it('registers the annotated text format alongside the plain one', () => {
    expect(supportedBlockTypes).toContainEqual({ kind: 'core.rich_text', typeVersion: 1 });
    expect(supportedBlockTypes).toContainEqual({ kind: 'core.rich_text', typeVersion: 3 });
  });

  it('accepts an annotation that resolves in the block text', () => {
    const record = annotated([{ conceptKey: 'term.denominator', surface: '분모' }, { conceptKey: 'term.equivalent', surface: '동치분수' }]);
    expect(() => validateLesson(record)).not.toThrow();
    expect(toPublicLesson(record, 'fractions').sections[0].contentBlocks[0].payload.definitions).toHaveLength(2);
  });

  it('rejects an annotation the text does not carry', () => {
    expect(() => validateLesson(annotated([{ conceptKey: 'term.decimal', surface: '소수점' }]))).toThrow(/does not occur/);
    expect(() => validateLesson(annotated([{ conceptKey: 'term.denominator', surface: '분모', occurrence: 99 }]))).toThrow(/does not occur/);
  });

  it('rejects a malformed annotation payload', () => {
    expect(() => validateLesson(annotated([{ conceptKey: 'term.denominator' }]))).toThrow(/Invalid payload/);
    expect(() => validateLesson(annotated([{ conceptKey: 'term.denominator', surface: '분모', note: '설명' }]))).toThrow(/Invalid payload/);
  });

  it('reports definition references with the concepts of the problem that holds them', () => {
    const record = structuredClone(seedLessons[2]);
    record.sections[0].contentBlocks[0] = { ...record.sections[0].contentBlocks[0], typeVersion: 3,
      payload: { text: record.sections[0].contentBlocks[0].payload.text, definitions: [{ conceptKey: 'term.denominator', surface: '분모' }] } };
    const problem = record.problems[0];
    problem.hints[0] = { ...problem.hints[0], typeVersion: 3, payload: { text: problem.hints[0].payload.text, definitions: [] } };
    expect(() => validateLesson(record)).not.toThrow();
    expect(definitionReferences(record)).toEqual([{ conceptKey: 'term.denominator', blockId: record.sections[0].contentBlocks[0].blockId, problemConceptKeys: null }]);
    expect(blockDefinitionRefs(record.sections[0].contentBlocks)).toEqual([{ conceptKey: 'term.denominator', scopeKind: undefined, scopeKey: undefined }]);
  });
});
