import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

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
