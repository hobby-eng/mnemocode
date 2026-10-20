// Git's view of the repository, for the checks that read it. Whether a folder is the top level of
// the Git work tree that Git finds from it: such a check runs only there, not in a copy inside
// another repository's work tree, nor where there is no repository at all. And the files that Git
// lists there, read in one place for every check that reads the repository's files: the code rules
// (verify-code-rules.mjs), the Markdown check (verify-markdown.mjs) and the published audit files
// (audit-files.mjs).

import { execFileSync, spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { join, resolve } from "node:path";

/**
 * The most output git ls-files may give before execFileSync refuses it: 64 MiB, a ceiling far
 * above this repository's file list, whose names take well under one.
 */
const FILE_LIST_BYTES = 64 * 1024 * 1024;

/** Whether `root`, an absolute path, is the top level of a Git work tree. */
export function isRepositoryTopLevel(root) {
  const topLevel = spawnSync("git", ["-C", root, "rev-parse", "--show-toplevel"], {
    encoding: "utf8",
  });
  return topLevel.status === 0 && resolve(topLevel.stdout.trim()) === root;
}

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
