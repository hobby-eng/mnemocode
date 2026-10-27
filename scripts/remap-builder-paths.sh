# Sourced, not run, by every build of the executable or a WebAssembly file that a release ships:
# scripts/build-wasm.sh, scripts/build-executables.sh and scripts/build-reproducible.sh. Taken from
# mhfe (packaging/remap-builder-paths.sh), with the repository remapped as `mnemocode`. Its
# callers are bash scripts that stop on their first error; it sets the same options (TOOL-02).
#
# rustc writes the source path of every panic location into a binary or WebAssembly. For the
# crates of the Cargo registry that path lies under CARGO_HOME, so a build would carry the
# builder's account name and directory layout, and a local build would never give the bytes of the
# canonical one. remap_builder_paths makes rustc write these directories under fixed relative
# names instead, the same on every computer and for every target, native programs and the
# WebAssembly alike:
#
#   the repository  ->  mnemocode (the crates' own files are relative already)
#   CARGO_HOME      ->  cargo    (the sources of every dependency: cargo/registry/src/...)
#   RUSTUP_HOME     ->  rustup   (the toolchain, should a path of it appear)
#
# The names are relative, so that no remapped path looks like a directory of some builder; the
# `artifacts` gate refuses a file that names one. rustc names its standard library
# /rustc/<commit>/ itself. Cargo's trim-paths would make such paths relative on its own, but
# Cargo 1.99.1 still refuses it as unstable.

set -euo pipefail

# Adds the remapping for the repository at $1 to CARGO_TARGET_<TRIPLE>_RUSTFLAGS of every release
# target, after the flags already there, such as the MinGW timestamp flag of a Windows build.
# Calling it twice adds nothing, so that a second build sees the same flags and has nothing to redo.
remap_builder_paths() {
  # Cargo takes the first of RUSTFLAGS, CARGO_ENCODED_RUSTFLAGS and the per-target flags that is
  # set, so either of the first two would silently drop the remapping.
  if [ -n "${RUSTFLAGS:-}" ] || [ -n "${CARGO_ENCODED_RUSTFLAGS:-}" ]; then
    echo "RUSTFLAGS or CARGO_ENCODED_RUSTFLAGS is set and would replace the remapping of the" \
      "builder's directories; unset it for a release build." >&2
    return 1
  fi
  local cargo_home="${CARGO_HOME:-${HOME%/}/.cargo}"
  local rustup_home="${RUSTUP_HOME:-${HOME%/}/.rustup}"
  local flags="" remapping triple variable current
  # rustc applies the last prefix that matches, so the repository comes first: a CARGO_HOME inside
  # it is still remapped as CARGO_HOME.
  for remapping in "${1%/}=mnemocode" "${cargo_home%/}=cargo" "${rustup_home%/}=rustup"; do
    # Cargo splits per-target rustflags at whitespace.
    case "$remapping" in
      *" "* | *"	"*)
        echo "Cannot remap a directory whose name has a space: $remapping" >&2
        return 1
        ;;
    esac
    flags="${flags:+$flags }--remap-path-prefix=$remapping"
  done
  # The release targets whose rustflags get the remapping, the computer's own target among them
  # for a build without --target.
  for triple in x86_64-unknown-linux-gnu aarch64-unknown-linux-gnu x86_64-pc-windows-gnu \
    x86_64-apple-darwin aarch64-apple-darwin wasm32-unknown-unknown; do
    variable="CARGO_TARGET_$(printf '%s' "$triple" | tr 'a-z-' 'A-Z_')_RUSTFLAGS"
    eval "current=\${$variable:-}"
    case " $current " in
      *" $flags "*) ;;
      *) eval "export $variable=\"\${current:+\$current }\$flags\"" ;;
    esac
  done
}
