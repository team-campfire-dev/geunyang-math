import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';

export default defineConfig({
  resolve: { alias: { '@': fileURLToPath(new URL('./src', import.meta.url)), 'server-only': fileURLToPath(new URL('./tests/server-only-stub.ts', import.meta.url)) } },
  // A screen test is a `.tsx` and asks for jsdom in its own first line, so the tests that talk to
  // MySQL keep running in node.
  test: { include: ['tests/**/*.test.ts', 'tests/**/*.test.tsx'], fileParallelism: false, testTimeout: 15000 },
});
