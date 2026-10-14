#!/bin/bash
# AUD-024 remediation: the checks of the remediated source, one at a time, each recorded by the
# AUD-023 record.py as remediation-<label> and run under its cap.sh. The source fingerprint is
# captured first (snapshot-remediation.json). The three probes of the findings must now exit 0.
# Run from the MnemoCode repository root:
#   bash docs/audits/AUD-024-harnesses/remediation-checks.sh docs/audits/AUD-024-evidence
set -u
here=$(dirname "$0")
audits=$(dirname "$here")
evidence=$1
status=0
check() {
  local label=$1
  shift
  python3 "$audits/AUD-023-harnesses/record.py" "$evidence" "remediation-$label" bash "$audits/AUD-023-harnesses/cap.sh" "$@" || status=1
}
export LC_ALL=C
python3 "$audits/AUD-023-harnesses/snapshot.py" "$evidence/snapshot-remediation.json"
check build pnpm build
check source pnpm check
check format pnpm format:check
check tests pnpm exec vitest run --maxWorkers=4 test/sskr-boundaries.test.ts test/joint-repair-entry.test.ts test/code-rules.test.ts test/re-encode-questions.test.ts test/ask-word-recovery.test.ts test/date-search-questions.test.ts test/encode-decode-questions.test.ts test/sskr-export-questions.test.ts test/re-encode.test.ts test/aud-022.test.ts test/sskr-vectors.test.ts test/sskr-integrity.test.ts test/sskr-cli-export.test.ts test/sskr-repair-engine.test.ts test/sskr-share-modules.test.ts test/portable-modules.test.ts test/aud-021-recovery.test.ts
check cli-self-test node dist/mnemocode.js self-test
check terminal-input python3 scripts/verify-terminal-input.py
check sskr-independent python3 scripts/verify-sskr-known-answers.py
check probe-truncated-share node "$here/truncated-share.mjs"
check probe-entry-types bash "$here/entry-types.sh"
check probe-code-rules-gaps bash "$here/code-rules-gaps.sh"
echo "remediation checks done, status $status"
exit $status
