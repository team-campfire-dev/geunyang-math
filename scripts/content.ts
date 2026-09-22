import 'dotenv/config';
import { createHash } from 'node:crypto';
import { readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { ContentError } from '../src/core/content-bundle';
import { getDatabase } from '../src/server/db';
import { exportContent, importContent, publishBundle, retiredVersions, retireVersions, verifyContent } from '../src/server/content-store';
import { parseContentBundle } from '../src/core/content-bundle';
import { z } from 'zod';

export async function runContentCommand(args: string[]) {
  const [command, ...flags] = args;
  const dryRun = flags.at(-1) === '--dry-run';
  const publishFlags = dryRun ? flags.slice(0, -1) : flags;
  const valid = command === 'verify' ? flags.length === 0
    : command === 'retire' ? flags.length === 0 || (flags.length === 1 && flags[0] === '--apply')
    : command === 'export' ? flags.length === 2 && flags[0] === '--out' && !!flags[1]
    : command === 'publish' ? publishFlags.length === 0 || (publishFlags.length === 2 && publishFlags[0] === '--dir' && !!publishFlags[1])
    : command === 'import' && flags[0] === '--file' && !!flags[1] && (flags.length === 2 || (flags.length === 3 && dryRun));
  if (!valid) throw new ContentError('Usage: content:verify | content:retire [-- --apply] | content:export -- --out <new-file.json> | content:import -- --file <bundle.json> [--dry-run] | content:publish [-- --dir <directory>] [--dry-run]');
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
    else if (command === 'retire') {
      /**
       * Versions the seeds no longer ship. Listing is the default and `--apply` is the exception,
       * because this is the one content command that removes rather than adds: a version bump
       * leaves the old version behind, and it is unreachable rather than wrong.
       *
       * What stays behind on purpose is `prisma/published-versions.json`. It is the memory that an
       * id was published, and forgetting it would let the same id come back later holding different
       * content — which is the thing the ledger exists to refuse.
       */
      const seeds = readdirSync('prisma/seed').filter(name => name.endsWith('.json')).sort()
        .map(name => parseContentBundle(JSON.parse(readFileSync(join('prisma/seed', name), 'utf8'))));
      const keepLessons = seeds.flatMap(bundle => bundle.lessons.map(lesson => lesson.public.versionId));
      const keepSets = seeds.flatMap(bundle => bundle.problemSets.map(set => set.versionId));
      if (!keepLessons.length || !keepSets.length) throw new ContentError('Seeds look empty; refusing to treat the whole catalogue as retired.');
      const retired = await retiredVersions(db, keepLessons, keepSets);
      const held = retired.filter(item => item.heldBy.length);
      const free = retired.filter(item => !item.heldBy.length);
      const apply = flags[0] === '--apply';
      console.log(JSON.stringify({ retired: retired.length, removable: free.length, kept: held.length,
        versions: free.map(item => item.versionId), stillReferenced: held.map(item => `${item.versionId} (${item.heldBy.join(', ')})`),
        ...(apply ? await retireVersions(db, free) : { dryRun: true }) }));
    }
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
