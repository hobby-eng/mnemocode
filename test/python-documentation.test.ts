import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it } from "vitest";

/** Runs the real gate over one synthetic Python source, keeping its diagnostics and exit code. */
function checked(text: string): { readonly status: number | null; readonly output: string } {
  const directory = mkdtempSync(join(tmpdir(), "mnemocode-python-docs-"));
  try {
    const path = join(directory, "fixture.py");
    writeFileSync(path, text);
    const run = spawnSync(process.execPath, ["scripts/verify-python-documentation.mjs", path], {
      encoding: "utf8",
    });
    return { status: run.status, output: run.stdout + run.stderr };
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}

it.each([
  ["module", "value = 1\n"],
  ["function", '"""The module."""\ndef read():\n    return 1\n'],
  ["async function", '"""The module."""\nasync def read():\n    return 1\n'],
  ["class", '"""The module."""\nclass Reader:\n    pass\n'],
  [
    "method",
    '"""The module."""\nclass Reader:\n    """A reader."""\n    def read(self):\n        return 1\n',
  ],
  [
    "constructor",
    '"""The module."""\nclass Reader:\n    """A reader."""\n    def __init__(self):\n        pass\n',
  ],
])("refuses a public Python %s without its docstring", (_, text) => {
  const result = checked(text);
  expect(result.status).toBe(1);
  expect(result.output).toContain("TOOL-04 missing docstring:");
});

it("accepts documented public declarations and undocumented private or nested functions", () => {
  const result = checked(
    '"""The module."""\nclass Reader:\n    """A reader."""\n' +
      '    def __init__(self):\n        """Start a reader."""\n        pass\n' +
      '    async def read(self):\n        """Read the value."""\n' +
      "        def local():\n            return 1\n        return local()\n" +
      "def _private():\n    return 2\nclass _Private:\n    def read(self):\n        return 3\n",
  );
  expect(result.status).toBe(0);
});

it.each(["comment", "docstring"])("accepts a 72-column %s and refuses 73 columns", (kind) => {
  const text = (columns: number): string =>
    kind === "comment"
      ? `"""The module."""\n# ${"x".repeat(columns - 2)}\n`
      : `"""${"x".repeat(columns - 6)}"""\n`;
  expect(checked(text(72)).status).toBe(0);
  const refused = checked(text(73));
  expect(refused.status).toBe(1);
  expect(refused.output).toContain("TOOL-04 comment or docstring exceeds 72 columns");
});

it("does not treat long data strings as docstrings and reports invalid Python syntax", () => {
  expect(checked(`"""The module."""\nDATA = "${"x".repeat(100)}"\n`).status).toBe(0);
  expect(checked('"""The module."""\nraise RuntimeError("must not execute")\n').status).toBe(0);
  const result = checked('"""The module."""\ndef broken(\n');
  expect(result.status).toBe(1);
  expect(result.output).toContain("TOOL-04 invalid Python syntax");
});

it("refuses a return outside a function without executing the module", () => {
  const result = checked('"""The module."""\nreturn 1\n');
  expect(result.status).toBe(1);
  expect(result.output).toContain("TOOL-04 invalid Python syntax");
});
