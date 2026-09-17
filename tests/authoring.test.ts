import { describe, expect, it } from 'vitest';
import { supportedBlockTypes, definitionBlockSchema, storedLessonOf, validateLesson, validateProblemSet, type LessonRecord } from '@/core/content';
/** Publishing validates the frozen half of a lesson: its steps, not the questions its sets hold. */
const checkLesson = (record: unknown) => validateLesson(storedLessonOf(record as LessonRecord));
import { setsOf } from './fixtures/content';
import {
  blockForms, blockFormOf, lessonBlockForms, copyBlock, copyProblem, copySection, dropLooseProblems, insertAfter,
  looseProblems, moveBlock, newProblem,
  nextBlockId, nextProblemBlockId, nextProblemVersionId,
  nextSectionId, problemBlockForms, problemGist, problemsOfBlock, pruneBlock, pruneSections, renameProblem,
  renameProblemReferences, renamedProblemVersionId, responseSpecOf, scopeDefinitionLinks,
  issueText, problemSetIdPattern, suggestVersionId, definitionBlockForms, toPublicProblem, versionLabel, writePath,
} from '@/shared/authoring';
import { seedLessons } from './fixtures/content';

const block = (kind: string, typeVersion: number, payload: Record<string, unknown>) =>
  ({ blockId: 'draft:block:v1', kind, typeVersion, required: true, payload });

describe('naming a new version and its parts', () => {
  it('suggests the next version of the lesson, not a copy of the published one', () => {
    expect(suggestVersionId('fraction-meaning', ['fraction-meaning:v1', 'fraction-meaning:v4'])).toBe('fraction-meaning:v5');
    expect(suggestVersionId('decimals', [])).toBe('decimals:v1');
    expect(suggestVersionId('decimals', ['decimals:draft'])).toBe('decimals:v1');
  });
  it('keeps generated block and section IDs unique inside the document', () => {
    const taken = ['fraction-meaning:explanation:fraction_sequence:v5'];
    expect(nextBlockId('fraction-meaning', 'fraction-meaning:explanation:v1', 'math.fraction_sequence', 'fraction-meaning:v5', []))
      .toBe('fraction-meaning:explanation:fraction_sequence:v5');
    expect(nextBlockId('fraction-meaning', 'fraction-meaning:explanation:v1', 'math.fraction_sequence', 'fraction-meaning:v5', taken))
      .toBe('fraction-meaning:explanation:fraction_sequence-2:v5');
    expect(nextSectionId('fraction-meaning', 'practice', 'fraction-meaning:v5', ['fraction-meaning:practice:v5']))
      .toBe('fraction-meaning:practice-2:v5');
  });
  it('generates IDs the publishing validator accepts', () => {
    const record = structuredClone(seedLessons[0]);
    const section = record.sections[0];
    section.contentBlocks.push({ ...block('core.rich_text', 1, { text: '새 문단이에요.' }),
      blockId: nextBlockId(record.public.lessonKey, section.sectionId, 'core.rich_text', 'fraction-meaning:v5', []) });
    expect(() => checkLesson(record)).not.toThrow();
  });
});

describe('block order and payload editing', () => {
  it('swaps neighbours and refuses to move past either end', () => {
    const blocks = [block('a.a', 1, {}), block('b.b', 1, {}), block('c.c', 1, {})];
    expect(moveBlock(blocks, 0, 1).map((item) => item.kind)).toEqual(['b.b', 'a.a', 'c.c']);
    expect(moveBlock(blocks, 0, -1)).toBe(blocks);
    expect(moveBlock(blocks, 2, 1)).toBe(blocks);
  });
  it('writes a nested field without dropping its siblings', () => {
    const payload = { alt: '그림', primitive: { kind: 'fraction_strip', parts: 4, filled: 3 } };
    expect(writePath(payload, 'primitive.filled', 2)).toEqual({ alt: '그림', primitive: { kind: 'fraction_strip', parts: 4, filled: 2 } });
    expect(payload.primitive.filled).toBe(3);
  });
});

