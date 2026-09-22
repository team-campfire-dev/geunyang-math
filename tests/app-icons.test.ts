import { readFileSync, readdirSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

/**
 * The tab icon is the sidebar's brand mark, and it is now the same drawing at every size: a cat with
 * a set square leaning across its face. One filled ruler survives down to sixteen pixels, where an
 * outlined one closed into a blob, so there is no longer a simplified copy to keep in step.
 *
 * What there is instead is the same drawing written twice — as an inline `<svg>` in the `Brand`
 * component, and as a file Next serves on its own with no stylesheet and no bundler behind it.
 * Nothing links them, so this does: every stroke, and the palette they are painted in. A repaint of
 * the brand that forgets the icon leaves a tab showing the old one.
 *
 * The last rule is about the phone build. `scripts/build-mobile.mjs` copies a named list out of
 * `src/app` rather than the whole directory, so a metadata file that nobody imports — every icon,
 * and the card a shared link shows — ships on the web and silently misses the static export.
 */
const icons = readdirSync('src/app').filter((name) => /^(?:favicon|icon|apple-icon|opengraph-image|twitter-image)(?:\.alt)?\.(?:ico|svg|png|jpe?g|txt)$/.test(name));
const workspace = readFileSync('src/features/learning/learning-workspace.tsx', 'utf8');
const svg = readFileSync('src/app/icon.svg', 'utf8');
const brand = workspace.slice(workspace.indexOf('className="brand-mark"'), workspace.indexOf('</span>', workspace.indexOf('className="brand-mark"')));
const paths = (source: string) => [...source.matchAll(/ d="([^"]+)"/g)].map((match) => match[1]);

describe('the app icon', () => {
  it('draws exactly what the sidebar draws', () => {
    expect(paths(brand), '사이드바 브랜드 마크의 획').toHaveLength(9);
    expect(paths(svg), 'icon.svg의 획이 사이드바와 다르다').toEqual(paths(brand));
  });

  it('places the ruler where the sidebar places it', () => {
    // The face is scaled and shifted to make room for the ruler; the two have to agree on that too,
    // or the icon shows the same strokes in a different arrangement.
    const frame = /translate\(302 290\) scale\(0\.88\) translate\(-300 -305\)/g;
    expect(svg.match(frame), 'icon.svg의 얼굴 배치').toHaveLength(2);
    expect(brand.match(frame), '사이드바의 얼굴 배치').toHaveLength(2);
  });

  it('draws the paw the sidebar draws', () => {
    // The paw is an <ellipse>, not a path, so it would slip past the stroke comparison above.
    const paw = /<ellipse cx="226" cy="420" rx="58" ry="38" transform="rotate\(-14 226 420\)"/;
    expect(svg, 'icon.svg의 발').toMatch(paw);
    expect(brand, '사이드바의 발').toMatch(paw);
  });

  it('paints nothing outside the palette', () => {
    const used = [...new Set([...svg.matchAll(/#[0-9A-Fa-f]{6}/g)].map((match) => match[0].toUpperCase()))].sort();
    expect(used, 'icon.svg가 팔레트 밖의 색을 쓴다').toEqual(['#141414', '#D2674A', '#FAF6EE']);
  });

  it('has a favicon for browsers that will not read the svg one', () => {
    expect(icons).toContain('favicon.ico');
    expect(icons).toContain('icon.svg');
  });

  it('is carried into the phone bundle', () => {
    const mobile = readFileSync('scripts/build-mobile.mjs', 'utf8');
    for (const name of icons) expect(mobile, `${name}이 모바일 번들 복사 목록에 없다`).toContain(`'src/app/${name}'`);
  });
});
