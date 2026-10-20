// The audit files that the repository publishes: every file under docs/audits that git tracks or
// would track. The local evidence folders (docs/audits/*-evidence/) and Python caches are ignored
// (.gitignore), so they are never among them. The privacy check reads these files
// (verify-audit-privacy.mjs), and the package check finds each of them in the npm package
// (verify-audit-package.mjs).
import { trackedOrNewFiles } from "./git-top-level.mjs";

const AUDIT_ROOT = "docs/audits";

/**
 * The published audit files, as paths from the folder the check runs in, the repository root: a
 * tracked file deleted in the working tree is published no more (trackedOrNewFiles).
 */
export function publishedAuditFiles() {
  return trackedOrNewFiles(".", [AUDIT_ROOT]);
}
