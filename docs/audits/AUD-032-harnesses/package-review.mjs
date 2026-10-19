// Inspect the complete dry-run file list, not only the presence of audit documents.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { publishedAuditFiles } from "../../../scripts/audit-files.mjs";

const root = fileURLToPath(new URL("../../../", import.meta.url));
const evidence = resolve(root, "docs/audits/AUD-032-evidence");
const label = process.argv[2] ?? "package-review";
if (!/^[a-z0-9-]+$/u.test(label)) throw new Error("Use a plain evidence label.");
const text = execFileSync("npm", ["pack", "--dry-run", "--json", "--ignore-scripts"], {
  cwd: root, encoding: "utf8", maxBuffer: 16 * 1024 * 1024,
});
const [listing] = JSON.parse(text);
const paths = new Set(listing.files.map((file) => file.path));
const audits = publishedAuditFiles();
const snapshot = JSON.parse(readFileSync(resolve(evidence, "snapshot.json"), "utf8"));
const artifacts = JSON.parse(readFileSync(resolve(evidence, "artifacts.json"), "utf8"));
const admitted = new Set([...snapshot.files, ...artifacts.dist.files].map((file) => file.path));
for (const path of audits) admitted.add(path);
for (const path of paths) assert.ok(admitted.has(path), `Unadmitted package path: ${path}`);
for (const path of audits) assert.ok(paths.has(path), `Missing audit file: ${path}`);
for (const path of ["README.md", "SECURITY.md", "LICENSE", "NOTICE", "THIRD_PARTY_NOTICES.md",
  "docs/releases/v0.1.0.md", "sskr-wasm/integrity.json", "vectors/mnemocode-v1.json",
  "assets/fonts/DejaVuSans-NOTICE", "assets/maps/NOTICE"]) assert.ok(paths.has(path), path);
const refused = listing.files.filter(({ path }) =>
  /(?:^|\/)(?:node_modules|coverage|output|tmp|release|test-results|goldens)(?:\/|$)/u.test(path)
  || /(?:^|\/)AUD-\d+-evidence(?:\/|$)/u.test(path)
  || /^export-[^/]+\//u.test(path)
  || /(?:^|\/)(?:\.env|\.aws|\.git)(?:\/|$)/u.test(path)
  || /\.(?:pdf|png|jpe?g)$/iu.test(path) && !path.startsWith("assets/"));
assert.deepEqual(refused, []);
const directories = {};
for (const path of paths) {
  const prefix = path.startsWith("docs/audits/") ? "docs/audits"
    : path.includes("/") ? path.split("/")[0] : "root";
  directories[prefix] = (directories[prefix] ?? 0) + 1;
}
assert.ok(Object.keys(directories).every((name) =>
  ["root", "dist", "assets", "vectors", "sskr-wasm", "docs", "docs/audits"].includes(name)));
const result = { auditId: "AUD-032", checkedAtUtc: new Date().toISOString(),
  command: ["npm", "pack", "--dry-run", "--json", "--ignore-scripts"],
  fileCount: listing.files.length, auditFiles: audits.length, directories,
  listingSha256: createHash("sha256").update(text).digest("hex"),
  noArchiveCreated: true, noEvidenceOrExportsPacked: true, missingAuditFiles: [],
  files: listing.files,
  qualification: "Complete path allowlist review and required-document inclusion; not a published archive, provenance attestation, legal certification or release approval." };
writeFileSync(resolve(evidence, `${label}-listing.json`), text, { flag: "wx" });
writeFileSync(resolve(evidence, `${label}.json`), JSON.stringify(result, null, 2) + "\n", { flag: "wx" });
console.log(JSON.stringify({ fileCount: result.fileCount, auditFiles: result.auditFiles,
  directories, noEvidenceOrExportsPacked: true, noArchiveCreated: true }));
