import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readdirSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { parseContentBundle } from '@/core/content-bundle';

const deploymentScript = resolve('scripts/deploy-remote.sh');
const source = readFileSync(deploymentScript, 'utf8');
const scratchDirectories: string[] = [];
const quote = (value: string) => `'${value.replaceAll("'", "'\\''")}'`;

afterEach(() => {
  for (const directory of scratchDirectories.splice(0)) rmSync(directory, { recursive: true, force: true });
});

function pointerScenario(kind: 'same-sha-preflight' | 'existing-commit-signal' | 'first-commit-signal' | 'same-sha-commit-signal') {
  const scratch = realpathSync(mkdtempSync(join(tmpdir(), 'geunyang-deploy-rollback-')));
  scratchDirectories.push(scratch);
  const release = join(scratch, 'releases', '2'.repeat(40));
  const previous = kind.startsWith('same-sha') ? release : join(scratch, 'releases', '1'.repeat(40));
  const current = join(scratch, 'current');
  mkdirSync(release, { recursive: true });
  mkdirSync(previous, { recursive: true });
  if (kind !== 'first-commit-signal') symlinkSync(previous, current);

  // Execute the real initializer, pointer recovery, EXIT trap, and pointer commit
  // code. Docker/environment recovery is deliberately out of this pointer test.
  const initialization = source.slice(source.indexOf("previous_release=''"), source.indexOf('phase=preflight') + 'phase=preflight'.length);
  const rollback = source.slice(source.indexOf('restore_current_pointer() {'), source.indexOf('trap on_exit EXIT'));
  const commit = source.slice(source.lastIndexOf("phase='Commit the current release pointer'"), source.lastIndexOf('\ndeployment_committed=1'));
  const harness = join(scratch, 'pointer-test.sh');
  writeFileSync(harness, `#!/usr/bin/env bash
set -Eeuo pipefail
release_dir=${quote(release)}
current_link=${quote(current)}
symlink_temp=${quote(join(scratch, '.current-staged'))}
${initialization}
log() { :; }
# Portable replacements for GNU readlink/mv/ln; they operate only in this fixture.
readlink() { ${quote(process.execPath)} -e 'console.log(require("node:fs").realpathSync(process.argv.at(-1)))' -- "$@"; }
mv() { ${quote(process.execPath)} -e 'const a = process.argv.slice(1).filter(v => !v.startsWith("-")); require("node:fs").renameSync(a[0], a[1]);' -- "$@"; }
ln() { ${quote(process.execPath)} -e 'const a = process.argv.slice(1).filter(v => !v.startsWith("-")); require("node:fs").symlinkSync(a[0], a[1]);' -- "$@"; }
${rollback}
trap on_exit EXIT
trap 'exit 143' TERM
${kind === 'same-sha-preflight'
    ? '# Model an invalid incoming env before previous_release is discovered.\nexit 1'
    : `previous_release=${quote(kind === 'first-commit-signal' ? '' : previous)}
${commit}
# Interrupt precisely after the pointer rename and before the commit flag.
kill -TERM $$`}
`, { mode: 0o700 });
  const result = spawnSync('bash', [harness], { encoding: 'utf8' });
  return { result, current, previous };
}

describe('deployment pointer rollback', () => {
  it('has valid bash syntax', () => {
    expect(() => execFileSync('bash', ['-n', deploymentScript])).not.toThrow();
  });

  it('preserves an existing same-SHA current pointer when incoming env preflight fails', () => {
    const { result, current, previous } = pointerScenario('same-sha-preflight');
    expect(result.status, result.stderr).toBe(1);
    expect(existsSync(current)).toBe(true);
    expect(realpathSync(current)).toBe(previous);
  });

  it.each(['existing-commit-signal', 'same-sha-commit-signal'] as const)('restores the previous pointer for %s', (kind) => {
    const { result, current, previous } = pointerScenario(kind);
    expect(result.status, result.stderr).toBe(143);
    expect(realpathSync(current)).toBe(previous);
  });

  it('removes only the newly installed pointer when the first deployment is interrupted', () => {
    const { result, current } = pointerScenario('first-commit-signal');
    expect(result.status, result.stderr).toBe(143);
    expect(existsSync(current)).toBe(false);
  });
});

