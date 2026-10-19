import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

// The licenses of the crates that the SSKR engine links travel with it (AUD-037-BLD002): in the
// repository and the npm package (sskr-wasm/LINKED_LICENSES.txt, which scripts/sskr-licenses.mjs
// writes and `pnpm check:rust` keeps current) and in each executable's license notices.

/** The holders of the code under MIT alone that the engine links. */
const HOLDERS = ["Pieter Wuille", "Dominik Spicher", "Steven Fackler"];

/** The license notices that an executable gets, with no npm package bundled. */
function executableNotices(): string {
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

describe("the licenses of the SSKR engine", () => {
  it("name every holder of code under MIT alone, with the MIT permission", () => {
    const linked = readFileSync("sskr-wasm/LINKED_LICENSES.txt", "utf8");
    for (const holder of HOLDERS) expect(linked).toContain(holder);
    expect(linked).toContain("Permission is hereby granted, free of charge");
    expect(linked).toMatch(/^secp256k1-sys [\d.]+: CC0-1\.0; MIT for libsecp256k1$/mu);
  });

  it("travel with each executable", () => {
    const notices = executableNotices();
    const sskr = notices.slice(notices.indexOf("SSKR engine (sskr-wasm)\n"));
    for (const holder of HOLDERS) expect(sskr).toContain(holder);
  });
});
