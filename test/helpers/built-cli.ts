// The built command line (dist/mnemocode.js, from `pnpm build`) as the tests start it: in a process
// of its own, with the public material of a fixture passed as files (PublicCliFiles), without
// colour unless a test gives an environment of its own, and within the limits of limits.ts.

import { execFile, spawnSync, type SpawnSyncReturns } from "node:child_process";
import { join } from "node:path";
import { promisify } from "node:util";
import { RUN_OUTPUT_BYTES, TEST_TIME_LIMIT_MS } from "./limits.js";
import { PublicCliFiles } from "./public-cli-files.js";

const execFileAsync = promisify(execFile);

/** The built command line, in the checkout that the tests run in. */
export const BUILT_CLI = join(process.cwd(), "dist", "mnemocode.js");

/** The test's own environment without colour, as a pipe gets the output anyway. */
function plainEnvironment(): NodeJS.ProcessEnv {
  return { ...process.env, NO_COLOR: "1" };
}

/**
 * Runs the built CLI with `argv` in `environment` and gives its output. A run that exits with an
 * error rejects with its `code`, `stdout` and `stderr`, as execFile does. Vitest's limit for the
 * test bounds its time.
 */
export async function runBuiltCli(
  argv: readonly string[],
  environment: NodeJS.ProcessEnv = plainEnvironment(),
): Promise<{ stdout: string; stderr: string }> {
  using material = new PublicCliFiles(argv);
  return await execFileAsync(process.execPath, [BUILT_CLI, ...material.arguments], {
    env: environment,
    maxBuffer: RUN_OUTPUT_BYTES,
  });
}

/**
 * Runs the built CLI with `argv` and waits for it: its status, signal and output. A run that cannot
 * start, writes more than RUN_OUTPUT_BYTES or outlasts TEST_TIME_LIMIT_MS throws.
 */
export function runBuiltCliSync(argv: readonly string[]): SpawnSyncReturns<string> {
  using material = new PublicCliFiles(argv);
  const result = spawnSync(process.execPath, [BUILT_CLI, ...material.arguments], {
    encoding: "utf8",
    env: plainEnvironment(),
    timeout: TEST_TIME_LIMIT_MS,
    maxBuffer: RUN_OUTPUT_BYTES,
  });
  if (result.error) throw result.error;
  return result;
}
