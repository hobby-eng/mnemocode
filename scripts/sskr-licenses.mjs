// The license texts of every crate that the SSKR engine's WebAssembly links, read from the crates'
// own sources (AUD-037-BLD002): MIT, the BSD licenses and Blue Oak ask for their notices to travel
// with the binary, which the repository, the npm package and each executable carry. The crates are
// those that `cargo metadata` gives for wasm32-unknown-unknown and that the bridge reaches through
// normal dependencies; procedural macros run only while it is built and are left out. Of a crate
// offered under several licenses, MIT is taken where it is one of them. A crate under CC0 asks for
// no notice and is only listed.
//
//   node scripts/sskr-licenses.mjs          writes sskr-wasm/LINKED_LICENSES.txt
//   node scripts/sskr-licenses.mjs --check  fails when that file is not what the crates give

import { execFileSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { ErrorCatalog } from "../src/core/error-catalog.ts";

const ERRORS = new ErrorCatalog("scripts.sskr-licenses", {
  /**
   * @param {string} crate
   */
  "crate-holds-no-license-file": (crate) => `${crate} holds no file of its license.`,
});

const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
const CRATE = join(root, "sskr-wasm", "rust");
const OUTPUT = join(root, "sskr-wasm", "LINKED_LICENSES.txt");
/** The target that the engine is built for. */
const TARGET = "wasm32-unknown-unknown";
/** The files of a crate that hold its license or its notices. */
const LICENSE_FILE = /^(?:licen[cs]e|copying|notice)(?:[-.][\w.-]*)?$/iu;
/** License files of a crate that name a license other than the one taken, MIT. */
const NOT_TAKEN = /apache|zlib|bsd|unlicense/iu;
/**
 * What a crate bundles under a license of its own, below its folder: secp256k1-sys compiles the C
 * library libsecp256k1, which is under MIT, while the crate itself is under CC0.
 */
const BUNDLED = {
  "secp256k1-sys": { files: ["depend/secp256k1/COPYING"], license: "MIT for libsecp256k1" },
};

/** The crates that the engine links, by name and version, with their folders and licenses. */
function linkedCrates() {
  const metadata = JSON.parse(
    execFileSync(
      "cargo",
      ["metadata", "--offline", "--locked", "--format-version", "1", "--filter-platform", TARGET],
      { cwd: CRATE, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 },
    ),
  );
  const packages = new Map(metadata.packages.map((item) => [item.id, item]));
  const nodes = new Map(metadata.resolve.nodes.map((node) => [node.id, node]));
  const procedural = (item) => item.targets.some((target) => target.kind.includes("proc-macro"));
  const reached = new Set();
  const waiting = [metadata.resolve.root];
  while (waiting.length > 0) {
    const id = waiting.pop();
    if (reached.has(id)) continue;
    reached.add(id);
    for (const dependency of nodes.get(id).deps) {
      // A normal dependency has a kind of null; build and development ones are not linked.
      const normal = dependency.dep_kinds.some((kind) => kind.kind === null);
      if (normal && !procedural(packages.get(dependency.pkg))) waiting.push(dependency.pkg);
    }
  }
  reached.delete(metadata.resolve.root);
  return [...reached]
    .map((id) => packages.get(id))
    .map((item) => ({
      name: item.name,
      version: item.version,
      license: item.license ?? "",
      folder: dirname(item.manifest_path),
    }))
    .sort((a, b) => a.name.localeCompare(b.name) || a.version.localeCompare(b.version));
}

/** The license taken of `expression`: MIT where it is one of several offered, else all of it. */
function taken(expression) {
  const alternatives = /\(([^()]*)\)|^([^()]*)$/u;
  const offered = expression.match(alternatives);
  const choice = (offered?.[1] ?? offered?.[2] ?? "").split(/\s+OR\s+|\//u);
  if (!choice.includes("MIT") || choice.length === 1) return expression;
  return expression.replace(offered?.[1] === undefined ? expression : `(${offered[1]})`, "MIT");
}

/**
 * The license texts that `crate` asks to travel with the binary, each with its file: those of the
 * license taken, none for CC0, and those of what it bundles under another license.
 */
function licenseTexts(crate) {
  // A crate that follows REUSE keeps its license texts in LICENSES/, named by their licenses.
  const reuse = existsSync(join(crate.folder, "LICENSES"))
    ? readdirSync(join(crate.folder, "LICENSES")).map((file) => `LICENSES/${file}`)
    : [];
  const own =
    crate.license === "CC0-1.0"
      ? []
      : [...readdirSync(crate.folder).filter((file) => LICENSE_FILE.test(file)), ...reuse]
          .filter((file) => taken(crate.license) === crate.license || !NOT_TAKEN.test(file))
          .sort();
  return [...own, ...(BUNDLED[crate.name]?.files ?? [])]
    .filter((file) => existsSync(join(crate.folder, file)))
    .map((file) => ({ file, text: readFileSync(join(crate.folder, file), "utf8").trim() }));
}

/** The licenses of `crate`, the one taken and any of what it bundles. */
function licensesOf(crate) {
  const bundled = BUNDLED[crate.name]?.license;
  return bundled === undefined ? taken(crate.license) : `${taken(crate.license)}; ${bundled}`;
}

/** The text of LINKED_LICENSES.txt. */
function notices() {
  const crates = linkedCrates();
  const rule = "=".repeat(78);
  const parts = [
    "Licenses of the crates linked into the SSKR engine (sskr-wasm)",
    "",
    "Written by scripts/sskr-licenses.mjs from the crates' own sources; do not edit it.",
    "Of a crate offered under several licenses, MIT is taken where it is one of them.",
    "A crate under CC0-1.0 asks for no notice and is only listed.",
    "",
    ...crates.map((crate) => `${crate.name} ${crate.version}: ${licensesOf(crate)}`),
  ];
  for (const crate of crates) {
    const texts = licenseTexts(crate);
    if (texts.length === 0 && crate.license === "CC0-1.0") continue;
    if (texts.length === 0)
      throw ERRORS.create("crate-holds-no-license-file", [`${crate.name} ${crate.version}`]);
    parts.push("", rule, `${crate.name} ${crate.version}: ${licensesOf(crate)}`, rule);
    for (const { file, text } of texts) parts.push("", `--- ${file}`, "", text);
  }
  return `${parts.join("\n")}\n`;
}

const text = notices();
if (process.argv.includes("--check")) {
  if (!existsSync(OUTPUT) || readFileSync(OUTPUT, "utf8") !== text) {
    console.error(
      "sskr-wasm/LINKED_LICENSES.txt is not what the linked crates give: run node scripts/sskr-licenses.mjs.",
    );
    process.exit(1);
  }
  console.log("The licenses of the crates linked into the SSKR engine are current.");
} else {
  writeFileSync(OUTPUT, text);
  console.log(`Wrote ${OUTPUT}.`);
}
