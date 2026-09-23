import { readFileSync, readdirSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { configuredUrl, databaseTests } from './database-notice';

/**
 * The notice that says which tests a run without a database is not going to make.
 *
 * It finds those files by looking for `process.env.TEST_DATABASE_URL` in their text, which is how it
 * stays right as files come and go — and also how it could quietly stop being right. A file that
 * holds itself back some other way would skip without being named, and the notice would go on
 * sounding complete. A rename of the variable would empty the list altogether and the notice would
 * say nothing at all, which reads exactly like having a database.
 *
 * So the two ways of asking the same question are held together here: every file that skips a whole
 * suite is a file the notice knows about.
 */
const files = readdirSync('tests').filter((name) => /\.test\.tsx?$/.test(name));
const holdsBack = (name: string) => readFileSync(`tests/${name}`, 'utf8').includes('describe.skipIf');

describe('the notice about skipped database tests', () => {
  it('names every file that holds a whole suite back', () => {
    expect(databaseTests().sort(), '건너뛰는 파일과 안내가 말하는 파일이 다르다')
      .toEqual(files.filter(holdsBack).sort());
  });

  it('has something to name at all', () => {
    // An empty list is how a renamed variable would look, and an empty notice reads like a run that
    // had a database. The suite has talked to MySQL since its first week; zero here is a fault.
    expect(databaseTests().length, 'MySQL 테스트를 하나도 못 찾았다').toBeGreaterThan(0);
  });

  it('is what vitest actually runs before the suite', () => {
    expect(readFileSync('vitest.config.ts', 'utf8'), '안내가 globalSetup에 걸려 있지 않다')
      .toContain("globalSetup: ['./tests/database-notice.ts']");
  });
});

/**
 * Which database the notice hands on to the workers.
 *
 * `process.env` keeps strings and stringifies whatever it is given, so writing an absent value into
 * it leaves the word "undefined" behind — a name, as far as anything reading the variable can tell.
 * The MySQL tests then stop skipping and fail on `new URL('undefined')` instead, and this notice,
 * which exists to say the database is missing, is the one thing that does not print. A checkout
 * without `.env` looked broken in exactly that way until 2026-09-23.
 */
describe('the database the notice names', () => {
  it('takes the environment first, then .env', () => {
    expect(configuredUrl('mysql://env/a_test', null)).toBe('mysql://env/a_test');
    expect(configuredUrl(undefined, 'mysql://file/b_test')).toBe('mysql://file/b_test');
    expect(configuredUrl('mysql://env/a_test', 'mysql://file/b_test')).toBe('mysql://env/a_test');
  });

  it('names nothing when neither does, so the variable is left unset', () => {
    expect(configuredUrl(undefined, null), '없는 것을 이름처럼 넘겼다').toBeNull();
  });

  it('is why the answer is checked before it is written down', () => {
    const probe = 'GEUNYANG_DATABASE_NOTICE_PROBE';
    try {
      process.env[probe] = undefined as unknown as string;
      expect(process.env[probe], 'process.env가 undefined를 그대로 두었다').toBe('undefined');
      expect(Boolean(process.env[probe]), '그 문자열은 이름처럼 읽힌다').toBe(true);
    } finally { delete process.env[probe]; }
  });
});
