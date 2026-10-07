# SSKR Boundary Checks

This AUD-009 harness reviews source files in the current checkout. The audit report records the reviewed commit and dirty-source fingerprint. It uses the public zero-entropy BIP39 phrase, published `vectors/sskr-v1.json`, and a fixed synthetic random seed. It prints no phrase, share, date-shifted backup, or private wallet material.

Run from the MnemoCode repository root with its pinned Node.js and existing dependencies:

```sh
node --import tsx docs/audits/AUD-009-harnesses/sskr-boundaries.mjs
```

The harness checks nested ShareSet ownership, injected JointRepair services, and baseline-date ownership in both backup-check classes. The last check creates and restores a small SSKR share set with the existing integrity-checked WASM and compares the verifier's verdict with actual Seedshift recovery.

Every assertion tests required behavior. A failure prints its check name and makes the process exit nonzero. The reviewed snapshot is expected to pass the first two checks and fail both baseline-date ownership checks. After repair, all four checks should pass and the process should exit zero. This harness performs no build or file export and does not replace generated WASM.
