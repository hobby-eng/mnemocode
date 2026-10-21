// The time and output limits of the tests, each named once with its reason (CORE-18), so that the
// limits of the same reason share one value. How long a test takes depends on the machine's load,
// not on the code: hosted CI runners need several times longer than a developer machine.

import { MEBIBYTE } from "../../src/core/byte-units.js";

/**
 * Vitest's limit for every test and hook (vitest.config.ts), in milliseconds. Many tests start the
 * built CLI several times, and every start runs the core self-test; the end-to-end CLI cases (the
 * full self-test with PDF rendering, date searches) take seconds. A program that a test starts and
 * waits for synchronously gets the same limit as its own: it blocks the test's worker, so that
 * Vitest cannot stop it.
 */
export const TEST_TIME_LIMIT_MS = 60_000;

/**
 * The limit of a test that does much more than a few CLI starts: a search or a repair over many
 * candidates, drawing cards or sheets, or many CLI starts in a row. Twice TEST_TIME_LIMIT_MS.
 */
export const LONG_TEST_TIME_LIMIT_MS = 2 * TEST_TIME_LIMIT_MS;

/**
 * The limit of a test that draws a design with its real fonts and artwork, runs the whole
 * self-test, or searches every mode, length and forgotten part: three times TEST_TIME_LIMIT_MS.
 * The full self-test draws cards; with every other test running beside it, it takes longer than
 * TEST_TIME_LIMIT_MS.
 */
export const LONGEST_TEST_TIME_LIMIT_MS = 3 * TEST_TIME_LIMIT_MS;

/**
 * The limit of a test that renders and reads back the cards of every design or of every family,
 * which takes minutes on a loaded machine or a hosted CI runner: five times TEST_TIME_LIMIT_MS.
 */
export const DRAWING_TEST_TIME_LIMIT_MS = 5 * TEST_TIME_LIMIT_MS;

/**
 * Vitest's limit for every test in a coverage run (`vitest run --coverage`, vitest.config.ts),
 * whose instrumentation slows every test down: three times TEST_TIME_LIMIT_MS.
 */
export const COVERAGE_TEST_TIME_LIMIT_MS = 3 * TEST_TIME_LIMIT_MS;

/**
 * The most a program that a test starts may write to each of its pipes before the run fails:
 * 1 MiB. The longest output a test reads, the license notices of an executable, takes about
 * 320 KB, and the longest of the command line, a list of candidate phrases, some kilobytes.
 */
export const RUN_OUTPUT_BYTES = MEBIBYTE;