describe('reviewed content bundles published by the migrator', () => {
  const dockerfile = readFileSync(resolve('Dockerfile'), 'utf8');
  const migrator = dockerfile.slice(dockerfile.indexOf('AS migrator'), dockerfile.indexOf('AS builder'));
  const bundles = readdirSync(resolve('content')).filter(name => name.endsWith('.json'));

  it('ships the bundles it publishes and keeps them out of the running app', () => {
    expect(bundles.length).toBeGreaterThan(0);
    expect(migrator).toMatch(/COPY --chown=node:node content \.\/content/);
    expect(readFileSync(resolve('.dockerignore'), 'utf8').split('\n')).not.toContain('content');
    // The runtime image serves published DB rows; a bundle file has no place in it.
    expect(dockerfile.slice(dockerfile.indexOf('AS runtime'))).not.toMatch(/content/);
  });

  it('publishes bundles between migrating and verifying', () => {
    const command = migrator.slice(migrator.indexOf('CMD'));
    for (const step of ['db:migrate', 'content:publish', 'content:verify']) expect(command).toContain(`npm run ${step}`);
    expect(command.indexOf('db:migrate')).toBeLessThan(command.indexOf('content:publish'));
    expect(command.indexOf('content:publish')).toBeLessThan(command.indexOf('content:verify'));
    // Each step gates the next, so a rejected bundle stops the release before the app starts.
    expect(command.split('npm run').length - 1).toBe(command.split('&&').length);
  });

  it('keeps answer keys out of every committed bundle', () => {
    for (const name of bundles) {
      const raw = readFileSync(resolve('content', name), 'utf8');
      expect(raw, name).not.toMatch(/"(?:gradingSpec|solution|hints|problems)"/);
      const bundle = parseContentBundle(JSON.parse(raw));
      expect(bundle.lessons, name).toHaveLength(0);
      expect(bundle.diagnostics, name).toHaveLength(0);
      expect(bundle.definitions.length, name).toBeGreaterThan(0);
    }
  });
});

function reclaimScenario() {
  const scratch = realpathSync(mkdtempSync(join(tmpdir(), 'geunyang-deploy-reclaim-')));
  scratchDirectories.push(scratch);
  const [current, previous, stale] = ['a', 'b', 'c'].map(letter => letter.repeat(40));
  const runId = `${current}.20260915T000000Z.1`;
  for (const sha of [current, previous, stale]) {
    mkdirSync(join(scratch, 'releases', sha), { recursive: true });
    mkdirSync(join(scratch, 'incoming'), { recursive: true });
    for (const suffix of ['.tar', '.env', '.migrate.env']) writeFileSync(join(scratch, 'incoming', `${sha}${suffix}`), 'fixture');
  }
  const tags = [current, previous, stale].flatMap(sha => [`geunyang-math:${sha}`, `geunyang-math:${sha}-migrator`])
    .concat([`geunyang-math:rollback-${runId}`, 'geunyang-math:rollback-old.20260101T000000Z.9']);
  const reclaim = source.slice(source.indexOf("phase='Reclaim superseded releases and images'"));
  const harness = join(scratch, 'reclaim-test.sh');
  writeFileSync(harness, `#!/usr/bin/env bash
set -Eeuo pipefail
release_sha=${quote(current)}
previous_sha=${quote(previous)}
run_id=${quote(runId)}
IMAGE_REPOSITORY=geunyang-math
deploy_root=${quote(scratch)}
releases_root=${quote(join(scratch, 'releases'))}
log() { printf '%s\\n' "$*" >>${quote(join(scratch, 'log'))}; }
docker() {
  case "$1 $2" in
    'image ls') printf '%s\\n' ${tags.map(quote).join(' ')} ;;
    'image rm') shift 2; for tag in "$@"; do [[ "$tag" == '--' ]] || printf '%s\\n' "$tag" >>${quote(join(scratch, 'removed'))}; done ;;
    'builder prune') printf 'pruned %s\\n' "$*" >>${quote(join(scratch, 'removed'))} ;;
  esac
}
${reclaim}
`, { mode: 0o700 });
  const result = spawnSync('bash', [harness], { encoding: 'utf8' });
  const removed = existsSync(join(scratch, 'removed')) ? readFileSync(join(scratch, 'removed'), 'utf8').trim().split('\n') : [];
  return { result, scratch, current, previous, stale, runId, removed };
}

describe('superseded release reclamation', () => {
  it('keeps the released and rollback versions while removing everything older', () => {
    const { result, current, previous, stale, runId, removed } = reclaimScenario();
    expect(result.status, result.stderr).toBe(0);
    for (const sha of [current, previous]) {
      expect(removed).not.toContain(`geunyang-math:${sha}`);
      expect(removed).not.toContain(`geunyang-math:${sha}-migrator`);
    }
    expect(removed).toContain(`geunyang-math:${stale}`);
    expect(removed).toContain(`geunyang-math:${stale}-migrator`);
    // This deployment's rollback alias survives; the aliases of earlier deployments do not.
    expect(removed).not.toContain(`geunyang-math:rollback-${runId}`);
    expect(removed).toContain('geunyang-math:rollback-old.20260101T000000Z.9');
  });

  it('removes the release directory and the private incoming copies of superseded versions', () => {
    const { scratch, current, previous, stale } = reclaimScenario();
    for (const sha of [current, previous]) {
      expect(existsSync(join(scratch, 'releases', sha)), sha).toBe(true);
      expect(existsSync(join(scratch, 'incoming', `${sha}.migrate.env`)), sha).toBe(true);
    }
    expect(existsSync(join(scratch, 'releases', stale))).toBe(false);
    for (const suffix of ['.tar', '.env', '.migrate.env']) {
      expect(existsSync(join(scratch, 'incoming', `${stale}${suffix}`)), suffix).toBe(false);
    }
  });

  it('prunes only long-idle build cache, which is shared with other projects on the VM', () => {
    const { removed } = reclaimScenario();
    expect(removed.find(line => line.startsWith('pruned'))).toMatch(/--force --filter until=72h/);
  });
});
