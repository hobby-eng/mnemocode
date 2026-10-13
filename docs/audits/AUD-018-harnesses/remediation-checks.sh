#!/bin/sh
# AUD-018 remediation: the checks that bind the fixes of AUD-018-SEC001, DOC001 and DOC002 to the
# remediation snapshot, each through audit.py under its own label. Run from the repository root.
# The test files that read QR images are those of the ordinary run; cli, sskr-cli-export and
# known-audit-defects also do, but render PDFs and are not run here (owner's order).

A="python3 docs/audits/AUD-018-harnesses/audit.py"
failed=0
run() { "$@" || failed=1; }

run $A snapshot remediation
run $A check remediation-source-check pnpm check
run $A check remediation-format pnpm format:check
run $A check remediation-build pnpm build
run $A check remediation-tests --timeout 1200 npx vitest run --maxWorkers=2 test/aud-018.test.ts \
  test/aud-002-remediation.test.ts test/core.test.ts test/encode-decode-questions.test.ts \
  test/menu.test.ts test/card-qr.test.ts
run $A check remediation-cli-self-test node dist/mnemocode.js self-test
run $A check remediation-probes npx vitest run --config docs/audits/AUD-018-harnesses/probe.config.ts
run $A check remediation-readme-arguments python3 docs/audits/AUD-018-harnesses/readme-secret-arguments.py
run $A check remediation-record-integrity python3 docs/audits/AUD-018-harnesses/record-integrity.py
exit $failed
