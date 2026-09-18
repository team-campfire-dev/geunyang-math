import 'dotenv/config';
import { writeFileSync } from 'node:fs';
import { getDatabase } from '../src/server/db';
import { pilotReport } from '../src/server/pilot-report';

const asDate = (value: string) => {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) throw new Error(`Not a date: ${value}`);
  return parsed;
};

export async function runPilotCommand(args: string[]) {
  const flags = new Map<string, string>();
  for (let index = 0; index < args.length; index += 2) {
    if (!args[index]?.startsWith('--') || !args[index + 1]) throw new Error('Usage: pilot:report -- --out <new-file.json> [--from <date>] [--to <date>]');
    flags.set(args[index].slice(2), args[index + 1]);
  }
  const out = flags.get('out');
  if (!out || [...flags.keys()].some((key) => !['out', 'from', 'to'].includes(key))) {
    throw new Error('Usage: pilot:report -- --out <new-file.json> [--from <date>] [--to <date>]');
  }

  const db = getDatabase();
  try {
    const report = await pilotReport(db, {
      from: flags.has('from') ? asDate(flags.get('from')!) : undefined,
      to: flags.has('to') ? asDate(flags.get('to')!) : undefined,
    });
    // The report holds learners' own writing. It is never printed and never overwrites a file.
    writeFileSync(out, JSON.stringify(report, null, 2) + '\n', { mode: 0o600, flag: 'wx' });
    console.log(`Wrote a report of ${report.learners} learners, ${report.lessons.length} lessons and ${report.rejectedAnswers.length} rejected answers to ${out}.`);
  } finally { await db.$disconnect(); }
}

runPilotCommand(process.argv.slice(2)).catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : 'Could not build the pilot report. Check database access and migration status.');
  process.exitCode = 1;
});
