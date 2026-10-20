// The check of exports that no code path reaches (scripts/verify-dead-exports.mjs,
// AUD-037-ARC001), on a small copy of a repository.

import { spawnSync } from "node:child_process";
import { copyFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/** Runs the check on a copy with `files`, by their paths; its exit code and what it said. */
function checkOf(files: Record<string, string>): { status: number | null; said: string } {
  const root = mkdtempSync(join(tmpdir(), "mnemocode-exports-"));
  try {
    for (const folder of ["scripts", "src", "test"]) mkdirSync(join(root, folder));
    copyFileSync("scripts/verify-dead-exports.mjs", join(root, "scripts/verify-dead-exports.mjs"));
    writeFileSync(join(root, "package.json"), JSON.stringify({ exports: {} }));
    for (const [path, text] of Object.entries(files)) writeFileSync(join(root, path), text);
    const run = spawnSync(process.execPath, [join(root, "scripts/verify-dead-exports.mjs")], {
      encoding: "utf8",
    });
    return { status: run.status, said: run.stdout + run.stderr };
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

describe("the check of exports that no code path reaches", () => {
  it("fails on an export that nothing names, and on one that only tests name", () => {
    const run = checkOf({
      "src/a.ts": "export const used = 1;\nexport const unreached = 2;\nexport const tested = 3;\n",
      "src/b.ts": 'import { used } from "./a.js";\nexport const b = used;\n',
      "test/a.test.ts": 'import { tested } from "../src/a.js";\nvoid tested;\n',
    });
    expect(run.status).toBe(1);
    expect(run.said).toContain("src/a.ts: unreached is dead");
    expect(run.said).toContain("src/a.ts: tested is only for tests");
    expect(run.said).not.toContain("used ");
  });

  it("keeps an export that its doc comment gives to other hosts", () => {
    const run = checkOf({
      "src/a.ts": "/** For other hosts: a page reads it. */\nexport const forPages = 1;\n",
    });
    expect(run.status).toBe(0);
  });
});
