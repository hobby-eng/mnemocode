// AUD-015: inherited object properties are not CLI option labels. Uses freshly built production
// modules and the real CLI on public input, without exports, rendering, network or vector replay.
import { spawnSync } from "node:child_process";
import { optionLabel } from "../../../dist/cli/option-copy.js";

const checks = [];
for (const key of ["word", "synthetic-option", "__proto__", "constructor", "toString"]) {
  const expected = key === "word" ? "BIP39 word" : key.replaceAll("-", " ");
  const actual = optionLabel(key);
  checks.push({
    key,
    expected,
    actualType: typeof actual,
    actualText: String(actual),
    passed: actual === expected,
  });
}
const run = spawnSync(
  process.execPath,
  ["dist/mnemocode.js", "table", "--word", "abandon", "--__proto__", "public fixture"],
  { encoding: "utf8", timeout: 10_000, env: { ...process.env, NO_COLOR: "1" } },
);
checks.push({
  key: "actual CLI refusal",
  exitCode: run.status,
  stderr: run.stderr.trim(),
  passed: run.status === 1 && run.stderr.includes("__proto__"),
});
console.log(JSON.stringify({ checks }, null, 2));
process.exitCode = checks.every((check) => check.passed) ? 0 : 1;
