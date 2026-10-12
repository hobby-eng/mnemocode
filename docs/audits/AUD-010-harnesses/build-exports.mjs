// AUD-010 build reviewer: the package's "exports" against src/ and dist/, and each subpath
// imported alone through the package's own name in a fresh Node.js process.
//
// Checks, each printed with the values compared:
// 1. every export maps ./dist/<p>.js and ./dist/<p>.d.ts, both present, and src/<p>.ts exists;
// 2. every non-compatibility export's <p> equals its subpath (./core/coins -> core/coins);
// 3. every part listed in test/portable-modules.test.ts (PARTS) has an export, and every
//    non-compatibility export is a listed part;
// 4. every subpath loads alone (node -e "await import('mnemocode/<subpath>')") with exit 0 and
//    a non-empty module namespace.
// Exits 1 when any check fails. Run from the repository root.
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";

const manifest = JSON.parse(readFileSync("package.json", "utf8"));
const COMPATIBILITY = new Set([".", "./cards", "./sskr"]);
let failures = 0;
const fail = (message) => {
  failures += 1;
  console.log(`FAIL ${message}`);
};

const portable = readFileSync("test/portable-modules.test.ts", "utf8");
const partsBlock = portable.slice(
  portable.indexOf("const PARTS"),
  portable.indexOf("const SHARED_MODULES"),
);
const parts = new Set([...partsBlock.matchAll(/^  "(src\/[^"]+\.ts)": \{/gmu)].map((m) => m[1]));
console.log(`PARTS listed in test/portable-modules.test.ts: ${parts.size}`);

const exportsMap = manifest.exports;
console.log(`package.json exports: ${Object.keys(exportsMap).length}`);
const exportedParts = new Set();
for (const [subpath, target] of Object.entries(exportsMap)) {
  const js = target.import;
  const dts = target.types;
  const stem = js.replace(/^\.\/dist\//u, "").replace(/\.js$/u, "");
  const src = `src/${stem}.ts`;
  const line = `${subpath} -> import ${js} (${existsSync(js)}), types ${dts} (${existsSync(dts)}), source ${src} (${existsSync(src)})`;
  console.log(line);
  if (!js.startsWith("./dist/") || dts !== `./dist/${stem}.d.ts`) fail(`${subpath}: target shape`);
  if (!existsSync(js)) fail(`${subpath}: ${js} missing`);
  if (!existsSync(dts)) fail(`${subpath}: ${dts} missing`);
  if (!existsSync(src)) fail(`${subpath}: ${src} missing`);
  if (!COMPATIBILITY.has(subpath)) {
    if (`./${stem}` !== subpath) fail(`${subpath}: maps ${stem}, expected ${subpath.slice(2)}`);
    exportedParts.add(src);
    if (!parts.has(src)) fail(`${subpath}: exported but not a PART in portable-modules.test.ts`);
  }
}
for (const part of parts)
  if (!exportedParts.has(part)) fail(`${part}: a PART without a package export`);
console.log(`Parts with an export: ${[...parts].filter((p) => exportedParts.has(p)).length}/${parts.size}`);

// Each subpath alone, in its own process, through the package's self-reference.
for (const subpath of Object.keys(exportsMap)) {
  const specifier = subpath === "." ? manifest.name : `${manifest.name}/${subpath.slice(2)}`;
  const script = `const m = await import(${JSON.stringify(specifier)}); console.log(Object.keys(m).length);`;
  const result = spawnSync(process.execPath, ["--input-type=module", "-e", script], {
    encoding: "utf8",
    timeout: 60_000,
  });
  const names = Number.parseInt(result.stdout.trim(), 10);
  console.log(`import ${specifier}: exit ${result.status}, ${Number.isNaN(names) ? "?" : names} names`);
  if (result.status !== 0) fail(`${specifier}: ${result.stderr.trim().split("\n").at(-1)}`);
  else if (!(names > 0)) fail(`${specifier}: empty namespace`);
}

console.log(failures === 0 ? "PASS build-exports" : `FAIL build-exports: ${failures} check(s)`);
process.exitCode = failures === 0 ? 0 : 1;