describe('what the editor sends is what publishing accepts', () => {
  it('offers a form for every published block kind', () => {
    for (const type of supportedBlockTypes) expect(blockFormOf(type), `${type.kind}@${type.typeVersion}`).toBeDefined();
    for (const form of blockForms) expect(supportedBlockTypes).toContainEqual({ kind: form.kind, typeVersion: form.typeVersion });
  });

  it('keeps a retired format openable without offering it for new content', () => {
    // Published lessons still hold these, so an author must be able to open one and read it.
    for (const kind of ['core.figure', 'math.fraction_strip']) {
      expect(blockFormOf({ kind, typeVersion: 1 })?.retired).toBe(true);
    }
    const offered = blockForms.filter((form) => !form.retired).map((form) => form.kind);
    expect(offered).toContain('core.scene');
    expect(offered).not.toContain('core.figure');
    expect(offered).not.toContain('math.fraction_strip');
  });

  it('offers one paragraph wherever a paragraph may go, never a choice of schema version', () => {
    const paragraphs = (forms: typeof blockForms) =>
      forms.filter((form) => !form.retired && form.kind === 'core.rich_text');
    // A lesson's paragraph is the one that can carry definition links; a definition's is the one that cannot.
    expect(paragraphs(lessonBlockForms).map((form) => form.typeVersion)).toEqual([3]);
    expect(paragraphs(problemBlockForms).map((form) => form.typeVersion)).toEqual([3]);
    expect(paragraphs(definitionBlockForms).map((form) => form.typeVersion)).toEqual([1]);
    // Both are called the same thing, because to whoever is writing they are the same thing.
    expect([...new Set(paragraphs(blockForms).map((form) => form.label))]).toEqual(['글']);
    // The older one still opens, so a lesson published with it can be read and edited.
    expect(blockFormOf({ kind: 'core.rich_text', typeVersion: 1 })).toBeDefined();
  });

  it('starts every new block at a payload the validator already accepts', () => {
    for (const form of blockForms) {
      // An activity is a new, empty problem set until an author writes a question; the set's version is a placeholder saving decides.
      if (form.editsProblems) {
        const made = form.create() as { problemSetId: string; problemSetVersionId: string; problemVersionIds: string[] };
        expect(made.problemVersionIds).toEqual([]);
        expect(made.problemSetVersionId).toBe(`${made.problemSetId}:v1`);
        expect(problemSetIdPattern.test(made.problemSetId)).toBe(true);
        continue;
      }
      const record = structuredClone(seedLessons[0]);
      const section = record.sections[0];
      section.contentBlocks.push({ blockId: `draft:${form.kind}:v1`, kind: form.kind, typeVersion: form.typeVersion,
        required: true, payload: form.create() } as never);
      expect(() => checkLesson(record), `${form.kind}@${form.typeVersion}`).not.toThrow();
    }
  });

  it('drops the optional fields an author left blank, which validation would otherwise reject', () => {
    const strip = pruneBlock(block('math.fraction_strip', 1, { parts: 4, filled: 3, label: '$\\frac{3}{4}$', labelAlt: '' }));
    expect(strip.payload).not.toHaveProperty('labelAlt');
    const kept = pruneBlock(block('math.fraction_strip', 1, { parts: 4, filled: 3, label: '$\\frac{3}{4}$', labelAlt: '4분의 3' }));
    expect(kept.payload.labelAlt).toBe('4분의 3');
    const scene = pruneBlock(block('core.scene', 1, { alt: '그림', caption: '', width: 320, height: 200, items: [] }));
    expect(scene.payload).not.toHaveProperty('caption');
    const optional = pruneBlock({ ...block('core.rich_text', 1, { text: '본문' }), required: false, fallback: '  ' });
    expect(optional).not.toHaveProperty('fallback');
  });

  it('tells a blank optional field apart from a missing one when publishing', () => {
    const record = structuredClone(seedLessons[0]);
    const withBlank = (labelAlt: string) => {
      const draft = structuredClone(record);
      draft.sections[0].contentBlocks.push(block('math.fraction_strip', 1,
        { parts: 4, filled: 3, label: '$\\frac{3}{4}$', labelAlt }) as never);
      return { ...draft, sections: pruneSections(draft.sections) as typeof draft.sections };
    };
    // Pruned, a blank spoken name is absent, and a math caption without one is rejected by name.
    expect(() => checkLesson(withBlank(''))).toThrow(/labelAlt/);
    expect(() => checkLesson(withBlank('4분의 3'))).not.toThrow();
  });
});

