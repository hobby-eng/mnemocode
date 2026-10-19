// Run the remaining documented local release checks serially after the complete default suite.
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";

const summary = JSON.parse(readFileSync("docs/audits/AUD-034-evidence/suite-summary.json", "utf8"));
if (summary.completedFiles !== summary.expectedFiles)
  throw new Error("Complete default-suite evidence is required before this phase.");
if (existsSync("output/aud034-card-output"))
  throw new Error("Use a new output folder; existing public exports are preserved.");
const commands = [
  ["full-self-test", 768, process.execPath, "dist/mnemocode.js", "self-test"],
  ["native-sskr", 512, "cargo", "test", "--locked", "--offline", "--manifest-path", "sskr-wasm/rust/Cargo.toml", "--workspace", "--all-targets", "--jobs", "1", "--target-dir", "node_modules/.cache/sskr-cargo", "--", "--test-threads=1"],
  ["independent-sskr", 256, "python3", "-B", "scripts/verify-sskr-known-answers.py"],
  ["real-terminal", 768, "python3", "-B", "scripts/verify-terminal-input.py"],
  ["real-card-output", 896, process.execPath, "scripts/check-card-output.mjs", "output/aud034-card-output"],
  ["linux-acceptance", 768, process.execPath, "scripts/verify-executable.mjs", "release/aud033-arc002-closed/mnemocode-0.1.0-linux-x64"],
  ["npm-advisories", 384, "bash", "-c", "set -euo pipefail; set -o noclobber; pnpm audit --audit-level high --json > docs/audits/AUD-034-evidence/npm-advisories.json"],
  ["package-dry-run", 384, "bash", "-c", "set -euo pipefail; set -o noclobber; npm pack --dry-run --json --ignore-scripts > docs/audits/AUD-034-evidence/package-dry-run.json"],
];
let failed = false;
for (const [label, rss, ...command] of commands) {
  console.log(`RELEASE CHECK: ${label}`);
  const result = spawnSync(process.execPath, ["docs/audits/AUD-034-harnesses/run.mjs", label, ...command], {
    stdio: "inherit",
    env: { ...process.env, AUD026_RSS_MIB: String(rss), AUD026_HEAP_MIB: "256", AUD026_TIMEOUT_SECONDS: "600" },
  });
  if (result.error) throw result.error;
  if (result.status !== 0) failed = true;
  if ([125, 143, 241].includes(result.status)) {
    console.error("Resource/admission stop; subsequent checks were not started.");
    process.exit(result.status);
  }
}
process.exitCode = failed ? 1 : 0;
