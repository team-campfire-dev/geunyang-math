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
    // 판 하나에, 시안에서 그대로 옮겨 온 여덟 획.
    expect(paths(brand), '사이드바 브랜드 마크의 획').toHaveLength(9);
    expect(paths(svg), 'icon.svg의 획이 사이드바와 다르다').toEqual(paths(brand));
  });

  it('sets the drawing on the plate the way the sidebar does', () => {
    // 시안은 제 좌표계로 그려져 있고, 이 한 줄이 그것을 판 가운데로 옮긴다. 양쪽이 같아야 같은 자리에 선다.
    const frame = /translate\(-125\.6 -72\.9\) scale\(1\.9\)/g;
    expect(svg.match(frame), 'icon.svg의 배치').toHaveLength(1);
    expect(brand.match(frame), '사이드바의 배치').toHaveLength(1);
  });

  it('leaves the middle of the set square open', () => {
    // 자의 속은 한 길 안의 둘째 고리다. even-odd가 아니면 메워져 통짜 삼각형이 된다.
    expect(brand, '사이드바의 삼각자').toMatch(/fillRule="evenodd"/);
    expect(svg, 'icon.svg의 삼각자').toMatch(/fill-rule="evenodd"/);
  });

  it('keeps the strokes at the weights the reference drew them', () => {
    // 굵기는 시안 좌표계의 값 그대로다. 한쪽만 손대면 같은 그림이 다른 무게로 나온다.
    const widths = (source: string, attribute: string) =>
      [...source.matchAll(new RegExp(`${attribute}="(\\d+)"`, 'g'))].map((match) => match[1]);
    expect(widths(svg, 'stroke-width'), 'icon.svg의 획 굵기').toEqual(['13', '11', '10', '12']);
    expect(widths(brand, 'strokeWidth'), '사이드바의 획 굵기').toEqual(widths(svg, 'stroke-width'));
  });

  it('paints nothing outside the palette', () => {
    const used = [...new Set([...svg.matchAll(/#[0-9A-Fa-f]{6}/g)].map((match) => match[0].toUpperCase()))].sort();
    expect(used, 'icon.svg가 팔레트 밖의 색을 쓴다').toEqual(['#141414', '#D2674A', '#FAF6EE']);
  });

  it('has a favicon for browsers that will not read the svg one', () => {
    expect(icons).toContain('favicon.ico');
    expect(icons).toContain('icon.svg');
  });

  it('is made from the svg rather than by hand', () => {
    // 아이콘·홈 화면 아이콘·공유 카드는 전부 icon.svg에서 뽑아 낸 그림 파일이다. 손으로 만들어 넣으면
    // 마크가 바뀐 뒤에도 옛 그림이 남고, 무엇으로 만들었는지 아무도 모르게 된다.
    const script = readFileSync('scripts/build-brand-images.py', 'utf8');
    for (const name of icons) {
      if (name === 'icon.svg' || name.endsWith('.txt')) continue;
      expect(script, `${name}을 만드는 자리가 scripts/build-brand-images.py에 없다`).toContain(name);
    }
    expect(readFileSync('package.json', 'utf8'), 'brand:images 스크립트').toContain('build-brand-images.py');
  });

  it('is carried into the phone bundle', () => {
    const mobile = readFileSync('scripts/build-mobile.mjs', 'utf8');
    for (const name of icons) expect(mobile, `${name}이 모바일 번들 복사 목록에 없다`).toContain(`'src/app/${name}'`);
  });
});
