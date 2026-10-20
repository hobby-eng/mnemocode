import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { listedFiles } from "./git-top-level.mjs";
import { KEY_DOCUMENTS, shownFingerprints, SIGNING_KEY } from "./release-key.mjs";

// GitHub renders a Markdown list "loose", as separate paragraphs with wider spacing than every
// other list, when a blank line separates two of its items or two blocks of one item. Every list
// in the project's documents stays tight. The files that the formatter leaves alone
// (.prettierignore, such as the frozen audit records and the SSKR bridge's notices) are left out
// here too.
//
// The documents that show the release key's fingerprint are also checked to show that one
// (release-key.mjs).
//
// Deliberate copy: LIST_ITEM, CODE_FENCE, INDENTED_TEXT and looseListLines copy the check of the
// same rule (DOC-01 of the workspace's coding guide) in the multi-chain wallet tools,
// looseListLine and its patterns in tooling/verify-project-facts.mjs. It is copied because
// MnemoCode is a program of its own that imports nothing from another project of the workspace
// (AGENTS.md). No check here can keep the two in step, as this repository does not read the
// other: a change to either is made to both by hand. Both find the same loose lines, though this
// one reports every loose line and the other stops at the first.
const LIST_ITEM = /^\s*(?:[-*+]|\d+[.)])\s/u;
const CODE_FENCE = /^\s*(?:```|~~~)/u;
const INDENTED_TEXT = /^\s{2,}\S/u;

const root = fileURLToPath(new URL("..", import.meta.url));

/** The 1-based numbers of the blank lines that make a list loose. */
function looseListLines(lines) {
  const found = [];
  let inFence = false;
  let inList = false;
  let blankInList = false;
  // The 0-based index of a line is the 1-based number of the blank line just above it.
  for (const [index, line] of lines.entries()) {
    if (CODE_FENCE.test(line)) {
      const indented = /^\s/u.test(line);
      // A fence opened with indentation right after a blank line is a second block of the item.
      if (!inFence && blankInList && indented) found.push(index);
      // A fence at the left margin belongs to no list item, so it ends the list.
      if (!inFence && !indented) inList = false;
      inFence = !inFence;
      blankInList = false;
      continue;
    }
    if (inFence) continue;
    if (line.trim() === "") {
      if (inList) blankInList = true;
      continue;
    }
    if (LIST_ITEM.test(line) || (blankInList && INDENTED_TEXT.test(line))) {
      if (blankInList) found.push(index);
      inList = true;
      blankInList = false;
      continue;
    }
    if (blankInList || line.startsWith("#")) inList = false;
    blankInList = false;
  }
  return found;
}

/** The Markdown files that `git ls-files` lists with `options` (listedFiles). */
function listed(...options) {
  return listedFiles(root, options, ["*.md"]);
}

/**
 * The Markdown files Git tracks or would track (new but not ignored), as repository paths, but
 * those the formatter ignores: Git applies the patterns of .prettierignore, so that both tools
 * read them by one rule.
 */
function markdownFiles() {
  const ignored = new Set(listed("--cached", "--ignored", "--exclude-from=.prettierignore"));
  return [
    ...listed("--cached").filter((path) => !ignored.has(path)),
    ...listed("--others", "--exclude-standard", "--exclude-from=.prettierignore"),
  ].sort();
}

const checked = markdownFiles();
let looseLines = 0;
for (const path of checked) {
  const lines = readFileSync(resolve(root, path), "utf8").split(/\r?\n/u);
  for (const line of looseListLines(lines)) {
    console.error(
      `${path}:${line} has a blank line inside a list, so GitHub renders it with wider spacing.`,
    );
    looseLines += 1;
  }
}

let keyProblems = 0;
for (const path of KEY_DOCUMENTS) {
  const shown = shownFingerprints(readFileSync(resolve(root, path), "utf8"));
  const other = shown.filter((fingerprint) => fingerprint !== SIGNING_KEY);
  if (!shown.includes(SIGNING_KEY) || other.length > 0) {
    console.error(
      `${path} must show the release key ${SIGNING_KEY} (scripts/release-key.mjs) and no other.`,
    );
    keyProblems += 1;
  }
}
if (keyProblems > 0) process.exitCode = 1;

if (looseLines > 0) {
  console.error(
    `${looseLines} blank line(s) inside Markdown lists; remove them to keep lists tight.`,
  );
  process.exitCode = 1;
} else {
  console.log(`Markdown lists are tight in ${checked.length} files.`);
}
