# AUD-008 reproduction harness

These bounded checks belong to the MnemoCode pre-release review dated 2026-11-17.
They call the real library APIs without modifying production code or existing tests.
Inputs are public zero/counting entropy, fixed dates and deterministic SSKR test randomness.
The fixed random sources are test fixtures, not generators for real backups.

The reviewed HEAD is `19addd5583bb011dd34be53a7ce9b5253c346b04`, with uncommitted
changes. The closing production-diff SHA-256 is
`d00815cf93983bf54d99af567e6f010af114a7d6b838173fd9f3dad760329e14`.
See the [report](../AUD-008-2026-11-17.md) for source manifests and intermediate
snapshots: HEAD alone does not reproduce the audited state.

## Run the small API checks

Use Rust 1.99.1 and the repository's configured toolchain. From the repository root:

```sh
CARGO_TARGET_DIR=target/aud008-probes cargo test --locked \
  --manifest-path docs/audits/AUD-008-harnesses/Cargo.toml --lib -- --nocapture
```

The reviewed source produced **3 passing and 9 failing tests**, exit **101**.
The passing encoding test contains 65 combinations of phrase length, form and mode.
The other passing controls check printed metadata merging/conflicts and enumerate
wrong dates for one fixed legacy backup. The latter is a counterexample to a
documentation claim, not an estimate for the population of backups.

| Test assertion | Finding |
| --- | --- |
| Distinct SSKR groups keep their same-numbered members | AUD-008-FUN002 |
| An incomplete surplus share leaves a valid quorum usable | AUD-008-FUN003 |
| A wrong candidate hint does not abort later candidates | AUD-008-FUN006 |
| A legacy backup prefix survives a decoy suffix | AUD-008-FUN005: withdrawn as a defect; the assertion is stronger than the documented helper contract |
| Returned legacy mode retains the recovery word | AUD-008-API001 |
| Serialized backup agrees with its own mode | AUD-008-API002 |
| Admitted PNG Debug omits the complete image | AUD-008-SEC003 |
| Discovered filename display omits terminal escapes | AUD-008-SEC002 |
| MNC1 record classification uses its payload | AUD-008-API005 |

Eight failures support current findings. The ninth, FUN005, is retained as evidence
of an overstrong audit assertion: the helper documents propagated refusals, and
the documented CLI recovery with `--words 12` succeeds. Do not count this failure
as a confirmed product defect.

The filename test checks the collector's display string, not a real terminal emulator.
The full terminal-routing proof and static renderer trace are described in the report.
The group and surplus-share tests have successful core-restoration controls.

No PDF/template batch is generated. The QR Debug probe produces one small PNG in
memory. Library tests themselves took 0.03 seconds after compilation; compilation
and thermal pauses are separate costs. Apply the workspace machine-wide resource
policy. Do not include ignored whole-project rendering matrices merely to rerun
these checks.

## Validate the report

The validator rejects duplicate JSON keys recursively, validates every keyword used
by the retained canonical JSON schema, checks finding IDs against Markdown and
checks evidence-source paths. It refuses unsupported schema keywords rather than
silently ignoring them. It also checks for accidental machine paths/private
attribution. This is a validator for this schema vocabulary, not a general JSON
Schema implementation.

The schema lives in the sibling wallet-tools checkout; its exact hash is in the
report. Run from this repository root:

```sh
CARGO_TARGET_DIR=target/aud008-probes cargo run --locked \
  --manifest-path docs/audits/AUD-008-harnesses/Cargo.toml --bin validate -- \
  ../multi-chain-wallet-tools/docs/audit-report.schema.json \
  docs/audits/AUD-008-2026-11-17.json docs/audits/AUD-008-2026-11-17.md
```

Expected success is exit 0 and a single summary line. A missing schema, duplicate
key, invalid report field, mismatched ID or missing evidence-source file exits
nonzero. Its duplicate-key control is:

```sh
CARGO_TARGET_DIR=target/aud008-probes cargo test --locked \
  --manifest-path docs/audits/AUD-008-harnesses/Cargo.toml --bin validate
```

Formatting and lint checks:

```sh
cargo fmt --manifest-path docs/audits/AUD-008-harnesses/Cargo.toml -- --check
CARGO_TARGET_DIR=target/aud008-probes cargo clippy --locked \
  --manifest-path docs/audits/AUD-008-harnesses/Cargo.toml --all-targets -- -D warnings
```

The deliberately failing regression assertions remain separate from validation
and lint success. Do not change them to expect the defects just to make the suite
green.

