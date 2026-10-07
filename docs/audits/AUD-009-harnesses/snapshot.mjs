import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
const directory = "docs/audits/AUD-009-evidence";
mkdirSync(directory, { recursive: true });
const [label = "baseline"] = process.argv.slice(2);
const hash = (bytes) => createHash("sha256").update(bytes).digest("hex");
const paths = [...new Set(execFileSync("git", ["ls-files", "-c", "-o", "--exclude-standard", "-z"])
  .toString().split("\0").filter(Boolean))].filter((p) => !p.startsWith("docs/audits/")).sort();
const source = paths.map((path) => [path, existsSync(path) ? hash(readFileSync(path)) : "deleted"]);
const artifacts = ["release/mnemocode-0.1.0-linux-x64", "dist/mnemocode.js",
  "dist/core/encoded-backup.js", "dist/sskr/share-set.js", "sskr-wasm/generated/sskr_wasm_bg.wasm"]
  .filter(existsSync).map((path) => [path, hash(readFileSync(path))]);
const record = { capturedAt: new Date().toISOString(),
  head: execFileSync("git", ["rev-parse", "HEAD"]).toString().trim(),
  branch: execFileSync("git", ["branch", "--show-current"]).toString().trim(),
  workingTree: execFileSync("git", ["status", "--short"]).toString(),
  fingerprint: hash(JSON.stringify(source)), source, artifacts };
writeFileSync(directory + "/" + label + "-snapshot.json", JSON.stringify(record, null, 2) + "\n");
console.log(JSON.stringify({label, fingerprint: record.fingerprint, head: record.head,
  sourceFiles: source.length, artifacts}, null, 2));
