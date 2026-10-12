import { defineConfig } from "vitest/config";

// Audit probes are opt-in: the ordinary test suite must not collect known failing cases.
export default defineConfig({
  test: {
    include: ["docs/audits/AUD-015-harnesses/staging-probes.ts"],
    maxWorkers: 1,
    fileParallelism: false,
    testTimeout: 10_000,
  },
});
