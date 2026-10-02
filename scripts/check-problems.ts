/**
 * Checks problems a model wrote against the claims it declared beside them.
 *
 *   npm run problems:check -- path/to/problems.json
 *
 * The file is a JSON array in the generator's output format: each item has `prompt`, `answer` (as a
 * question stores it — integer, rational, expression or choice), optional `misreadings` (each with
 * `answer`, `misconception`, and optionally the wrong computation as `expression`) and `solves`, the
 * claim. Nothing is written anywhere; the report is printed.
 */
import { readFileSync } from 'node:fs';
import { verifyProblem, type CheckInput, type Report } from '../src/core/verify/verify';

const path = process.argv[2];
if (!path) { console.error('Usage: npm run problems:check -- <problems.json>'); process.exit(2); }
const items: unknown = JSON.parse(readFileSync(path, 'utf8'));
if (!Array.isArray(items)) { console.error('The file must hold a JSON array of problems.'); process.exit(2); }

const counts: Record<Report['verdict'] | 'malformed', number> = { verified: 0, rejected: 0, unverified: 0, malformed: 0 };
items.forEach((item, index) => {
  const label = `#${index + 1}`;
  if (!item || typeof item !== 'object' || !('answer' in item) || !('solves' in item)) {
    counts.malformed++;
    console.log(`${label} malformed — each problem needs "answer" and "solves".`);
    return;
  }
  const report = verifyProblem(item as CheckInput);
  counts[report.verdict]++;
  const head = `${label} ${report.verdict}${report.strength ? ` (${report.strength})` : ''}${report.computed !== undefined ? ` · computed ${report.computed}` : ''}`;
  console.log(head);
  for (const issue of report.issues) console.log(`    ${issue.level} ${issue.code}${issue.option ? ` [${issue.option}]` : ''}${issue.answer ? ` [${issue.answer}]` : ''}: ${issue.message}`);
});
console.log(`\n${items.length} problems: ${counts.verified} verified, ${counts.rejected} rejected, ${counts.unverified} unverified${counts.malformed ? `, ${counts.malformed} malformed` : ''}.`);
