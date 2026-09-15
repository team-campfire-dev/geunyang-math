import { describe, expect, it } from 'vitest';
import { supportedBlockTypes, validateClass } from '@/core/content';
import {
  blockForms, blockFormOf, moveBlock, nextBlockId, nextSectionId, pruneBlock, pruneSections, suggestVersionId, writePath,
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
      // A question group is empty until an author picks questions, and picking is what validates it.
      if (form.picksProblems) { expect(form.create()).toEqual({ problemVersionIds: [] }); continue; }
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
