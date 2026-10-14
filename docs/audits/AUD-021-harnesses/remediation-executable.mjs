// Narrow current-source Linux controls from an empty folder. No PDFs, gallery or full self-test.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { executableName } from "../../../scripts/executable-files.mjs";
import { exportQrPayload } from "../../../dist/export/qr-image.js";
import { serializeRecord } from "../../../dist/record.js";

const destination = resolve("output/aud021-remediation-executable");
const { version } = JSON.parse(await readFile("package.json", "utf8"));
const vectors = JSON.parse(await readFile("vectors/mnemocode-v1.json", "utf8")).vectors;
const direct = vectors.find((value) => value.name === "direct-12");
const masked = vectors.find((value) => value.name === "checksum-valid-seedshift-12");
const path = join(destination, executableName(version));
const folder = await mkdtemp(join(tmpdir(), "mnemocode-aud021-native-"));
const checks = [];
const run = (...args) => execFileSync(path, args, { cwd: folder, encoding: "utf8", timeout: 15000, env: { ...process.env, NO_COLOR: "1" }, stdio: ["ignore", "pipe", "pipe"] });
const passed = (name) => { checks.push(name); console.log(`${name}: PASS`); };
try {
  assert.equal(run("--version"), `mnemocode ${version}\n`);
  assert.ok(run("encode", "--help").includes("Usage: mnemocode encode"));
  passed("version and help outside checkout");
  const encoded = run("encode", "--mode", "direct", "--format", "indexes", "--mnemonic", direct.sourceMnemonic);
  assert.ok(encoded.includes(direct.indexes));
  passed("public BIP39 exact indexes and startup gates");
  const shifted = run("encode", "--mode", "seedshift", "--dates", ...masked.dates, "--format", "english", "--mnemonic", masked.sourceMnemonic);
  assert.ok(shifted.includes(masked.english));
  passed("published date-masking answer");
  const converted = run("re-encode", "--input", masked.english, "--old-mode", masked.mode, "--old-format", "english", "--old-dates", ...masked.dates, "--recognised", "--mode", "direct", "--format", "unicode");
  assert.ok(converted.includes(direct.unicode));
  passed("recognised re-encoding exact Unicode answer");
  const split = run("sskr-split", "--mode", "direct", "--mnemonic", direct.sourceMnemonic, "--format", "ur", "--threshold", "2", "--shares", "3");
  const shares = split.match(/ur:sskr\/[a-z]+/gu);
  assert.equal(shares?.length, 3);
  assert.ok(run("sskr-combine", "--mode", "direct", "--share", shares[0], "--share", shares[1]).includes(direct.sourceMnemonic));
  passed("embedded SSKR generation and 2-of-3 recovery");
  const qr = join(folder, "public.png");
  await exportQrPayload(serializeRecord("direct", "indexes", direct.indexes), qr);
  assert.ok(run("decode", "--qr-file", qr, "--words", "12").includes(direct.sourceMnemonic));
  passed("actual local PNG QR admission and decoding");
  const bytes = await readFile(path);
  const record = { verifiedAt: new Date().toISOString(), timeZone: "UTC (+00:00)", executable: `output/aud021-remediation-executable/${executableName(version)}`, bytes: bytes.length, sha256: createHash("sha256").update(bytes).digest("hex"), checks, fullSelfTestRun: false, fullGalleryRun: false, pdfGenerated: false };
  await writeFile(join(destination, "verification.json"), JSON.stringify(record, null, 2) + "\n");
} finally {
  await rm(folder, { recursive: true, force: true });
}
