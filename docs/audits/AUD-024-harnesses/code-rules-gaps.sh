#!/bin/bash
# AUD-024-BLD001 and BLD002: scripts/verify-code-rules.mjs, copied into small trees in
# ../tmp/aud024-code-rules (beside the repository, removed afterwards), must refuse a Python
# import that the script's existing requirements file does not pin (TOOL-03), and a Cargo
# dependency written as a table or a dotted key without "=x.y.z" (CORE-25). Each case prints the
# gate's exit code and its first problem line. Run from the MnemoCode repository root:
#   bash docs/audits/AUD-024-harnesses/code-rules-gaps.sh
# Exit 0 when the gate refuses every violating case and passes the control; exit 1 otherwise.
set -euo pipefail
repo=$(pwd)
base=../tmp/aud024-code-rules
hash64=$(printf 'a%.0s' $(seq 64))
status=0
run_case() {
  local name=$1 want=$2 setup=$3
  local root="$base/$name"
  rm -rf "$root"
  mkdir -p "$root/scripts"
  cp "$repo/scripts/verify-code-rules.mjs" "$repo/scripts/source-tokens.mjs" "$root/scripts/"
  printf '{"packageManager":"pnpm@12.8.1","dependencies":{"@scure/bip39":"2.4.0"}}' > "$root/package.json"
  printf "lockfileVersion: '9.0'\n" > "$root/pnpm-lock.yaml"
  "$setup" "$root"
  set +e
  node "$root/scripts/verify-code-rules.mjs" > "$root/out.txt" 2>&1
  local got=$?
  set -e
  local verdict=PASS
  if { [ "$want" = refused ] && [ "$got" -eq 0 ]; } || { [ "$want" = passed ] && [ "$got" -ne 0 ]; }; then
    verdict=FAIL
    status=1
  fi
  echo "$verdict $name: expected $want, exit $got: $(head -1 "$root/out.txt")"
}
py_unlisted() {
  printf 'from PIL import Image\nimport requests\n' > "$1/scripts/fetch-thing.py"
  printf 'pillow==12.3.0 \\\n    --hash=sha256:%s\n' "$hash64" > "$1/scripts/fetch-thing-requirements.txt"
}
py_listed() {
  printf 'from PIL import Image\n' > "$1/scripts/fetch-thing.py"
  printf 'pillow==12.3.0 \\\n    --hash=sha256:%s\n' "$hash64" > "$1/scripts/fetch-thing-requirements.txt"
}
cargo() {
  mkdir -p "$1/crate"
  printf '[package]\nname = "x"\nversion = "0.1.0"\n\n%s\n' "$2" > "$1/crate/Cargo.toml"
}
cargo_table() { cargo "$1" $'[dependencies.serde]\nversion = "1"'; }
cargo_dev_table() { cargo "$1" $'[dev-dependencies.serde]\nversion = "~1.0"'; }
cargo_dotted() { cargo "$1" $'[dependencies]\nserde.version = "1"'; }
cargo_pinned() { cargo "$1" $'[dependencies.serde]\nversion = "=1.0.0"'; }
run_case python-import-not-in-requirements refused py_unlisted
run_case python-import-in-requirements passed py_listed
run_case cargo-dependency-table refused cargo_table
run_case cargo-dev-dependency-table refused cargo_dev_table
run_case cargo-dotted-key refused cargo_dotted
run_case cargo-table-pinned passed cargo_pinned
rm -rf "$base"
exit $status
