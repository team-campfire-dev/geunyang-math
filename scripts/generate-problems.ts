/**
 * Writes questions with Claude and checks them, the way the editor's 「AI로 문제 만들기」 does, without
 * a draft or a database — for trying a prompt change or a model on the same request again.
 *
 *   ANTHROPIC_API_KEY=… npm run problems:generate -- request.json [--out result.json]
 *
 * request.json names the lesson and what to ask for:
 *   { "courseTitle": "분수", "lessonTitle": "분모가 다른 분수의 덧셈",
 *     "concepts": [{ "key": "fraction-addition", "label": "분수의 덧셈" }],
 *     "misconceptions": ["add-denominators"], "count": 3, "form": "mixed", "note": "" }
 * The report is printed; `--out` also writes every question with its verdict and findings.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { z } from 'zod';
import { generateProblems } from '../src/server/problem-generation';
import { claudeProblemModel } from '../src/server/problem-writer';
import { generationLimits } from '../src/shared/generation';
import { misconceptionOf } from '../src/shared/misconception';

const requestSchema = z.object({
  courseTitle: z.string().nullable().default(null),
  lessonTitle: z.string().min(1),
  concepts: z.array(z.object({ key: z.string(), label: z.string() })).min(1).max(10),
  misconceptions: z.array(z.string()).max(generationLimits.maxMisconceptions).default([]),
  count: z.number().int().min(1).max(generationLimits.maxCount).default(3),
  form: z.enum(['choice', 'written', 'mixed']).default('mixed'),
  note: z.string().max(generationLimits.maxNote).default(''),
  existing: z.array(z.object({ prompt: z.string(), answer: z.string() })).max(generationLimits.maxExisting).default([]),
});

const args = process.argv.slice(2);
const outAt = args.indexOf('--out');
const path = args.find((arg, index) => !arg.startsWith('--') && (outAt < 0 || index !== outAt + 1));
if (!path || (outAt >= 0 && !args[outAt + 1])) { console.error('Usage: npm run problems:generate -- <request.json> [--out <result.json>]'); process.exit(2); }
if (!process.env.ANTHROPIC_API_KEY) { console.error('Set ANTHROPIC_API_KEY.'); process.exit(2); }
const asked = requestSchema.parse(JSON.parse(readFileSync(path, 'utf8')));
const unknown = asked.misconceptions.find((key) => !misconceptionOf(key));
if (unknown) { console.error(`Unknown misconception: ${unknown}`); process.exit(2); }

async function main() {
  const result = await generateProblems(claudeProblemModel(), {
    conceptKeys: asked.concepts.map((concept) => concept.key), misconceptions: asked.misconceptions,
    count: asked.count, form: asked.form, note: asked.note, existing: asked.existing,
  }, { courseTitle: asked.courseTitle, lessonTitle: asked.lessonTitle, concepts: asked.concepts });

  result.problems.forEach((generated, index) => {
    const prompt = generated.problem.promptContent.map((block) => String(block.payload.text ?? '')).join(' ');
    console.log(`#${index + 1} ${generated.verdict}${generated.strength ? ` (${generated.strength})` : ''}${generated.computed !== undefined ? ` · computed ${generated.computed}` : ''}${generated.independent ? ` · independent ${generated.independent}` : ''}`);
    console.log(`    ${prompt.slice(0, 160)}`);
    for (const issue of generated.issues) console.log(`    ${issue.level} ${issue.code}${issue.option ? ` [${issue.option}]` : ''}${issue.answer ? ` [${issue.answer}]` : ''}: ${issue.message}`);
  });
  const count = (verdict: string) => result.problems.filter((generated) => generated.verdict === verdict).length;
  console.log(`\n${result.problems.length} problems from ${result.model}: ${count('verified')} verified, ${count('unverified')} unverified, ${count('rejected')} rejected.`);
  if (outAt >= 0) writeFileSync(args[outAt + 1], `${JSON.stringify(result, null, 2)}\n`);
}

main().catch((reason: unknown) => { console.error(reason instanceof Error ? reason.message : reason); process.exit(1); });
