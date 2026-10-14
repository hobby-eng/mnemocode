#!/bin/bash
# AUD-023 baseline: the checks that the AUD-022 remediation run did not make at this source,
# each recorded by record.py and run through cap.sh (the shared heavy-job lock, 6 GiB, no swap).
# The gates that run made at the same fingerprint (build, pnpm check, Prettier, the suite in parts,
# the self-test, terminal checks, card output, executable) are taken from its records instead of
# running them again (owner: no repeated long checks). Run from the MnemoCode repository root:
#   bash docs/audits/AUD-023-harnesses/baseline.sh docs/audits/AUD-023-evidence
set -u
here=$(dirname "$0")
evidence=$1
status=0
check() {
  local label=$1
  shift
  python3 "$here/record.py" "$evidence" "$label" bash "$here/cap.sh" "$@" || status=1
}
export LC_ALL=C
check lockfile-frozen pnpm install --frozen-lockfile --offline --ignore-scripts --lockfile-only
check dependency-advisories pnpm audit --audit-level high
check package-manifest npm pack --dry-run --json --ignore-scripts
check records-schema python3 docs/audits/AUD-022-harnesses/validate-records.py
check seedshift-oracle python3 docs/audits/AUD-005-harnesses/seedshift-oracle.py
# Line coverage of the library from the test files that draw no PDFs, three workers; the PDF
# files are left out to keep the run short and cool (owner, 2026-10-13).
mapfile -t pdf < <(grep -lE "renderCards|renderMaterialCard|renderIndividualCards|renderCatalogDesign|renderShare|HeirSheet|heirSheet|exportIndividualCards|--pdf|--cards-dir|--images-dir|renderSheet|drawCollectionStudy|renderCollection|nodeCardRenderer|ShareCardSet|pdftocairo|renderDocument|writeRenderedDocument|\"preview\"" test/*.test.ts | sort)
mapfile -t other < <(ls test/*.test.ts | sort | comm -23 - <(printf '%s\n' "${pdf[@]}"))
check coverage-other pnpm exec vitest run --coverage --coverage.reporter=text-summary --coverage.reporter=json-summary --coverage.reportsDirectory="$evidence/coverage" --coverage.include='src/**' --maxWorkers=3 "${other[@]}"
echo "baseline done, status $status"
exit $status
