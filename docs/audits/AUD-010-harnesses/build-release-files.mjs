// AUD-010 build reviewer: the local release files in release/ (CHECK-BLD-005), as
// scripts/build-executable.mjs leaves them. Nothing is built or run here.
//
// Checks, each printed with the values compared:
// 1. release/ holds exactly an executable, its -licenses.txt and its .sha256, named as
//    scripts/executable-files.mjs names them for this system and the package.json version;
// 2. the .sha256 lines are "<64 hex>  <name>" for the executable and the notices, in that order,
//    and equal the SHA-256 of the files;
// 3. the notices name MnemoCode, the Node.js runtime of .node-version, the SSKR engine and the
//    fonts and map data;
// 4. the executable carries the protection flags of src/cli/protection-flags.json (the SEA
//    configuration's execArgv) and no --allow-net.
// Exits 1 when a check fails.
import { createHash } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { executableName, noticesName } from "../../../scripts/executable-files.mjs";

let failures = 0;
const fail = (message) => {
  failures += 1;
  console.log(`FAIL ${message}`);
};
const version = JSON.parse(readFileSync("package.json", "utf8")).version;
const nodeVersion = readFileSync(".node-version", "utf8").trim();
const name = executableName(version);
const notices = noticesName(name);
const checksums = `${name}.sha256`;
const present = readdirSync("release").sort();
console.log(`release/: ${present.join(", ")}`);
const expected = [name, notices, checksums].sort();
if (present.join("|") !== expected.join("|")) fail(`release/ should hold exactly ${expected.join(", ")}`);

const sha256 = (path) => createHash("sha256").update(readFileSync(path)).digest("hex");
const lines = readFileSync(join("release", checksums), "utf8").trimEnd().split("\n");
const actual = [name, notices].map((file) => `${sha256(join("release", file))}  ${file}`);
for (const [index, line] of lines.entries()) console.log(`${checksums} line ${index + 1}: ${line}`);
for (const [index, line] of actual.entries()) console.log(`computed line ${index + 1}: ${line}`);
if (lines.join("\n") !== actual.join("\n")) fail(".sha256 lines differ from the files");

const text = readFileSync(join("release", notices), "utf8");
const headings = [
  ["MnemoCode", /^MnemoCode$/mu],
  [`Node.js v${nodeVersion}`, new RegExp(`^Node\\.js v${nodeVersion.replaceAll(".", "\\.")}$`, "mu")],
  ["SSKR engine", /^SSKR engine \(sskr-wasm\)$/mu],
  ["Fonts and map data", /^Fonts and map data$/mu],
];
for (const [label, pattern] of headings) {
  const found = pattern.test(text);
  console.log(`notices section ${label}: ${found}`);
  if (!found) fail(`notices lack ${label}`);
}

const binary = readFileSync(join("release", name));
const flags = JSON.parse(readFileSync("src/cli/protection-flags.json", "utf8"));
for (const flag of flags) {
  const found = binary.includes(Buffer.from(JSON.stringify(flag)));
  console.log(`executable carries ${flag}: ${found}`);
  if (!found) fail(`executable lacks ${flag}`);
}
const allowNet = binary.includes(Buffer.from('"--allow-net'));
console.log(`executable carries "--allow-net: ${allowNet}`);
if (allowNet) fail("executable grants the network");
console.log(failures === 0 ? "PASS build-release-files" : `FAIL build-release-files: ${failures} check(s)`);
process.exitCode = failures === 0 ? 0 : 1;
