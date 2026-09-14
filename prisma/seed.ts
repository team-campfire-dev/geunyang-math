import 'dotenv/config';
import { createHash } from 'node:crypto';
import { Prisma } from '@prisma/client';
import { getDatabase } from '../src/server/db';
import { seedClasses } from '../src/core/seed';
import { validateClass } from '../src/core/content';

async function main() {
const db = getDatabase();
try {
  await db.scope.upsert({ where: { id: 'platform' }, create: { id: 'platform', kind: 'platform' }, update: {} });
  for (const record of seedClasses) {
    validateClass(record);
    const document = JSON.stringify(record);
    const contentHash = createHash('sha256').update(document).digest('hex');
    const existing = await db.classVersion.findUnique({ where: { id: record.public.versionId } });
    if (existing && existing.contentHash !== contentHash) throw new Error(`Published version is immutable: ${record.public.versionId}. Create a new version ID.`);
    if (!existing) await db.classVersion.create({ data: { id: record.public.versionId, classKey: record.public.classKey,
      title: record.public.title, order: record.public.order, contentHash, document: JSON.parse(document) as Prisma.InputJsonValue } });
  }
  console.log(`Validated and seeded ${seedClasses.length} class versions. Existing versions preserved.`);
} finally { await db.$disconnect(); }

}
main().catch(error => { console.error(error); process.exitCode = 1; });
