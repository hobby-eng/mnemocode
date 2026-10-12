// Exercise the unchanged detector's private primitives with synthetic source, without writing src/.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import * as paths from "node:path";
import { pathToFileURL, fileURLToPath } from "node:url";

const path = "scripts/verify-no-copies.mjs";
const source = readFileSync(path, "utf8");
const cut = source.indexOf("const minTokens = option(");
assert.ok(cut > 0);
// Only replace the filesystem root initialization; exported primitives keep their exact bodies.
const prefix = source
  .slice(0, cut)
  .replace(
    /const root = resolve\(fileURLToPath\(new URL\("\.\.", import\.meta\.url\)\)\);/u,
    'const root = "synthetic-detector-root";',
  );
assert.ok(prefix.includes('const root = "synthetic-detector-root";'));
const moduleSource = prefix + "\nexport { tokensOf, withoutImportLists, deliberate, option };\n";
const detector = await import(
  "data:text/javascript;base64," + Buffer.from(moduleSource).toString("base64")
);

// The contract requires the marker in a comment. The actual matcher also accepts a string.
const markerInString = detector.deliberate(
  ['const label = "not a deliberate copy";', "x();"],
  2,
  2,
);
const markerInComment = detector.deliberate(
  ["// deliberate copy: isolated worker cannot import.", "x();"],
  2,
  2,
);
assert.equal(markerInString, true);
assert.equal(markerInComment, true);

const saved = process.argv;
let badThreshold;
try {
  process.argv = [saved[0], path, "--tokens", "wrong"];
  badThreshold = detector.option("--tokens", 50);
} finally {
  process.argv = saved;
}
assert.ok(Number.isNaN(badThreshold));
assert.equal(0 + badThreshold <= 100, false); // Every scan-window loop is skipped.

// Exported function bodies and dynamic imports remain code when import lists are removed.
const tokens = detector.withoutImportLists(
  detector.tokensOf(
    'import { x } from "a"; export { x }; export function f(){ return import("b"); }',
  ),
);
assert.ok(tokens.some(({ key }) => key === "function"));
assert.ok(tokens.some(({ key }) => key === "return"));
assert.equal(tokens.filter(({ key }) => key === "import").length, 1);

// Run the complete original scanner over two in-memory files. Only filesystem/process adapters
// are synthetic; tokenization, copy matching, marker handling and final exit logic are unchanged.
const executable = source
  .replace(/^import .*?;\n/gmu, "")
  .replaceAll("import.meta.url", JSON.stringify(pathToFileURL(paths.resolve(path)).href));
const runScanner = new Function(
  "readdirSync",
  "readFileSync",
  "join",
  "relative",
  "resolve",
  "fileURLToPath",
  "process",
  "console",
  executable,
);
const body =
  "export function shared(x: number): number { let y = x + 1; y = y * 2; y = y - 3; y = y / 4; y = y + 5; y = y * 6; y = y - 7; return y; }";
function scan(header, threshold = "50") {
  let exitCode = 0;
  const messages = [];
  const files = { "a.ts": body, "b.ts": header + "\n" + body };
  const fakeProcess = {
    argv: [saved[0], path, "--tokens", threshold],
    exit(code) {
      exitCode = code;
      throw stop;
    },
  };
  const stop = {};
  try {
    runScanner(
      () => Object.keys(files).map((name) => ({ name, isDirectory: () => false })),
      (name) => files[paths.basename(name)],
      paths.join,
      paths.relative,
      paths.resolve,
      fileURLToPath,
      fakeProcess,
      {
        log: (...items) => messages.push(items.join(" ")),
        error: (...items) => messages.push(items.join(" ")),
      },
    );
  } catch (error) {
    if (error !== stop) throw error;
  }
  return { exitCode, messages };
}
const fixtureRuns = {
  unmarked: scan("// Synthetic fixture."),
  commentMarker: scan("// deliberate copy: synthetic isolated-worker exception."),
  stringMarker: scan('const label = "not a deliberate copy";'),
  invalidThreshold: scan("// Synthetic fixture.", "wrong"),
};
assert.equal(fixtureRuns.unmarked.exitCode, 1);
assert.equal(fixtureRuns.commentMarker.exitCode, 0);
assert.equal(fixtureRuns.stringMarker.exitCode, 0);
assert.equal(fixtureRuns.invalidThreshold.exitCode, 0);

console.log(
  JSON.stringify(
    {
      detectorSha256: createHash("sha256").update(source).digest("hex"),
      markerInString,
      markerInComment,
      invalidThresholdSkipsScan: Number.isNaN(badThreshold),
      exportedBodiesAndDynamicImportsRetained: true,
      fixtureRuns,
    },
    null,
    2,
  ),
);
