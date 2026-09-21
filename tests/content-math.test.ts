import { readFileSync, readdirSync } from 'node:fs';
import katex from 'katex';
import { describe, expect, it } from 'vitest';
import { parseContentBundle } from '@/core/content-bundle';
import { mathOptions, splitRichText } from '@/shared/rich-text';
import type { StoredLesson } from '@/core/content';

/**
 * Every formula the catalogue ships, put through the renderer the app actually uses.
 *
 * KaTeX does not fail loudly on a formula it cannot set: with `throwOnError: false` it draws the
 * TeX source in red and carries on. So `$\dfrac{1}{2} \times 호 \times 반지름$` reached learners as
 * literal backslashes in a hint, and nothing caught it — the page rendered, it just rendered the
 * wrong thing. A Hangul word standing bare in math mode is the way this happens; Korean belongs in
 * prose, or inside `\text{}` when a formula has to name a quantity.
 */
const files = [...readdirSync('prisma/seed').map((name) => `prisma/seed/${name}`),
  ...readdirSync('content').map((name) => `content/${name}`)].filter((name) => name.endsWith('.json'));
const bundles = files.map((name) => ({ name, bundle: parseContentBundle(JSON.parse(readFileSync(name, 'utf8'))) }));

/** The newest of each, which is what a learner is shown. A version that already shipped cannot be
 *  edited, so holding the superseded ones to this would be a rule nothing could ever satisfy. */
const current = <T,>(rows: T[], keyOf: (row: T) => string) =>
  [...new Map(rows.map((row) => [keyOf(row), row])).values()];

/** Every string the renderer will hand to KaTeX, with somewhere to point when one of them breaks. */
function* written() {
  for (const { name, bundle } of bundles) {
    for (const lesson of current(bundle.lessons as StoredLesson[], (item) => item.public.lessonKey)) {
      for (const section of lesson.sections) {
        for (const block of section.contentBlocks) yield { where: block.blockId, name, payload: block.payload };
      }
    }
    for (const set of current(bundle.problemSets, (item) => item.problemSetId)) {
      for (const problem of set.problems) {
        for (const block of [...problem.promptContent, ...problem.hints, ...problem.solution]) {
          yield { where: `${problem.problemVersionId}의 ${block.blockId}`, name, payload: block.payload };
        }
      }
    }
    for (const definition of bundle.definitions ?? []) {
      for (const block of definition.blocks) yield { where: block.blockId, name, payload: block.payload };
    }
  }
}

const broken = (equation: string, display: boolean) =>
  katex.renderToString(equation, { ...mathOptions, displayMode: display }).includes('katex-error');

describe('the math the catalogue ships', () => {
  it('draws every formula, instead of printing its TeX at the learner', () => {
    const failures: string[] = [];
    for (const { where, name, payload } of written()) {
      const text = typeof payload.text === 'string' ? payload.text : '';
      for (const segment of splitRichText(text)) {
        if (segment.kind !== 'math') continue;
        if (broken(segment.equation, segment.display)) failures.push(`${name} ${where}: ${segment.value}`);
      }
    }
    expect(failures, '수식이 그려지지 않고 TeX 그대로 나온다').toEqual([]);
  });

  it('catches a Hangul word left standing in math mode, which is how this breaks', () => {
    expect(broken('\\dfrac{1}{2} \\times 호 \\times 반지름', false)).toBe(true);
    // The way to name a quantity inside a formula, for when prose cannot carry it.
    expect(broken('\\text{평균} = \\frac{\\text{합계}}{\\text{개수}}', false)).toBe(false);
  });
});
