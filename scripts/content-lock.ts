import 'dotenv/config';
import { readFileSync, writeFileSync } from 'node:fs';
import { publishedFingerprints, lockPath, readLock } from '../src/core/published-lock';

/**
 * Records the shape of every version the seeds publish, so that editing one in place is caught here
 * rather than by a deployment.
 *
 * A published version is immutable, and `db:seed` refuses to install one whose content has changed
 * — but only against a database that already holds it. A fresh database accepts anything, which is
 * how a rewritten version can pass every local check and then stop a release halfway through. This
 * writes down what was published so the same refusal happens in the repository.
 *
 * It only ever adds. A version already listed whose content has changed is an error here too: the
 * answer is a new version id, never a new fingerprint for the old one.
 */
const current = publishedFingerprints();
const recorded = readLock();
const changed = [...recorded].filter(([id, mark]) => current.has(id) && current.get(id) !== mark).map(([id]) => id);
if (changed.length) {
  console.error(`발행된 판본을 고쳤어요. 새 판본 ID를 쓰세요:\n${changed.map((id) => `  - ${id}`).join('\n')}`);
  process.exitCode = 1;
} else {
  const merged = new Map([...recorded, ...current]);
  const rows = [...merged].sort(([a], [b]) => (a < b ? -1 : 1));
  writeFileSync(lockPath, `${JSON.stringify(Object.fromEntries(rows), null, 2)}\n`);
  const added = rows.filter(([id]) => !recorded.has(id)).length;
  const gone = [...recorded.keys()].filter((id) => !current.has(id));
  console.log(`기록한 판본 ${rows.length}개 (새로 적은 것 ${added}개)${gone.length ? `, 씨앗에서 사라진 판본 ${gone.length}개는 그대로 둡니다` : ''}`);
  if (readFileSync(lockPath, 'utf8').length === 0) process.exitCode = 1;
}
