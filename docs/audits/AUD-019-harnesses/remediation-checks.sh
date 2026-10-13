#!/bin/sh
# AUD-019 remediation: the remediated snapshot and its checks, one after another, each through
# audit.py, into the ignored docs/audits/AUD-019-evidence/. Exits non-zero if any check failed.

A="python3 docs/audits/AUD-019-harnesses/audit.py"
failed=0
run() { "$@" || failed=1; }

run $A snapshot remediation
run $A check remediation-source-check pnpm check
run $A check remediation-format-check pnpm format:check
run $A check remediation-build pnpm build
run $A check remediation-all-tests --timeout 1800 npx vitest run --maxWorkers=4 --testTimeout=180000
run $A check remediation-cli-self-test node dist/mnemocode.js self-test
run $A check remediation-terminal-input --timeout 1200 python3 scripts/verify-terminal-input.py
run $A check remediation-probes npx vitest run --config docs/audits/AUD-019-harnesses/probe.config.ts
run $A check remediation-short-copies node scripts/verify-no-copies.mjs --tokens 35
run $A check remediation-executable --timeout 1500 pnpm build:executable
exit $failed
