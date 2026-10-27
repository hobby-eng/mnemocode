// Writes the Rust crates part of THIRD_PARTY_NOTICES.md: the licence of every crate that the
// executable or a page's WebAssembly file ships (GATES.md `notices`). A port to Node (TOOL-01) of
// mhfe's scripts/third-party-licenses.py, with the same rules:
//
//   node scripts/third-party-notices.mjs           write the part into THIRD_PARTY_NOTICES.md
//   node scripts/third-party-notices.mjs --check   fail if the file is out of date
//
// The crates are the union of `cargo tree --locked --offline -e normal,no-proc-macro` for the
// executable on every release target and for the binding with each profile of wasm-profiles.json.
// Build scripts, build dependencies and procedural macros run only on the build machine, so they are
// left out; so are the workspace's own crates, but not the vendored SSKR engine. The licence texts
// come from the crates' sources in the local Cargo registry; nothing is downloaded, so run `cargo
// fetch --locked` first.
//
// How the licence of a crate is chosen, the same for every crate:
// - The licence expression is read from the crate's Cargo.toml; "A/B" is the old way of writing
//   "A OR B".
// - Every part joined by AND is required, so each gets its own text.
// - Within a part with alternatives joined by OR, MIT is used when it is offered, otherwise
//   Apache-2.0, otherwise the only licence. Any other choice stops the script.
// - The text is the crate's own licence file for that licence, unchanged, with its copyright lines;
//   line endings become LF and trailing blank space is dropped.
// - A crate that publishes no licence file gets the standard text of its licence instead: for MIT,
//   the SPDX text with the holders from the crate's `authors`; for CC0-1.0, the legal code as
//   another crate of the list ships it. Its entry says so. Any other case stops the script.
// Crates with byte-identical texts share one text section, so no copyright line is ever dropped.
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { featuresOf, readProfiles } from "./wasm-profiles.mjs";

const root = fileURLToPath(new URL("..", import.meta.url));
const OUTPUT = join(root, "THIRD_PARTY_NOTICES.md");
/** The hand-written notices come first; everything from this line on is generated. */
const MARKER =
  "<!-- Everything below is written by scripts/third-party-notices.mjs from Cargo.lock and the crates' own licence files; do not edit it by hand. -->";
/** The workspace's own crates, which are MnemoCode itself. */
const OWN = new Set([
  "mnemocode",
  "mnemocode-cards",
  "mnemocode-cli",
  "mnemocode-wasm",
  "bc-crypto",
]);
const NATIVE_TARGETS = [
  "x86_64-unknown-linux-gnu",
  "aarch64-unknown-linux-gnu",
  "x86_64-pc-windows-gnu",
  "x86_64-apple-darwin",
  "aarch64-apple-darwin",
];
/** The order in which an alternative of an OR is chosen. */
const PREFERRED = ["MIT", "Apache-2.0"];
/** Licence file names to look for, per licence, before the generic names. */
const FILE_NAMES = {
  MIT: ["LICENSE-MIT", "LICENSE-MIT.md", "LICENSE-MIT.txt", "license-mit", "LICENSE.MIT"],
  "Apache-2.0": [
    "LICENSE-APACHE",
    "LICENSE-APACHE.md",
    "LICENSE-APACHE.txt",
    "license-apache-2.0",
    "LICENSE-APACHE-2.0",
  ],
  "Unicode-3.0": ["LICENSE-UNICODE"],
  Zlib: ["LICENSE-ZLIB", "LICENSE-ZLIB.md"],
};
const GENERIC_NAMES = ["LICENSE", "LICENSE.md", "LICENSE.txt", "LICENCE", "COPYING"];
/** A phrase every text of the licence contains, so that no other licence's file is copied. */
const MARKERS = {
  MIT: "Permission is hereby granted, free of charge",
  "Apache-2.0": "Apache License",
  "BSD-2-Clause-Patent": "Redistribution and use in source and binary forms",
  "BSD-3-Clause": "Redistribution and use in source and binary forms",
  "CC0-1.0": "CC0 1.0 Universal",
  "Unicode-3.0": "UNICODE LICENSE V3",
  Zlib: "This notice may not be removed or altered from any source distribution",
};
/** The SPDX MIT text with the year left out; {holders} comes from the crate's `authors`. */
const SPDX_MIT = `MIT License

Copyright (c) {holders}

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.`;

/** A crate whose licence text cannot be determined; nothing is written. */
class Unresolved extends Error {}

const cargo = (...args) =>
  execFileSync("cargo", args, {
    cwd: root,
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
    env: { ...process.env, CARGO_TERM_COLOR: "never" },
  });

