// Writes modules.json beside one page's WebAssembly file (scripts/build-wasm.sh): the version, the
// profile with its modules and units, and every file with its SHA-256, so that the page checks the
// bytes it loads (ARCHITECTURE.md section 9). The build id is the start of the SHA-256 over the
// files' names and hashes, so two builds of the same files share it.
//
//   node scripts/write-modules-manifest.mjs <folder> <edition>/<page>
import { createHash } from "node:crypto";
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { readProfiles } from "./wasm-profiles.mjs";

const MANIFEST = "modules.json";
/** Hex digits of the build id: 64 bits, enough to tell builds apart. */
const BUILD_ID_DIGITS = 16;

const [folder, name] = process.argv.slice(2);
const profile = readProfiles()[name];
if (folder === undefined || profile === undefined || process.argv.length !== 4) {
  process.stderr.write(
    "usage: node scripts/write-modules-manifest.mjs <folder> <edition>/<page>\n",
  );
  process.exit(2);
}
const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");
const version = /^\[workspace\.package\][^[]*?^version = "([^"]+)"/msu.exec(
  readFileSync("Cargo.toml", "utf8"),
)[1];
const files = Object.fromEntries(
  readdirSync(folder)
    .filter((file) => file !== MANIFEST)
    .sort()
    .map((file) => [file, sha256(readFileSync(join(folder, file)))]),
);
const buildId = sha256(
  Object.entries(files)
    .map(([file, hash]) => `${hash}  ${file}\n`)
    .join(""),
).slice(0, BUILD_ID_DIGITS);
const manifest = { version, buildId, profile: name, ...profile, files };
writeFileSync(join(folder, MANIFEST), `${JSON.stringify(manifest, null, 2)}\n`);