describe('naming a question, and keeping an answered one as it was answered', () => {
  const lessonKey = 'fraction-meaning';
  it('names a new question after the activity that holds it', () => {
    expect(nextProblemVersionId(lessonKey, 'practice', 'fraction-meaning:v5', [])).toBe('fraction-meaning:practice-1:v5');
    expect(nextProblemVersionId(lessonKey, 'practice', 'fraction-meaning:v5', ['fraction-meaning:practice-1:v5']))
      .toBe('fraction-meaning:practice-2:v5');
    // A question carried from an earlier version still holds its name, so a new one takes the next.
    expect(nextProblemVersionId(lessonKey, 'practice', 'fraction-meaning:v5', ['fraction-meaning:practice-1:v2']))
      .toBe('fraction-meaning:practice-2:v5');
    expect(nextProblemBlockId('fraction-meaning:practice-1:v5', 'hint', [])).toBe('fraction-meaning:practice-1:v5:hint');
    expect(nextProblemBlockId('fraction-meaning:practice-1:v5', 'hint', ['fraction-meaning:practice-1:v5:hint']))
      .toBe('fraction-meaning:practice-1:v5:hint-2');
  });

  it('moves an edited question to the version being written, stepping aside for a name in use', () => {
    expect(renamedProblemVersionId('fraction-meaning:practice-1:v1', 'fraction-meaning:v2', () => false))
      .toBe('fraction-meaning:practice-1:v2');
    expect(renamedProblemVersionId('fraction-meaning:practice-1:v1', 'fraction-meaning:v2',
      (id) => id === 'fraction-meaning:practice-1:v2')).toBe('fraction-meaning:practice-1-2:v2');
  });

  it('renames the blocks named after a question, and leaves the others where they are', () => {
    const problem = newProblem('fraction-meaning:practice-1:v1', ['fraction.meaning']);
    problem.hints.push({ blockId: 'fraction-meaning:shared:hint:v1', kind: 'core.rich_text', typeVersion: 1,
      required: true, payload: { text: '힌트예요.' } });
    const renamed = renameProblem(problem, 'fraction-meaning:practice-1:v2');
    expect(renamed.promptContent[0].blockId).toBe('fraction-meaning:practice-1:v2:prompt');
    expect(renamed.solution[0].blockId).toBe('fraction-meaning:practice-1:v2:solution');
    expect(renamed.hints[0].blockId).toBe('fraction-meaning:shared:hint:v1');
  });

  it('moves every reference an activity holds, and leaves other blocks untouched', () => {
    const record = structuredClone(seedLessons[0]);
    const renamed = renameProblemReferences(record.sections, new Map([['fraction-meaning:practice-1:v1', 'fraction-meaning:practice-1:v2']]));
    const activities = renamed.flatMap((section) => section.contentBlocks).filter((item) => item.kind === 'core.problem_set');
    expect(activities.flatMap((item) => item.payload.problemVersionIds as string[])).toContain('fraction-meaning:practice-1:v2');
    expect(activities.flatMap((item) => item.payload.problemVersionIds as string[])).not.toContain('fraction-meaning:practice-1:v1');
    expect(renamed[0].contentBlocks).toEqual(record.sections[0].contentBlocks);
    // An activity reads its questions in the order it names them.
    const practice = renamed.flatMap((section) => section.contentBlocks).find((item) => item.kind === 'core.problem_set')!;
    const problems = [newProblem('fraction-meaning:practice-2:v1', ['fraction.meaning']), newProblem('fraction-meaning:practice-1:v2', ['fraction.meaning'])];
    expect(problemsOfBlock(practice, problems).map((item) => item.problemVersionId))
      .toEqual((practice.payload.problemVersionIds as string[]).filter((id) => problems.some((item) => item.problemVersionId === id)));
  });

  it('starts a new question at something the publishing validator accepts', () => {
    const record = structuredClone(seedLessons[0]);
    const activity = record.sections.flatMap((section) => section.contentBlocks).find((block) => block.kind === 'core.problem_set')!;
    const created = newProblem(nextProblemVersionId(lessonKey, 'practice', 'fraction-meaning:v5',
      record.problems.map((problem) => problem.problemVersionId)), record.problems[0].conceptKeys);
    record.problems.push({ ...created, responseSpec: responseSpecOf(created.gradingSpec), hintAvailable: created.hints.length > 0 });
    (activity.payload.problemVersionIds as string[]).push(created.problemVersionId);
    expect(() => validateLesson(storedLessonOf(record))).not.toThrow();
    for (const set of setsOf(record)) expect(() => validateProblemSet(set)).not.toThrow();
  });

  it('shows the preview the half of a question a learner may see', () => {
    const problem = newProblem('fraction-meaning:practice-1:v2', ['fraction.meaning']);
    expect(toPublicProblem(problem)).toEqual({ problemVersionId: problem.problemVersionId, conceptKeys: ['fraction.meaning'],
      promptContent: problem.promptContent, responseSpec: { kind: 'rational' }, hintAvailable: false });
    problem.hints.push({ blockId: 'fraction-meaning:practice-1:v2:hint', kind: 'core.rich_text', typeVersion: 1, required: true, payload: { text: '힌트' } });
    problem.gradingSpec = { kind: 'rational', numerator: 1, denominator: 2, requiredForm: 'reduced_fraction' };
    expect(toPublicProblem(problem)).toMatchObject({ hintAvailable: true, responseSpec: { kind: 'rational', requiredForm: 'reduced_fraction' } });
  });
});

