// Whether a folder is the top level of the Git work tree that Git finds from it: a check that reads
// Git's view of the repository runs only there, not in a copy inside another repository's work
// tree, nor where there is no repository at all.

import { spawnSync } from "node:child_process";
import { resolve } from "node:path";

/** Whether `root`, an absolute path, is the top level of a Git work tree. */
export function isRepositoryTopLevel(root) {
  const topLevel = spawnSync("git", ["-C", root, "rev-parse", "--show-toplevel"], {
    encoding: "utf8",
  });
  return topLevel.status === 0 && resolve(topLevel.stdout.trim()) === root;
}
