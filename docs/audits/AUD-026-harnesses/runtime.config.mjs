import { defineConfig } from 'vitest/config';

// CORE-13 exception: Vitest reads this audit-only configuration through its default export.
export default defineConfig({
  test: {
    include: ['docs/audits/AUD-026-harnesses/runtime.probe.ts'],
    testTimeout: 60_000,
    hookTimeout: 60_000,
  },
});
