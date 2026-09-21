import { describe, expect, it } from 'vitest';
import { publishedFingerprints, readLock } from '@/core/published-lock';

/**
 * A published version may never change.
 *
 * `db:seed` already refuses to install a version whose content differs from the one it holds — but
 * only where it holds it. An empty database accepts anything, so a rewritten version passes every
 * check run against a fresh database and then stops the deployment on the real one, halfway
 * through: on 2026-09-21 six lesson scenes were corrected in place and the release got two bundles
 * in before it refused the third and rolled back.
 *
 * `prisma/published-versions.json` is what the repository remembers about what it has published, and
 * `npm run content:lock` adds to it. The answer to a failure here is a **new version id**, never a
 * new fingerprint for the old one — learners' answers, review assignments and placement runs all
 * name a version and mean the content it had.
 */
describe('what has already been published', () => {
  const recorded = readLock();
  const current = publishedFingerprints();

  it('is written down, so a rewrite is caught here rather than by a deployment', () => {
    expect(recorded.size, 'published-versions.json이 비어 있다').toBeGreaterThan(100);
    const rewritten = [...current].filter(([id, mark]) => recorded.has(id) && recorded.get(id) !== mark).map(([id]) => id);
    expect(rewritten, '발행된 판본을 고쳤다. 새 판본 ID를 쓰세요').toEqual([]);
  });

  it('covers every version the seeds carry, so nothing slips in unrecorded', () => {
    const missing = [...current.keys()].filter((id) => !recorded.has(id));
    expect(missing, 'npm run content:lock 을 돌려 새 판본을 적어 주세요').toEqual([]);
  });

  it('keeps the versions a release installed even after the seeds stop carrying them', () => {
    // The corrected lessons ship as v2 and the seeds no longer hold v1 — but production does, and
    // a v1 that came back with different content would be the same failure again.
    for (const id of ['exponent-law:v1', 'linear-function:v1', 'slope-intercept:v1',
      'linear-expression:v1', 'monomial-arithmetic:v1', 'polynomial-arithmetic:v1']) {
      expect(recorded.has(id), `${id}의 기록이 사라졌다`).toBe(true);
      expect(current.has(id), `${id}이 씨앗에 다시 들어왔다`).toBe(false);
    }
  });
});
