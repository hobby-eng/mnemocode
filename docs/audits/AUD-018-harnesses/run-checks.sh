#!/bin/sh
# AUD-018: the recorded checks, one after another, each through audit.py. Run from the
# repository root; every result lands in the ignored docs/audits/AUD-018-evidence/. The run goes
# on after a failing check and exits non-zero at the end if any check failed.
#
# Not run here, by the owner's order of 2026-10-11/12 or as release-level work: the test files
# that render whole PDF card sets (PDF_TESTS below), scripts/check-card-output.mjs, the Docker
# rebuild of the SSKR engine (pnpm verify:sskr) and the executable build.

A="python3 docs/audits/AUD-018-harnesses/audit.py"
PDF_TESTS="business-cards card-page-sizes cli collection-sheet export heir-sheet known-audit-defects material-cards render-platform sskr-cli-export card-preview"
failed=0
run() { "$@" || failed=1; }

run $A check source-check pnpm check
run $A check format-check pnpm format:check
run $A check build pnpm build

ordinary=""
for file in test/*.test.ts; do
  name=$(basename "$file" .test.ts)
  case " $PDF_TESTS " in *" $name "*) ;; *) ordinary="$ordinary $file" ;; esac
done
# shellcheck disable=SC2086
run $A check ordinary-tests --timeout 2400 npx vitest run --maxWorkers=2 --testTimeout=180000 $ordinary
run $A check cli-self-test node dist/mnemocode.js self-test
run $A check terminal-input --timeout 1200 python3 scripts/verify-terminal-input.py
run $A check package-contents npm pack --dry-run --json --ignore-scripts
run $A check dependency-advisories pnpm audit --audit-level high
run $A check private-reporting gh api repos/hobby-eng/mnemocode/private-vulnerability-reporting
exit $failed
