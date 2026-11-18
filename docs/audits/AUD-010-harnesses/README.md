# AUD-010 verification probes

These probes verify MnemoCode's uncommitted remediation on base
`19addd5583bb011dd34be53a7ce9b5253c346b04`. The [report](../AUD-010-2026-11-18.md)
records the full source identity; HEAD alone is insufficient to reproduce it.
All inputs are public: the BIP39 all-zero entropy phrase and fixed test randomness.
No PDF matrix, full self-test or cloud operation is used.

Run from the repository root with its Rust 1.99.1 toolchain. Apply the workspace
memory and thermal budget. The commands below omit machine-specific toolchain paths.

## Original and current regressions

```sh
CARGO_TARGET_DIR=target/aud008-probes cargo test --locked --offline \
  --manifest-path docs/audits/AUD-009-harnesses/Cargo.toml --lib -- --nocapture
cargo test --locked --offline -p mnemocode --test ts_recovery_shares -- --nocapture
cargo test --locked --offline -p mnemocode-cards --test sets \
  one_export_shares_its_document_id_and_another_has_its_own -- --exact --nocapture
cargo test --locked --offline -p mnemocode-cli --test menu_guides \
  the_places_ticked_for_saving_stay_ticked_when_coming_back -- --exact --nocapture
```

Expected on the reviewed tree: 7, 7, 1 and 1 passing tests respectively, exit 0.
These include overlapping behaviors and are not unique coverage totals.

## Residual Unicode defect

```sh
CARGO_TARGET_DIR=target/aud008-probes cargo test --locked --offline \
  --manifest-path docs/audits/AUD-010-harnesses/Cargo.toml --lib -- --nocapture
```

On the reviewed tree the Colors control passes and Unicode fails with
`Different(13)`: one passed, one failed, exit 101. Each tiny scene's XMP is read
and compared with its complete expected text before the exports are combined.
No PDF or raster file is rendered. Keep the failing assertion as the desired
behavior; do not change it to accept the defect.

## Navigation

The native CLI must be built from the intended tree first. The original current
menu test above builds it. The audit records its SHA-256.

```sh
AUD010_CLI="$PWD/target/debug/mnemocode" \
CARGO_TARGET_DIR=target/aud008-probes \
timeout --signal=TERM --kill-after=5s 90s cargo test --locked --offline \
  --manifest-path docs/audits/AUD-010-harnesses/Cargo.toml --test navigation \
  -- --nocapture --test-threads=1
```

Expected: two tests pass, exit 0. They reuse the current native PTY helper,
create one small QR PNG in Cargo's test temporary directory, and run three child
sessions. One test selects Original Seedshift, goes back and presses Enter alone.
The other tests both cancellation and explicit consent when a folder contains
exactly one file of a different kind than requested. It checks exact recovery
after consent and no revealed phrase after cancellation. The 90-second outer
deadline bounds the helper's longer waits; use the process-scope wrapper from the
workspace policy so a timed-out job also cleans up its PTY children.

## Harness and report validation

```sh
cargo fmt --manifest-path docs/audits/AUD-010-harnesses/Cargo.toml -- --check
CARGO_TARGET_DIR=target/aud008-probes cargo clippy --locked --offline \
  --manifest-path docs/audits/AUD-010-harnesses/Cargo.toml --all-targets -- -D warnings
CARGO_TARGET_DIR=target/aud008-probes cargo run --locked --offline \
  --manifest-path docs/audits/AUD-010-harnesses/Cargo.toml --bin validate -- \
  ../multi-chain-wallet-tools/docs/audit-report.schema.json \
  docs/audits/AUD-010-2026-11-18.json docs/audits/AUD-010-2026-11-18.md
```

The validator reuses the frozen duplicate-key reader from AUD-008. It validates
the canonical schema vocabulary, IDs, references and accidental private paths;
it does not validate implementation correctness. Unknown schema keywords fail
closed. Residual old findings keep their original IDs and are recorded separately
from new AUD-010 findings. Expected validation and lint exit status is 0.

Local command logs and metadata live in the ignored `AUD-010-evidence` directory.
Initial probe compilation/lint mistakes are retained there separately from product
test results. No historical harness has been edited.
