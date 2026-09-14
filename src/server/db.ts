import 'server-only';
import { PrismaClient } from '@prisma/client';
import { PrismaMariaDb } from '@prisma/adapter-mariadb';

export function createDatabase(url: string) {
  const parsed = new URL(url);
  if (parsed.protocol !== 'mysql:') throw new Error('A mysql DATABASE_URL is required.');
  // Do not silently discard TLS or other driver settings encoded in a URL.
  // Remote database configuration must be added explicitly before deployment.
  if (parsed.search) throw new Error('DATABASE_URL query options are not supported yet; configure the database adapter explicitly.');
  const adapter = new PrismaMariaDb({
    host: parsed.hostname, port: Number(parsed.port || 3306),
    user: decodeURIComponent(parsed.username), password: decodeURIComponent(parsed.password),
    database: parsed.pathname.slice(1), connectionLimit: 5,
  });
  return new PrismaClient({ adapter });
}

const globalDb = globalThis as unknown as { geunyangDatabase?: PrismaClient };
export function getDatabase() {
  if (!globalDb.geunyangDatabase) {
    if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is not configured.');
    globalDb.geunyangDatabase = createDatabase(process.env.DATABASE_URL);
  }
  return globalDb.geunyangDatabase;
}
