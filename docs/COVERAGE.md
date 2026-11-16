# Test coverage

The Linux x86-64 run on 2026-11-16 covered **81.07%** of the measured source lines of MnemoCode's
own crates (40,867 of 50,408). Every test passed: 682 in the workspace run, with 14 marked ignored,
and 14 in the WebAssembly binding's run with all its modules.

## Measurement

Rust 1.99.1 and cargo-llvm-cov 0.9.1 measured commit `74b03e9501b7f1d0ba40bb6bc193aeccc23e0109`
(tree `9f56989a33db264843648d4e5a3ed092536b8aca`) with the tests of `cargo xtask check`:
`cargo test --locked --workspace --no-fail-fast`, then
`cargo test --locked -p mnemocode-wasm --all-features --no-fail-fast`.

Each process writes its own profile while it runs, since the command-line program closes its own
file access once its protections are on. Of the 415 profiles, two of 512 bytes had no complete
header, from processes that ended before it was written; they were left out of the merge, and their
counters are missing.

| Crate                  | Files | Covered lines | Measured lines | Coverage |
| ---------------------- | ----: | ------------: | -------------: | -------: |
| `mnemocode`            |   107 |        19,433 |         21,148 |   91.89% |
| `mnemocode-cards`      |    23 |         5,677 |          5,965 |   95.17% |
| `mnemocode-embroidery` |    15 |         3,377 |          3,633 |   92.95% |
| `mnemocode-cli`        |    66 |        11,534 |         16,217 |   71.12% |
| `mnemocode-wasm`       |    16 |           846 |          3,445 |   24.56% |
| Total                  |   227 |        40,867 |         50,408 |   81.07% |

## Scope and exclusions

The percentage counts the lines of `crates/*/src` compiled for Linux x86-64. Test files are outside
it, and so are the vendored SSKR engine (`vendor/`), `shims/` and the maintainer tasks (`xtask/`).
Code for macOS and Windows is not compiled into this measurement; CI runs the workspace's tests on
both systems without measuring them.

The WebAssembly binding's figure is low because a native test cannot cross into JavaScript: most of
its entries run only in the browser, under `cargo xtask wasm verify`, which this measurement does
not count.

## Reproduce on Linux

From the repository root, in bash, with the pinned toolchain:

```sh
export CARGO_TARGET_DIR="$PWD/target/coverage"
source <(cargo llvm-cov show-env --sh)
export RUSTFLAGS="-C llvm-args=-runtime-counter-relocation"
export LLVM_PROFILE_FILE="$CARGO_TARGET_DIR/mnemocode-%p%c.profraw"
cargo llvm-cov clean --workspace
cargo test --locked --workspace --no-fail-fast
cargo test --locked -p mnemocode-wasm --all-features --no-fail-fast
cargo llvm-cov report --ignore-filename-regex '(^|/)(vendor|shims|xtask)/' --summary-only
```

`%p` gives each process its own profile and `%c` writes it as the process runs. If the report stops
on a profile whose header is corrupt, move that file out of `target/coverage` and run the report
again.
