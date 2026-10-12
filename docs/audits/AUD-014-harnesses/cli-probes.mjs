// AUD-014: bounded probes of the built CLI's actual option and swap-warning contracts.
// Only public words and an empty synthetic /proc root are used; no PDF or image is created.
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { parseArguments, assertAllowedArguments } from "../../../dist/cli/arguments.js";
import { unencryptedSwap } from "../../../dist/cli/swap-check.js";
import { PROTECTION_FLAGS } from "../../../dist/cli/protection.js";

const checks = [];
function record(name, passed, details) {
  checks.push({ name, passed, details });
}

for (const key of ["constructor", "toString", "hasOwnProperty", "__proto__"]) {
  const parsed = parseArguments([`--${key}`, "synthetic-option-value"]);
  let refused = false;
  try {
    assertAllowedArguments(parsed, "table", ["word"]);
  } catch {
    refused = true;
  }
  record(`unknown option --${key}`, refused, { keys: Object.keys(parsed), refused });
}
const actual = spawnSync(
  process.execPath,
  ["dist/mnemocode.js", "table", "--word", "abandon", "--__proto__", "synthetic-value"],
  { encoding: "utf8", timeout: 15_000, env: { ...process.env, NO_COLOR: "1" } },
);
record("actual CLI refuses unknown --__proto__", actual.status !== 0, {
  exitCode: actual.status,
  stdout: actual.stdout,
  stderr: actual.stderr,
});

const root = await mkdtemp(join(tmpdir(), "mnemocode-aud014-proc-"));
try {
  let outcome;
  try {
    outcome = { warnings: unencryptedSwap(root) };
  } catch (error) {
    outcome = { refusal: error.message };
  }
  record(
    "unreadable swap table is not reported as no risk",
    outcome.refusal !== undefined || outcome.warnings.length > 0,
    outcome,
  );
} finally {
  await rm(root, { recursive: true, force: true });
}

// A caller may already use Node's permission model with only the package directory readable.
// This is a real protected CLI run: /proc/swaps is unavailable, while public input is sufficient.
const publicPhrase = `${"abandon ".repeat(11)}about`;
const limited = spawnSync(
  process.execPath,
  [
    ...PROTECTION_FLAGS.filter((flag) => !flag.startsWith("--allow-fs-read")),
    `--allow-fs-read=${process.cwd()}`,
    "dist/mnemocode.js",
    "encode",
    "--mode",
    "direct",
    "--format",
    "indexes",
    "--mnemonic",
    publicPhrase,
  ],
  { encoding: "utf8", timeout: 15_000, env: { ...process.env, NO_COLOR: "1" } },
);
record(
  "actual CLI warns when its permissions deny the swap table",
  limited.status !== 0 || /swap/iu.test(limited.stderr),
  { exitCode: limited.status, stdout: limited.stdout, stderr: limited.stderr },
);

console.log(JSON.stringify({ checks }, null, 2));
if (checks.some((check) => !check.passed)) process.exitCode = 1;
