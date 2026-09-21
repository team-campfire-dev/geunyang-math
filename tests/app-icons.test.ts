import { readFileSync, readdirSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

/**
 * The tab icon is the sidebar's brand mark, kept in two places that cannot import each other: the
 * mark is a grid of `<i>` elements styled by `.brand-mark` in globals.css, and the icon is a file
 * Next serves on its own, with no stylesheet behind it. Nothing links the two but their colours, so
 * the colours are what this holds together — a repaint of the brand that forgets the icon leaves a
 * tab showing the old one.
 *
 * The second rule is about the phone build. `scripts/build-mobile.mjs` copies a named list out of
 * `src/app` rather than the whole directory, so a metadata file that nobody imports — which is
 * every icon — ships on the web and silently misses the static export.
 */
const icons = readdirSync('src/app').filter((name) => /^(?:favicon|icon|apple-icon)\.(?:ico|svg|png|jpe?g)$/.test(name));
const globals = readFileSync('src/app/globals.css', 'utf8');
const svg = readFileSync('src/app/icon.svg', 'utf8');
const colours = (source: string) => [...source.matchAll(/#[0-9a-f]{6}/g)].map((match) => match[0]);

describe('the app icon', () => {
  it('is drawn in the brand mark’s colours', () => {
    // `.brand-mark i` and its three overrides, in the order the grid lays them out.
    const last = globals.indexOf('.brand-mark i:last-child');
    const mark = colours(globals.slice(globals.indexOf('.brand-mark i{'), globals.indexOf('}', last)));
    expect(mark.length, '.brand-mark의 네 조각 색').toBe(4);
    expect(colours(svg), 'icon.svg의 색이 .brand-mark와 다르다').toEqual(mark);
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
