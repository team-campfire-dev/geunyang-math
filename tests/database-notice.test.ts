import { readFileSync, readdirSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { databaseTests } from './database-notice';

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
