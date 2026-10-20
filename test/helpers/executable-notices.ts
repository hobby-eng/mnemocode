// The license notices that an executable carries (scripts/executable-notices.mjs), built as the
// executable build builds them but with no npm package bundled. In a process of its own: the
// script loads src/bundled-file-paths.ts with Node.js's type stripping.

import { spawnSync } from "node:child_process";
import { expect } from "vitest";

/** The license notices of an executable of MnemoCode 0.1.0 with no npm package bundled. */
export function executableNotices(): string {
  const run = spawnSync(
    process.execPath,
    [
      "--input-type=module",
      "-e",
      'import { executableNotices } from "./scripts/executable-notices.mjs";' +
        'process.stdout.write(executableNotices({ root: process.cwd(), name: "mnemocode", version: "0.1.0", metafile: { inputs: {} } }));',
    ],
    { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 },
  );
  expect(run.status, run.stderr).toBe(0);
  return run.stdout;
}
