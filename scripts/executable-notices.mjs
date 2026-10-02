// Assembles the license notices of a single executable: MnemoCode's own license and notices, the
// Node.js runtime that the executable contains, every npm package that esbuild bundled into it,
// the SSKR engine and the bundled fonts and map data. MIT, Apache-2.0 and BSD-2-Clause-Patent ask
// for their notices to travel with a binary. The build fails without the Node.js license; a
// package that publishes no license file is named with the license its package.json declares.

import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";

/** File names that hold a package's license or notice text. */
const LICENSE_FILE = /^(licen[cs]e|copying|notice)(\.(md|txt))?$/iu;

const PROJECT_FILES = ["LICENSE", "NOTICE", "THIRD_PARTY_NOTICES.md"];
const SSKR_FILES = ["sskr-wasm/LICENSE", "sskr-wasm/NOTICE.md", "sskr-wasm/UPSTREAM_NOTICES.md"];
const ASSET_FILES = [
  "assets/fonts/DejaVuSans-NOTICE",
  "assets/fonts/DroidSansFallback-NOTICE",
  "assets/maps/NOTICE",
];

function heading(title) {
  return `\n${"=".repeat(78)}\n${title}\n${"=".repeat(78)}\n`;
}

/**
 * The folder of each npm package that contributed a file to the bundle. In pnpm's layout a file
 * lies below `node_modules/.pnpm/<name>@<version>/node_modules/<name>/`; the last
 * `node_modules/<name>` (or `node_modules/@scope/name`) of its path is the package that owns it.
 */
function bundledPackageFolders(root, metafile) {
  const folders = new Set();
  for (const input of Object.keys(metafile.inputs)) {
    const match = input.match(/^(.*node_modules\/(?:@[^/]+\/)?[^/]+)\//u);
    if (match && !match[1].endsWith("node_modules/.pnpm")) folders.add(join(root, match[1]));
  }
  return [...folders];
}

function packageNotice(folder) {
  const manifest = JSON.parse(readFileSync(join(folder, "package.json"), "utf8"));
  const files = readdirSync(folder)
    .filter((name) => LICENSE_FILE.test(name))
    .sort();
  const title = `npm package ${manifest.name} ${manifest.version} (${manifest.license})`;
  if (files.length > 0)
    return {
      key: `${manifest.name}@${manifest.version}`,
      text:
        heading(title) + files.map((name) => readFileSync(join(folder, name), "utf8")).join("\n"),
    };
  // Some packages publish no license file. Their declared license and source are all that can be
  // stated without inventing a copyright line.
  const source =
    typeof manifest.repository === "string" ? manifest.repository : manifest.repository?.url;
  return {
    key: `${manifest.name}@${manifest.version}`,
    text:
      heading(title) +
      `The published package contains no license file. Its package.json declares the ` +
      `${manifest.license} license${manifest.author ? `, author ${JSON.stringify(manifest.author)}` : ""}` +
      `${source ? `, source ${source}` : ""}.\n`,
  };
}

/** Node.js's own LICENSE, which also lists the libraries Node.js contains, next to its binary. */
function nodeLicense() {
  const folder = dirname(process.execPath);
  const candidates = [join(folder, "LICENSE"), join(folder, "..", "LICENSE")];
  const found = candidates.find((path) => existsSync(path));
  if (found === undefined)
    throw new Error(
      `The LICENSE of the running Node.js was not found next to ${process.execPath}. Build with an official Node.js download.`,
    );
  return readFileSync(found, "utf8");
}

/** The complete notice text for the executable `name`, built from the esbuild metafile. */
export function executableNotices({ root, name, version, metafile }) {
  const read = (path) => readFileSync(join(root, path), "utf8");
  const packages = bundledPackageFolders(root, metafile)
    .map(packageNotice)
    // Plain code-unit order, the same on every system, so that every build writes the same file.
    .sort((left, right) => (left.key < right.key ? -1 : left.key > right.key ? 1 : 0));
  return [
    `License notices for ${name} (MnemoCode ${version})\n\n` +
      "This file travels with the executable. The executable contains MnemoCode, the Node.js " +
      "runtime it was built with, the npm packages listed below, the SSKR engine compiled to " +
      "WebAssembly, and bundled fonts and map data. Each part keeps its own license.\n",
    heading("MnemoCode") + PROJECT_FILES.map(read).join("\n"),
    heading(`Node.js ${process.version}`) + nodeLicense(),
    ...packages.map((item) => item.text),
    heading("SSKR engine (sskr-wasm)") + SSKR_FILES.map(read).join("\n"),
    heading("Fonts and map data") + ASSET_FILES.map(read).join("\n"),
  ].join("\n");
}