describe('which lesson keeps a linked definition', () => {
  const linked = (definitions: Record<string, unknown>[]) => ([{
    blockId: 'fraction-meaning:explanation:text:v5', kind: 'core.rich_text', typeVersion: 3, required: true,
    payload: { text: '분모는 전체를 나눈 조각 수예요.', definitions },
  }]);

  it('writes the owning lesson onto a definition the lesson keeps, and leaves a dictionary definition bare', () => {
    const scoped = scopeDefinitionLinks(linked([{ conceptKey: 'term.denominator', surface: '분모', scopeKind: 'lesson' }]), 'fraction-meaning');
    expect(scoped[0].payload.definitions).toEqual([{ conceptKey: 'term.denominator', surface: '분모', scopeKind: 'lesson', scopeKey: 'fraction-meaning' }]);
    // The shared dictionary is the absence of a scope, so nothing is written for it.
    const shared = scopeDefinitionLinks(linked([{ conceptKey: 'term.denominator', surface: '분모' }]), 'fraction-meaning');
    expect(shared[0].payload.definitions).toEqual([{ conceptKey: 'term.denominator', surface: '분모' }]);
  });

  it('never lets an annotation keep a scope the editor did not choose', () => {
    // An author who switches back to the dictionary must not leave the old lesson behind.
    const switched = scopeDefinitionLinks(linked([{ conceptKey: 'term.denominator', surface: '분모', scopeKey: 'other-lesson' }]), 'fraction-meaning');
    expect(switched[0].payload.definitions).toEqual([{ conceptKey: 'term.denominator', surface: '분모' }]);
    // And a lesson may only ever write its own name, whatever the payload said.
    const borrowed = scopeDefinitionLinks(linked([{ conceptKey: 'term.denominator', surface: '분모', scopeKind: 'lesson', scopeKey: 'other-lesson' }]), 'fraction-meaning');
    expect(borrowed[0].payload.definitions).toEqual([{ conceptKey: 'term.denominator', surface: '분모', scopeKind: 'lesson', scopeKey: 'fraction-meaning' }]);
  });

  it('leaves blocks that carry no definition links untouched', () => {
    const plain = [{ blockId: 'b1', kind: 'core.rich_text', typeVersion: 1, required: true, payload: { text: '본문' } }];
    // Returned as-is, so a document with no definition links is not rewritten on every save.
    expect(scopeDefinitionLinks(plain, 'fraction-meaning')[0]).toBe(plain[0]);
  });

  it('offers the scope as a choice the publishing schema accepts', () => {
    const form = blockFormOf({ kind: 'core.rich_text', typeVersion: 3 })!;
    const field = form.list!.fields.find((item) => item.key === 'scopeKind')!;
    expect(field.kind).toBe('select');
    expect(field.options!.map((option) => option.value)).toEqual(['', 'lesson']);
    // An unchosen scope is an empty string, which pruning drops before validation ever sees it.
    const pruned = pruneBlock({ blockId: 'b1', kind: 'core.rich_text', typeVersion: 3, required: true,
      payload: { text: '분모는 전체를 나눈 조각 수예요.', definitions: [{ conceptKey: 'term.denominator', surface: '분모', scopeKind: '' }] } });
    expect(pruned.payload.definitions).toEqual([{ conceptKey: 'term.denominator', surface: '분모' }]);
  });
});

