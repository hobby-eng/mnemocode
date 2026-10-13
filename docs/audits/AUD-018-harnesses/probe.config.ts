// AUD-018 probes are opt-in and cannot change the ordinary Vitest collection.
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["docs/audits/AUD-018-harnesses/probes.ts"],
    maxWorkers: 1,
    fileParallelism: false,
    testTimeout: 30_000,
  },
});
