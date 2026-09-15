import { describe, expect, it } from 'vitest';
import { supportedBlockTypes, validateClass } from '@/core/content';
import {
  blockForms, blockFormOf, moveBlock, newProblem, nextBlockId, nextProblemBlockId, nextProblemVersionId, nextSectionId,
  problemsOfBlock, pruneBlock, pruneSections, renameProblem, renameProblemReferences, renamedProblemVersionId,
  responseSpecOf, scopeTermAnnotations, suggestVersionId, toPublicProblem, writePath,
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