describe('writing a definition', () => {
  it('offers only the blocks a definition may hold, and each one publishes as written', () => {
    const offered = definitionBlockForms.filter((form) => !form.retired);
    expect(offered.map((form) => form.kind)).not.toContain('core.problem_set');
    // A definition read while a question waits explains; it does not annotate further or ask.
    expect(offered.some((form) => form.kind === 'core.rich_text' && form.typeVersion === 3)).toBe(false);
    expect(offered.map((form) => form.kind)).toContain('core.scene');
    for (const form of offered) {
      expect(() => definitionBlockSchema.parse({ blockId: 'definition:block:1', kind: form.kind,
        typeVersion: form.typeVersion, required: true, payload: form.create() }), form.kind).not.toThrow();
    }
  });
});

describe('naming a version and a question for whoever is writing', () => {
  it('reads a version as the number it ends in, and leaves an unnumbered name alone', () => {
    expect(versionLabel('fraction-meaning:v4')).toBe('4판');
    expect(versionLabel('fraction-meaning:v12')).toBe('12판');
    expect(versionLabel('fraction-meaning:draft')).toBe('fraction-meaning:draft');
    expect(versionLabel('')).toBe('');
  });

  it('says which question is which by its first words, not by its name', () => {
    const problem = newProblem('fraction-meaning:practice-1:v2', []);
    expect(problemGist(problem)).toBe('여기에 문제를 씁니다.');
    const long = { ...problem, promptContent: [{ ...problem.promptContent[0],
      payload: { text: `${'가'.repeat(60)}`, definitions: [] } }] };
    expect(problemGist(long)).toHaveLength(43);
    expect(problemGist(long).endsWith('…')).toBe(true);
    // Line breaks in the source are not breaks in a one-line summary.
    const wrapped = { ...problem, promptContent: [{ ...problem.promptContent[0],
      payload: { text: '  첫 줄\n\n  둘째 줄  ', definitions: [] } }] };
    expect(problemGist(wrapped)).toBe('첫 줄 둘째 줄');
    // A formula cannot be drawn on one line, so the line says one is there.
    const math = { ...problem, promptContent: [{ ...problem.promptContent[0],
      payload: { text: '$\\frac{3}{7}$에서 분모는 어떤 수인가요?', definitions: [] } }] };
    expect(problemGist(math)).toBe('[식]에서 분모는 어떤 수인가요?');
    // A question whose prompt is only a drawing has no words to show, and says nothing rather than guessing.
    expect(problemGist({ ...problem, promptContent: [] })).toBe('');
  });
});

