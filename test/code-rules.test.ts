import { spawnSync } from "node:child_process";
import { copyFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { describe, expect, it } from "vitest";

// scripts/verify-code-rules.mjs, the gate `code-rules` of the coding guide, run over small trees
// of files in a temporary folder: each rule refuses its case and takes the case that keeps it.

/** A tree that keeps every rule: a pnpm manifest with exact versions and its lockfile. */
const BASE: Readonly<Record<string, string>> = {
  "package.json": JSON.stringify({
    packageManager: "pnpm@12.8.1",
    dependencies: { "@scure/bip39": "2.4.0" },
  }),
  "pnpm-lock.yaml": "lockfileVersion: '9.0'\n",
};

/** Whether Python 3 runs here, which the gate asks for its standard library (TOOL-03). */
const PYTHON = spawnSync("python3", ["--version"]).status === 0;

/** The gate run over BASE with `files` added (a null removes one): its exit code and its lines. */
function codeRules(files: Readonly<Record<string, string | null>>): {
  readonly status: number | null;
  readonly problems: string;
} {
  const root = mkdtempSync(join(tmpdir(), "mnemocode-code-rules-"));
  try {
    mkdirSync(join(root, "scripts"));
    for (const script of ["verify-code-rules.mjs", "source-tokens.mjs"])
      copyFileSync(join("scripts", script), join(root, "scripts", script));
    for (const [path, text] of Object.entries({ ...BASE, ...files })) {
      if (text === null) continue;
      mkdirSync(dirname(join(root, path)), { recursive: true });
      writeFileSync(join(root, path), text);
    }
    const run = spawnSync(process.execPath, [join(root, "scripts", "verify-code-rules.mjs")], {
      encoding: "utf8",
    });
    return { status: run.status, problems: run.stderr };
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

/** The rule IDs that the gate names for `files`, each once. */
function rulesBroken(files: Readonly<Record<string, string | null>>): string[] {
  const { problems } = codeRules(files);
  return [...new Set([...problems.matchAll(/^\S+:\d+ (\S+) /gmu)].map((match) => match[1]!))];
}

describe("the code rules of the coding guide", () => {
  it("pass a tree that keeps every rule", () => {
    expect(codeRules({})).toEqual({ status: 0, problems: "" });
  });

  it("refuse a file of more than 800 lines that the linter does not measure, unless it says why", () => {
    const long = "line\n".repeat(801);
    expect(rulesBroken({ "docs/long.md": long })).toEqual(["CORE-15"]);
    expect(
      rulesBroken({ "docs/long.md": `<!-- long: one table of every code -->\n${long}` }),
    ).toEqual([]);
    // A Rust file's unit tests at its end do not count.
    const rust = `${"fn f() {}\n".repeat(700)}#[cfg(test)]\nmod tests {\n${"//\n".repeat(200)}}\n`;
    expect(rulesBroken({ "crate/src/lib.rs": rust })).toEqual([]);
  });

  it("refuse a shell script that does not stop on its first error", () => {
    expect(rulesBroken({ "scripts/run.sh": "#!/usr/bin/env bash\nset -u\necho\n" })).toEqual([
      "TOOL-02",
    ]);
    expect(
      rulesBroken({ "scripts/run.sh": "#!/usr/bin/env bash\n# Runs it.\nset -euo pipefail\n" }),
    ).toEqual([]);
  });

  it.skipIf(!PYTHON)("refuse a Python package without its pin and hashes", () => {
    const script = { "scripts/trace.py": "import json\nimport numpy as np\n" };
    expect(rulesBroken(script)).toEqual(["TOOL-03"]);
    const hashed = `numpy==2.5.4 \\\n    --hash=sha256:${"0".repeat(64)}\n`;
    expect(rulesBroken({ ...script, "scripts/trace-requirements.txt": hashed })).toEqual([]);
    expect(
      rulesBroken({ ...script, "scripts/trace-requirements.txt": "numpy>=2\n" }).sort(),
    ).toEqual(["CORE-25", "TOOL-03"]);
    // A module that a script imports shares the script's requirements.
    expect(
      rulesBroken({
        "scripts/trace.py": "import shared\n",
        "scripts/shared.py": "import numpy\n",
        "scripts/trace-requirements.txt": hashed,
      }),
    ).toEqual([]);
  });

  it("refuse file names that are not kebab-case where the code lives", () => {
    expect(rulesBroken({ "src/CardSheet.ts": "" })).toEqual(["TS-09"]);
    expect(rulesBroken({ "src/card-sheet.ts": "", "docs/README.md": "" })).toEqual([]);
  });

  it("refuse a dependency without an exact version, and another lockfile than pnpm's", () => {
    const ranged = JSON.stringify({
      packageManager: "pnpm@12.8.1",
      devDependencies: { vitest: "^5.0.3" },
    });
    expect(rulesBroken({ "package.json": ranged })).toEqual(["CORE-25"]);
    expect(rulesBroken({ "crate/Cargo.toml": '[dependencies]\nsskr = "0.12.0"\n' })).toEqual([
      "CORE-25",
    ]);
    expect(rulesBroken({ "crate/Cargo.toml": '[dependencies]\nsskr = "=0.12.0"\n' })).toEqual([]);
    expect(rulesBroken({ "package-lock.json": "{}" })).toEqual(["TOOL-05"]);
    expect(rulesBroken({ "pnpm-lock.yaml": null })).toEqual(["TOOL-05"]);
  });
});

describe("the code rules of the coding guide", () => {
  it("refuse an error class without the Error suffix or a readonly code", () => {
    expect(rulesBroken({ "src/a.ts": "class Refused extends Error {}\n" })).toEqual(["TS-06"]);
    const coded = [
      'class RefusedError extends Error {\n  readonly code: "refused" = "refused";\n}',
      // A subclass carries its parent's code.
      "class NarrowError extends RefusedError {}",
    ].join("\n");
    expect(rulesBroken({ "src/cli/a.ts": coded })).toEqual([]);
    expect(
      codeRules({ "src/cli/a.ts": "class RefusedError extends TypeError {}\n" }).problems,
    ).toMatch(/readonly code/u);
  });

  it("refuse enum and the private keyword, not a private constructor", () => {
    expect(rulesBroken({ "src/cli/a.ts": "enum Kind {\n  A,\n}\n" })).toEqual(["TS-08"]);
    expect(rulesBroken({ "src/cli/a.ts": "class A {\n  private x = 1;\n}\n" })).toEqual(["TS-05"]);
    const factory = "class A {\n  #x = 1;\n  private constructor() {}\n  static of() {}\n}\n";
    expect(rulesBroken({ "src/cli/a.ts": factory })).toEqual([]);
    // A property named private is no keyword.
    expect(rulesBroken({ "src/cli/a.ts": "const flags = { private: true };\n" })).toEqual([]);
  });

  it("refuse an export of a library module without a doc comment, not of the command line", () => {
    const bare = "export const LIMIT = 3;\n";
    expect(rulesBroken({ "src/core/a.ts": bare })).toEqual(["TS-11"]);
    expect(rulesBroken({ "src/cli/a.ts": bare })).toEqual([]);
    const documented = [
      "/** The most marks. */",
      "export const LIMIT = 3;",
      "/** The parts of `text`. */",
      "export function parts(text: string): string[];",
      "export function parts(text: string, at: number): string[];",
      "export function parts(text: string): string[] {",
      "  return [text];",
      "}",
      'export { LIMIT as MAX } from "./b.js";',
    ].join("\n");
    expect(rulesBroken({ "src/core/a.ts": documented })).toEqual([]);
    // A line comment is no doc comment.
    expect(rulesBroken({ "src/core/a.ts": `// The most marks.\n${bare}` })).toEqual(["TS-11"]);
  });

  it("refuse a lint exception without its rule and reason, and a handler in markup", () => {
    const bare = "// oxlint-disable-next-line max-lines-per-function\nfunction f() {}\n";
    expect(rulesBroken({ "src/cli/a.ts": bare })).toEqual(["TS-12"]);
    const reasoned =
      "// oxlint-disable-next-line max-lines-per-function -- one table of every code\nfunction f() {}\n";
    expect(rulesBroken({ "src/cli/a.ts": reasoned })).toEqual([]);
    expect(rulesBroken({ "page.html": '<button onclick="go()">Go</button>\n' })).toEqual([
      "WEB-01",
    ]);
  });
});
