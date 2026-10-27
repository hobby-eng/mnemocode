#!/usr/bin/env bash
# Builds the WebAssembly file of one wallet-tools page from its profile in wasm-profiles.json
# (docs/design/architect/ARCHITECTURE.md section 9, ADR 0007):
#
#   scripts/build-wasm.sh <edition>/<page>
#
# writes dist/wasm/<edition>/<page>/: mnemocode.wasm, its glue mnemocode.js with initSync only
# (scripts/offline-glue.mjs), mnemocode.d.ts, and modules.json with the version, the profile and
# the SHA-256 of each file. Needs wasm-bindgen 0.2.129.
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$repo_root"
if [[ "$#" -ne 1 ]]; then
  echo "usage: scripts/build-wasm.sh <edition>/<page>" >&2
  exit 2
fi
profile="$1"
features="$(node scripts/wasm-profiles.mjs features "$profile")"

expected_bindgen="wasm-bindgen 0.2.129"
actual_bindgen="$(wasm-bindgen --version)"
if [[ "$actual_bindgen" != "$expected_bindgen" ]]; then
  echo "Expected $expected_bindgen, found $actual_bindgen" >&2
  exit 1
fi

# No directory of this computer may end up in the file (scripts/remap-builder-paths.sh).
. scripts/remap-builder-paths.sh
remap_builder_paths "$repo_root"

feature_args=()
if [[ -n "$features" ]]; then
  feature_args=(--features "$features")
fi
cargo rustc --locked --profile wasm -p mnemocode-wasm --lib --target wasm32-unknown-unknown \
  --no-default-features "${feature_args[@]}" --crate-type cdylib

target_dir="$(cargo metadata --locked --no-deps --format-version 1 |
  node -e 'let s = ""; process.stdin.on("data", (d) => (s += d)).on("end", () => console.log(JSON.parse(s).target_directory));')"
out="dist/wasm/$profile"
rm -rf "$out"
mkdir -p "$out"
wasm-bindgen "$target_dir/wasm32-unknown-unknown/wasm/mnemocode_wasm.wasm" \
  --target web \
  --out-dir "$out" \
  --out-name mnemocode
node scripts/offline-glue.mjs "$out" mnemocode
# Nothing loads the file by the name wasm-bindgen gives it; its declarations are wasm-bindgen's
# internals.
mv "$out/mnemocode_bg.wasm" "$out/mnemocode.wasm"
rm "$out/mnemocode_bg.wasm.d.ts"
node scripts/write-modules-manifest.mjs "$out" "$profile"
echo "Built $out"
