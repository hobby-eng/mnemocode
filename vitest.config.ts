import { defineConfig } from "vitest/config";
// One limit for every test and hook, named with its reason beside the longer ones of single tests.
import { COVERAGE_TEST_TIME_LIMIT_MS, TEST_TIME_LIMIT_MS } from "./test/helpers/limits.js";

/** Whether this is a coverage run (`pnpm test:coverage`), which gives every test a longer limit. */
const COVERAGE_RUN = process.argv.some((argument) => argument.startsWith("--coverage"));

/**
 * Test files run at once: half the processors. Many files start the built CLI, which starts more
 * processes, and the card and repair tests are heavy; one file for every processor overloaded the
 * machine until those tests ran out of time, while they pass alone in seconds.
 */
const PARALLEL_FILES = "50%";

// oxlint-disable-next-line import/no-default-export -- Vitest reads its configuration from it
export default defineConfig({
  test: {
    // Historical audit probes have explicit runners; ignored local evidence is not this suite.
    include: ["test/**/*.test.ts"],
    testTimeout: COVERAGE_RUN ? COVERAGE_TEST_TIME_LIMIT_MS : TEST_TIME_LIMIT_MS,
    hookTimeout: TEST_TIME_LIMIT_MS,
    maxWorkers: PARALLEL_FILES,
  },
});
