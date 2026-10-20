// The check of .git-blame-ignore-revs (scripts/verify-blame-ignore.mjs, AUD-037-BLD003): it checks
// the names only in a Git checkout of the repository, reading them as Git does, and elsewhere says
// that it cannot tell.

import { spawnSync, type SpawnSyncReturns } from "node:child_process";
import { copyFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

const SCRIPTS = ["verify-blame-ignore.mjs", "git-top-level.mjs"];
const FILE = ".git-blame-ignore-revs";

let root: string;
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "mnemocode-blame-"));
});
afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

/** Copies the check into `folder`; returns how it is run there. */
function checkIn(folder: string): () => SpawnSyncReturns<string> {
  mkdirSync(join(folder, "scripts"), { recursive: true });
  for (const script of SCRIPTS)
    copyFileSync(join("scripts", script), join(folder, "scripts", script));
  return () =>
    spawnSync(process.execPath, [join(folder, "scripts", "verify-blame-ignore.mjs")], {
      encoding: "utf8",
    });
}

/** Runs git in `folder` as a test fixture's own author, whatever the user's settings. */
function git(folder: string, ...arguments_: string[]): string {
  const run = spawnSync(
    "git",
    [
      "-c",
      "user.name=MnemoCode test",
      "-c",
      "user.email=test@example.invalid",
      "-c",
      "commit.gpgsign=false",
      ...arguments_,
    ],
    { cwd: folder, encoding: "utf8" },
  );
  expect(run.status, run.stderr).toBe(0);
  return run.stdout.trim();
}

describe("the check of the commits that blame skips", () => {
  it("passes in this checkout", () => {
    const run = spawnSync(process.execPath, ["scripts/verify-blame-ignore.mjs"], {
      encoding: "utf8",
    });
    expect(run.status).toBe(0);
  });

  it("says that it cannot tell in a copy that is no Git checkout", () => {
    const check = checkIn(root);
    copyFileSync(FILE, join(root, FILE));
    const run = check();
    expect(run.status).toBe(0);
    expect(run.stdout).toContain("no Git checkout of the repository");
    expect(run.stderr).toBe("");
  });

  it("says that it cannot tell in a copy inside another repository's work tree", () => {
    git(root, "init", "--quiet");
    const copy = join(root, "copy");
    const check = checkIn(copy);
    copyFileSync(FILE, join(copy, FILE));
    const run = check();
    expect(run.status).toBe(0);
    expect(run.stdout).toContain("no Git checkout of the repository");
    expect(run.stderr).toBe("");
  });

  it("reads a name as Git does, in either case and before a comment", () => {
    git(root, "init", "--quiet");
    const check = checkIn(root);
    writeFileSync(join(root, FILE), "# Formatting\n");
    git(root, "add", "--all");
    git(root, "commit", "--quiet", "--message", "Public fixture");
    const commit = git(root, "rev-parse", "HEAD");
    writeFileSync(join(root, FILE), `# Formatting\n${commit.toUpperCase()}  # the fixture\n`);
    const named = check();
    expect(named.status, named.stderr).toBe(0);
    expect(named.stdout).toContain("The 1 commits");
    const missing = "0".repeat(commit.length);
    writeFileSync(join(root, FILE), `${commit}\n${missing} # rewritten\n`);
    const refused = check();
    expect(refused.status).toBe(1);
    expect(refused.stderr).toContain(`not in the history of HEAD: ${missing}.`);
  });
});
