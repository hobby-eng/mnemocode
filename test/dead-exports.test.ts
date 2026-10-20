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
    for (const script of ["verify-dead-exports.mjs", "source-tokens.mjs"])
      copyFileSync(join("scripts", script), join(root, "scripts", script));
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

  it("fails on a re-export that no module takes, though its source uses the name and a word matches it", () => {
    const run = checkOf({
      "src/a.ts": "export const x = 1;\nexport const y = x + 1;\n",
      "src/b.ts": 'import { y } from "./a.js";\nexport { x } from "./a.js";\nexport const b = y;\n',
      // A local of the same name is no use of the export.
      "src/c.ts": 'import { b } from "./b.js";\nconst x = b;\nconsole.log(x);\n',
    });
    expect(run.status).toBe(1);
    expect(run.said).toContain("src/b.ts: x is dead");
    expect(run.said).not.toContain("src/a.ts");
  });

  it("fails on a re-export that only tests take, written as an import exported again", () => {
    const run = checkOf({
      "src/a.ts": "export const x = 1;\nexport const y = 2;\n",
      "src/b.ts": 'import { x } from "./a.js";\nexport { x };\n',
      "src/c.ts": 'import { y } from "./a.js";\nconsole.log(y);\n',
      "test/b.test.ts": 'import { x } from "../src/b.js";\nvoid x;\n',
    });
    expect(run.status).toBe(1);
    expect(run.said).toContain("src/b.ts: x is only for tests");
    expect(run.said).toContain("src/a.ts: x is only for tests");
  });

  it("keeps a renamed re-export that production code takes, and the export it passes on", () => {
    const run = checkOf({
      "src/a.ts": "export const x = 1;\n",
      "src/b.ts": 'export { x as z } from "./a.js";\n',
      "src/c.ts": 'import { z } from "./b.js";\nconsole.log(z);\n',
    });
    expect(run.said).toBe("Every export of the 3 modules of src/ is reached.\n");
    expect(run.status).toBe(0);
  });

  it("fails on a dead export after a comment or a string that holds /*, which opens no comment", () => {
    const run = checkOf({
      "src/a.ts": [
        "// Reads the files under output/*.pdf that the cards were saved to.",
        "export const used = 1;",
        "export const unreached = 2;",
        'export const opener = "/*";',
        "export const hidden = 3;",
        "/** Something documented. */",
        "export const documented = 4;",
        "",
      ].join("\n"),
      "src/b.ts":
        'import { documented, opener, used } from "./a.js";\nconsole.log(documented, opener, used);\n',
    });
    expect(run.status).toBe(1);
    expect(run.said).toContain("src/a.ts: unreached is dead");
    expect(run.said).toContain("src/a.ts: hidden is dead");
  });

  it("fails on an export whose name its own module holds only as a key, a member or a string", () => {
    const run = checkOf({
      "src/a.ts": [
        "export const limit = 16;",
        'export const label = "limit";',
        "export function settings(o: { limit: number }): { readonly limit: number; most?: number } {",
        "  return { limit: o.limit };",
        "}",
        "",
      ].join("\n"),
      "src/b.ts":
        'import { label, settings } from "./a.js";\nconsole.log(label, settings({ limit: 1 }));\n',
    });
    expect(run.status).toBe(1);
    expect(run.said).toContain("src/a.ts: limit is dead");
    expect(run.said).not.toContain("settings");
  });

  it("fails on an export that a module imports but holds only as a key or a member", () => {
    const run = checkOf({
      "src/a.ts": "export const limit = 16;\nexport const o = { most: 1 };\n",
      "src/b.ts": 'import { limit, o } from "./a.js";\nconsole.log(o?.limit, { limit: 2 });\n',
    });
    expect(run.status).toBe(1);
    expect(run.said).toContain("src/a.ts: limit is dead");
    expect(run.said).not.toContain(" o ");
  });

  it("keeps an export that a module names in shorthand, a template, a spread or a condition", () => {
    const run = checkOf({
      "src/a.ts": "export const limit = 16;\nexport const report = () => ({ limit });\n",
      "src/b.ts": [
        'import { report } from "./a.js";',
        "export const most = report();",
        "export const list = [1];",
        "export const on = true;",
        "",
      ].join("\n"),
      "src/c.ts": [
        "import {",
        "  list,",
        "  most,",
        "  on,",
        '} from "./b.js";',
        'console.log(`at most ${most}`, [...list], on ? `yes` : "no");',
        "",
      ].join("\n"),
    });
    expect(run.said).toBe("Every export of the 3 modules of src/ is reached.\n");
    expect(run.status).toBe(0);
  });

  it("keeps an export that its doc comment gives to other hosts", () => {
    const run = checkOf({
      "src/a.ts": "/** For other hosts: a page reads it. */\nexport const forPages = 1;\n",
    });
    expect(run.status).toBe(0);
  });
});
