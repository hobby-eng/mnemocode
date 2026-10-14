#!/bin/bash
# AUD-022: the whole test suite in parts. The test files that draw PDFs, found by the renderers and
# card options they use, run three at a time (owner, 2026-10-13); the rest in one run with four
# workers. Every part goes through cap.sh. Run from the MnemoCode repository root:
#   bash docs/audits/AUD-022-harnesses/run-tests.sh docs/audits/AUD-022-evidence [label-prefix]
set -u
here=$(dirname "$0")
evidence=$1
prefix=${2:-tests}
export LC_ALL=C
mapfile -t pdf < <(grep -lE "renderCards|renderMaterialCard|renderIndividualCards|renderCatalogDesign|renderShare|HeirSheet|heirSheet|exportIndividualCards|--pdf|--cards-dir|--images-dir|renderSheet|drawCollectionStudy|renderCollection|nodeCardRenderer|ShareCardSet|pdftocairo|renderDocument|writeRenderedDocument|\"preview\"" test/*.test.ts | sort)
mapfile -t other < <(ls test/*.test.ts | sort | comm -23 - <(printf '%s\n' "${pdf[@]}"))
echo "${#other[@]} files without PDFs, ${#pdf[@]} files with PDFs"
status=0
python3 "$here/record.py" "$evidence" "$prefix-other" bash "$here/cap.sh" pnpm exec vitest run --maxWorkers=4 "${other[@]}" || status=1
batch=0
for ((i = 0; i < ${#pdf[@]}; i += 3)); do
  batch=$((batch + 1))
  python3 "$here/record.py" "$evidence" "$prefix-pdf-$(printf %02d $batch)" bash "$here/cap.sh" pnpm exec vitest run --maxWorkers=3 "${pdf[@]:i:3}" || status=1
done
echo "all parts done, status $status"
exit $status
