import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["docs/audits/AUD-021-harnesses/export-probe.ts"],
    testTimeout: 20_000,
    hookTimeout: 20_000,
    maxWorkers: 1,
    fileParallelism: false,
  },
});
