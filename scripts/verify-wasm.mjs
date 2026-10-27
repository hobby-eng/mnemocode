// The `wasm` gate's checks of the files scripts/build-wasm.sh built, one folder per profile of
// wasm-profiles.json (docs/design/architect/GATES.md): modules.json names exactly the files with
// their SHA-256; the glue loads nothing by URL; the WebAssembly names no directory of this
// computer (scripts/remap-builder-paths.sh); it starts with initSync in Node; and its exports are
// exactly those of the profile's modules (wasm-profiles.json, "exports"). The binding's own tests,
// CLI↔WASM parity and the memory scan (B-WIPE), run from here as each module arrives.
//
//   node scripts/verify-wasm.mjs        every profile, after scripts/build-wasm.sh built each
import { createHash } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { networkCodeIn } from "./network-code.mjs";
import { readProfiles } from "./wasm-profiles.mjs";

const root = fileURLToPath(new URL("..", import.meta.url));
const MANIFEST = "modules.json";

const problems = [];
const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");

/** The directories of this computer that no shipped file may name (remap-builder-paths.sh). */
function builderDirectories() {
  const home = homedir().replace(/\/$/u, "");
  return [root.replace(/\/$/u, ""), process.env.CARGO_HOME, process.env.RUSTUP_HOME, home]
    .filter((directory) => directory !== undefined && directory !== "" && directory !== "/")
    .map((directory) => directory.replace(/\/$/u, ""));
}

/** The names a profile's file must export: its modules' exports and initSync. */
function expectedExports(profile, exportsByModule) {
  return new Set([
    "initSync",
    ...profile.modules.flatMap((module) => exportsByModule[module] ?? []),
  ]);
}

async function verifyProfile(name, profile, exportsByModule) {
  const folder = join(root, "dist", "wasm", name);
  const manifest = JSON.parse(readFileSync(join(folder, MANIFEST), "utf8"));
  const files = readdirSync(folder)
    .filter((file) => file !== MANIFEST)
    .sort();
  if (JSON.stringify(Object.keys(manifest.files).sort()) !== JSON.stringify(files))
    problems.push(
      `${name}: modules.json lists ${Object.keys(manifest.files)}, the folder ${files}`,
    );
  for (const file of files)
    if (manifest.files[file] !== sha256(readFileSync(join(folder, file))))
      problems.push(`${name}: ${file} differs from its SHA-256 in modules.json`);
  if (manifest.profile !== name) problems.push(`${name}: modules.json names ${manifest.profile}`);
  const glue = readFileSync(join(folder, "mnemocode.js"), "utf8");
  if (networkCodeIn(glue) !== undefined) problems.push(`${name}: the glue holds network code`);
  const bytes = readFileSync(join(folder, "mnemocode.wasm"));
  for (const directory of builderDirectories())
    if (bytes.includes(Buffer.from(directory)))
      problems.push(`${name}: mnemocode.wasm names the builder directory ${directory}`);
  const binding = await import(pathToFileURL(join(folder, "mnemocode.js")).href);
  binding.initSync({ module: bytes });
  const exported = new Set(Object.keys(binding));
  const expected = expectedExports(profile, exportsByModule);
  const missing = [...expected].filter((key) => !exported.has(key));
  const extra = [...exported].filter((key) => !expected.has(key));
  if (missing.length > 0 || extra.length > 0)
    problems.push(`${name}: exports missing ${missing}, not of its modules ${extra}`);
}

const profiles = readProfiles();
const { exports: exportsByModule = {} } = JSON.parse(
  readFileSync(join(root, "wasm-profiles.json"), "utf8"),
);
for (const [name, profile] of Object.entries(profiles))
  await verifyProfile(name, profile, exportsByModule);
if (problems.length > 0) {
  process.stderr.write(`${problems.join("\n")}\n`);
  process.exit(1);
}
process.stdout.write(`wasm: ${Object.keys(profiles).length} page files checked\n`);
