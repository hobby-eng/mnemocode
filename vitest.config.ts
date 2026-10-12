import { defineConfig } from "vitest/config";

/**
 * One limit for every test and hook. Many tests start the built CLI several times, and every start
 * runs the core self-test; the end-to-end CLI cases (the full self-test with PDF rendering, date
 * searches) take seconds, and their time depends on the machine's load, not on the code. Hosted CI
 * runners need several times longer than a developer machine.
 */
const TEST_TIME_LIMIT_MS = 60_000;

export default defineConfig({
  test: {
    testTimeout: TEST_TIME_LIMIT_MS,
    hookTimeout: TEST_TIME_LIMIT_MS,
  },
});