/** Every tree a release ships: [package, target, feature arguments]. */
function trees() {
  return [
    ...NATIVE_TARGETS.map((target) => ["mnemocode-cli", target, []]),
    ...Object.values(readProfiles()).map((profile) => {
      const features = featuresOf(profile);
      const featureArgs = features.length > 0 ? ["--features", features.join(",")] : [];
      return [
        "mnemocode-wasm",
        "wasm32-unknown-unknown",
        ["--no-default-features", ...featureArgs],
      ];
    }),
  ];
}

/** "name version" of every crate compiled into a release, the workspace's own left out. */
function shippedCrates() {
  const crates = new Set();
  for (const [pkg, target, features] of trees()) {
    const tree = cargo(
      "tree",
      "--locked",
      "--offline",
      "-p",
      pkg,
      "-e",
      "normal,no-proc-macro",
      "--target",
      target,
      "--prefix",
      "none",
      "--format",
      "{p}",
      ...features,
    );
    for (const line of tree.split("\n")) {
      const match = /^(\S+) v(\S+)/u.exec(line);
      if (match !== null && !OWN.has(match[1])) crates.add(`${match[1]} ${match[2]}`);
    }
  }
  return [...crates].sort().map((entry) => entry.split(" "));
}

/** The metadata of every package of Cargo.lock, by "name version". */
function registryPackages() {
  const data = JSON.parse(
    cargo("metadata", "--locked", "--offline", "--all-features", "--format-version", "1"),
  );
  return new Map(data.packages.map((pkg) => [`${pkg.name} ${pkg.version}`, pkg]));
}

/** The parts joined by AND, each a list of the alternatives joined by OR. */
function licenceParts(expression) {
  return expression
    .replaceAll("/", " OR ")
    .split(/\s+AND\s+/u)
    .map((part) => {
      const bare = part.trim().replace(/^\((.*)\)$/u, "$1");
      const alternatives = bare.split(/\s+OR\s+/u).map((alternative) => alternative.trim());
      if (alternatives.some((alternative) => !/^[A-Za-z0-9.+-]+$/u.test(alternative)))
        throw new Unresolved(`licence expression "${expression}" is not a plain AND of ORs`);
      return alternatives;
    });
}

function choose(alternatives) {
  const preferred = PREFERRED.find((licence) => alternatives.includes(licence));
  if (preferred !== undefined) return preferred;
  if (alternatives.length === 1) return alternatives[0];
  throw new Unresolved(`no rule chooses between ${alternatives.join(" OR ")}`);
}

const readText = (path) => readFileSync(path, "utf8").replaceAll("\r\n", "\n").trimEnd();

/** The text of the crate's own file for `licence`, or undefined if it ships none. */
function licenceFileText(directory, licence) {
  const marker = MARKERS[licence];
  if (marker === undefined) throw new Unresolved(`no marker phrase is known for ${licence}`);
  for (const name of [...(FILE_NAMES[licence] ?? []), ...GENERIC_NAMES]) {
    const path = join(directory, name);
    if (existsSync(path)) {
      const text = readText(path);
      if (text.includes(marker)) return text;
    }
  }
  return undefined;
}

/** The names in the crate's `authors`, without their e-mail addresses. */
function holders(pkg) {
  const names = pkg.authors
    .map((author) => author.replace(/\s*<[^>]*>/gu, "").trim())
    .filter(Boolean);
  if (names.length === 0)
    throw new Unresolved(`${pkg.name} ships no MIT text and names no authors`);
  return names.join(", ");
}

/** For each crate: its name, version, expression and the [licence, text, note] it needs. */
function resolve(crates, packages) {
  const standard = new Map();
  const resolved = crates.map(([name, version]) => {
    const pkg = packages.get(`${name} ${version}`);
    if (pkg === undefined) throw new Unresolved(`cargo metadata does not list ${name} ${version}`);
    if (!pkg.license) throw new Unresolved(`${name} ${version} declares no licence expression`);
    const directory = dirname(pkg.manifest_path);
    const licences = licenceParts(pkg.license).map((alternatives) => {
      const licence = choose(alternatives);
      let text = licenceFileText(directory, licence);
      let note;
      if (text === undefined && licence === "MIT") {
        text = SPDX_MIT.replace("{holders}", holders(pkg));
        note =
          "The crate publishes no licence file. This is the standard SPDX MIT text with the copyright holders taken from the crate's `authors`.";
      } else if (text === undefined && licence === "CC0-1.0") {
        note =
          "The crate publishes no licence file. This is the CC0 1.0 legal code as other crates in this list ship it.";
      } else if (text === undefined)
        throw new Unresolved(`${name} ${version} ships no ${licence} text`);
      if (note === undefined && licence === "CC0-1.0" && !standard.has(licence))
        standard.set(licence, text);
      return [licence, text, note];
    });
    return [name, version, pkg.license, licences];
  });
  for (const [name, version, , licences] of resolved)
    for (const entry of licences)
      if (entry[1] === undefined) {
        if (!standard.has(entry[0]))
          throw new Unresolved(`${name} ${version}: no crate ships a ${entry[0]} text to use`);
        entry[1] = standard.get(entry[0]);
      }
  return resolved;
}

