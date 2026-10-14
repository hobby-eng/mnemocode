#!/bin/bash
# AUD-022 remediation: every check of the remediated source, one at a time, each recorded by
# record.py as remediation-<label> and run under cap.sh; the suite in parts as run-tests.sh runs
# it. The source fingerprint is captured first (snapshot-remediation.json), and make-report.py
# writes the addendum from these records. Run from the MnemoCode repository root:
#   bash docs/audits/AUD-022-harnesses/remediation-checks.sh docs/audits/AUD-022-evidence
set -u
here=$(dirname "$0")
evidence=$1
executable=output/aud022-remediation-executable
python3 "$here/snapshot.py" "$evidence/snapshot-remediation.json"
status=0
check() {
  local label=$1
  shift
  python3 "$here/record.py" "$evidence" "remediation-$label" bash "$here/cap.sh" "$@" || status=1
}
check build pnpm build
check source pnpm check
check format pnpm format:check
bash "$here/run-tests.sh" "$evidence" remediation-tests || status=1
check cli-self-test node dist/mnemocode.js self-test
check terminal-input python3 scripts/verify-terminal-input.py
check card-output node scripts/check-card-output.mjs "$evidence/remediation-card-output"
check repair-leading-marks node "$here/repair-leading-marks.mjs"
check reencode-stdout python3 "$here/reencode-stdout.py"
check sskr-independent python3 scripts/verify-sskr-known-answers.py
check aud021-fixed node "$here/aud021-fixed.mjs"
check executable-build node scripts/build-executable.mjs "$executable"
check executable-verify node scripts/verify-executable.mjs "$executable"
check terminal-executable python3 scripts/verify-terminal-input.py "$executable/mnemocode-0.1.0-linux-x64"
echo "all remediation checks done, status $status"
exit $status
