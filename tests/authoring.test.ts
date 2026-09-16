import { describe, expect, it } from 'vitest';
import { supportedBlockTypes, termContentBlockSchema, validateClass } from '@/core/content';
import {
  blockForms, blockFormOf, classBlockForms, copyBlock, copyProblem, copySection, insertAfter, moveBlock, newProblem,
  nextBlockId, nextProblemBlockId, nextProblemVersionId,
  nextSectionId, problemBlockForms, problemGist, problemsOfBlock, pruneBlock, pruneSections, renameProblem,
  renameProblemReferences, renamedProblemVersionId, nextTermVersionId, responseSpecOf, scopeTermAnnotations,
  suggestVersionId, termBlockForms, toPublicProblem, versionLabel, writePath,
} from '@/shared/authoring';
import { seedClasses } from './fixtures/content';

const block = (kind: string, typeVersion: number, payload: Record<string, unknown>) =>
  ({ blockId: 'draft:block:v1', kind, typeVersion, required: true, payload });

describe('naming a new version and its parts', () => {
  it('suggests the next version of the class, not a copy of the published one', () => {
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
    const record = structuredClone(seedClasses[0]);
    const section = record.sections[0];
    section.contentBlocks.push({ ...block('core.rich_text', 1, { text: '새 문단이에요.' }),
      blockId: nextBlockId(record.public.classKey, section.sectionId, 'core.rich_text', 'fraction-meaning:v5', []) });
    expect(() => validateClass(record)).not.toThrow();
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
    // Published classes still hold these, so an author must be able to open one and read it.
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
    // A lesson's paragraph is the one that can carry term links; a definition's is the one that cannot.
    expect(paragraphs(classBlockForms).map((form) => form.typeVersion)).toEqual([2]);
    expect(paragraphs(problemBlockForms).map((form) => form.typeVersion)).toEqual([2]);
    expect(paragraphs(termBlockForms).map((form) => form.typeVersion)).toEqual([1]);
    // Both are called the same thing, because to whoever is writing they are the same thing.
    expect([...new Set(paragraphs(blockForms).map((form) => form.label))]).toEqual(['글']);
    // The older one still opens, so a class published with it can be read and edited.
    expect(blockFormOf({ kind: 'core.rich_text', typeVersion: 1 })).toBeDefined();
  });

  it('starts every new block at a payload the validator already accepts', () => {
    for (const form of blockForms) {
      // A question group is empty until an author writes a question, and writing one validates it.
      if (form.editsProblems) { expect(form.create()).toEqual({ problemVersionIds: [] }); continue; }
      const record = structuredClone(seedClasses[0]);
      const section = record.sections[0];
      section.contentBlocks.push({ blockId: `draft:${form.kind}:v1`, kind: form.kind, typeVersion: form.typeVersion,
        required: true, payload: form.create() } as never);
      expect(() => validateClass(record), `${form.kind}@${form.typeVersion}`).not.toThrow();
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
    const record = structuredClone(seedClasses[0]);
    const withBlank = (labelAlt: string) => {
      const draft = structuredClone(record);
      draft.sections[0].contentBlocks.push(block('math.fraction_strip', 1,
        { parts: 4, filled: 3, label: '$\\frac{3}{4}$', labelAlt }) as never);
      return { ...draft, sections: pruneSections(draft.sections) as typeof draft.sections };
    };
    // Pruned, a blank spoken name is absent, and a math caption without one is rejected by name.
    expect(() => validateClass(withBlank(''))).toThrow(/labelAlt/);
    expect(() => validateClass(withBlank('4분의 3'))).not.toThrow();
  });
});

describe('naming a question, and keeping an answered one as it was answered', () => {
  const classKey = 'fraction-meaning';
  it('names a new question after the activity that holds it', () => {
    expect(nextProblemVersionId(classKey, 'practice', 'fraction-meaning:v5', [])).toBe('fraction-meaning:practice-1:v5');
    expect(nextProblemVersionId(classKey, 'practice', 'fraction-meaning:v5', ['fraction-meaning:practice-1:v5']))
      .toBe('fraction-meaning:practice-2:v5');
    // A question carried from an earlier version still holds its name, so a new one takes the next.
    expect(nextProblemVersionId(classKey, 'practice', 'fraction-meaning:v5', ['fraction-meaning:practice-1:v2']))
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
    const record = structuredClone(seedClasses[0]);
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
    const record = structuredClone(seedClasses[0]);
    const activity = record.sections.flatMap((section) => section.contentBlocks).find((block) => block.kind === 'core.problem_set')!;
    const created = newProblem(nextProblemVersionId(classKey, 'practice', 'fraction-meaning:v5',
      record.problems.map((problem) => problem.problemVersionId)), record.problems[0].skillKeys);
    record.problems.push({ ...created, responseSpec: responseSpecOf(created.gradingSpec), hintAvailable: created.hints.length > 0 });
    (activity.payload.problemVersionIds as string[]).push(created.problemVersionId);
    expect(() => validateClass(record)).not.toThrow();
  });

  it('shows the preview the half of a question a learner may see', () => {
    const problem = newProblem('fraction-meaning:practice-1:v2', ['fraction.meaning']);
    expect(toPublicProblem(problem)).toEqual({ problemVersionId: problem.problemVersionId, skillKeys: ['fraction.meaning'],
      promptContent: problem.promptContent, responseSpec: { kind: 'rational' }, hintAvailable: false });
    problem.hints.push({ blockId: 'fraction-meaning:practice-1:v2:hint', kind: 'core.rich_text', typeVersion: 1, required: true, payload: { text: '힌트' } });
    problem.gradingSpec = { kind: 'rational', numerator: 1, denominator: 2, requiredForm: 'reduced_fraction' };
    expect(toPublicProblem(problem)).toMatchObject({ hintAvailable: true, responseSpec: { kind: 'rational', requiredForm: 'reduced_fraction' } });
  });
});

describe('which class keeps a linked term', () => {
  const linked = (terms: Record<string, unknown>[]) => ([{
    blockId: 'fraction-meaning:explanation:text:v5', kind: 'core.rich_text', typeVersion: 2, required: true,
    payload: { text: '분모는 전체를 나눈 조각 수예요.', terms },
  }]);

  it('writes the owning class onto a term the class keeps, and leaves a dictionary term bare', () => {
    const scoped = scopeTermAnnotations(linked([{ termKey: 'term.denominator', surface: '분모', scopeKind: 'class' }]), 'fraction-meaning');
    expect(scoped[0].payload.terms).toEqual([{ termKey: 'term.denominator', surface: '분모', scopeKind: 'class', scopeKey: 'fraction-meaning' }]);
    // The shared dictionary is the absence of a scope, so nothing is written for it.
    const shared = scopeTermAnnotations(linked([{ termKey: 'term.denominator', surface: '분모' }]), 'fraction-meaning');
    expect(shared[0].payload.terms).toEqual([{ termKey: 'term.denominator', surface: '분모' }]);
  });

  it('never lets an annotation keep a scope the editor did not choose', () => {
    // An author who switches back to the dictionary must not leave the old class behind.
    const switched = scopeTermAnnotations(linked([{ termKey: 'term.denominator', surface: '분모', scopeKey: 'other-class' }]), 'fraction-meaning');
    expect(switched[0].payload.terms).toEqual([{ termKey: 'term.denominator', surface: '분모' }]);
    // And a class may only ever write its own name, whatever the payload said.
    const borrowed = scopeTermAnnotations(linked([{ termKey: 'term.denominator', surface: '분모', scopeKind: 'class', scopeKey: 'other-class' }]), 'fraction-meaning');
    expect(borrowed[0].payload.terms).toEqual([{ termKey: 'term.denominator', surface: '분모', scopeKind: 'class', scopeKey: 'fraction-meaning' }]);
  });

  it('leaves blocks that carry no term links untouched', () => {
    const plain = [{ blockId: 'b1', kind: 'core.rich_text', typeVersion: 1, required: true, payload: { text: '본문' } }];
    // Returned as-is, so a document with no term links is not rewritten on every save.
    expect(scopeTermAnnotations(plain, 'fraction-meaning')[0]).toBe(plain[0]);
  });

  it('offers the scope as a choice the publishing schema accepts', () => {
    const form = blockFormOf({ kind: 'core.rich_text', typeVersion: 2 })!;
    const field = form.list!.fields.find((item) => item.key === 'scopeKind')!;
    expect(field.kind).toBe('select');
    expect(field.options!.map((option) => option.value)).toEqual(['', 'class']);
    // An unchosen scope is an empty string, which pruning drops before validation ever sees it.
    const pruned = pruneBlock({ blockId: 'b1', kind: 'core.rich_text', typeVersion: 2, required: true,
      payload: { text: '분모는 전체를 나눈 조각 수예요.', terms: [{ termKey: 'term.denominator', surface: '분모', scopeKind: '' }] } });
    expect(pruned.payload.terms).toEqual([{ termKey: 'term.denominator', surface: '분모' }]);
  });
});

describe('writing a definition', () => {
  it('names the next version after the scope that keeps the term', () => {
    const shared = { termKey: 'term.denominator', scopeKind: 'global' as const, scopeKey: '' };
    expect(nextTermVersionId(shared, [])).toBe('term.denominator:v1');
    expect(nextTermVersionId(shared, ['term.denominator:v1', 'term.denominator:v2'])).toBe('term.denominator:v3');
    const mine = { termKey: 'term.denominator', scopeKind: 'class' as const, scopeKey: 'fraction-meaning' };
    expect(nextTermVersionId(mine, [])).toBe('fraction-meaning:term.denominator:v1');
    // The two scopes count separately, so one class's versions never push the dictionary along.
    expect(nextTermVersionId(mine, ['fraction-meaning:term.denominator:v1'])).toBe('fraction-meaning:term.denominator:v2');
    expect(nextTermVersionId(shared, ['fraction-meaning:term.denominator:v7'])).toBe('term.denominator:v1');
  });

  it('offers only the blocks a definition may hold, and each one publishes as written', () => {
    const offered = termBlockForms.filter((form) => !form.retired);
    expect(offered.map((form) => form.kind)).not.toContain('core.problem_set');
    // A definition read while a question waits explains; it does not annotate further or ask.
    expect(offered.some((form) => form.kind === 'core.rich_text' && form.typeVersion === 2)).toBe(false);
    expect(offered.map((form) => form.kind)).toContain('core.scene');
    for (const form of offered) {
      expect(() => termContentBlockSchema.parse({ blockId: 'term:block:1', kind: form.kind,
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
      payload: { text: `${'가'.repeat(60)}`, terms: [] } }] };
    expect(problemGist(long)).toHaveLength(43);
    expect(problemGist(long).endsWith('…')).toBe(true);
    // Line breaks in the source are not breaks in a one-line summary.
    const wrapped = { ...problem, promptContent: [{ ...problem.promptContent[0],
      payload: { text: '  첫 줄\n\n  둘째 줄  ', terms: [] } }] };
    expect(problemGist(wrapped)).toBe('첫 줄 둘째 줄');
    // A formula cannot be drawn on one line, so the line says one is there.
    const math = { ...problem, promptContent: [{ ...problem.promptContent[0],
      payload: { text: '$\\frac{3}{7}$에서 분모는 어떤 수인가요?', terms: [] } }] };
    expect(problemGist(math)).toBe('[식]에서 분모는 어떤 수인가요?');
    // A question whose prompt is only a drawing has no words to show, and says nothing rather than guessing.
    expect(problemGist({ ...problem, promptContent: [] })).toBe('');
  });
});

describe('copying what is already written', () => {
  const draftOf = (record: (typeof seedClasses)[number]) => ({
    classKey: record.public.classKey, versionId: `${record.public.classKey}:v9`,
    sectionIds: record.sections.map((section) => section.sectionId),
    blockIds: record.sections.flatMap((section) => section.contentBlocks.map((block) => block.blockId)),
    problemIds: record.problems.map((problem) => problem.problemVersionId),
  });

  it('gives a copied block its own name and leaves what it says alone', () => {
    const record = structuredClone(seedClasses[0]);
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
    const record = structuredClone(seedClasses[0]);
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
    const record = structuredClone(seedClasses[0]);
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
    expect(() => validateClass(record)).not.toThrow();
  });

  it('keeps every copy out of the names already spoken for, however many are made', () => {
    const record = structuredClone(seedClasses[0]);
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
