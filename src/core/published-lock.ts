import { createHash } from 'node:crypto';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

/**
 * What the repository remembers about every version its seeds have published.
 *
 * A published lesson, problem set or diagnostic may never change: a learner's answer, a review
 * assignment and a placement run all name a version and mean the content it had. `db:seed` enforces
 * that, but only where the version is already installed — so a rewritten version passes on an empty
 * database and stops the deployment on the real one, halfway through. This file is that memory,
 * kept beside the seeds, so the repository can refuse what a release would refuse.
 */
// Beside the seeds, not among them: `db:seed` reads every file in `prisma/seed/` as content.
export const lockPath = 'prisma/published-versions.json';
const seedDirectory = 'prisma/seed';

function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.entries(value).sort(([a], [b]) => (a < b ? -1 : 1)).map(([k, v]) => `${JSON.stringify(k)}:${canonical(v)}`).join(',')}}`;
  }
  return JSON.stringify(value);
}
const mark = (value: unknown) => createHash('sha256').update(canonical(value)).digest('hex').slice(0, 32);

/**
 * A question as the freeze sees it.
 *
 * A worked solution is left out. It is shown only after the answer is in, so it changes nothing
 * about what was asked, what the answer is, or how the answer is marked — it is an aid beside the
 * question, which is exactly the reason a definition is corrected in place and not frozen either
 * (docs/content-management.md). Freezing it would mean that adding one to a published question
 * costs a new question, a new set version and a new lesson version, and the catalogue would simply
 * never get solutions.
 *
 * The expected wrong answers (`misreadings`) are left out for the same reason and by the same
 * argument: they change nothing about what was asked, what the answer is, or whether an answer is
 * marked right — they name what a wrong answer means, and only in the record.
 *
 * One is pinned to its empty form and the other is dropped, which is the same statement said two
 * ways. They differ only so that every fingerprint already written down still reads the same: every
 * seed spells out `solution: []` today, and none of them has a `misreadings` at all.
 */
export const frozenProblem = <T extends object>({ misreadings: _unfrozen, ...problem }: T & { misreadings?: unknown }) =>
  ({ ...problem, solution: [] });

type Seed = {
  lessons: { public: { versionId: string } }[];
  problemSets: { versionId: string; problemSetId: string; problems: object[] }[];
  diagnostics: { versionId: string }[];
};

/**
 * Every published version the seeds hold, by what may not change about it. A problem set's name and
 * the course that keeps it are not frozen, so they are left out — exactly as the importer leaves
 * them out of its own comparison.
 */
export function publishedFingerprints(): Map<string, string> {
  const marks = new Map<string, string>();
  for (const name of readdirSync(seedDirectory).filter((file) => file.endsWith('.json')).sort()) {
    const seed = JSON.parse(readFileSync(join(seedDirectory, name), 'utf8')) as Seed;
    for (const lesson of seed.lessons) marks.set(lesson.public.versionId, mark(lesson));
    for (const set of seed.problemSets) {
      marks.set(set.versionId, mark({ problemSetId: set.problemSetId, versionId: set.versionId, problems: set.problems.map(frozenProblem) }));
    }
    for (const diagnostic of seed.diagnostics) marks.set(diagnostic.versionId, mark(diagnostic));
  }
  return marks;
}

export function readLock(): Map<string, string> {
  if (!existsSync(lockPath)) return new Map();
  return new Map(Object.entries(JSON.parse(readFileSync(lockPath, 'utf8')) as Record<string, string>));
}