describe('copying what is already written', () => {
  const draftOf = (record: (typeof seedLessons)[number]) => ({
    lessonKey: record.public.lessonKey, versionId: `${record.public.lessonKey}:v9`,
    sectionIds: record.sections.map((section) => section.sectionId),
    blockIds: record.sections.flatMap((section) => section.contentBlocks.map((block) => block.blockId)),
    problemIds: record.problems.map((problem) => problem.problemVersionId),
  });

  it('gives a copied block its own name and leaves what it says alone', () => {
    const record = structuredClone(seedLessons[0]);
    const section = record.sections[0];
    const original = section.contentBlocks[0];
    const { block: made, problems } = copyBlock({ block: original, problems: [], role: section.role,
      sectionId: section.sectionId, ...draftOf(record) });
    expect(made.blockId).not.toBe(original.blockId);
    expect(draftOf(record).blockIds).not.toContain(made.blockId);
    expect(made.payload).toEqual(original.payload);
    expect(problems).toEqual([]);
  });

  it('copies the questions an activity holds, because a question belongs to one activity', () => {
    const record = structuredClone(seedLessons[0]);
    const section = record.sections.find((item) => item.contentBlocks.some((block) => block.kind === 'core.problem_set'))!;
    const activity = section.contentBlocks.find((block) => block.kind === 'core.problem_set')!;
    const held = problemsOfBlock(activity, record.problems as never);
    expect(held.length).toBeGreaterThan(0);

    const { block: made, problems } = copyBlock({ block: activity, problems: record.problems as never,
      role: section.role, sectionId: section.sectionId, ...draftOf(record) });
    expect(problems).toHaveLength(held.length);
    // The copy names its own questions, and no question is named by two activities.
    expect(made.payload.problemVersionIds).toEqual(problems.map((problem) => problem.problemVersionId));
    for (const problem of problems) expect(record.problems.map((item) => item.problemVersionId)).not.toContain(problem.problemVersionId);
    // The blocks inside a question carry its name, so they move with it.
    for (const problem of problems) {
      for (const block of [...problem.promptContent, ...problem.hints, ...problem.solution]) {
        expect(block.blockId.startsWith(problem.problemVersionId), block.blockId).toBe(true);
      }
    }
    // What the copy asks and accepts is what the original asked and accepted.
    expect(problems.map((problem) => problem.gradingSpec)).toEqual(held.map((problem) => problem.gradingSpec));
  });

  it('copies a step whole, and the result is a document publishing accepts', () => {
    const record = structuredClone(seedLessons[0]);
    const section = record.sections.find((item) => item.contentBlocks.some((block) => block.kind === 'core.problem_set'))!;
    const index = record.sections.indexOf(section);
    const made = copySection({ section, problems: record.problems as never, ...draftOf(record) });

    expect(made.section.sectionId).not.toBe(section.sectionId);
    expect(made.section.title).toBe(`${section.title} 사본`);
    const names = made.section.contentBlocks.map((block) => block.blockId);
    expect(new Set(names).size).toBe(names.length);
    for (const name of names) expect(draftOf(record).blockIds).not.toContain(name);

    record.sections = insertAfter(record.sections, index, made.section) as never;
    record.problems = [...record.problems, ...made.problems] as never;
    record.public.sectionCount = record.sections.length;
    expect(() => validateLesson(storedLessonOf(record))).not.toThrow();
    // The copied activity is a set of its own, so the copy's questions never share one with the original's.
    const copied = made.section.contentBlocks.find((block) => block.kind === 'core.problem_set')!;
    expect(copied.payload.problemSetId).not.toBe(section.contentBlocks.find((block) => block.kind === 'core.problem_set')!.payload.problemSetId);
    for (const set of setsOf(record)) expect(() => validateProblemSet(set)).not.toThrow();
  });

  it('keeps every copy out of the names already spoken for, however many are made', () => {
    const record = structuredClone(seedLessons[0]);
    const section = record.sections[0];
    const original = section.contentBlocks[0];
    const blockIds = draftOf(record).blockIds;
    const made: string[] = [];
    for (let round = 0; round < 4; round++) {
      const copy = copyBlock({ block: original, problems: [], role: section.role, sectionId: section.sectionId,
        ...draftOf(record), blockIds: [...blockIds, ...made] });
      expect(made).not.toContain(copy.block.blockId);
      made.push(copy.block.blockId);
    }
    expect(new Set(made).size).toBe(4);
  });

  it('names a copied question after the activity it will sit in', () => {
    const problem = newProblem('fraction-meaning:practice-1:v2', ['fraction.meaning']);
    const made = copyProblem(problem, 'fraction-meaning', 'practice', 'fraction-meaning:v2', [problem.problemVersionId]);
    expect(made.problemVersionId).not.toBe(problem.problemVersionId);
    expect(made.problemVersionId.endsWith(':v2')).toBe(true);
    expect(made.promptContent[0].blockId.startsWith(made.problemVersionId)).toBe(true);
    // The original is untouched by the copying.
    expect(problem.problemVersionId).toBe('fraction-meaning:practice-1:v2');
  });

  it('puts a copy right after what it was copied from', () => {
    expect(insertAfter(['a', 'b', 'c'], 1, 'b2')).toEqual(['a', 'b', 'b2', 'c']);
    expect(insertAfter(['a'], 0, 'a2')).toEqual(['a', 'a2']);
  });
});

