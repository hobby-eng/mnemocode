#!/bin/sh
# AUD-019: the recorded checks, one after another, each through audit.py. Run from the
# repository root; every result lands in the ignored docs/audits/AUD-019-evidence/. The run goes
# on after a failing check and exits non-zero at the end if any check failed.
#
# Unlike AUD-018, the whole test collection runs, the PDF-rendering files included, and so do the
# card export round trip and the executable build with its own checks. Not run: the Docker
# rebuild of the SSKR engine (pnpm verify:sskr), other systems than Linux, CI and any release step.

A="python3 docs/audits/AUD-019-harnesses/audit.py"
WORK=../tmp/mnemocode/aud-019
failed=0
run() { "$@" || failed=1; }

run $A check source-check pnpm check
run $A check format-check pnpm format:check
run $A check build pnpm build
run $A check all-tests --timeout 1800 npx vitest run --maxWorkers=4 --testTimeout=180000
run $A check cli-self-test node dist/mnemocode.js self-test
run $A check terminal-input --timeout 1200 python3 scripts/verify-terminal-input.py
mkdir -p "$WORK"
run $A check card-output --timeout 1200 node scripts/check-card-output.mjs "$WORK/card-output"
run $A check executable --timeout 1500 pnpm build:executable
run $A check package-contents npm pack --dry-run --json --ignore-scripts
run $A check dependency-advisories pnpm audit --audit-level high
run $A check private-reporting gh api repos/hobby-eng/mnemocode/private-vulnerability-reporting
run $A check sskr-manifest python3 docs/audits/AUD-019-harnesses/sskr-manifest.py
run $A check record-integrity python3 docs/audits/AUD-019-harnesses/record-integrity.py
run $A check readme-examples python3 docs/audits/AUD-019-harnesses/readme-examples.py
run $A check readme-secret-arguments python3 docs/audits/AUD-019-harnesses/readme-secret-arguments.py
rm -rf "$WORK"
exit $failed
