// Execute the exact two existing release-regression assertions; baseline failure is intentional evidence.
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../../../", import.meta.url));
const result = spawnSync(process.execPath, [
  "node_modules/vitest/vitest.mjs", "run",
  "test/scan-fixes-s006-s061.test.ts", "test/sskr-cli-export.test.ts",
  "--testNamePattern", "is listed here whenever it extends Redacted|saves the QR code of the sheets as images",
  "--pool=threads", "--maxWorkers=1", "--no-file-parallelism", "--reporter=verbose",
], { cwd: root, stdio: "inherit" });
if (result.error) throw result.error;
if (result.status === null) throw new Error(`Regression runner ended by ${result.signal}.`);
process.exitCode = result.status;
