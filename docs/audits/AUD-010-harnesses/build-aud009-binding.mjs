// AUD-010 build reviewer: does a commit carry the bytes that AUD-009's remediation was bound to?
//
// AUD-009 (docs/audits/AUD-009-2026-10-06.md, "Remediation and follow-up") binds its fixes to the
// source fingerprint 837d75ee…dbe: "the SHA-256 of the sorted sha256sum lines of every tracked and
// untracked file under src/, test/ and scripts/ plus tsconfig.strict-consumers.json", and records
// the fix commit as "Not committed" (JSON fixCommit null). This probe recomputes that fingerprint
// from the blobs of the commits given (git cat-file; no checkout) and of the working tree, in the
// sha256sum line form "<sha256>  <path>\n", sorted by path, and prints each.
//
// It also checks by content which commit first carries the remediation that the record names: the
// regression test test/aud-009-remediation.test.ts and core/dates.ts's ownedDate and ownedPattern.
//
// Exits 1 when the record still says "Not committed" (Markdown) or fixCommit null (JSON) although
// a commit carries the remediation, by fingerprint or by content: the record would then be stale.
// Not reproducing the fingerprint is printed, not a failure: the remediated tree was a dirty tree
// that later work changed before it was committed.
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";

const RECORDED = "837d75eec85234a0072f48c0e37840adce151b485df15f6bb1921336fd700dbe";
const COMMITS = process.argv.slice(2).length > 0 ? process.argv.slice(2) : ["2c3ec5b", "3b4ce6a", "ab57e8d", "ed5bed4"];
const INCLUDED = (path) => /^(src|test|scripts)\//u.test(path) || path === "tsconfig.strict-consumers.json";
const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");
const git = (args, options = {}) => execFileSync("git", args, { maxBuffer: 1 << 30, ...options });

function fingerprint(entries) {
  const lines = entries
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([path, hash]) => `${hash}  ${path}\n`)
    .join("");
  return sha256(lines);
}

let reproduced;
for (const commit of COMMITS) {
  const paths = git(["ls-tree", "-r", "--name-only", "-z", commit]).toString().split("\0").filter((p) => p && INCLUDED(p));
  const entries = paths.map((path) => [path, sha256(git(["cat-file", "blob", `${commit}:${path}`]))]);
  const value = fingerprint(entries);
  console.log(`${commit}: ${paths.length} files, fingerprint ${value}${value === RECORDED ? "  <- equals AUD-009's" : ""}`);
  if (value === RECORDED && reproduced === undefined) reproduced = commit;
}
const working = git(["ls-files", "-c", "-o", "--exclude-standard", "-z"]).toString().split("\0").filter((p) => p && INCLUDED(p));
const workingValue = fingerprint(working.map((path) => [path, sha256(readFileSync(path))]));
console.log(`working tree: ${working.length} files, fingerprint ${workingValue}${workingValue === RECORDED ? "  <- equals AUD-009's" : ""}`);

const record = readFileSync("docs/audits/AUD-009-2026-10-06.md", "utf8");
const json = JSON.parse(readFileSync("docs/audits/AUD-009-2026-10-06.json", "utf8"));
const notCommitted = (record.match(/\| fixed \| Not committed \| Not committed \|/gu) ?? []).length;
const nullCommits = json.remediation.filter((row) => row.fixCommit === null).length;
console.log(`AUD-009 record: ${notCommitted} remediation rows "Not committed" (Markdown); ${nullCommits} with fixCommit null (JSON)`);
let carrying;
// COMMITS are in the order of history: the first that carries the remediation is the fix commit.
for (const commit of COMMITS) {
  const has = (path) => {
    try {
      return git(["cat-file", "blob", `${commit}:${path}`], { stdio: ["ignore", "pipe", "ignore"] }).toString();
    } catch {
      return undefined;
    }
  };
  const test = has("test/aud-009-remediation.test.ts") !== undefined;
  const dates = has("src/core/dates.ts") ?? "";
  const owned = /export function ownedDate\b/u.test(dates) && /export function ownedPattern\b/u.test(dates);
  console.log(`${commit}: test/aud-009-remediation.test.ts ${test}; core/dates.ts ownedDate and ownedPattern ${owned}`);
  if (test && owned && carrying === undefined) carrying = commit;
}
console.log(`Fingerprint reproduced by: ${reproduced ?? "no candidate commit"}; remediation first carried by: ${carrying ?? "no candidate commit"}`);
let failures = 0;
if ((reproduced ?? carrying) !== undefined && (notCommitted > 0 || nullCommits > 0)) {
  failures += 1;
  console.log(`FAIL ${reproduced ?? carrying} carries the remediation, but the AUD-009 record still says Not committed`);
}
console.log(failures === 0 ? "PASS build-aud009-binding" : "FAIL build-aud009-binding");
process.exitCode = failures === 0 ? 0 : 1;
