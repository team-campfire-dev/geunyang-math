import { readFileSync, readdirSync } from 'node:fs';

/**
 * Says out loud which tests this run is not going to make.
 *
 * Eleven test files talk to MySQL, and each one skips itself when `TEST_DATABASE_URL` is unset so
 * that a checkout with no database still runs. That is the right behaviour and it has a cost: on a
 * machine without the variable, `npm test` ends green having skipped about a fifth of the suite. The
 * summary does print a skipped count, but nothing there says which tests they were, why they went,
 * or that CI runs every one of them — so a change that only breaks the database tests looks fine
 * locally and fails on the pull request.
 *
 * Hence this. It is registered as vitest's `globalSetup`, so it speaks once per run rather than once
 * per file, and only when there is something to say.
 */
const gate = 'process.env.TEST_DATABASE_URL';

/** The test files that hold themselves back until a test database is named. */
export function databaseTests(directory = 'tests') {
  return readdirSync(directory).filter((name) => /\.test\.tsx?$/.test(name))
    .filter((name) => readFileSync(`${directory}/${name}`, 'utf8').includes(gate)).sort();
}

export default function notice() {
  if (process.env.TEST_DATABASE_URL) return;
  const held = databaseTests();
  if (!held.length) return;
  // CI의 것과 같은 모양이다(.github/workflows/ci.yml): root 계정, 이름이 _test로 끝나는 별도 데이터베이스.
  // 그 이름이 아니면 테스트가 스스로 거절한다 — 운영이나 개발 DB를 건드리지 않기 위해서다.
  const url = 'mysql://root:local-root-only@127.0.0.1:3317/geunyang_math_test';
  process.stderr.write([
    '',
    `  TEST_DATABASE_URL이 없어 MySQL 테스트 ${held.length}개 파일을 건너뜁니다.`,
    '  CI는 이 파일들을 전부 돌립니다. 여기서 초록이어도 PR에서 깨질 수 있습니다.',
    `    ${held.join(', ')}`,
    '',
    '  로컬에서도 돌리려면 한 번만:',
    '    docker compose up -d db',
    '    docker compose exec -T db mysql -uroot -plocal-root-only -e "CREATE DATABASE IF NOT EXISTS geunyang_math_test"',
    `    DATABASE_URL=${url} npm run db:migrate`,
    `  그리고 .env에  TEST_DATABASE_URL=${url}`,
    '',
  ].join('\n'));
}
