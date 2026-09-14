import 'server-only';
import { readFileSync } from 'node:fs';
import { isAbsolute } from 'node:path';
import { PrismaClient } from '@prisma/client';
import { PrismaMariaDb } from '@prisma/adapter-mariadb';

/** Translate the supported Prisma MySQL URL options without weakening TLS validation. */
export function databaseConfig(url: string) {
  const parsed = new URL(url);
  if (parsed.protocol !== 'mysql:') throw new Error('A mysql DATABASE_URL is required.');
  if (parsed.hash) throw new Error('DATABASE_URL fragments are not supported.');
  const supportedOptions = new Set(['sslcert', 'sslaccept']);
  for (const key of parsed.searchParams.keys()) {
    if (!supportedOptions.has(key)) throw new Error('DATABASE_URL contains an unsupported query option.');
    if (parsed.searchParams.getAll(key).length !== 1) throw new Error('DATABASE_URL query options must not be repeated.');
  }
  const hasCertificate = parsed.searchParams.has('sslcert');
  const hasValidationMode = parsed.searchParams.has('sslaccept');
  if (hasCertificate !== hasValidationMode) {
    throw new Error('DATABASE_URL TLS requires both sslcert and sslaccept=strict.');
  }
  let ssl: { ca: Buffer; rejectUnauthorized: true } | undefined;
  if (hasCertificate) {
    if (parsed.searchParams.get('sslaccept') !== 'strict') {
      throw new Error('DATABASE_URL only supports sslaccept=strict.');
    }
    const certificatePath = parsed.searchParams.get('sslcert')!;
    if (!isAbsolute(certificatePath)) throw new Error('DATABASE_URL sslcert must be an absolute CA certificate path.');
    // The same absolute, read-only CA mount is used by Prisma CLI and the application.
    // MariaDB/Node validates both the chain and the URL host using its default identity check.
    ssl = { ca: readFileSync(certificatePath), rejectUnauthorized: true };
  }
  return {
    host: parsed.hostname, port: Number(parsed.port || 3306),
    user: decodeURIComponent(parsed.username), password: decodeURIComponent(parsed.password),
    database: parsed.pathname.slice(1), connectionLimit: 5,
    ...(ssl ? { ssl } : {}),
  };
}

export function createDatabase(url: string) {
  const adapter = new PrismaMariaDb(databaseConfig(url));
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
