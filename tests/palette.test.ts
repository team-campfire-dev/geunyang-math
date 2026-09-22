import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

/**
 * The palette is paper, ink and one clay accent — every hue it uses sits between 8° and 62° on the
 * wheel. Green kept coming back anyway, three times, because each sweep only knew one way of
 * writing a colour: first the six-digit hexes went, then the ones under 12% saturation were found
 * still there, then the eight-digit ones carrying alpha — shadows, ruled lines, and the scrim
 * behind a modal, which tinted the whole page green the moment anything opened.
 *
 * So this reads the stylesheets the way a browser does: whatever notation a colour is written in,
 * it has a hue, and the hue is what is checked. Three percent is where a tint stops reading as a
 * neutral. Anything outside the warm band has to be named below with the reason it is there.
 */
const NAMED_EXCEPTIONS = new Map([
  ['#4e84b0', '그림의 둘째 색 — 파란펜. --accent-2'],
  ['#4285f4', 'Google 로그인 버튼의 브랜드 파랑 — 규정상 바꿀 수 없다'],
  ['#3c4043', 'Google 로그인 버튼의 그림자 — 같은 규정'],
]);

const hsl = (r: number, g: number, b: number) => {
  const [R, G, B] = [r, g, b].map((v) => v / 255);
  const mx = Math.max(R, G, B), mn = Math.min(R, G, B), d = mx - mn, l = (mx + mn) / 2;
  let h = 0;
  if (d) { h = mx === R ? ((G - B) / d + (G < B ? 6 : 0)) : mx === G ? (B - R) / d + 2 : (R - G) / d + 4; h *= 60; }
  return { h: Math.round(h), s: Math.round(d ? (d / (1 - Math.abs(2 * l - 1))) * 100 : 0) };
};

/** Every colour in a stylesheet, in every notation that can carry a hue. */
function* colours(css: string): Generator<{ text: string; r: number; g: number; b: number }> {
  const hex = /#([0-9a-fA-F]{8}|[0-9a-fA-F]{6}|[0-9a-fA-F]{3,4})\b(?![0-9a-fA-F])/g;
  for (const m of css.matchAll(hex)) {
    const raw = m[1];
    const full = raw.length <= 4 ? [...raw.slice(0, 3)].map((c) => c + c).join('') : raw.slice(0, 6);
    yield { text: m[0], r: parseInt(full.slice(0, 2), 16), g: parseInt(full.slice(2, 4), 16), b: parseInt(full.slice(4, 6), 16) };
  }
  for (const m of css.matchAll(/rgba?\(\s*(\d+)[,\s]+(\d+)[,\s]+(\d+)/g)) {
    yield { text: m[0], r: +m[1], g: +m[2], b: +m[3] };
  }
  // Colour keywords that carry a hue, as a value — never as part of a name like `--light-green`
  // or a word inside a comment. `white`, `black` and `transparent` carry no hue and are fine.
  for (const m of css.matchAll(/:\s*(green|olive|teal|lime|seagreen|darkgreen|olivedrab|darkseagreen|blue|navy|purple|red|orange|yellow|pink|brown)\s*(?:;|}|!)/gi)) {
    yield { text: m[1], r: -1, g: -1, b: -1 };
  }
}

describe('the stylesheet palette', () => {
  for (const file of ['src/app/globals.css', 'src/app/editor.css']) {
    it(`${file.split('/').pop()}는 따뜻한 대역 밖의 색을 남기지 않는다`, () => {
      const strays: string[] = [];
      for (const c of colours(readFileSync(file, 'utf8').replace(/\/\*[\s\S]*?\*\//g, ' '))) {
        if (c.r < 0) { strays.push(`${c.text} (색 이름)`); continue; }
        const key = `#${[c.r, c.g, c.b].map((v) => v.toString(16).padStart(2, '0')).join('')}`;
        if (NAMED_EXCEPTIONS.has(key)) continue;
        const { h, s } = hsl(c.r, c.g, c.b);
        if (s < 3) continue;                    // a neutral has no hue to be wrong about
        if (h >= 8 && h <= 62) continue;        // paper, ink, clay
        strays.push(`${c.text} → h${h} s${s}`);
      }
      expect([...new Set(strays)], '팔레트 밖 색').toEqual([]);
    });
  }

  it('예외는 이유와 함께만 둔다', () => {
    const css = readFileSync('src/app/globals.css', 'utf8');
    for (const [hex, why] of NAMED_EXCEPTIONS) {
      expect(why, `${hex}의 사유`).toBeTruthy();
      expect(css.toLowerCase(), `${hex}가 더는 쓰이지 않으면 예외에서 빼야 한다`).toContain(hex);
    }
  });
});
