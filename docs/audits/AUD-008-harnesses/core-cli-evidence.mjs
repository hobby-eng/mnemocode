// AUD-008: actual CLI malformed public-key evidence probe, public zero-entropy mnemonic only.
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
const cli = fileURLToPath(new URL("../../../dist/mnemocode.js", import.meta.url));
const result = spawnSync(
  process.execPath,
  [
    cli,
    "recover-word",
    "--mnemonic",
    `${"abandon ".repeat(11)}?`,
    "--compressed-public-key",
    `02${"ff".repeat(32)}`,
    "--bitcoin-profile",
    "native-segwit",
  ],
  { timeout: 10000, encoding: "utf8", maxBuffer: 128 * 1024 },
);
const rejected = result.status !== 0 && !result.error;
console.log(
  JSON.stringify(
    {
      expected: "reject a compressed public key with x outside secp256k1's field",
      observed: {
        exitCode: result.status,
        error: result.error?.code,
        checksumValidCandidates: /Checksum-valid candidates\s+128/u.test(result.stdout),
        zeroMatches: /Evidence matches\s+0/u.test(result.stdout),
        reportedNonMatches: (result.stdout.match(/not matched/gu) ?? []).length,
        stderr: result.stderr,
        summary: result.stdout
          .split("\n")
          .filter((line) => !line.includes("abandon"))
          .slice(0, 15),
      },
    },
    null,
    2,
  ),
);
process.exitCode = rejected ? 0 : 1;
