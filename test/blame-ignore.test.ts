// The check of .git-blame-ignore-revs (scripts/verify-blame-ignore.mjs, AUD-037-BLD003): it checks
// the names only in a Git checkout of the repository, and elsewhere says that it cannot tell.

import { spawnSync } from "node:child_process";
import { copyFileSync, mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const SCRIPTS = ["verify-blame-ignore.mjs", "git-top-level.mjs"];

describe("the check of the commits that blame skips", () => {
  it("passes in this checkout", () => {
    const run = spawnSync(process.execPath, ["scripts/verify-blame-ignore.mjs"], {
      encoding: "utf8",
    });
    expect(run.status).toBe(0);
  });

  it("says that it cannot tell in a copy that is no Git checkout", () => {
    const root = mkdtempSync(join(tmpdir(), "mnemocode-blame-"));
    try {
      mkdirSync(join(root, "scripts"));
      for (const script of SCRIPTS)
        copyFileSync(join("scripts", script), join(root, "scripts", script));
      copyFileSync(".git-blame-ignore-revs", join(root, ".git-blame-ignore-revs"));
      const run = spawnSync(process.execPath, [join(root, "scripts", "verify-blame-ignore.mjs")], {
        encoding: "utf8",
      });
      expect(run.status).toBe(0);
      expect(run.stdout).toContain("no Git checkout of the repository");
      expect(run.stderr).toBe("");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
