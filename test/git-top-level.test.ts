import { spawnSync } from "node:child_process";
import { mkdirSync, symlinkSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { scriptExports } from "./helpers/script-exports.js";
import { testFolder } from "./helpers/test-folders.js";

const { isRepositoryTopLevel } = await scriptExports<{
  isRepositoryTopLevel: (root: string) => boolean;
}>("scripts/git-top-level.mjs", { isRepositoryTopLevel: "function" });

describe("a Git work tree's top level", () => {
  it("recognizes the same root through a directory alias, but never a nested folder", async () => {
    const folder = await testFolder("mnemocode-git-root-");
    const root = join(folder, "physical");
    const alias = join(folder, "alias");
    const nested = join(root, "nested");
    mkdirSync(nested, { recursive: true });
    symlinkSync(root, alias, process.platform === "win32" ? "junction" : "dir");
    const init = spawnSync("git", ["-C", root, "init", "--quiet"], { encoding: "utf8" });
    expect(init.status, init.stderr).toBe(0);
    expect(isRepositoryTopLevel(root)).toBe(true);
    expect(isRepositoryTopLevel(alias)).toBe(true);
    expect(isRepositoryTopLevel(nested)).toBe(false);
    expect(isRepositoryTopLevel(join(alias, "nested"))).toBe(false);
    expect(isRepositoryTopLevel(folder)).toBe(false);
    expect(isRepositoryTopLevel(join(folder, "missing"))).toBe(false);
  });
});
