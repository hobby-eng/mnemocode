// AUD-008-UI002 follow-up: exact reviewed typedCommand/wrapText functions and the menu's display
// composition, with a harmless POSIX function that prints argv. No product command is executed.
// Run from the repository root:
// node docs/audits/AUD-008-harnesses/recheck-ui-build-command-display.mjs
// Exits nonzero if copying the rendered command changes a synthetic filename.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { stripTypeScriptTypes } from "node:module";
import vm from "node:vm";

const paths = ["src/cli/menu.ts", "src/cli/terminal.ts", "src/cli/terminal-choice.ts"];
const sources = Object.fromEntries(paths.map((path) => [path, readFileSync(path, "utf8")]));
const menu = sources[paths[0]];
const terminal = sources[paths[1]];
const width = Number(sources[paths[2]].match(/export const LINE_WIDTH = (\d+);/u)?.[1]);
const indent = menu.match(/const COMMAND_INDENT = "([ ]+)";/u)?.[1];
assert.ok(Number.isInteger(width) && typeof indent === "string");
assert.ok(menu.includes("wrapText(typedCommand(action.run), LINE_WIDTH - COMMAND_INDENT.length)"));

function sliceBetween(source, start, end) {
  assert.equal(source.split(start).length, 2, `Expected one source match: ${start}`);
  const offset = source.indexOf(start);
  const stop = source.indexOf(end, offset);
  assert.ok(stop > offset, `Expected source boundary: ${end}`);
  return source.slice(offset, stop);
}

const functions = stripTypeScriptTypes(
  sliceBetween(menu, "const PLAIN_ARGUMENT", "const paint") +
    sliceBetween(terminal, "export function wrapText", "/**"),
).replace(/^export /gmu, "");
const { typedCommand, wrapText } = vm.runInNewContext(
  `${functions}\n({ typedCommand, wrapText });`,
);
const cases = [
  "output/a$(printf b).pdf",
  "output/a  b.pdf",
  `output/${"a".repeat(45)} ${"b".repeat(45)}.pdf`,
];
const results = cases.map((filename) => {
  const argv = ["preview", "--pdf", filename];
  const quoted = typedCommand(argv, "linux");
  const displayed = wrapText(quoted, width - indent.length)
    .map((line) => `${indent}${line}`)
    .join("\n");
  const child = spawnSync("sh", ["-c", `mnemocode() { printf '%s\\0' "$@"; }; ${displayed}`], {
    encoding: "utf8",
    timeout: 5_000,
  });
  if (child.error) throw child.error;
  const actual = child.stdout.split("\0").slice(0, -1);
  return {
    filename,
    quoted,
    displayed,
    shellStatus: child.status,
    shellStderr: child.stderr,
    actual,
    preserved: child.status === 0 && JSON.stringify(actual) === JSON.stringify(argv),
  };
});
console.log(
  JSON.stringify(
    {
      sourceHashes: Object.fromEntries(
        paths.map((path) => [path, createHash("sha256").update(sources[path]).digest("hex")]),
      ),
      method:
        "Exact extracted function bodies; TypeScript annotations/export modifier removed only",
      limitations: "POSIX sh; no Windows shell or full menu PTY execution",
      results,
    },
    null,
    2,
  ),
);
if (results.some((result) => !result.preserved)) process.exitCode = 1;
