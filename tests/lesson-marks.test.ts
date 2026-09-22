import { readFileSync, readdirSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

/**
 * Every lesson card draws a mark chosen by the first piece of its key — `fraction-addition` gets the
 * bar cut into parts, `coordinate-plane` gets the axes. The table that does the choosing lives in
 * learning-workspace.tsx and cannot import the catalogue, so this holds the two together.
 *
 * Without it, a course added with an unfamiliar stem draws the fallback and nobody notices: the card
 * still looks fine, it just quietly says the wrong thing about what the lesson is. The catalogue is
 * read straight out of the seed bundles, which is where lesson keys are actually written down.
 */
const workspace = readFileSync('src/features/learning/learning-workspace.tsx', 'utf8');
const table = workspace.slice(workspace.indexOf('const MARK_BY_STEM'), workspace.indexOf('function LessonArt('));
const drawings = new Set([...workspace.slice(workspace.indexOf('const LESSON_MARKS'), workspace.indexOf('const MARK_BY_STEM'))
  .matchAll(/^ {2}([a-z]+): <g[ >]/gm)].map((match) => match[1]));
const mapped = new Map<string, string>();
for (const row of table.matchAll(/\['([a-z]+)', '([a-z ]+)'\]/g)) {
  for (const stem of row[2].split(' ')) mapped.set(stem, row[1]);
}

const stems = new Set<string>();
for (const file of readdirSync('prisma/seed').filter((name) => name.endsWith('.json'))) {
  const bundle = readFileSync(`prisma/seed/${file}`, 'utf8');
  for (const match of bundle.matchAll(/"lessonKey"\s*:\s*"([^"-]+)-?[^"]*"/g)) stems.add(match[1]);
}

describe('the drawing on a lesson card', () => {
  it('reads the catalogue it is meant to cover', () => {
    expect(stems.size, 'seed 번들에서 읽은 주제 수').toBeGreaterThan(50);
    expect(drawings.size, 'LESSON_MARKS의 그림 수').toBeGreaterThan(20);
  });

  it('has one for every topic the catalogue actually holds', () => {
    const uncovered = [...stems].filter((stem) => !mapped.has(stem)).sort();
    expect(uncovered, `그림이 없는 주제: ${uncovered.join(', ')}`).toEqual([]);
  });

  it('names only drawings that exist', () => {
    const dangling = [...new Set(mapped.values())].filter((mark) => !drawings.has(mark)).sort();
    expect(dangling, `없는 그림을 가리키는 항목: ${dangling.join(', ')}`).toEqual([]);
  });

  it('keeps no drawing that nothing points at, except the fallback', () => {
    // One drawing is deliberately unmapped: the one an unfamiliar key falls back to. A fallback that
    // names a drawing which no longer exists renders an empty plate and nothing else goes wrong,
    // which is exactly how the problem-set cards came to be blank.
    const fallback = workspace.match(/\?\? '([a-z]+)';/)?.[1];
    expect(fallback, 'LessonArt의 기본 그림').toBeTruthy();
    expect(drawings, `기본 그림 ${fallback}이 LESSON_MARKS에 없다`).toContain(fallback);
    const orphans = [...drawings].filter((mark) => mark !== fallback && ![...mapped.values()].includes(mark)).sort();
    expect(orphans, `아무도 쓰지 않는 그림: ${orphans.join(', ')}`).toEqual([]);
  });
});
