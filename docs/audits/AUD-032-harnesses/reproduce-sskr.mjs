// Run the unchanged comparison mode with only the final compilation stage uncached.
import childProcess from "node:child_process";
import { syncBuiltinESMExports } from "node:module";
import { resolve } from "node:path";
import { pathToFileURL, fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../../../", import.meta.url));
const original = childProcess.execFileSync;
let calls = 0;
childProcess.execFileSync = function (program, arguments_, options) {
  if (program !== "docker" || arguments_?.[0] !== "build")
    throw new Error("The comparison attempted an unexpected subprocess.");
  calls += 1;
  if (calls !== 1) throw new Error("The comparison attempted more than one Docker build.");
  const command = [arguments_[0], "--no-cache-filter", "built", ...arguments_.slice(1)];
  console.log(JSON.stringify({
    program, arguments: command,
    qualification: "Fresh canonical Rust/wasm-bindgen compilation stage; pinned installed toolchain/dependency Docker layers may be reused. No generated output or integrity file is replaced.",
  }));
  return Reflect.apply(original, childProcess, [program, command, options]);
};
syncBuiltinESMExports();
const argv = process.argv;
try {
  process.argv = [process.execPath, resolve(root, "scripts/build-sskr-wasm.mjs"), "--check"];
  await import(pathToFileURL(resolve(root, "scripts/build-sskr-wasm.mjs")).href);
  if (calls !== 1) throw new Error("No canonical Docker comparison was executed.");
} finally {
  process.argv = argv;
  childProcess.execFileSync = original;
  syncBuiltinESMExports();
}
