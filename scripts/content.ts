import 'dotenv/config';
import { createHash } from 'node:crypto';
import { readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { ContentError } from '../src/core/content-bundle';
import { getDatabase } from '../src/server/db';
import { exportContent, importContent, publishBundle, verifyContent } from '../src/server/content-store';
import { z } from 'zod';

export async function runContentCommand(args: string[]) {
  const [command, ...flags] = args;
  const dryRun = flags.at(-1) === '--dry-run';
  const publishFlags = dryRun ? flags.slice(0, -1) : flags;
  const valid = command === 'verify' ? flags.length === 0
    : command === 'export' ? flags.length === 2 && flags[0] === '--out' && !!flags[1]
    : command === 'publish' ? publishFlags.length === 0 || (publishFlags.length === 2 && publishFlags[0] === '--dir' && !!publishFlags[1])
    : command === 'import' && flags[0] === '--file' && !!flags[1] && (flags.length === 2 || (flags.length === 3 && dryRun));
  if (!valid) throw new ContentError('Usage: content:verify | content:export -- --out <new-file.json> | content:import -- --file <bundle.json> [--dry-run] | content:publish [-- --dir <directory>] [--dry-run]');
  let input: unknown;
  if (command === 'import') {
    if (statSync(flags[1]).size > 5 * 1024 * 1024) throw new ContentError('Import is limited to 5 MiB. Split larger bundles.');
    input = JSON.parse(readFileSync(flags[1], 'utf8'));
  }
  const db = getDatabase();
  try {
    if (command === 'publish') {
      // Reviewed, answer-free bundles ship with the repository and publish once per released change.
      const directory = publishFlags.length ? publishFlags[1] : 'content';
      const names = readdirSync(directory).filter(name => name.endsWith('.json')).sort();
      for (const name of names) {
        const path = join(directory, name);
        if (statSync(path).size > 5 * 1024 * 1024) throw new ContentError(`Bundle is limited to 5 MiB: ${name}`);
        const raw = readFileSync(path);
        const checksum = createHash('sha256').update(raw).digest('hex');
        console.log(JSON.stringify(await publishBundle(db, name, checksum, JSON.parse(raw.toString('utf8')), dryRun)));
      }
      if (!names.length) console.log(JSON.stringify({ bundles: 0 }));
    }
    else if (command === 'import') console.log(JSON.stringify(await importContent(db, input, dryRun)));
    else if (command === 'verify') console.log(JSON.stringify(await verifyContent(db)));
    else {
      const bundle = await db.$transaction(tx => exportContent(tx), { isolationLevel: 'RepeatableRead', timeout: 30_000 });
      // Exports include private answer keys. Never overwrite a file or print its content.
      writeFileSync(flags[1], JSON.stringify(bundle, null, 2) + '\n', { mode: 0o600, flag: 'wx' });
      console.log(`Exported ${bundle.lessons.length} lesson versions and ${bundle.diagnostics.length} diagnostic versions.`);
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
