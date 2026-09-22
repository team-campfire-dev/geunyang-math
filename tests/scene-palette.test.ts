import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { scenePalette, sceneColorLabels, sceneColors } from '@/shared/scene';

/**
 * A drawing in a lesson names its colours — `ink`, `orange` — and the palette turns each name into a
 * CSS value. When the app's own tokens were renamed, four of those names kept pointing at custom
 * properties that no longer existed, and nothing anywhere said so: an undefined `var()` computes to
 * black in a `fill` and to `none` in a `stroke`, so 108 of 127 lessons quietly drew black text and
 * invisible lines. A build cannot catch that and neither can a type.
 *
 * So this walks the other way: every property the palette reaches for has to be one the stylesheet
 * actually defines.
 */
const globals = readFileSync('src/app/globals.css', 'utf8');
const root = globals.slice(globals.indexOf(':root{'), globals.indexOf('}', globals.indexOf(':root{')));
const defined = new Set([...root.matchAll(/(--[a-z0-9-]+)\s*:/g)].map((m) => m[1]));

const walk = (dir: string): string[] => readdirSync(dir).flatMap((entry) => {
  const path = join(dir, entry);
  return statSync(path).isDirectory() ? walk(path) : /\.tsx?$/.test(path) ? [path] : [];
});

describe('the palette a drawing paints from', () => {
  it('names only custom properties the stylesheet defines', () => {
    const dangling = Object.entries(scenePalette)
      .map(([name, value]) => [name, /var\((--[a-z0-9-]+)\)/.exec(value)?.[1]] as const)
      .filter(([, token]) => token && !defined.has(token));
    expect(dangling.map(([name, token]) => `${name} → ${token}`), '없는 토큰을 가리키는 색').toEqual([]);
  });

  it('gives every colour a name an author can read', () => {
    for (const colour of sceneColors) {
      expect(sceneColorLabels[colour], `${colour}의 한국어 이름`).toBeTruthy();
    }
    expect(Object.keys(sceneColorLabels).sort()).toEqual([...sceneColors].sort());
  });

  it('keeps the keys published content already uses', () => {
    // Renaming a key would mean rewriting every bundle, so the keys are fixed even where the name
    // has outlived the colour it describes.
    for (const key of ['ink', 'muted', 'line', 'paper', 'white', 'green', 'deep-green', 'light-green', 'orange', 'fill', 'fill-soft', 'sand', 'sky', 'none']) {
      expect(sceneColors, `${key}는 발행된 콘텐츠가 쓰는 이름`).toContain(key);
    }
  });

  it('is the only place a drawing colour is decided', () => {
    // A hex sitting in a renderer is a colour no author can pick and no palette change can reach.
    const renderers = walk('src/features/learning').filter((p) => /content-blocks|scene/.test(p));
    const strays = renderers.flatMap((p) => [...readFileSync(p, 'utf8').matchAll(/#[0-9a-fA-F]{6}\b/g)].map((m) => `${p}: ${m[0]}`));
    expect(strays, '렌더러에 박힌 색').toEqual([]);
  });
});
