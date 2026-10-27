// The files that Git lists in a work tree, read in one place for every check that reads the
// repository's files: the code rules (verify-code-rules.mjs) and the Markdown check
// (verify-markdown.mjs). Taken from MnemoCode TS (scripts/git-top-level.mjs).

import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";

/**
 * The most output git ls-files may give before execFileSync refuses it: 64 MiB, a ceiling far
 * above this repository's file list, whose names take well under one.
 */
const FILE_LIST_BYTES = 64 * 1024 * 1024;

/**
 * The files that `git ls-files` lists with `options` when it runs in `folder`, a folder of a work
 * tree, for `pathspecs` (every file when none is given), as paths from `folder`. Each comes once,
 * though Git lists a file with a merge conflict once per stage, and only while it exists, though a
 * file deleted in the work tree is still in the index. Git's failure, such as outside a work tree,
 * is thrown as execFileSync throws it.
 */
export function listedFiles(folder, options, pathspecs = []) {
  const listing = execFileSync(
    "git",
    ["-C", folder, "ls-files", "-z", ...options, "--", ...pathspecs],
    { encoding: "utf8", maxBuffer: FILE_LIST_BYTES },
  );
  return [...new Set(listing.split("\0"))].filter(
    (path) => path !== "" && existsSync(join(folder, path)),
  );
}

/**
 * The files that Git tracks or would track in `folder` (new, but not ignored), for `pathspecs`, as
 * listedFiles gives them.
 */
export function trackedOrNewFiles(folder, pathspecs = []) {
  return listedFiles(folder, ["--cached", "--others", "--exclude-standard"], pathspecs);
}
