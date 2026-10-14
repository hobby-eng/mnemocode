// The audit files that the repository publishes: every file under docs/audits that git tracks or
// would track. The local evidence folders (docs/audits/*-evidence/) and Python caches are ignored
// (.gitignore), so they are never among them. The privacy check reads these files
// (verify-audit-privacy.mjs), and the package check finds each of them in the npm package
// (verify-audit-package.mjs).
import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";

export const AUDIT_ROOT = "docs/audits";

/** The published audit files, as paths from the repository root. */
export function publishedAuditFiles() {
  const listed = execFileSync(
    "git",
    ["ls-files", "--cached", "--others", "--exclude-standard", "-z", AUDIT_ROOT],
    { encoding: "utf8" },
  );
  // A tracked file deleted in the working tree is published no more.
  return [...new Set(listed.split("\0"))].filter((path) => path !== "" && existsSync(path));
}
