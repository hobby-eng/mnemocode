#!/bin/bash
# AUD-024 baseline: every check of the reviewed source, one at a time, each recorded by the AUD-023
# record.py and run under the AUD-023 cap.sh (the workspace's heavy-job lock, 6 GiB, no swap, 30
# minutes). The suite runs in parts as the AUD-022 run-tests.sh runs it; the AUD-022 probes of its
# findings and the AUD-005 Seedshift oracle run again on this source. Run from the MnemoCode
# repository root:
#   bash docs/audits/AUD-024-harnesses/baseline.sh docs/audits/AUD-024-evidence
set -u
here=$(dirname "$0")
audits=$(dirname "$here")
evidence=$1
status=0
check() {
  local label=$1
  shift
  python3 "$audits/AUD-023-harnesses/record.py" "$evidence" "$label" bash "$audits/AUD-023-harnesses/cap.sh" "$@" || status=1
}
export LC_ALL=C
python3 "$audits/AUD-023-harnesses/snapshot.py" "$evidence/snapshot.json"
# The commit whose tree is the source that the AUD-022 remediation left (AUD-023's fingerprint).
check aud022-source python3 "$here/source-at-commit.py" 870effe 89c0cf323e39545dcbb37b5f37027314cc3b39f57cf6cbfd9004bc2a7f34c68d
check lockfile-frozen pnpm install --frozen-lockfile --offline --ignore-scripts --lockfile-only
check build pnpm build
check source pnpm check
check format pnpm format:check
bash "$audits/AUD-022-harnesses/run-tests.sh" "$evidence" tests || status=1
check cli-self-test node dist/mnemocode.js self-test
check terminal-input python3 scripts/verify-terminal-input.py
check card-output node scripts/check-card-output.mjs "$evidence/card-output"
check repair-leading-marks node "$audits/AUD-022-harnesses/repair-leading-marks.mjs"
check reencode-stdout python3 "$audits/AUD-022-harnesses/reencode-stdout.py"
check aud021-fixed node "$audits/AUD-022-harnesses/aud021-fixed.mjs"
check sskr-independent python3 scripts/verify-sskr-known-answers.py
check seedshift-oracle python3 "$audits/AUD-005-harnesses/seedshift-oracle.py"
check sskr-reproducible pnpm verify:sskr
check dependency-advisories pnpm audit --audit-level high
check package-manifest npm pack --dry-run --json --ignore-scripts
python3 "$audits/AUD-023-harnesses/snapshot.py" "$evidence/snapshot-after.json"
echo "baseline done, status $status"
exit $status
