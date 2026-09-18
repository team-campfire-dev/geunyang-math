import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

/**
 * A drawing is stretched to the width it was given, and the buttons that play it are not. Both live
 * inside the same figure, so the rule that sizes the drawing has to name the drawing — a descendant
 * rule reached the play and step icons too and drew each at whatever its button's box happened to
 * be. The icon buttons only looked right because their padding made that box 16px by coincidence.
 *
 * jsdom applies no stylesheet, so a render test cannot see this. The stylesheet itself is read.
 */
const sheets = {
  'globals.css': { css: readFileSync('src/app/globals.css', 'utf8'), figure: 'scene-figure' },
  'editor.css': { css: readFileSync('src/app/editor.css', 'utf8'), figure: 'scene-canvas' },
};

describe('the rule that sizes a drawing', () => {
  for (const [name, { css, figure }] of Object.entries(sheets)) {
    it(`names the drawing itself in ${name}, never every svg inside the figure`, () => {
      // `.scene-figure svg { … }` would also catch the play button's icon; `> svg` cannot.
      const stretching = [...css.matchAll(new RegExp(`\\.${figure}\\s+svg\\s*\\{([^}]*)\\}`, 'g'))]
        .filter((match) => /width|height/.test(match[1]));
      expect(stretching.map((match) => match[0]), `${figure} 안의 모든 svg를 잡는 규칙`).toEqual([]);
      expect(css).toContain(`.${figure} > svg`);
    });
  }
});
