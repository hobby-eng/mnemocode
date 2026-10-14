#!/bin/bash
# AUD-024-API001: a host of the package names the types of the joint repair's results through the
# part's own entry, mnemocode/sskr/joint-repair, as it could at 870effe. Builds a tiny host project
# in ../tmp/aud024-entry-types (beside the repository, removed afterwards) whose node_modules links
# to this checkout, and compiles it with the repository's TypeScript. Run from the MnemoCode
# repository root after pnpm build:
#   bash docs/audits/AUD-024-harnesses/entry-types.sh
# Exit 0 when the host compiles; exit 1 while a name is missing from the entry.
set -euo pipefail
repo=$(pwd)
host=../tmp/aud024-entry-types
rm -rf "$host"
mkdir -p "$host/node_modules"
ln -s "$repo" "$host/node_modules/mnemocode"
cat > "$host/host.ts" <<'TS'
import type { ElementHelp, JointAssessment, JointPlan, MarkedElement, RepairedSet, RepairedShares, ShareAssessment } from "mnemocode/sskr/joint-repair";
import { DIGEST_BITS } from "mnemocode/sskr/joint-repair";
export function verdictOf(plan: JointPlan): JointAssessment["verdict"] {
  return plan.assessment.verdict;
}
export type Named = [ElementHelp, MarkedElement, RepairedSet, RepairedShares, ShareAssessment, typeof DIGEST_BITS];
TS
printf '{"compilerOptions":{"module":"nodenext","moduleResolution":"nodenext","target":"es2022","strict":true,"noEmit":true,"skipLibCheck":true},"files":["host.ts"]}\n' > "$host/tsconfig.json"
status=0
"$repo/node_modules/.bin/tsc" -p "$host" || status=1
rm -rf "$host"
echo "host compile: exit $status"
exit $status
