import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';

export default defineConfig({
  resolve: { alias: { '@': fileURLToPath(new URL('./src', import.meta.url)), 'server-only': fileURLToPath(new URL('./tests/server-only-stub.ts', import.meta.url)) } },
  // A screen test is a `.tsx` and asks for jsdom in its own first line, so the tests that talk to
  // MySQL keep running in node.
  // 데이터베이스가 없어 빠지는 테스트를 한 번 알려 준다. tests/database-notice.ts를 보라.
  test: { include: ['tests/**/*.test.ts', 'tests/**/*.test.tsx'], globalSetup: ['./tests/database-notice.ts'], fileParallelism: false, testTimeout: 15000 },
});
