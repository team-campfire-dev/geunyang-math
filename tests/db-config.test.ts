import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { checkServerIdentity, type PeerCertificate } from 'node:tls';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { databaseConfig } from '@/server/db';

describe('shared Prisma URL and MariaDB TLS configuration', () => {
  let directory: string;
  let certificatePath: string;
  const certificateBytes = Buffer.from('CA fixture bytes; TLS validates certificate syntax during the handshake.');
  const host = 'mysql_server_8.0.42_auto_generated_server_certificate';
  const baseUrl = `mysql://learner:p%40ss@${host}:3306/geunyang_math`;
  const options = () => `sslcert=${encodeURIComponent(certificatePath)}&sslaccept=strict`;

  beforeAll(() => {
    directory = mkdtempSync(join(tmpdir(), 'geunyang-db-config-'));
    certificatePath = join(directory, 'mysql ca.pem');
    writeFileSync(certificatePath, certificateBytes);
  });
  afterAll(() => { rmSync(directory, { recursive: true, force: true }); });

  it('preserves the existing plain local connection and percent-encoded credentials', () => {
    const config = databaseConfig('mysql://learner:p%40ss@127.0.0.1:3317/geunyang_math_test');
    expect(config).toEqual({ host: '127.0.0.1', port: 3317, user: 'learner', password: 'p@ss', database: 'geunyang_math_test', connectionLimit: 5 });
    expect(config).not.toHaveProperty('ssl');
  });

  it('loads the absolute CA path and keeps certificate and hostname verification enabled', () => {
    const config = databaseConfig(`${baseUrl}?${options()}`);
    expect(config.host).toBe(host);
    expect(config.ssl?.ca).toEqual(certificateBytes);
    expect(config.ssl?.rejectUnauthorized).toBe(true);
    expect(config.ssl).not.toHaveProperty('checkServerIdentity');
    expect(config.ssl).not.toHaveProperty('servername');
  });

  it.each(['sslaccept=strict', 'sslcert=%2Frun%2Fcerts%2Fmysql-ca.pem'])('rejects incomplete TLS options: %s', query => {
    expect(() => databaseConfig(`${baseUrl}?${query}`)).toThrow('requires both sslcert and sslaccept=strict');
  });

  it.each(['accept_invalid_certs', '', 'STRICT'])('rejects a non-strict validation mode: %s', mode => {
    expect(() => databaseConfig(`${baseUrl}?sslcert=${encodeURIComponent(certificatePath)}&sslaccept=${mode}`)).toThrow('only supports sslaccept=strict');
  });

  it.each(['ca.pem', '../ca.pem', 'file:///run/certs/ca.pem', ''])('rejects a non-absolute CA path: %s', value => {
    expect(() => databaseConfig(`${baseUrl}?sslcert=${encodeURIComponent(value)}&sslaccept=strict`)).toThrow('absolute CA certificate path');
  });

  it.each(['ssl=true', 'sslmode=require', 'connection_limit=5', 'sslidentity=identity.p12'])('does not silently discard unsupported options: %s', query => {
    expect(() => databaseConfig(`${baseUrl}?${options()}&${query}`)).toThrow('unsupported query option');
  });

  it.each(['sslaccept=strict', 'sslcert=%2Frun%2Fcerts%2Fanother-ca.pem'])('rejects duplicate TLS settings: %s', query => {
    expect(() => databaseConfig(`${baseUrl}?${options()}&${query}`)).toThrow('must not be repeated');
  });

  it('fails when the CA is missing instead of silently falling back to plain transport', () => {
    const missing = join(directory, 'missing.pem');
    expect(() => databaseConfig(`${baseUrl}?sslcert=${encodeURIComponent(missing)}&sslaccept=strict`)).toThrow();
  });

  it('uses the default Node identity check for a CN-only certificate alias and rejects the IP', () => {
    // Public certificate metadata only. Actual chain/expiry/TLS handshakes are deployment checks.
    const certificate = { subject: { CN: 'MySQL_Server_8.0.42_Auto_Generated_Server_Certificate' } } as PeerCertificate;
    expect(checkServerIdentity(host, certificate)).toBeUndefined();
    expect(checkServerIdentity('10.0.0.135', certificate)).toBeInstanceOf(Error);
    expect(checkServerIdentity('unrelated-db.example.com', certificate)).toBeInstanceOf(Error);
  });

  it('rejects protocols and URL fragments that cannot share the Prisma MySQL contract', () => {
    expect(() => databaseConfig('postgresql://learner:pass@localhost/db')).toThrow('mysql DATABASE_URL');
    expect(() => databaseConfig(`${baseUrl}?${options()}#ignored`)).toThrow('fragments are not supported');
  });
});
