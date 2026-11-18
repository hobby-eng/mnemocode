# AUD-009 follow-up harnesses

These checks verify remediation of [AUD-008](../AUD-008-2026-11-17.md) and exercise nearby cases on the working tree based on `19addd5583bb011dd34be53a7ce9b5253c346b04`. The reviewed production diff SHA-256 is `89b75c357410f75d67b489946b70ccdc12a9d7dd44355753390adb9d12e5804c`. The audit report records the additional new-file hashes.

The inputs are all synthetic: zero entropy, one small entropy variation, public dates, fixed test randomness, and a public BIP39 phrase. Fixed randomness is confined to the tests. The collector tests construct metadata; the card test draws two small vector scenes and round-trips their XMP. They do not produce PDFs, PNGs or a template matrix.

Run from the repository root with the workspace Rust toolchain:

```sh
CARGO_TARGET_DIR=target/aud008-probes cargo test --offline --manifest-path docs/audits/AUD-009-harnesses/Cargo.toml --lib -- --nocapture
```

The first offline invocation created the retained lockfile from the existing dependency cache. Subsequent invocations can add `--locked`. A failing assertion exits nonzero. On the reviewed source, seven tests ran: two passed and five failed (exit 101). The two Debug assertions expose one residual finding; the two collector assertions and the repeated-export assertion expose three additional findings. The candidate-search regression and the five-length hint reconstruction test pass. The hint test performs 15 exact reconstructions across three producer paths. No PDF or raster output is generated.

The first card probe stopped at an audit-owned formatting expectation: Colors metadata includes `#`. After correcting that positive control, the repeated-export probe reached the actual conflict assertion. Both execution records are retained locally; their failures must not be added together.

The candidate regression retains the original AUD-008 fixture but allows the search to report `Running` before `Done`. It tests both candidate orders and exact recovered phrase equality. The original AUD-008 harness remains unchanged: its requirement that two candidates finish in one `step(2)` call is too strong.

The report validator checks the canonical schema subset, rejects unknown schema keywords and duplicate JSON keys, matches finding IDs with Markdown, and checks source references and privacy. It reuses the frozen duplicate-key reader from AUD-008:

```sh
CARGO_TARGET_DIR=target/aud008-probes cargo run --offline --manifest-path docs/audits/AUD-009-harnesses/Cargo.toml --bin validate -- ../multi-chain-wallet-tools/docs/audit-report.schema.json docs/audits/AUD-009-2026-11-17.json docs/audits/AUD-009-2026-11-17.md
```

Successful validation exits zero. It validates the report structure; it does not certify the implementation or replace the recorded regression checks.

