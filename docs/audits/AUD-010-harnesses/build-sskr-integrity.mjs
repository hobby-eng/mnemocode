// AUD-010 build reviewer: the SSKR engine's pins, without rebuilding it (CHECK-BLD-004, static).
//
// Checks, each printed with the values compared:
// 1. sskr-wasm/integrity.json lists exactly the files of sskr-wasm/generated/ and of
//    sskr-wasm/rust/ (Cargo.toml, Cargo.lock, src/**), and each SHA-256 equals the file's bytes;
// 2. Cargo.toml pins every dependency with "=x.y.z";
// 3. Cargo.lock: every package with a source comes from the crates.io registry with a 64-hex
//    checksum, and none from git;
// 4. the generated glue has no network loader and no async start (no fetch, import.meta,
//    __wbg_load or __wbg_init), as scripts/build-sskr-wasm.mjs promises;
// 5. Dockerfile.sskr pins the base image by digest, Node.js and rustup by SHA-256, Rust 1.99.0 and
//    wasm-bindgen 0.2.129 (AGENTS.md), and builds with --network=none --locked --offline.
// Exits 1 when a check fails. The byte-for-byte rebuild (pnpm verify:sskr) is not run here.
import { createHash } from "node:crypto";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

let failures = 0;
const fail = (message) => {
  failures += 1;
  console.log(`FAIL ${message}`);
};
const sha256 = (path) => createHash("sha256").update(readFileSync(path)).digest("hex");
function files(directory) {
  return readdirSync(directory).flatMap((entry) => {
    const path = join(directory, entry);
    return statSync(path).isDirectory() ? files(path) : [path];
  });
}
const base = "sskr-wasm";
const manifest = JSON.parse(readFileSync(join(base, "integrity.json"), "utf8"));
const present = [...files(join(base, "generated")), ...files(join(base, "rust"))]
  .map((path) => relative(base, path).split("\\").join("/"))
  .filter((path) => !path.startsWith("rust/target/"))
  .sort();
console.log(`integrity.json entries: ${Object.keys(manifest).length}; files present: ${present.length}`);
for (const path of present) {
  const actual = sha256(join(base, path));
  const expected = manifest[path];
  console.log(`${path}: actual ${actual}; pinned ${expected ?? "NOT PINNED"}`);
  if (expected === undefined) fail(`${path} is not in integrity.json`);
  else if (expected !== actual) fail(`${path} differs from integrity.json`);
}
for (const path of Object.keys(manifest)) if (!present.includes(path)) fail(`${path} is pinned but missing`);

const cargoToml = readFileSync(join(base, "rust/Cargo.toml"), "utf8");
const requirements = [...cargoToml.matchAll(/^([\w-]+)\s*=\s*(?:"([^"]+)"|\{[^}]*version\s*=\s*"([^"]+)")/gmu)]
  .filter((match) => !["name", "version", "edition", "rust-version", "license", "crate-type", "codegen-units", "opt-level", "panic"].includes(match[1]))
  .map((match) => [match[1], match[2] ?? match[3]]);
for (const [name, requirement] of requirements) {
  console.log(`Cargo.toml ${name} = ${requirement}`);
  if (!/^=\d+\.\d+\.\d+$/u.test(requirement)) fail(`Cargo.toml ${name} is not pinned with =x.y.z`);
}

const lock = readFileSync(join(base, "rust/Cargo.lock"), "utf8");
const packages = lock.split("[[package]]").slice(1);
let registry = 0;
let local = 0;
for (const block of packages) {
  const name = /name = "([^"]+)"/u.exec(block)?.[1];
  const source = /source = "([^"]+)"/u.exec(block)?.[1];
  const checksum = /checksum = "([^"]+)"/u.exec(block)?.[1];
  if (source === undefined) {
    local += 1;
    continue;
  }
  if (source !== "registry+https://github.com/rust-lang/crates.io-index") fail(`${name}: source ${source}`);
  else if (!/^[0-9a-f]{64}$/u.test(checksum ?? "")) fail(`${name}: no checksum`);
  else registry += 1;
}
console.log(`Cargo.lock: ${packages.length} packages; ${registry} from crates.io with a checksum; ${local} local`);

const glue = readFileSync(join(base, "generated/recovery_sskr_wasm.js"), "utf8");
const loaders = ["fetch(", "import.meta", "__wbg_load", "__wbg_init"].filter((text) => glue.includes(text));
console.log(`glue loaders or async start found: [${loaders.join(", ")}]`);
if (loaders.length > 0) fail("the glue keeps a network loader or an async start");

const dockerfile = readFileSync("Dockerfile.sskr", "utf8");
const expectations = [
  ["base image by digest", /^FROM buildpack-deps:noble@sha256:[0-9a-f]{64} AS toolchain$/mu],
  ["Node.js archive SHA-256", /^ARG NODE_ARCHIVE_SHA256=[0-9a-f]{64}$/mu],
  ["Node.js 26.10.0", /^ARG NODE_VERSION=26\.10\.0$/mu],
  ["rustup-init SHA-256", /^ARG RUSTUP_INIT_SHA256=[0-9a-f]{64}$/mu],
  ["Rust 1.99.0", /--default-toolchain 1\.99\.0 /u],
  ["wasm-bindgen 0.2.129 --locked", /wasm-bindgen-cli --version 0\.2\.129 --locked/u],
  ["build without network", /RUN --network=none/u],
  ["cargo --locked --offline", /cargo build --target wasm32-unknown-unknown --release --locked --offline/u],
  ["pnpm 12.8.1", /pnpm@12\.8\.1/u],
];
for (const [name, pattern] of expectations) {
  const found = pattern.test(dockerfile);
  console.log(`Dockerfile.sskr ${name}: ${found}`);
  if (!found) fail(`Dockerfile.sskr: ${name}`);
}
console.log(failures === 0 ? "PASS build-sskr-integrity" : `FAIL build-sskr-integrity: ${failures} check(s)`);
process.exitCode = failures === 0 ? 0 : 1;
