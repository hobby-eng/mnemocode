#!/usr/bin/env bash
# The fast gates of CORE-43 (docs/design/architect/GATES.md, "check"): run before every commit,
# and by CI on every push. The release gates (features, artifacts, reproducible, executable) come
# with the release tooling of increment 11, the pty gate with the terminal of increment 2.
#
# Needs the pinned Rust toolchain with its targets (rust-toolchain.toml), wasm-bindgen 0.2.129,
# Node.js with the tooling package installed (pnpm install --frozen-lockfile), and Python 3.
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$repo_root"

# The sources of every target, for the notices and for --offline below (a no-op when present).
cargo fetch --locked

# clippy, with a list of disallowed items that must all resolve: clippy only warns of a path it
# cannot find, which -D warnings does not refuse, and the ban would be gone (clippy.toml).
clippy() {
  local log
  log="$(mktemp "${TMPDIR:-/tmp}/mnemocode-clippy.XXXXXX")"
  if ! cargo clippy --locked "$@" -- -D warnings 2>&1 | tee "$log"; then
    rm -f "$log"
    return 1
  fi
  if grep -q "does not refer to a" "$log"; then
    echo "clippy.toml names a path that does not resolve; fix it, or mark a platform-only one allow-invalid." >&2
    rm -f "$log"
    return 1
  fi
  rm -f "$log"
}

# rustfmt; clippy for every crate and target on this system, for the release targets of the other
# systems, whose own code compiles only there (RUST-02), and for the binding's wasm32 build with
# every module and each alone (CORE-04, RUST-15); doc.
cargo fmt --all --check
clippy --workspace --all-targets
clippy --workspace --all-targets --target x86_64-pc-windows-gnu
clippy --workspace --all-targets --target aarch64-apple-darwin
clippy -p mnemocode-wasm --lib --target wasm32-unknown-unknown --all-features
# Each list is read into a variable first, so that a failing list command stops the script.
modules="$(node scripts/wasm-profiles.mjs modules)"
while IFS= read -r module; do
  [[ -n "$module" ]] || continue
  clippy -p mnemocode-wasm --lib --target wasm32-unknown-unknown --no-default-features \
    --features "$module"
done <<< "$modules"
RUSTDOCFLAGS="-D warnings" cargo doc --locked --no-deps

# tests: unit tests, the vendored crates' tests, published vectors, the fast TS 0.1.0 replay.
cargo test --locked --workspace

# code-rules, copies, prettier, markdown, notices.
node scripts/verify-code-rules.mjs --self-test
node scripts/verify-code-rules.mjs
node scripts/verify-no-copies.mjs --self-test
node scripts/verify-no-copies.mjs
pnpm run format:check
node scripts/verify-markdown.mjs
node scripts/third-party-notices.mjs --check

# action-pins: the workspace's checker reads the pin table of its coding guide, so it runs where
# this repository sits in the workspace, on the owner's computer; CI has no workspace beside it.
if [[ -f ../.github/scripts/verify-action-pins.mjs ]]; then
  node ../.github/scripts/verify-action-pins.mjs "$repo_root"
else
  echo "action-pins: the workspace's checker is not beside this repository; not run here."
fi

# wasm: every page's file built and checked.
profiles="$(node scripts/wasm-profiles.mjs list)"
while IFS= read -r profile; do
  [[ -n "$profile" ]] || continue
  scripts/build-wasm.sh "$profile"
done <<< "$profiles"
node scripts/verify-wasm.mjs

echo "All checks passed."
