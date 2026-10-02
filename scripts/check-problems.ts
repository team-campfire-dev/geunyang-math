/**
 * Checks problems a model wrote against the claims it declared beside them.
 *
 *   npm run problems:check -- path/to/problems.json [--independent path/to/answers.json]
 *
 * The file is a JSON array in the generator's output format: each item has `prompt`, `answer` (as a
 * question stores it — integer, rational, expression or choice), optional `misreadings` (each with
 * `answer`, `misconception`, and optionally the wrong computation as `expression`) and `solves`, the
 * claim. `--independent` adds answers reached by solving from the prompts alone, in the same order —
 * a JSON array of strings, or of objects with an `answer` — and each is compared with the key.
 * Nothing is written anywhere; the report is printed.
 */
import { readFileSync } from 'node:fs';
import { verifyProblem, type CheckInput, type Report } from '../src/core/verify/verify';

const args = process.argv.slice(2);
const flag = args.indexOf('--independent');
const path = args.find((a, i) => !a.startsWith('--') && (flag < 0 || i !== flag + 1));
if (!path || (flag >= 0 && !args[flag + 1])) { console.error('Usage: npm run problems:check -- <problems.json> [--independent <answers.json>]'); process.exit(2); }
const items: unknown = JSON.parse(readFileSync(path, 'utf8'));
if (!Array.isArray(items)) { console.error('The file must hold a JSON array of problems.'); process.exit(2); }
const solved: unknown = flag >= 0 ? JSON.parse(readFileSync(args[flag + 1], 'utf8')) : null;
if (solved !== null && (!Array.isArray(solved) || solved.length !== items.length)) {
  console.error(`The independent answers must be a JSON array with one answer per problem (${items.length}).`); process.exit(2);
}
const independentAt = (i: number): string | undefined => {
  if (!Array.isArray(solved)) return undefined;
  const entry: unknown = solved[i];
  if (typeof entry === 'string' || typeof entry === 'number') return String(entry);
  if (entry && typeof entry === 'object' && 'answer' in entry) return String((entry as { answer: unknown }).answer);
  return undefined;
};

const counts: Record<Report['verdict'] | 'malformed', number> = { verified: 0, rejected: 0, unverified: 0, malformed: 0 };
items.forEach((item, index) => {
  const label = `#${index + 1}`;
  if (!item || typeof item !== 'object' || !('answer' in item) || !('solves' in item)) {
    counts.malformed++;
    console.log(`${label} malformed — each problem needs "answer" and "solves".`);
    return;
  }
  const answer = independentAt(index);
  const report = verifyProblem({ ...(item as CheckInput), ...(answer !== undefined ? { independent: answer } : {}) });
  counts[report.verdict]++;
  const head = `${label} ${report.verdict}${report.strength ? ` (${report.strength})` : ''}${report.computed !== undefined ? ` · computed ${report.computed}` : ''}${report.independent ? ` · independent ${report.independent}` : ''}`;
  console.log(head);
  for (const issue of report.issues) console.log(`    ${issue.level} ${issue.code}${issue.option ? ` [${issue.option}]` : ''}${issue.answer ? ` [${issue.answer}]` : ''}: ${issue.message}`);
});
console.log(`\n${items.length} problems: ${counts.verified} verified, ${counts.rejected} rejected, ${counts.unverified} unverified${counts.malformed ? `, ${counts.malformed} malformed` : ''}.`);