describe('saying what a rule refused', () => {
  const paragraph = { blockId: 'b1', kind: 'core.rich_text', typeVersion: 1, required: true, payload: { text: '' } };

  it('names the field the way the block\u0027s own form names it', () => {
    expect(issueText({ message: 'Too small', field: 'text' }, paragraph)).toBe('글: Too small');
    // A field inside a repeated row is named by the row\u0027s own form.
    const linked = { ...paragraph, typeVersion: 3, payload: { text: '분모', definitions: [] } };
    expect(issueText({ message: 'Required', field: 'definitions.0.conceptKey' }, linked)).toBe('개념 키: Required');
  });

  it('drops the kind of block from the message, because the card already says it', () => {
    expect(issueText({ message: 'Invalid payload for core.rich_text@1: Too small', field: 'text' }, paragraph))
      .toBe('글: Too small');
    // The same message with no block to place it against is left exactly as the rule wrote it.
    expect(issueText({ message: 'Invalid payload for core.rich_text@1: Too small', field: 'text' }))
      .toBe('Invalid payload for core.rich_text@1: Too small');
  });

  it('says the rule alone when it was not about a field of the block', () => {
    expect(issueText({ message: 'Missing definition: definition.denominator' }, paragraph)).toBe('Missing definition: definition.denominator');
    expect(issueText({ message: 'Duplicate block id.', field: 'nothing' }, paragraph)).toBe('Duplicate block id.');
  });
});

describe('what an activity holds leaves with it', () => {
  const activity = (blockId: string, ids: string[]) =>
    ({ blockId, kind: 'core.problem_set', typeVersion: 2, required: true, payload: { problemSetId: `set-${blockId}`, problemSetVersionId: '', problemVersionIds: ids } });
  const lesson = (blocks: ReturnType<typeof activity>[], problems: string[]) => ({
    meta: { versionId: 'c:v2', title: '수업', summary: '한 줄', estimatedMinutes: 10, conceptKeys: ['s'] },
    sections: [{ sectionId: 'c:practice:v2', role: 'practice' as const, title: '연습', contentBlocks: blocks }],
    problems: problems.map((id) => newProblem(id, ['s'])),
  });

  it('calls a question loose when no activity in the lesson holds it', () => {
    const edit = lesson([activity('c:set:v2', ['p1'])], ['p1', 'p2']);
    expect(looseProblems(edit).map((problem) => problem.problemVersionId)).toEqual(['p2']);
  });

  it('disables activity-based review when that activity is removed, without affecting a separate pool', () => {
    const edit = { ...lesson([], ['p1']), reviewBlockId: 'removed' };
    expect(dropLooseProblems(edit).reviewBlockId).toBeNull();
    const separate = lesson([], []);
    expect(dropLooseProblems(separate)).toBe(separate);
  });

  it('drops what nothing holds, and leaves the edit alone when everything is held', () => {
    const edit = lesson([activity('c:set:v2', ['p1'])], ['p1', 'p2']);
    expect(dropLooseProblems(edit).problems.map((problem) => problem.problemVersionId)).toEqual(['p1']);
    // Nothing to drop means the very same value, so nothing downstream reads it as a change.
    const whole = lesson([activity('c:set:v2', ['p1'])], ['p1']);
    expect(dropLooseProblems(whole)).toBe(whole);
  });

  it('leaves a lesson publishing accepts after an activity is taken out', () => {
    const record = structuredClone(seedLessons[0]);
    const section = record.sections.find((item) => item.contentBlocks.some((block) => block.kind === 'core.problem_set'))!;
    const edit = {
      meta: { versionId: record.public.versionId, title: record.public.title, summary: record.public.summary,
        estimatedMinutes: record.public.estimatedMinutes, conceptKeys: [...record.public.conceptKeys] },
      sections: structuredClone(record.sections),
      problems: structuredClone(record.problems) as never,
    };
    const without = { ...edit, sections: edit.sections.filter((item) => item.sectionId !== section.sectionId) };
    // The questions the step held are loose now, and leave with it; the review pool keeps its own.
    // The record's questions include the review pool's, which no step shows, so those read as loose here too.
    expect(looseProblems(without).map((problem) => problem.problemVersionId).sort())
      .toEqual([...(section.contentBlocks[0].payload.problemVersionIds as string[]), ...record.review!.problemVersionIds].sort());
    record.sections = without.sections;
    record.public.sectionCount = record.sections.length;
    record.problems = dropLooseProblems(without).problems as never;
    expect(() => validateLesson(storedLessonOf(record))).not.toThrow();
  });
});
