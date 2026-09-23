import 'dotenv/config';
import { readdirSync, readFileSync } from 'node:fs';
import { z } from 'zod';
import { ContentError, parseContentBundle } from '../src/core/content-bundle';
import { compareContentBundleNames } from '../src/core/content-files';
import { getDatabase } from '../src/server/db';
import { importContent } from '../src/server/content-store';

/**
 * Installs the platform's own content — its courses, their lessons, the starting-point diagnostic
 * and the concepts they name — through the same import every other bundle takes. A version already
 * published is left as it is, so this runs on every deployment and does nothing when nothing
 * changed; after a migration has cleared the content tables it puts the content back.
 *
 * Every file in `seed/` is a course's own bundle, applied in name order so a course may rest on the
 * concepts of one that came before it. **These are the only files that carry answer keys** — the
 * bundles in `content/` hold definitions and nothing a learner could be marked against.
 */
const bundlesIn = (directory: string, keep: (name: string) => boolean) =>
  readdirSync(new URL(directory, import.meta.url)).filter(name => name.endsWith('.json') && keep(name)).sort(compareContentBundleNames)
    .map(name => ({ name, bundle: parseContentBundle(JSON.parse(readFileSync(new URL(`${directory}${name}`, import.meta.url), 'utf8'))) }));

async function seed() {
  const seeds = bundlesIn('./seed/', () => true);
  const dictionary = bundlesIn('../content/', name => name.startsWith('glossary-'));
  const db = getDatabase();
  try {
    for (const { name, bundle } of seeds) {
      // The lessons link atomic concepts from their first publication. Install missing definitions
      // in the same transaction; later seeds must preserve explanations edited in the authoring UI.
      // Reviewed changes to the dictionary still go through content:publish and its checksum ledger.
      const existing = new Set((await db.conceptDefinition.findMany({ where: { scopeKind: 'global', scopeKey: '' }, select: { conceptKey: true } })).map(row => row.conceptKey));
      // A dictionary file may restate a concept an earlier one named, and a course names its own.
      // The later word wins, which is what a v3 that revises v2 means.
      const concepts = new Map(dictionary.flatMap(entry => entry.bundle.concepts).map(concept => [concept.key, concept]));
      for (const concept of bundle.concepts) concepts.set(concept.key, concept);
      const definitions = [...new Map(dictionary.flatMap(entry => entry.bundle.definitions)
        .map(definition => [definition.conceptKey, definition])).values()]
        .filter(definition => !existing.has(definition.conceptKey));
      console.log(JSON.stringify({ seed: name.replace(/\.json$/, ''), ...(await importContent(db, { ...bundle, concepts: [...concepts.values()], definitions })) }));
    }
  }
  finally { await db.$disconnect(); }
}

seed().catch((error: unknown) => {
  if (error instanceof ContentError) console.error(error.message);
  else if (error instanceof z.ZodError) console.error('Invalid seed content:', error.issues.map(i => `${i.path.join('.')}: ${i.code}`).join('; '));
  else console.error('Seeding failed. Check database access and migration status.');
  process.exitCode = 1;
});
