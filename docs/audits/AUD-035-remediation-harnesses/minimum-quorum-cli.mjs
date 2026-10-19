// Deliberate copy of the public mutation fixture: this artifact probe uses built modules
// without a test runner or TypeScript loader; it never takes private input.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { sskrSetVector } from "../../../dist/sskr/known-answers.js";
import { CHECKSUM_BYTES, urToTransport, transportToUr } from "../../../dist/sskr/transport.js";
import { crc32 } from "../../../dist/sskr/checksum.js";
const bytes = urToTransport(sskrSetVector.shares[0]);
bytes[10] ^= 1;
new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).setUint32(
  bytes.length - CHECKSUM_BYTES,
  crc32(bytes.slice(0, -CHECKSUM_BYTES)),
);
const damaged = transportToUr(bytes);
bytes.fill(0);
const folder = mkdtempSync(join(tmpdir(), "mnemocode-minimum-quorum-"));
try {
  const path = join(folder, "public-shares.txt");
  writeFileSync(path, damaged + "\n" + sskrSetVector.shares[1] + "\n", { mode: 0o600 });
  const result = spawnSync(
    resolve(process.argv[2] ?? "release/aud035-quorum-fixed/mnemocode-0.1.0-linux-x64"),
    ["sskr-combine", "--share-file", path],
    {
      encoding: "utf8",
      timeout: 15000,
      maxBuffer: 256 * 1024,
      env: { ...process.env, NO_COLOR: "1" },
    },
  );
  if (result.error) throw result.error;
  assert.equal(result.status, 1);
  assert.equal(result.signal, null);
  assert.equal(result.stdout, "");
  assert.ok(result.stderr.includes("These shares do not restore a secret"));
  assert.ok(!result.stderr.includes("Not enough SSKR shares to meet the recorded threshold"));
  assert.ok(!result.stderr.includes(damaged));
  assert.ok(!result.stderr.includes(sskrSetVector.shares[1]));
  assert.ok(!result.stderr.includes(sskrSetVector.phrase));
  console.log(
    JSON.stringify({
      passed: true,
      actualExecutable: true,
      invalidShareDiagnosis: true,
      phraseOrShareOutput: false,
    }),
  );
} finally {
  rmSync(folder, { recursive: true, force: true });
}
