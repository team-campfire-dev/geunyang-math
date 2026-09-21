import { spawnSync } from 'node:child_process';
import { cp, mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);

function apiOrigin() {
  const raw = process.env.NEXT_PUBLIC_API_ORIGIN;
  if (!raw) {
    throw new Error('NEXT_PUBLIC_API_ORIGIN is required. Set the HTTPS origin of the deployed API before building a mobile bundle.');
  }
  let url;
  try {
    url = new URL(raw);
  } catch {
    throw new Error('NEXT_PUBLIC_API_ORIGIN must be an absolute HTTP(S) origin.');
  }
  if (url.username || url.password || url.search || url.hash || url.pathname !== '/') {
    throw new Error('NEXT_PUBLIC_API_ORIGIN must contain only an origin, without credentials, path, query, or fragment.');
  }
  const loopback = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
  const localDevelopment = process.env.MOBILE_ALLOW_LOCAL_API === '1'
    && process.env.NODE_ENV !== 'production' && !process.env.CI;
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && loopback && localDevelopment)) {
    throw new Error('Mobile API origin must use HTTPS. Local development alone may opt into HTTP loopback with MOBILE_ALLOW_LOCAL_API=1.');
  }
  return url.origin;
}

async function copyClientPath(stage, relativePath, optional = false) {
  const source = path.join(root, relativePath);
  try {
    await stat(source);
  } catch (error) {
    if (optional && error.code === 'ENOENT') return;
    throw error;
  }
  await cp(source, path.join(stage, relativePath), {
    recursive: true,
    // Test fixtures and test modules can depend on server-only implementations.
    filter: (sourcePath) => !/(?:^|[/\\])(?:__tests__|__fixtures__)(?:[/\\]|$)|\.(?:test|spec)\.[cm]?[jt]sx?$/.test(sourcePath),
  });
}

async function buildMobile() {
  const origin = apiOrigin();
  const scratch = path.join(root, '.mobile-build');
  await mkdir(scratch, { recursive: true });
  const stage = await mkdtemp(path.join(scratch, 'bundle-'));

  try {
    // Copy only the browser surface. The original checkout is never renamed or edited.
    // An accidental import of @/server or @/core consequently fails resolution here.
    for (const relativePath of [
      'src/shared',
      'src/features',
      'src/app/page.tsx',
      'src/app/privacy',
      'src/app/layout.tsx',
      'src/app/globals.css',
      // Next reads these by name, so they are files rather than imports and have to be listed.
      // `tests/app-icons.test.ts` holds this list against what src/app actually holds.
      'src/app/favicon.ico',
      'src/app/icon.svg',
      'src/app/apple-icon.png',
    ]) {
      await copyClientPath(stage, relativePath);
    }
    await copyClientPath(stage, 'public', true);

    const sourcePackage = JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8'));
    const clientDependencies = Object.fromEntries(
      ['next', 'react', 'react-dom', 'zod', 'katex']
        .filter((name) => sourcePackage.dependencies[name])
        .map((name) => [name, sourcePackage.dependencies[name]]),
    );
    await writeFile(path.join(stage, 'package.json'), JSON.stringify({
      name: 'geunyang-math-mobile-bundle',
      version: sourcePackage.version,
      private: true,
      dependencies: clientDependencies,
    }, null, 2));

    const sourceTsconfig = JSON.parse(await readFile(path.join(root, 'tsconfig.json'), 'utf8'));
    await writeFile(path.join(stage, 'tsconfig.json'), JSON.stringify({
      compilerOptions: {
        ...sourceTsconfig.compilerOptions,
        baseUrl: '.',
        paths: { '@/*': ['./src/*'] },
        incremental: false,
      },
      include: ['next-env.d.ts', 'src/**/*.ts', 'src/**/*.tsx', '.next/types/**/*.ts'],
      exclude: ['node_modules'],
    }, null, 2));
    await writeFile(path.join(stage, 'next-env.d.ts'),
      '/// <reference types="next" />\n/// <reference types="next/image-types/global" />\n');
    await writeFile(path.join(stage, 'next.config.mjs'), `
export default {
  output: 'export',
  trailingSlash: true,
  images: { unoptimized: true },
  poweredByHeader: false,
  reactStrictMode: true,
};
`);

    console.log(`[mobile] Building browser bundle against ${origin}`);
    // Webpack resolves the already installed repository node_modules through its parents.
    // No second npm install, node_modules copy, or source-directory symlink is needed.
    const build = spawnSync(process.execPath, [require.resolve('next/dist/bin/next'), 'build', '--webpack'], {
      cwd: stage,
      stdio: 'inherit',
      env: {
        ...process.env,
        NEXT_TELEMETRY_DISABLED: '1',
        NEXT_PUBLIC_API_ORIGIN: origin,
      },
    });
    if (build.error) throw build.error;
    if (build.status !== 0) throw new Error(`Mobile static export failed (${build.signal ?? build.status}).`);

    await stat(path.join(stage, 'out/index.html'));
    await stat(path.join(stage, 'out/privacy/index.html'));
    const output = path.join(root, 'out');
    // Preserve the previous output when compilation fails. Replace it only after success.
    await rm(output, { recursive: true, force: true });
    await cp(path.join(stage, 'out'), output, { recursive: true });
    console.log('[mobile] Static bundle written to out/. Native authentication and store builds remain separate work.');
  } finally {
    await rm(stage, { recursive: true, force: true });
  }
}

buildMobile().catch((error) => {
  console.error(`[mobile] ${error.message}`);
  process.exitCode = 1;
});
