import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";

// The lint gate of the coding guide as the repository configures it (.oxlintrc.json and the lint
// script of package.json), run over one small file in a temporary folder.

const CONFIG = resolve(".oxlintrc.json");
const OXLINT = resolve("node_modules", ".bin", "oxlint");
/** The flags of the lint script that decide what fails, read from package.json. */
const LINT_SCRIPT = (
  JSON.parse(readFileSync("package.json", "utf8")) as { scripts: { lint: string } }
).scripts.lint;
const STALE_SEVERITY = "--report-unused-disable-directives-severity=error";

/** The exit code and output of the lint gate's configuration over a file holding `text`. */
function lint(text: string): { readonly status: number | null; readonly output: string } {
  const folder = mkdtempSync(join(tmpdir(), "mnemocode-lint-gate-"));
  try {
    const file = join(folder, "probe.ts");
    writeFileSync(file, text);
    const run = spawnSync(OXLINT, ["-c", CONFIG, STALE_SEVERITY, file], { encoding: "utf8" });
    return { status: run.status, output: `${run.stdout}${run.stderr}` };
  } finally {
    rmSync(folder, { recursive: true, force: true });
  }
}

/** `count` lines of code that declare constants. */
function codeLines(count: number, name = "v"): string {
  return Array.from({ length: count }, (_, at) => `export const ${name}${at} = ${at};`).join("\n");
}

/** `count` lines that hold nothing but a comment. */
function commentLines(count: number): string {
  return Array.from({ length: count }, () => "// Why the next line is as it is.").join("\n");
}

describe("the lint gate of the coding guide", () => {
  it("fails on a lint exception that no longer silences anything (TS-12)", () => {
    expect(LINT_SCRIPT).toContain(STALE_SEVERITY);
    const stale =
      "// oxlint-disable-next-line no-debugger -- a stale exception\nexport const v = 1;\n";
    expect(lint(stale).status).not.toBe(0);
    expect(lint("export const v = 1;\n").status).toBe(0);
  });

  it("counts a file's lines of code only: comments and blank lines are left out (CORE-15)", () => {
    // 800 lines of code beside 400 lines of comments and 400 blank lines: within the limit.
    const commented = `${codeLines(800)}\n${commentLines(400)}\n${"\n".repeat(400)}`;
    expect(lint(commented).status).toBe(0);
    const over = lint(`${codeLines(801)}\n`);
    expect(over.status).not.toBe(0);
    expect(over.output).toMatch(/max-lines/u);
  });

  it("counts a function's lines of code only (CORE-15)", () => {
    const body = (lines: number, comments: number): string =>
      [
        "export function f(): number {",
        "  let total = 0;",
        ...Array.from({ length: lines - 4 }, (_, at) => `  total += ${at};`),
        ...Array.from({ length: comments }, () => "  // Why the sum goes on."),
        "  return total;",
        "}",
      ].join("\n");
    expect(lint(`${body(150, 200)}\n`).status).toBe(0);
    const over = lint(`${body(151, 0)}\n`);
    expect(over.status).not.toBe(0);
    expect(over.output).toMatch(/max-lines-per-function/u);
  });
});
