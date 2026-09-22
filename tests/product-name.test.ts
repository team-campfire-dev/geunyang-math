import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * The product is called 그냥수학. That name was written down in seven places — two page titles, the
 * application name, the phone app's home-screen label, the footer, a footnote and the privacy
 * blurb — and nothing tied them together, so renaming it left the header saying one thing and the
 * footer another for a while. This holds them.
 *
 * What it does not touch is the Latin slug, which is not the name: the domain, the docker image,
 * the npm package, the deploy directory. And `AUTH_RETURN_STORAGE_KEY` least of all — that string
 * is a key in someone's browser right now, and renaming it would strand anyone mid-login.
 */
const NAME = '그냥수학';
const OLD = /geunyang[ _]math/i;

const walk = (dir: string): string[] => readdirSync(dir).flatMap((entry) => {
  const path = join(dir, entry);
  return statSync(path).isDirectory() ? walk(path) : /\.tsx?$/.test(path) ? [path] : [];
});
// Files that legitimately hold the slug rather than the name.
const SLUG_FILES = ['src/features/learning/auth-client.ts', 'src/app/layout.tsx'];
const sources = walk('src').filter((path) => !SLUG_FILES.includes(path));

describe('the product name', () => {
  it('is 그냥수학 everywhere it is shown', () => {
    const offenders = sources.filter((path) => OLD.test(readFileSync(path, 'utf8')));
    expect(offenders, `아직 옛 이름을 쓰는 파일: ${offenders.join(', ')}`).toEqual([]);
  });

  it('is what the browser tab and the phone home screen say', () => {
    const layout = readFileSync('src/app/layout.tsx', 'utf8');
    expect(layout).toContain(`title: '${NAME} ·`);
    expect(layout).toContain(`applicationName: '${NAME}'`);
    expect(readFileSync('capacitor.config.ts', 'utf8')).toContain(`appName: '${NAME}'`);
  });

  it('is drawn in the sidebar as the two-colour wordmark', () => {
    const workspace = readFileSync('src/features/learning/learning-workspace.tsx', 'utf8');
    expect(workspace, '사이드바 워드마크').toContain('<span className="brand-word">그냥<span>수학</span></span>');
  });

  it('leaves the latin slug alone where it is an identifier, not a name', () => {
    // Renaming this key strands anyone who is mid-login when the deploy lands.
    expect(readFileSync('src/features/learning/auth-client.ts', 'utf8')).toContain("'geunyang-math:google-return:v1'");
    expect(readFileSync('src/app/layout.tsx', 'utf8'), '기본 origin 도메인').toMatch(/geunyang-math\.[a-z.-]+/);
  });
});
