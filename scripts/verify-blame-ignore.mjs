// Checks that every commit named in .git-blame-ignore-revs is in the history of HEAD
// (AUD-037-BLD003): git and GitHub skip a name they cannot find without a word, so that a
// formatting commit rewritten under a new hash would be blamed again. A clone without the whole
// history, such as the shallow one of CI, or a copy that is no Git checkout of the repository, such
// as a review snapshot or an unpacked archive, cannot tell and says so.
//
//   node scripts/verify-blame-ignore.mjs

import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { isRepositoryTopLevel } from "./git-top-level.mjs";

const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
const FILE = ".git-blame-ignore-revs";
/** A commit's full name, SHA-1 or SHA-256, which the file must give. */
const COMMIT = /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/u;

function git(...arguments_) {
  return execFileSync("git", arguments_, { cwd: root, encoding: "utf8", stdio: "pipe" }).trim();
}

/** Whether `name` is a full commit name and that commit is in the history of HEAD. */
function inHistory(name) {
  if (!COMMIT.test(name)) return false;
  try {
    git("merge-base", "--is-ancestor", name, "HEAD");
    return true;
  } catch {
    return false;
  }
}

// As Git reads the file: a "#" begins a comment, also after a name, and names are in either case.
const names = readFileSync(join(root, FILE), "utf8")
  .split("\n")
  .map((line) => line.replace(/#.*/u, "").trim().toLowerCase())
  .filter((line) => line !== "");
if (!isRepositoryTopLevel(root)) {
  console.log(`This folder is no Git checkout of the repository: ${FILE} is not checked.`);
} else if (git("rev-parse", "--is-shallow-repository") === "true") {
  console.log(`The history is shallow: the commits of ${FILE} are not checked.`);
} else {
  const missing = names.filter((name) => !inHistory(name));
  if (missing.length > 0) {
    console.error(
      `${FILE} names commits that are not in the history of HEAD: ${missing.join(", ")}.`,
    );
    process.exit(1);
  }
  console.log(`The ${names.length} commits of ${FILE} are in the history.`);
}
