// Keep the canonical producer unchanged; request bounded containers for this audit run.
import childProcess from "node:child_process";
import { syncBuiltinESMExports } from "node:module";
const original = childProcess.execFileSync;
childProcess.execFileSync = (program, arguments_, options) => {
  if (program !== "docker" || arguments_?.[0] !== "build")
    throw new Error("Unexpected subprocess in canonical SSKR build.");
  return original(
    program,
    [
      "build", "--resource", "memory=1536m", "--resource", "cpu-quota=100000",
      ...(process.argv.includes("--check") ? ["--no-cache-filter", "built"] : []),
      ...arguments_.slice(1),
    ],
    options,
  );
};
syncBuiltinESMExports();
await import("../../../scripts/build-sskr-wasm.mjs");
