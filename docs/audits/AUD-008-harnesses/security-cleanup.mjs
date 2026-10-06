// AUD-008: inspect mutable candidate-buffer ownership using bounded synthetic instrumentation.
// Captured references measure overwrite behavior; they do not demonstrate production GC lifetime.
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { encodeMnemonicLegacy, formatEncoded, parseDate } from "../../../dist/core.js";
import { encodeCandidateList, decodeCandidateList } from "../../../dist/core/candidate-list.js";
import { runRecoverDate } from "../../../dist/cli/recover-date-command.js";
import { runRecoverWord } from "../../../dist/cli/recover-word-command.js";

const phrase = "legal winner thank year wave sausage worth useful legal winner thank yellow";
const NativeBytes = Uint8Array;
const originalFrom = NativeBytes.from;
const originalEncode = TextEncoder.prototype.encode;
const originalLog = console.log;
const originalError = console.error;
const dateMapLine =
  readFileSync("dist/cli/recover-date-command.js", "utf8")
    .split("\n")
    .findIndex((line) => line.includes("kept.map(")) + 1;
const kept = [];
let phase = "";
const capture = (bytes, expectedFrame) => {
  if (new Error().stack.includes(expectedFrame)) kept.push({ phase, bytes });
  return bytes;
};
const proxy = new Proxy(NativeBytes, {
  construct(target, arguments_) {
    return capture(Reflect.construct(target, arguments_), "entropyOfWords");
  },
});
globalThis.Uint8Array = proxy;
NativeBytes.from = function (...arguments_) {
  const bytes = originalFrom.apply(this, arguments_);
  return capture(
    bytes,
    phase === "date-export"
      ? `dist/cli/recover-date-command.js:${dateMapLine}:`
      : "decodeCandidateList",
  );
};
TextEncoder.prototype.encode = function (...arguments_) {
  return capture(originalEncode.apply(this, arguments_), "passphraseBytes");
};
const directory = await mkdtemp("docs/audits/AUD-008-evidence/security-cleanup-");
const reports = [];
const remaining = (name) =>
  kept.filter((entry) => entry.phase === name && entry.bytes.some((b) => b !== 0));
try {
  console.log = () => undefined;
  console.error = () => undefined;
  phase = "word-export-success";
  await runRecoverWord({
    mnemonic: `${"abandon ".repeat(11)}?`,
    "candidates-file": join(directory, "word-success.bin"),
    "plaintext-candidates": true,
  });
  reports.push({ phase, nonzeroOwnedBuffersAfterReturn: remaining(phase).length });
  assert.equal(remaining(phase).length, 0);

  phase = "word-export-forced-output-error";
  console.log = () => {
    throw new Error("synthetic output failure after enumeration");
  };
  await assert.rejects(
    runRecoverWord({
      mnemonic: `${"abandon ".repeat(11)}?`,
      "candidates-file": join(directory, "word-error.bin"),
      "plaintext-candidates": true,
    }),
    /synthetic output failure/,
  );
  reports.push({ phase, nonzeroOwnedBuffersAfterRejection: remaining(phase).length });
  console.log = () => undefined;

  phase = "prepare-public-date-fixture";
  const encoded = formatEncoded(encodeMnemonicLegacy(phrase, [parseDate("01-01-2020")]), "english");
  phase = "date-export";
  await runRecoverDate({
    input: encoded,
    mode: "seedshift-legacy",
    format: "english",
    date: "01-01-202?",
    "max-candidates": "10",
    "candidates-file": join(directory, "dates.bin"),
    "plaintext-candidates": true,
  });
  reports.push({ phase, nonzeroOwnedBuffersAfterReturn: remaining(phase).length });

  phase = "encoded-passphrase-temporary-copies";
  const source = NativeBytes.from({ length: 16 }, (_, i) => i + 1);
  const list = encodeCandidateList({
    passphrase: "synthetic-global-password",
    records: [{ entropy: source, passphrase: "synthetic-record-password" }],
  });
  reports.push({ phase, nonzeroTemporaryPassphraseBuffers: remaining(phase).length });
  list.fill(0);

  phase = "failed-decode";
  const damaged = encodeCandidateList({ records: [{ entropy: source }] });
  damaged[27] ^= 1; // Four-byte CRC begins after 11 header bytes and 16 entropy bytes.
  await assert.throws(() => decodeCandidateList(damaged), /CRC-32/);
  reports.push({ phase, nonzeroDecodedBuffersAfterRejection: remaining(phase).length });
  damaged.fill(0);
  source.fill(0);
} finally {
  globalThis.Uint8Array = NativeBytes;
  NativeBytes.from = originalFrom;
  TextEncoder.prototype.encode = originalEncode;
  console.log = originalLog;
  console.error = originalError;
  // These captured public buffers and temporary files are probe-owned and erased by the probe.
  for (const entry of kept) entry.bytes.fill(0);
  await rm(directory, { recursive: true, force: true });
}
for (const report of reports) console.log(JSON.stringify(report));
console.log(
  JSON.stringify({
    instrumentedReferences: kept.length,
    productionLifetimeEstablished: false,
    privateMaterialExfiltrationEstablished: false,
  }),
);
process.exitCode = reports
  .slice(1)
  .some((report) =>
    Object.entries(report).some(([key, value]) => key.startsWith("nonzero") && value > 0),
  )
  ? 1
  : 0;