/** A code fence longer than any run of backticks in the text. */
function fence(text) {
  const longest = Math.max(0, ...(text.match(/`+/gu) ?? []).map((run) => run.length));
  return "`".repeat(Math.max(3, longest + 1));
}

function render(resolved) {
  const numbers = new Map();
  const users = new Map();
  for (const [name, version, , licences] of resolved)
    for (const [licence, text] of licences) {
      const key = `${licence}\0${text}`;
      if (!numbers.has(key)) {
        numbers.set(key, numbers.size + 1);
        users.set(key, []);
      }
      users.get(key).push(`${name} ${version}`);
    }
  const lines = [
    MARKER,
    "",
    "## Rust crates",
    "",
    "The `mnemocode` executable and the WebAssembly file of each wallet-tools page are compiled from",
    "the Rust crates below. Each crate is listed with its licence expression, the licence MnemoCode",
    "uses it under and the text of that licence.",
    "",
    "### How the licence is chosen",
    "",
    "- The crates are those compiled into the executable for every release target (Linux, Windows and",
    "  macOS on x86-64, Linux and macOS on ARM64) and into the WebAssembly file of every page. Build",
    "  scripts and procedural macros, which run only while building, are left out. Not every crate is",
    "  in every file.",
    "- Every licence joined by AND is required and listed. Among licences joined by OR, MIT is used",
    "  when it is offered, otherwise Apache-2.0, otherwise the only licence.",
    "- The text is the crate's own licence file, unchanged, with its copyright lines. Where a crate",
    "  publishes no licence file, its entry says so and the standard text of its licence is used.",
    "",
    "### Crates",
    "",
  ];
  for (const [name, version, expression, licences] of resolved) {
    const used = licences.map(([licence]) => licence).join(" and ");
    const texts = licences
      .map(([licence, text]) => {
        const number = numbers.get(`${licence}\0${text}`);
        return `[text ${number}](#text-${number})`;
      })
      .join(", ");
    lines.push(`- \`${name}\` ${version}: \`${expression}\`, used under ${used}; ${texts}.`);
    for (const [, , note] of licences) if (note !== undefined) lines.push(`  ${note}`);
  }
  lines.push("", "### Licence texts", "");
  for (const [key, number] of numbers) {
    const [licence, text] = key.split("\0");
    const marker = fence(text);
    lines.push(`#### Text ${number}`, "", `${licence}, for ${users.get(key).join(", ")}.`, "");
    lines.push(marker, text, marker, "");
  }
  return lines.join("\n");
}

const args = process.argv.slice(2);
const check = args.length === 1 && args[0] === "--check";
if (args.length > 0 && !check) {
  process.stderr.write("usage: node scripts/third-party-notices.mjs [--check]\n");
  process.exit(2);
}
let generated;
try {
  generated = render(resolve(shippedCrates(), registryPackages()));
} catch (error) {
  if (!(error instanceof Unresolved)) throw error;
  process.stderr.write(`Cannot determine a licence text: ${error.message}. Nothing was written.\n`);
  process.exit(1);
}
const written = existsSync(OUTPUT) ? readFileSync(OUTPUT, "utf8") : "";
if (!written.includes(MARKER)) {
  process.stderr.write(
    `THIRD_PARTY_NOTICES.md lacks the line that starts the generated part:\n${MARKER}\n`,
  );
  process.exit(1);
}
const content = written.slice(0, written.indexOf(MARKER)) + generated;
if (check) {
  if (written !== content) {
    process.stderr.write(
      "THIRD_PARTY_NOTICES.md is out of date; run node scripts/third-party-notices.mjs.\n",
    );
    process.exit(1);
  }
  process.stdout.write("THIRD_PARTY_NOTICES.md matches the shipped crates.\n");
} else {
  writeFileSync(OUTPUT, content);
  process.stdout.write("Wrote THIRD_PARTY_NOTICES.md.\n");
}
