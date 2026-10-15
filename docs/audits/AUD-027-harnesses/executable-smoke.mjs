// Bounded native smoke checks: public vectors, one PDF sheet and no gallery or full self-test.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { PDFDocument } from "pdf-lib";
import {
  checksumLine,
  checksumsName,
  executableName,
  noticesName,
} from "../../../scripts/executable-files.mjs";

const root = fileURLToPath(new URL("../../../", import.meta.url));
const version = JSON.parse(readFileSync(join(root, "package.json"), "utf8")).version;
const executable = resolve(process.argv[2] ?? join(root, "release", executableName(version)));
const vectors = JSON.parse(readFileSync(join(root, "vectors/mnemocode-v1.json"), "utf8")).vectors;
const direct = vectors.find((row) => row.name === "direct-12");
const shifted = vectors.find((row) => row.name === "checksum-valid-seedshift-12");
assert(direct && shifted, "Published smoke vectors exist");
const folder = mkdtempSync(join(root, "../tmp/mnemocode-release-smoke-"));
const checks = [];
const run = (...args) => execFileSync(executable, args, {
  cwd: folder,
  encoding: "utf8",
  timeout: 45_000,
  maxBuffer: 4 * 1024 * 1024,
  env: { ...process.env, NO_COLOR: "1", TZ: "UTC" },
  stdio: ["ignore", "pipe", "pipe"],
});
const checked = (condition, description) => {
  assert(condition, description);
  checks.push(description);
  console.log("ok  " + description);
};

try {
  checked(run("--version") === `mnemocode ${version}\n`, "standalone version");
  checked(run("encode", "--help").includes("Usage: mnemocode encode"), "standalone help/startup");
  const encoded = run("encode", "--mnemonic", shifted.sourceMnemonic, "--mode", "seedshift",
    "--dates", shifted.dates.join(","), "--format", "1");
  checked(encoded.includes(shifted.english), "Seedshift matches the published 12-word answer");
  const decoded = run("decode", "--input", direct.unicode, "--format", "3", "--mode", "direct");
  checked(decoded.includes(direct.sourceMnemonic), "Unicode restores the exact published seed phrase");
  run("encode", "--sskr", "--mnemonic", direct.sourceMnemonic, "--threshold", "2", "--shares", "3",
    "--output", "shares.txt");
  const shares = readFileSync(join(folder, "shares.txt"), "utf8").trim().split("\n");
  assert.equal(shares.length, 3);
  writeFileSync(join(folder, "two.txt"), `${shares[0]}\n${shares[2]}\n`);
  checked(run("sskr-combine", "--share-file", "two.txt").includes(direct.sourceMnemonic),
    "SSKR restores the exact seed phrase from two of three shares");
  run("preview", "--template", "business-it", "--pdf", "preview.pdf");
  const pdf = readFileSync(join(folder, "preview.pdf"));
  checked(pdf.subarray(0, 5).toString() === "%PDF-" && (await PDFDocument.load(pdf)).getPageCount() === 1,
    "one IT business-card PDF sheet loads with embedded assets");
  const name = basename(executable);
  const notices = noticesName(name);
  const noticesText = readFileSync(join(dirname(executable), notices), "utf8");
  checked(["MnemoCode", `Node.js ${process.version}`, "npm package", "SSKR engine"].every(
    (text) => noticesText.includes(text)), "license notices accompany the executable");
  const hash = (path) => createHash("sha256").update(readFileSync(path)).digest("hex");
  const expected = [name, notices].map((file) => checksumLine(hash(join(dirname(executable), file)), file));
  checked(readFileSync(join(dirname(executable), checksumsName(name)), "utf8") === expected.join("\n") + "\n",
    "both delivered SHA-256 checksums match");
  const result = { checkedAtUtc: new Date().toISOString(), artifact: name, bytes: statSync(executable).size,
    sha256: hash(executable), checks, fullSelfTest: false, gallery: false, visualComparison: false };
  writeFileSync(join(root, "docs/audits/AUD-027-evidence/executable-smoke.json"), JSON.stringify(result, null, 2) + "\n");
  console.log(JSON.stringify(result));
} finally {
  rmSync(folder, { recursive: true, force: true });
}
