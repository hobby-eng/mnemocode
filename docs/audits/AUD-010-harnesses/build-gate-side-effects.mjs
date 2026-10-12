// AUD-010 build reviewer: does the import pattern of test/portable-modules.test.ts see a
// side-effect import such as `import "./platform-node.js";`?
//
// The gate follows a module's imports with the regular expression IMPORT, read here from the test
// file itself, and esbuild resolves the same modules for comparison. For every module of src/ that
// has a side-effect import (index.ts, cli/heir-sheet.ts, export/pdf.ts, export/individual-cards.ts,
// export/sskr-cards.ts install the Node.js render platform this way), it prints the specifiers each
// sees. A side-effect import that esbuild follows and the gate's pattern does not is a blind spot:
// a part that gained one would reach Node.js code without the gate noticing.
//
// It also confirms, through esbuild, that no listed part reaches such a module today (the gate's
// blind spot has no present consequence). Exits 1 only if a listed part reaches a module through a
// side-effect import, which would be a present defect; the blind spot itself is printed.
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { build } from "esbuild";

const test = readFileSync("test/portable-modules.test.ts", "utf8");
const source = /const IMPORT =\s*\/(.+)\/(\w*);/u.exec(test);
const IMPORT = new RegExp(source[1], source[2]);
console.log(`The gate's pattern: /${IMPORT.source}/${IMPORT.flags}`);
const code = (text) => text.replace(/\/\*[\s\S]*?\*\//gu, "").replace(/(^|[^:"])\/\/.*$/gmu, "$1");
function files(directory) {
  return readdirSync(directory).flatMap((entry) => {
    const path = join(directory, entry);
    return statSync(path).isDirectory() ? files(path) : path.endsWith(".ts") ? [path] : [];
  });
}
const withSideEffects = files("src").filter((path) => /^\s*import\s+"[^"]+";/mu.test(readFileSync(path, "utf8")));
let blind = 0;
for (const path of withSideEffects) {
  const text = code(readFileSync(path, "utf8"));
  const sideEffects = [...text.matchAll(/^\s*import\s+"([^"]+)";/gmu)].map((m) => m[1]);
  const seen = new Set([...text.matchAll(new RegExp(IMPORT.source, IMPORT.flags))].map((m) => m[1] ?? m[2]));
  for (const specifier of sideEffects) {
    const sees = seen.has(specifier);
    if (!sees) blind += 1;
    console.log(`${path}: side-effect import "${specifier}" -> the gate's pattern sees it: ${sees}`);
  }
}
console.log(`Side-effect imports the gate's pattern does not see: ${blind}`);

// Today: does any listed part reach a module through a side-effect import?
const block = (from, to) => test.slice(test.indexOf(from), test.indexOf(to));
const listed = [
  ...block("const PARTS", "const SHARED_MODULES").matchAll(/^  "(src\/[^"]+\.ts)": \{/gmu),
  ...block("const SHARED_MODULES", "const NEVER_REACHED").matchAll(/^  "(src\/[^"]+\.ts)": /gmu),
].map((m) => m[1]);
const result = await build({
  entryPoints: listed,
  bundle: true,
  write: false,
  metafile: true,
  platform: "node",
  format: "esm",
  packages: "external",
  outdir: "aud010-unwritten",
  logLevel: "silent",
});
const reachedSideEffectModules = Object.keys(result.metafile.inputs).filter((input) =>
  withSideEffects.map((path) => relative(".", path).split("\\").join("/")).includes(input),
);
console.log(`Listed parts and shared modules: ${listed.length}; modules with side-effect imports they reach: [${reachedSideEffectModules.join(", ")}]`);
const failures = reachedSideEffectModules.length;
console.log(failures === 0 ? "PASS build-gate-side-effects (blind spot printed above, no present consequence)" : "FAIL build-gate-side-effects");
process.exitCode = failures === 0 ? 0 : 1;
