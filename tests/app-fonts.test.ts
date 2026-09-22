import { readFileSync, existsSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

/**
 * Three faces, each with a job: Pretendard reads, Gaegu writes the small labels and the asides, and
 * Plex Mono sets the figures. The stylesheet reaches all three through tokens, and the tokens are
 * fed by `next/font` variables declared in the root layout — a variable renamed on one side and not
 * the other does not fail a build, it just quietly serves the whole app in the system face.
 *
 * The body face is a file rather than a Google font because the phone bundle has to read offline,
 * and `scripts/build-mobile.mjs` copies a named list out of `src/app` instead of the directory, so
 * a self-hosted font that nobody adds to that list breaks only the static export.
 */
const layout = readFileSync('src/app/layout.tsx', 'utf8');
const globals = readFileSync('src/app/globals.css', 'utf8');
const mobile = readFileSync('scripts/build-mobile.mjs', 'utf8');

describe('the app’s three faces', () => {
  it('declares each one the stylesheet asks for', () => {
    for (const [token, variable] of [['--font', '--font-sans'], ['--hand', '--font-hand'], ['--mono', '--font-mono']]) {
      expect(globals, `globals.css가 ${token}을 쓰지 않는다`).toContain(`${token}:var(${variable})`);
      expect(layout, `layout.tsx가 ${variable}을 선언하지 않는다`).toContain(`variable: '${variable}'`);
      expect(layout, `${variable}이 <html>에 붙지 않았다`).toMatch(new RegExp(`\\.variable\\}`));
    }
  });

  it('self-hosts the body face so the phone reads it offline', () => {
    const src = layout.match(/src: '\.\/(fonts\/[^']+)'/)?.[1];
    expect(src, 'layout.tsx의 로컬 폰트 경로').toBeTruthy();
    expect(existsSync(`src/app/${src}`), `src/app/${src}이 없다`).toBe(true);
    expect(mobile, '폰트가 모바일 번들 복사 목록에 없다').toContain(`'src/app/fonts'`);
  });
});
