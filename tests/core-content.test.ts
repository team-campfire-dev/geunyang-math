import { describe, expect, it } from 'vitest';
import { blockDefinitionRefs, getActivityProblemIds, supportedBlockTypes, definitionBlockSchema, definitionReferences, storedLessonOf, toPublicLesson, validateLesson, validateProblemSet, type LessonRecord } from '@/core/content';
import { validateReferences } from '@/core/content-bundle';
import { seedLessons, conceptLabels, lessonBundle, setsOf } from './fixtures/content';

/** A lesson on its own, the way publishing validates it: its steps and references, not its questions. */
const check = (record: LessonRecord) => validateLesson(storedLessonOf(record));
/** The lesson with the sets its record holds, checked against each other the way a bundle is. */
const checkBundle = (record: LessonRecord) => validateReferences(lessonBundle([record]));

describe('versioned lesson content', () => {
  it('ships three complete sample lessons with separate practice, checks, and a review pool', () => {
    expect(seedLessons).toHaveLength(3);
    const allProblemIds: string[] = [];
    for (const record of seedLessons) {
      expect(() => check(record)).not.toThrow();
      expect(() => checkBundle(record)).not.toThrow();
      expect(record.sections.map((section) => section.role)).toEqual(['explanation', 'worked_example', 'practice', 'check', 'summary']);
      expect(record.review!.problemVersionIds).toHaveLength(2);
      expect(record.problems).toHaveLength(5);
      const activityIds = record.sections.flatMap((section) => getActivityProblemIds(record, section.sectionId));
      expect(activityIds).toHaveLength(3);
      expect(activityIds.some((id) => record.review!.problemVersionIds.includes(id))).toBe(false);
      expect([...activityIds, ...record.review!.problemVersionIds].sort()).toEqual(record.problems.map((problem) => problem.problemVersionId).sort());
      expect(record.public.conceptKeys.every((concept) => concept in conceptLabels)).toBe(true);
      // Every activity is its own problem set, and the review pool another: nothing is shared.
      expect(setsOf(record).map((set) => set.problemSetId).sort()).toEqual(['check', 'practice', 'review'].map((role) => `${record.public.lessonKey}:${role}`).sort());
      allProblemIds.push(...record.problems.map((problem) => problem.problemVersionId));
    }
    expect(new Set(allProblemIds).size).toBe(15);
  });

  it('publishes explicit problem DTOs without answers, hints, or solutions', () => {
    const publicLesson = toPublicLesson(seedLessons[0], 'fractions');
    expect(publicLesson.problems).toHaveLength(5);
    for (const problem of publicLesson.problems) {
      // `solutionAvailable` says a worked solution exists; the solution itself stays on the server.
      expect(Object.keys(problem).sort()).toEqual(['conceptKeys', 'hintAvailable', 'problemVersionId', 'promptContent', 'responseSpec', 'solutionAvailable']);
      expect(problem).not.toHaveProperty('gradingSpec');
      expect(problem).not.toHaveProperty('hints');
      expect(problem).not.toHaveProperty('solution');
    }
    expect(publicLesson).not.toHaveProperty('review');
    publicLesson.problems[0].promptContent[0].payload.text = 'changed by a caller';
    publicLesson.sections[0].contentBlocks[0].payload.text = 'changed by a caller';
    expect(seedLessons[0].problems[0].promptContent[0].payload.text).not.toBe('changed by a caller');
    expect(seedLessons[0].sections[0].contentBlocks[0].payload.text).not.toBe('changed by a caller');
  });

  it('keeps published seed records immutable, including answer specifications', () => {
    expect(Object.isFrozen(seedLessons)).toBe(true);
    expect(Object.isFrozen(seedLessons[0])).toBe(true);
    expect(Object.isFrozen(seedLessons[0].problems[0].gradingSpec)).toBe(true);
    expect(() => { (seedLessons[0].problems[0].gradingSpec as { numerator?: number }).numerator = 99; }).toThrow();
  });

  it.each(['kind', 'typeVersion'] as const)('rejects an unsupported required block %s', (field) => {
    const record = structuredClone(seedLessons[0]);
    const block = record.sections[0].contentBlocks[0];
    if (field === 'kind') block.kind = 'future.graph';
    else block.typeVersion = 999;
    expect(() => check(record)).toThrow(/Unsupported block/);
  });

  it('permits a future optional block only when a fallback is present', () => {
    const record = structuredClone(seedLessons[0]);
    const block = record.sections[0].contentBlocks[0];
    block.kind = 'future.graph';
    block.required = false;
    expect(() => check(record)).toThrow(/optional blocks need a text fallback/);
    block.fallback = '이 그래프는 새 버전에서 표시됩니다.';
    expect(() => check(record)).not.toThrow();
  });

  it('registers the table format and refuses a table that cannot be read', () => {
    expect(supportedBlockTypes).toContainEqual({ kind: 'core.table', typeVersion: 1 });
    const withTable = (payload: Record<string, unknown>) => {
      const record = structuredClone(seedLessons[0]);
      record.sections[0].contentBlocks.push({ blockId: 'table:1', kind: 'core.table', typeVersion: 1, required: true, payload });
      return record;
    };
    const sound = {
      caption: '지점별 매출', note: '단위: 만 원', rowHeader: true,
      columns: [{ label: '지점' }, { label: '2024년', align: 'end' }],
      rows: [{ cells: ['A지점', '3,600'] }],
    };
    expect(() => check(withTable(sound))).not.toThrow();
    // A row that does not line up with the columns leaves a hole, and a hole in a table of numbers
    // reads as a value.
    expect(() => check(withTable({ ...sound, rows: [{ cells: ['A지점'] }] }))).toThrow(/열의 수와 칸의 수/);
    // The caption is the accessible name, announced before the numbers, so it is read not drawn.
    expect(() => check(withTable({ ...sound, caption: '$\\frac{1}{2}$ 매출' }))).toThrow(/Accessible text/);
    // A named row whose name is missing is a value belonging to nothing.
    expect(() => check(withTable({ ...sound, rows: [{ cells: ['', '3,600'] }] }))).toThrow(/줄 이름/);
  });

  it('registers both figure and fraction strip formats and validates their payload', () => {
    expect(supportedBlockTypes).toContainEqual({ kind: 'core.figure', typeVersion: 1 });
    expect(supportedBlockTypes).toContainEqual({ kind: 'math.fraction_strip', typeVersion: 1 });
    const record = structuredClone(seedLessons[0]);
    record.sections[1].contentBlocks[1].payload.filled = 6;
    expect(() => check(record)).toThrow(/filled must not exceed parts/);
    const figureRecord = structuredClone(seedLessons[0]);
    figureRecord.sections[0].contentBlocks[1].payload.primitive = { kind: 'fraction_strip', parts: 0, filled: 0 };
    expect(() => check(figureRecord)).toThrow(/Invalid payload/);
  });

  it('rejects an incorrect section count and duplicate identities', () => {
    const record = structuredClone(seedLessons[0]);
    record.public.sectionCount = 6;
    expect(() => check(record)).toThrow(/sectionCount/);
    record.public.sectionCount = 5;
    record.sections[1].sectionId = record.sections[0].sectionId;
    expect(() => check(record)).toThrow(/Duplicate section IDs/);
  });

  it('rejects a reference to a question the problem set version does not hold', () => {
    const record = structuredClone(seedLessons[0]);
    record.sections[2].contentBlocks[0].payload.problemVersionIds = ['fraction-meaning:practice-1:v2'];
    expect(() => checkBundle(record)).toThrow(/Problem is not in the problem set version/);
    const reviewRecord = structuredClone(seedLessons[0]);
    reviewRecord.review!.problemVersionIds[0] = 'fraction-meaning:homework-1:v2';
    expect(() => checkBundle(reviewRecord)).toThrow(/Problem is not in the problem set version/);
    // A reference to a version nobody published is refused before its questions are looked at.
    const dangling = structuredClone(seedLessons[0]);
    dangling.sections[2].contentBlocks[0].payload.problemSetVersionId = 'fraction-meaning:practice:v9';
    const bundle = lessonBundle([dangling]);
    bundle.problemSets = bundle.problemSets.filter((set) => set.versionId !== 'fraction-meaning:practice:v9');
    expect(() => validateReferences(bundle)).toThrow(/Missing problem set version/);
  });

  it('rejects inconsistent public answer requirements and private grading rules', () => {
    const [set] = setsOf(structuredClone(seedLessons[1]));
    delete set.problems[1].responseSpec.requiredForm;
    expect(() => validateProblemSet(set)).toThrow(/form requirements must match/);
    const [hintsSet] = setsOf(structuredClone(seedLessons[0]));
    hintsSet.problems[0].hintAvailable = false;
    expect(() => validateProblemSet(hintsSet)).toThrow(/hintAvailable/);
  });

  it('refuses a question answered by picking that the learner could not answer or could cheat', () => {
    const options = [{ id: 'a', text: '$2x$' }, { id: 'b', text: '$3x$' }];
    const picked = (over: Record<string, unknown> = {}) => {
      const [set] = setsOf(structuredClone(seedLessons[0]));
      set.problems = [set.problems[0]];
      set.problems[0].gradingSpec = { kind: 'choice', options: structuredClone(options), correct: 'a' };
      set.problems[0].responseSpec = { kind: 'choice', options: structuredClone(options) };
      Object.assign(set.problems[0], over);
      return set;
    };
    expect(() => validateProblemSet(picked())).not.toThrow();
    // Which one is right belongs to the question, never to the copy a learner is sent.
    expect(() => validateProblemSet(picked({ responseSpec: { kind: 'choice', options, correct: 'a' } }))).toThrow();
    // Options the learner never sees cannot be the ones the answer was written against.
    expect(() => validateProblemSet(picked({ responseSpec: { kind: 'choice', options: [options[0], { id: 'b', text: '$9x$' }] } })))
      .toThrow(/options must match/);
    expect(() => validateProblemSet(picked({ responseSpec: { kind: 'choice' } }))).toThrow(/options must match/);
    // An answer that names no option is an answer nobody could give.
    expect(() => validateProblemSet(picked({ gradingSpec: { kind: 'choice', options, correct: 'z' } }))).toThrow(/정답인 보기/);
    // Only a picked answer offers options; a written one that carries them is a mistake.
    const [numeric] = setsOf(structuredClone(seedLessons[0]));
    numeric.problems[0].responseSpec = { ...numeric.problems[0].responseSpec, options };
    expect(() => validateProblemSet(numeric)).toThrow(/Only a picked answer/);
  });

  it.each(['promptContent', 'hints', 'solution'] as const)('rejects a recursive problem group inside %s', (field) => {
    const [set] = setsOf(structuredClone(seedLessons[0]));
    const problem = set.problems[0];
    problem[field].push({
      blockId: `nested:${field}:v1`, kind: 'core.problem_set', typeVersion: 2, required: true,
      payload: { problemSetId: set.problemSetId, problemSetVersionId: set.versionId, problemVersionIds: [problem.problemVersionId] },
    });
    expect(() => validateProblemSet(set)).toThrow(/core.problem_set is not allowed inside a problem/);
  });

  it('rejects an optional future problem group inside a problem even with a fallback', () => {
    const [set] = setsOf(structuredClone(seedLessons[0]));
    set.problems[0].hints.push({
      blockId: 'nested:future:v1', kind: 'core.problem_set', typeVersion: 9, required: false,
      payload: {}, fallback: '다른 문제도 풀어 보세요.',
    });
    expect(() => validateProblemSet(set)).toThrow(/core.problem_set is not allowed inside a problem/);
  });

  it('rejects a practice question reused in the check without losing other references', () => {
    const record = structuredClone(seedLessons[0]);
    const practiceId = getActivityProblemIds(record, record.sections[2].sectionId)[0];
    const check_ = record.sections[3].contentBlocks[0];
    (check_.payload.problemVersionIds as string[]).push(practiceId);
    expect(() => check(record)).toThrow(/Reused problem version across activities/);
  });

  it.each([2, 3])('rejects a section %s question reused in the review pool, since a question has one set', (sectionIndex) => {
    const record = structuredClone(seedLessons[0]);
    record.review!.problemVersionIds.push(getActivityProblemIds(record, record.sections[sectionIndex].sectionId)[0]);
    expect(() => check(record)).not.toThrow();
    expect(() => checkBundle(record)).toThrow(/Problem belongs to another problem set/);
  });

  it('rejects duplicate questions split across two blocks in the same activity', () => {
    const record = structuredClone(seedLessons[0]);
    const duplicateBlock = structuredClone(record.sections[2].contentBlocks[0]);
    duplicateBlock.blockId = 'second-practice-group:v1';
    record.sections[2].contentBlocks.push(duplicateBlock);
    expect(() => check(record)).toThrow(/Reused problem version across activities/);
  });

  it('rejects a lesson that asks about a concept it does not teach', () => {
    const record = structuredClone(seedLessons[1]);
    record.problems[0].conceptKeys = ['fraction.addition'];
    expect(() => checkBundle(record)).toThrow(/Problem concept is absent from lesson concepts/);
  });

  it('rejects a lesson that requires a concept it is meant to teach', () => {
    const record = structuredClone(seedLessons[1]);
    record.public.prerequisiteConceptKeys.push(record.public.conceptKeys[0]);
    expect(() => check(record)).toThrow(/cannot require its own concept as a prerequisite/);
  });

  it('lets a figure caption carry math while the accessible name stays plain', () => {
    const record = structuredClone(seedLessons[0]);
    const figure = record.sections[0].contentBlocks[1];
    figure.payload.caption = '같은 크기의 4칸 중 3칸 = $\\frac{3}{4}$';
    expect(() => check(record)).not.toThrow();
    figure.payload.alt = '$\\frac{3}{4}$를 채운 막대';
    expect(() => check(record)).toThrow(/math markup/);
  });

  it('requires a plain labelAlt when a standalone strip label carries math', () => {
    const record = structuredClone(seedLessons[0]);
    const strip = record.sections[1].contentBlocks[1];
    expect(strip.kind).toBe('math.fraction_strip');
    strip.payload.label = '먹은 양 $\\frac{2}{5}$';
    expect(() => check(record)).toThrow(/labelAlt/);
    strip.payload.labelAlt = '먹은 양은 5분의 2';
    expect(() => check(record)).not.toThrow();
    strip.payload.labelAlt = '먹은 양 $\\frac{2}{5}$';
    expect(() => check(record)).toThrow(/math markup/);
  });

  it('allows a new catalog entry to retain existing immutable content IDs', () => {
    const record = structuredClone(seedLessons[0]);
    record.public.lessonKey = 'alternative-curriculum';
    record.public.versionId = 'alternative-curriculum:v1';
    expect(() => check(record)).not.toThrow();
  });

  it('bounds a lesson to 50 sections', () => {
    const record = structuredClone(seedLessons[0]);
    for (let index = 5; index < 50; index++) record.sections.push({
      sectionId: `extra-summary:${index}:v1`, role: 'summary', title: '복습',
      contentBlocks: [{ blockId: `extra-summary:${index}:text:v1`, kind: 'core.rich_text', typeVersion: 1, required: true, payload: { text: '오늘 배운 내용을 기억해 보세요.' } }],
    });
    record.public.sectionCount = 50;
    expect(() => check(record)).not.toThrow();
    record.sections.push({
      sectionId: 'extra-summary:50:v1', role: 'summary', title: '복습',
      contentBlocks: [{ blockId: 'extra-summary:50:text:v1', kind: 'core.rich_text', typeVersion: 1, required: true, payload: { text: '오늘 배운 내용을 기억해 보세요.' } }],
    });
    record.public.sectionCount = 51;
    expect(() => check(record)).toThrow(/At most 50 sections per lesson/);
  });

  it('bounds a problem set to 600 distinct questions', () => {
    const [set] = setsOf(structuredClone(seedLessons[0]));
    const addQuestion = (index: number) => {
      const problem = structuredClone(set.problems[0]);
      problem.problemVersionId = `extra:${index}:v1`;
      for (const [field, blocks] of Object.entries({ prompt: problem.promptContent, hint: problem.hints, solution: problem.solution })) {
        blocks.forEach((block, blockIndex) => { block.blockId = `extra:${index}:${field}:${blockIndex}:v1`; });
      }
      set.problems.push(problem);
    };
    // The bank the placement draws from is one set that grows with the catalogue — two
    // questions per concept taught — so the ceiling sits well above any set a learner is handed.
    for (let index = set.problems.length; index < 600; index++) addQuestion(index);
    expect(() => validateProblemSet(set)).not.toThrow();
    addQuestion(600);
    expect(() => validateProblemSet(set)).toThrow(/At most 600 problems per problem set/);
  });

  it('bounds blocks in a section', () => {
    const record = structuredClone(seedLessons[0]);
    const blocks = record.sections[0].contentBlocks;
    while (blocks.length < 100) blocks.push({
      blockId: `extra-text:${blocks.length}:v1`, kind: 'core.rich_text', typeVersion: 1, required: true,
      payload: { text: '분모는 전체를 같은 크기로 나눈 조각 수예요.' },
    });
    expect(() => check(record)).not.toThrow();
    blocks.push({ blockId: 'extra-text:100:v1', kind: 'core.rich_text', typeVersion: 1, required: true, payload: { text: '분자는 그중 고른 조각 수예요.' } });
    expect(() => check(record)).toThrow(/At most 100 blocks per content array/);
  });

  it.each(['promptContent', 'hints', 'solution'] as const)('bounds blocks in %s of a question', (location) => {
    const [set] = setsOf(structuredClone(seedLessons[0]));
    const blocks = set.problems[0][location];
    while (blocks.length < 100) blocks.push({
      blockId: `extra-text:${blocks.length}:v1`, kind: 'core.rich_text', typeVersion: 1, required: true,
      payload: { text: '분모는 전체를 같은 크기로 나눈 조각 수예요.' },
    });
    expect(() => validateProblemSet(set)).not.toThrow();
    blocks.push({ blockId: 'extra-text:100:v1', kind: 'core.rich_text', typeVersion: 1, required: true, payload: { text: '분자는 그중 고른 조각 수예요.' } });
    expect(() => validateProblemSet(set)).toThrow(/At most 100 blocks per content array/);
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
    expect(() => check(record)).not.toThrow();
    expect(toPublicLesson(record, 'fractions').sections[0].contentBlocks[0].payload.definitions).toHaveLength(2);
  });

  it('rejects an annotation the text does not carry', () => {
    expect(() => check(annotated([{ conceptKey: 'term.decimal', surface: '소수점' }]))).toThrow(/does not occur/);
    expect(() => check(annotated([{ conceptKey: 'term.denominator', surface: '분모', occurrence: 99 }]))).toThrow(/does not occur/);
  });

  it('rejects a malformed annotation payload', () => {
    expect(() => check(annotated([{ conceptKey: 'term.denominator' }]))).toThrow(/Invalid payload/);
    expect(() => check(annotated([{ conceptKey: 'term.denominator', surface: '분모', note: '설명' }]))).toThrow(/Invalid payload/);
  });

  it('reports definition references with the concepts of the problem that holds them', () => {
    const record = structuredClone(seedLessons[2]);
    record.sections[0].contentBlocks[0] = { ...record.sections[0].contentBlocks[0], typeVersion: 3,
      payload: { text: record.sections[0].contentBlocks[0].payload.text, definitions: [{ conceptKey: 'term.denominator', surface: '분모' }] } };
    const problem = record.problems[0];
    problem.hints[0] = { ...problem.hints[0], typeVersion: 3, payload: { text: problem.hints[0].payload.text, definitions: [] } };
    expect(() => check(record)).not.toThrow();
    expect(definitionReferences(record)).toEqual([{ conceptKey: 'term.denominator', blockId: record.sections[0].contentBlocks[0].blockId, problemConceptKeys: null }]);
    expect(blockDefinitionRefs(record.sections[0].contentBlocks)).toEqual([{ conceptKey: 'term.denominator', scopeKind: undefined, scopeKey: undefined }]);
  });

  it('offers a definition only the blocks a definition may hold', () => {
    expect(() => definitionBlockSchema.parse({ blockId: 'd:1', kind: 'core.rich_text', typeVersion: 1, required: true, payload: { text: '정의' } })).not.toThrow();
  });
});
