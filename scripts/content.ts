import 'dotenv/config';
import { readFileSync, statSync, writeFileSync } from 'node:fs';
import { ContentError } from '../src/core/content-bundle';
import { getDatabase } from '../src/server/db';
import { exportContent, importContent, verifyContent } from '../src/server/content-store';
import { z } from 'zod';

export async function runContentCommand(args: string[]) {
  const [command, ...flags] = args;
  const dryRun = flags.at(-1) === '--dry-run';
  const valid = command === 'verify' ? flags.length === 0
    : command === 'export' ? flags.length === 2 && flags[0] === '--out' && !!flags[1]
    : command === 'import' && flags[0] === '--file' && !!flags[1] && (flags.length === 2 || (flags.length === 3 && dryRun));
  if (!valid) throw new ContentError('Usage: content:verify | content:export -- --out <new-file.json> | content:import -- --file <bundle.json> [--dry-run]');
  let input: unknown;
  if (command === 'import') {
    if (statSync(flags[1]).size > 5 * 1024 * 1024) throw new ContentError('Import is limited to 5 MiB. Split larger bundles.');
    input = JSON.parse(readFileSync(flags[1], 'utf8'));
  }
  const db = getDatabase();
  try {
    if (command === 'import') console.log(JSON.stringify(await importContent(db, input, dryRun)));
    else if (command === 'verify') console.log(JSON.stringify(await verifyContent(db)));
    else {
      const bundle = await db.$transaction(tx => exportContent(tx), { isolationLevel: 'RepeatableRead', timeout: 30_000 });
      // Exports include private answer keys. Never overwrite a file or print its content.
      writeFileSync(flags[1], JSON.stringify(bundle, null, 2) + '\n', { mode: 0o600, flag: 'wx' });
      console.log(`Exported ${bundle.classes.length} class versions and ${bundle.diagnostics.length} diagnostic versions.`);
    }
  } finally { await db.$disconnect(); }
}
export function reportContentError(error: unknown) {
  if (error instanceof ContentError) console.error(error.message);
  else if (error instanceof z.ZodError) console.error('Invalid content:', error.issues.map(i => `${i.path.join('.')}: ${i.code}`).join('; '));
  else console.error('Content operation failed. Check the JSON file, database access, and migration status.');
  process.exitCode = 1;
}
runContentCommand(process.argv.slice(2)).catch(reportContentError);
