/** AUD-008: bounded public-fixture CLI record/QR and menu-command presentation probes. */
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { PNG } from "pngjs";
import jsQR from "jsqr";
import { typedCommand } from "../../../dist/cli/menu.js";
import { parseRecord } from "../../../dist/record.js";

const root = resolve(import.meta.dirname, "../../..");
const evidence = resolve(root, "docs/audits/AUD-008-evidence");
const outputs = resolve(evidence, "interface-contract-outputs");
mkdirSync(outputs, { recursive: true, mode: 0o700 });
const mnemonic = `${"abandon ".repeat(11)}about`;
const date = "23-09-2026";
const results = [];
const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");
function cli(args) {
  const result = spawnSync(process.execPath, ["dist/mnemocode.js", ...args], {
    cwd: root,
    encoding: "utf8",
    timeout: 15_000,
    env: { ...process.env, NO_COLOR: "1" },
  });
  if (result.error) throw result.error;
  assert.equal(result.status, 0, result.stderr);
  return result;
}

for (const format of ["english", "indexes", "unicode", "colors-unicode", "colors"]) {
  const recordPath = resolve(outputs, `${format}.txt`);
  const qrPath = resolve(outputs, `${format}.png`);
  const encoded = cli([
    "encode",
    "--mnemonic",
    mnemonic,
    "--date",
    date,
    "--format",
    format,
    "--output",
    recordPath,
    "--qr",
    qrPath,
  ]);
  const recordBytes = readFileSync(recordPath);
  const record = parseRecord(recordBytes.toString("utf8"));
  assert.equal(record.mode, "seedshift");
  assert.equal(record.format, format);
  const imageBytes = readFileSync(qrPath);
  const image = PNG.sync.read(imageBytes);
  const qr = jsQR(new Uint8ClampedArray(image.data), image.width, image.height);
  assert.equal(qr?.data, record.payload);
  const fromRecord = cli(["decode", "--input-file", recordPath, "--date", date]);
  const fromQr = cli(["decode", "--qr-file", qrPath, "--mode", "seedshift", "--date", date]);
  assert.equal(fromRecord.stdout.trim(), mnemonic);
  assert.equal(fromQr.stdout.trim(), mnemonic);
  assert(!/\x1b\[/u.test(encoded.stdout + encoded.stderr));
  results.push({
    kind: "pass",
    format,
    recordSha256: sha256(recordBytes),
    qrSha256: sha256(imageBytes),
    decodedBytesExact: true,
    qrContainsRawSelectedPayloadOnly: true,
  });
}

const wrong = cli([
  "decode",
  "--input-file",
  resolve(outputs, "colors.txt"),
  "--date",
  "24-09-2026",
]);
assert.notEqual(wrong.stdout.trim(), mnemonic);
assert.match(wrong.stderr, /BIP39 checksum: valid\./u);
assert(!/compare|wrong date|another wallet|does not prove|verify/u.test(wrong.stderr));
writeFileSync(resolve(evidence, "interface-wrong-date.stdout.txt"), wrong.stdout);
writeFileSync(resolve(evidence, "interface-wrong-date.stderr.txt"), wrong.stderr);
results.push({
  kind: "reproduced-presentation-gap",
  name: "wrong-date-checksum-success",
  returnedDifferentMnemonic: true,
  checksumReportedValid: true,
  walletComparisonWarning: false,
  stderrSha256: sha256(wrong.stderr),
});

const fileName = "output/a$(printf b).pdf";
const shown = typedCommand(["preview", "--pdf", fileName]);
const shellArgs = execFileSync("bash", ["-c", `mnemocode() { printf '%s\\n' "$@"; }; ${shown}`], {
  encoding: "utf8",
  timeout: 5_000,
})
  .trim()
  .split("\n");
assert.equal(shellArgs[0], "preview");
assert.notEqual(shellArgs.at(-1), fileName);
assert.equal(shellArgs.at(-1), "output/ab.pdf");
results.push({
  kind: "reproduced-defect",
  name: "displayed-command-shell-quoting",
  requested: fileName,
  displayed: shown,
  actualShellArgument: shellArgs.at(-1),
});
writeFileSync(
  resolve(evidence, "interface-contracts-results.json"),
  `${JSON.stringify(results, null, 2)}\n`,
);
console.log(
  JSON.stringify(
    { results, fixture: "Public BIP39 zero-entropy test vector", cliProtection: "normal launcher" },
    null,
    2,
  ),
);
// A confirmed presentation contract failure must fail the audit harness.
process.exitCode = 1;
