// Test-only fault injection: override declared build reads without copying an installation.
import files from "node:fs";
import promises from "node:fs/promises";
import { registerHooks, syncBuiltinESMExports } from "node:module";
import { isAbsolute, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { UNREACHED_FAULT_EXIT } from "./unreached-fault.ts";

const configPath = process.env.MNEMOCODE_TEST_BUILD_OVERLAY;
if (configPath === undefined) throw new Error("A virtual-build test needs its overlay manifest.");
const originalSync = files.readFileSync.bind(files);
const originalAsync = promises.readFile.bind(promises);
const config = JSON.parse(originalSync(configPath, "utf8"));
if (
  config === null ||
  typeof config !== "object" ||
  typeof config.root !== "string" ||
  config.files === null ||
  typeof config.files !== "object" ||
  Array.isArray(config.files)
)
  throw new Error("The virtual-build manifest has the wrong shape.");
const root = resolve(config.root);
const patches = new Map();
for (const [name, path] of Object.entries(config.files)) {
  if (typeof path !== "string" || isAbsolute(name) || name.split(/[\\/]/u).includes(".."))
    throw new Error("The virtual-build manifest has an invalid patch.");
  patches.set(name.replaceAll("\\", "/"), path);
}
const reached = new Set();

function patchFor(path) {
  const name = path instanceof URL ? fileURLToPath(path) : path;
  if (typeof name !== "string") return undefined;
  const key = relative(root, resolve(name)).replaceAll("\\", "/");
  const replacement = patches.get(key);
  if (replacement === undefined) return undefined;
  reached.add(key);
  return replacement;
}

// External filesystem effects only: unmatched reads keep their exact native options/results.
files.readFileSync = function (path, ...options) {
  return originalSync(patchFor(path) ?? path, ...options);
};
promises.readFile = async function (path, ...options) {
  return originalAsync(patchFor(path) ?? path, ...options);
};
syncBuiltinESMExports();

registerHooks({
  load(url, context, nextLoad) {
    const loaded = nextLoad(url, context);
    if (!url.startsWith("file:")) return loaded;
    const replacement = patchFor(new URL(url));
    return replacement === undefined
      ? loaded
      : { ...loaded, source: originalSync(replacement, "utf8") };
  },
});

process.on("exit", () => {
  if ([...patches.keys()].some((key) => !reached.has(key))) {
    console.error("The declared virtual-build fault was not reached.");
    process.exitCode = UNREACHED_FAULT_EXIT;
  }
});
