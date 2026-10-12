// AUD-010 build reviewer: dependency pins, use and notices (CHECK-BLD-003), and the toolchain pins
// of the workspace rules.
//
// Checks, each printed with the values compared:
// 1. every dependency and devDependency of package.json is an exact version, equals the specifier
//    and version of the lockfile's "." importer (its second YAML document, the project's) and the
//    version installed in node_modules;
// 2. every runtime dependency is imported by a module of src/ (resolved with esbuild over every
//    src/ file), and is named in the executable's license notices when release/ holds one;
//    a runtime dependency that src/ never imports fails;
// 3. THIRD_PARTY_NOTICES.md names every runtime dependency that src/ imports (in backquotes, any case);
// 4. toolchain pins: .node-version 26.10.0 and engines ">=26.10.0", packageManager pnpm@12.8.1,
//    prettier 3.9.9, .prettierrc.json exactly {"printWidth":100,"proseWrap":"preserve"},
//    and the running Node.js is the pinned one.
// Exits 1 when a check fails. Run from the repository root.
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { build } from "esbuild";

let failures = 0;
const fail = (message) => {
  failures += 1;
  console.log(`FAIL ${message}`);
};
const manifest = JSON.parse(readFileSync("package.json", "utf8"));

// The lockfile's project importer: the second YAML document (pnpm writes its own first).
const lock = readFileSync("pnpm-lock.yaml", "utf8");
const projectDocument = lock.split(/^---$/mu).find((document) => /^\s{4}dependencies:/mu.test(document));
const locked = new Map();
let section;
let current;
for (const line of projectDocument.slice(projectDocument.indexOf("importers:")).split("\n")) {
  if (/^packages:/u.test(line)) break;
  const header = /^ {4}(dependencies|devDependencies):$/u.exec(line);
  if (header) {
    section = header[1];
    continue;
  }
  const name = /^ {6}'?([^':]+)'?:$/u.exec(line);
  if (name) {
    current = { section, name: name[1] };
    locked.set(name[1], current);
    continue;
  }
  const field = /^ {8}(specifier|version): (.+)$/u.exec(line);
  if (field && current) current[field[1]] = field[2];
}
console.log(`Lockfile project importer entries: ${locked.size}`);

for (const section of ["dependencies", "devDependencies"])
  for (const [name, pinned] of Object.entries(manifest[section])) {
    const entry = locked.get(name);
    const installedPath = join("node_modules", name, "package.json");
    const installed = existsSync(installedPath)
      ? JSON.parse(readFileSync(installedPath, "utf8")).version
      : "missing";
    const lockedVersion = entry?.version?.replace(/\(.*$/u, "");
    console.log(
      `${section} ${name}: pinned ${pinned}; lock specifier ${entry?.specifier} version ${lockedVersion} (${entry?.section}); installed ${installed}`,
    );
    if (!/^\d+\.\d+\.\d+$/u.test(pinned)) fail(`${name}: not an exact version`);
    if (entry?.specifier !== pinned || lockedVersion !== pinned || entry?.section !== section)
      fail(`${name}: lockfile differs`);
    if (installed !== pinned) fail(`${name}: installed ${installed}`);
  }

// 2. Which packages src/ imports, resolved.
function sources(directory) {
  return readdirSync(directory).flatMap((entry) => {
    const path = join(directory, entry);
    if (statSync(path).isDirectory()) return sources(path);
    return path.endsWith(".ts") && !path.endsWith(".d.ts") ? [path] : [];
  });
}
const result = await build({
  entryPoints: sources("src"),
  bundle: true,
  write: false,
  metafile: true,
  platform: "node",
  format: "esm",
  packages: "external",
  outdir: "aud010-unwritten",
  logLevel: "silent",
});
const imported = new Set();
for (const { imports } of Object.values(result.metafile.inputs))
  for (const edge of imports)
    // Relative externals are the SSKR bridge outside src/, not packages.
    if (edge.external && !edge.path.startsWith("node:") && !/^[./]/u.test(edge.path)) {
      const parts = edge.path.split("/");
      imported.add(edge.path.startsWith("@") ? parts.slice(0, 2).join("/") : parts[0]);
    }
console.log(`Packages imported by src/: ${[...imported].sort().join(", ")}`);
const licensesPath = readdirSync("release", { withFileTypes: true })
  .map((entry) => join("release", entry.name))
  .find((path) => path.endsWith("-licenses.txt"));
const licensed = new Set(
  licensesPath === undefined
    ? []
    : [...readFileSync(licensesPath, "utf8").matchAll(/^npm package (\S+) (\S+) /gmu)].map((m) => m[1]),
);
console.log(`Executable notices: ${licensesPath ?? "none in release/"}; npm packages named: ${[...licensed].sort().join(", ")}`);
const notices = readFileSync("THIRD_PARTY_NOTICES.md", "utf8");
for (const name of Object.keys(manifest.dependencies)) {
  const used = imported.has(name);
  const inExecutable = licensesPath === undefined ? "n/a" : licensed.has(name);
  // Case-insensitive: the notices write jsqr as jsQR, the project's own spelling.
  const named = notices.toLowerCase().includes(`\`${name.toLowerCase()}\``);
  console.log(`runtime ${name}: imported by src/ ${used}; in executable notices ${inExecutable}; named in THIRD_PARTY_NOTICES.md ${named}`);
  if (!used) fail(`${name}: a runtime dependency that no module of src/ imports`);
  if (used && licensesPath !== undefined && !licensed.has(name)) fail(`${name}: imported but absent from the executable notices`);
  if (used && !named) fail(`${name}: imported but not named in THIRD_PARTY_NOTICES.md`);
}
for (const name of imported)
  if (!(name in manifest.dependencies)) fail(`${name}: imported by src/ but not a runtime dependency`);

// 4. Toolchain pins.
const nodeVersion = readFileSync(".node-version", "utf8").trim();
const prettierrc = JSON.parse(readFileSync(".prettierrc.json", "utf8"));
const prettierInstalled = JSON.parse(readFileSync("node_modules/prettier/package.json", "utf8")).version;
const pins = [
  [".node-version", nodeVersion, "26.10.0"],
  ["engines.node", manifest.engines?.node, ">=26.10.0"],
  ["running Node.js", process.version, "v26.10.0"],
  ["packageManager", manifest.packageManager, "pnpm@12.8.1"],
  ["devDependencies.prettier", manifest.devDependencies.prettier, "3.9.9"],
  ["installed prettier", prettierInstalled, "3.9.9"],
  [".prettierrc.json", JSON.stringify(prettierrc), JSON.stringify({ printWidth: 100, proseWrap: "preserve" })],
];
for (const [name, actual, expected] of pins) {
  console.log(`pin ${name}: ${actual} (expected ${expected})`);
  if (actual !== expected) fail(`${name}`);
}
console.log(failures === 0 ? "PASS build-dependencies" : `FAIL build-dependencies: ${failures} check(s)`);
process.exitCode = failures === 0 ? 0 : 1;
