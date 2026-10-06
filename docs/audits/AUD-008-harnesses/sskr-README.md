# AUD-008 SSKR probes

These probes belong to AUD-008 and reviewed commit `2d80c86c050c7e3b7de395b9f96548867c9cd44c`.
They use only published Blockchain Commons shares and deterministic public data from
`vectors/sskr-v1.json`. They require the repository's installed dependencies, Node.js 26.10.0
through `~/.local/bin`, and fresh `dist` produced by `pnpm build`. Do not rebuild Rust or WASM to
run them. The production loader verifies committed WASM integrity.

From the repository root, run:

```sh
node docs/audits/AUD-008-harnesses/sskr-coverage.mjs
node docs/audits/AUD-008-harnesses/sskr-defects.mjs
```

`sskr-coverage.mjs` checks literal official transport bytes and custom representation oracle
values, all 30 minimum official grouped quorums, all 15 pairs in five deterministic width
fixtures, all six formats and their one-token repairs, input bounds, production random splitting,
16-of-16 threshold behavior, mixed-form joint repair and duplicate damaged copies, single-share
ambiguity refusal, all 65,536 GF(256) multiplication results and published group digest checks.
It prints nine logical check records and exits 0 only when all pass. These logical groups are not
an additive total of the repository's tests.

`sskr-defects.mjs` expects an inconsistent surplus member to be refused and accepted compatibility
layouts to remain repairable. At the reviewed baseline it prints five failed check records and
exits 1: one surplus integrity failure, three marked legacy-layout failures, and the intact legacy
member mixed with another marked member. Failures are expected audit evidence, not passing
production acceptance. The script records intact acceptance and actual errors before each failure.

The coordinator's command recorder retains local logs and command metadata:

```sh
python3 docs/audits/AUD-008-harnesses/record-command.py --label sskr-coverage --timeout 90 -- node docs/audits/AUD-008-harnesses/sskr-coverage.mjs
python3 docs/audits/AUD-008-harnesses/record-command.py --label sskr-defects --timeout 90 -- node docs/audits/AUD-008-harnesses/sskr-defects.mjs
python3 docs/audits/AUD-008-harnesses/record-command.py --label sskr-review-record --timeout 90 -- node docs/audits/AUD-008-harnesses/sskr-record-review.mjs
```

Labels are unique: use a new label when rerunning, so original failures stay available. The third
command writes the review handoff and byte manifests into ignored `AUD-008-evidence/`, after the
first two recorded commands exist. It prints their summary and hashes, and exits 0 on successful
record creation. It is an audit record writer, not a production test.

The assigned review covers CHECK-FUN-006 and CHECK-API-004 for SSKR, plus only the SSKR portions
of CHECK-SEC-004, CHECK-SEC-005 and CHECK-SEC-007. Runtime source hashes identify the actual
bytes inspected. The review does not establish memory erasure, malicious-host protection or
independent certification of the underlying sharing algorithm.
