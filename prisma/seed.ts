import 'dotenv/config';
import { readFileSync } from 'node:fs';
import { z } from 'zod';
import { ContentError } from '../src/core/content-bundle';
import { getDatabase } from '../src/server/db';
import { importContent } from '../src/server/content-store';

/**
 * Installs the platform's own content — the fraction course, its lessons, the starting-point
 * diagnostic and the concepts they name — through the same import every other bundle takes. A
 * version already published is left as it is, so this runs on every deployment and does nothing
 * when nothing changed; after a migration has cleared the content tables it puts the content back.
 * The file carries answer keys, as the migration that first installed this content did.
 */
async function seed() {
  const input = JSON.parse(readFileSync(new URL('./seed/fractions.json', import.meta.url), 'utf8')) as unknown;
  const db = getDatabase();
  try { console.log(JSON.stringify({ seed: 'fractions', ...(await importContent(db, input)) })); }
  finally { await db.$disconnect(); }
}

seed().catch((error: unknown) => {
  if (error instanceof ContentError) console.error(error.message);
  else if (error instanceof z.ZodError) console.error('Invalid seed content:', error.issues.map(i => `${i.path.join('.')}: ${i.code}`).join('; '));
  else console.error('Seeding failed. Check database access and migration status.');
  process.exitCode = 1;
});
