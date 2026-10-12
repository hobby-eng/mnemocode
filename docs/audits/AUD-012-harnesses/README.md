# AUD-012 remediation review and new-finding probes

These harnesses support the read-only review of the uncommitted AUD-011 refactor on 2026-10-08, based on commit `7dd510b648015a4d553b5be24ab2564f6edbb6b2`. The report identifies the actual dirty source by SHA-256; HEAD alone does not identify these fixes. Only public test data and synthetic scanner files are used. No production source, dependency, workflow or generated WASM is changed by these scripts.

Run from the existing repository root with Node.js 26.10.0, pnpm 12.8.1, installed locked dependencies and Python 3. JSON report validation also needs the already installed `jsonschema` Python module. Historical snapshot validation needs the retained local evidence; reports alone cannot recreate an earlier dirty checkout.

- `audit.py snapshot LABEL` records tracked and untracked non-ignored source hashes outside `docs/audits/`, HEAD and working-tree state. The baseline also retains the tracked diff and procedure hashes locally. Untracked source is identified by its hash rather than copied into another tree.
- `audit.py record NAME COMMAND ...` captures exact arguments, working directory, UTC timestamps, exit status and combined output hash, then propagates the command's exit status. It selects the workspace's `~/.local/bin` tools.
- `audit.py graph` reuses the frozen AUD-011 runtime resolver in memory, redirecting only its evidence paths. It records the adapted stdin SHA-256 and leaves the original harness bytes unchanged. The resolver strips TypeScript types with esbuild before checking relative runtime cycles; it does not execute application modules.
- `detector-probes.mjs` tests the current copy detector with two in-memory synthetic files. Its unchanged matching and exit logic rejects an unmarked 58-token copy, but accepts the same copy with a marker in a string or an invalid threshold. The assertions describe the reviewed defects; after a fix, add positive regression expectations to the detector's normal tests.
- `sskr-boundary-probes.ts` reproduces current/legacy tagged-UR conversion failure, empty joint-plan diagnostics, reading of an excessive list before count refusal, and work beyond a tiny Cartesian cap. The excessive list uses a throwing accessor so no large set is parsed. No candidate search is run.
- `wasm-invalid-encoding.mjs` verifies the seven current bridge pins, freshly initializes that existing WASM, and makes one invalid-format call with a public deterministic fixture. It reports exact raw-share payload occurrences still present in WASM memory. This is a bounded cleanup diagnostic, not a canonical build, cryptographic oracle or external exploit.
- `api-boundary-probes.ts` checks mismatched card label groups/color slots, cross-kind labels, invalid orientation/share format, the POSIX backslash containment edge and the final address default without drawing anything.
- `menu-import-probe.mjs` observes actual QR package initialization in a fresh menu-import process without opening the menu.
- `core-probe-001.mjs` through `core-probe-004.mjs` preserve the scoped reviewer's bounded public-fixture probes: mixed known/guessed recovery, raw conflicting pattern keys, three iterator steps with an empty radix, and mode-specific wallet-call counts/virtual planning. The fourth probe never runs its large plan; its actual tiny searches use a cheap callback and bounded input. Run each separately with `timeout 10s node --max-old-space-size=256 --import tsx FILE` from the repository root. Relative imports are adapted for these saved paths; the report retains exact original stdin/command/output hashes.
- `core-probe-004-initial.mjs` preserves an initially failed hypothesis: eight virtual 1,000-second checks do not cross the 12-hour threshold. It intentionally exits nonzero and is not a regression acceptance test. The corrected fourth probe retains that noncrossing control and demonstrates the 128-call case.
- `export-probe-color-content.mjs` compares actual guard/printed-code projections for malformed and matched label-group counts, including wrong-payload and labels-only transport controls. No PDF is created.
- `export-probe-folder-publication.mjs` uses private synthetic marker files and a process-local `chmod` fault to inspect publication after failure, with success/pre-publication-failure controls. It removes all its own probe files and does not call a renderer.

Capture source and run bounded scanner probes:

```sh
python3 docs/audits/AUD-012-harnesses/audit.py snapshot baseline
python3 docs/audits/AUD-012-harnesses/audit.py graph
python3 docs/audits/AUD-012-harnesses/audit.py record detector-fixtures node docs/audits/AUD-012-harnesses/detector-probes.mjs
python3 docs/audits/AUD-012-harnesses/audit.py record detector-40 node scripts/verify-no-copies.mjs --tokens 40
python3 docs/audits/AUD-012-harnesses/audit.py record sskr-boundary-probes node --import tsx docs/audits/AUD-012-harnesses/sskr-boundary-probes.ts
python3 docs/audits/AUD-012-harnesses/audit.py record wasm-invalid-encoding node --import tsx docs/audits/AUD-012-harnesses/wasm-invalid-encoding.mjs
```

The 40-token diagnostic exits 1 and reports 20 candidate pairs at the reviewed snapshot. It is deliberately below the production gate's 50-token threshold; these pairs are not automatically 20 defects. The probe harness exits 0 when its baseline expectations reproduce, and nonzero when an assertion fails. It evaluates scanner source with synthetic filesystem/process adapters; this is not production execution of the application and does not introduce evaluation into its code.

The exact targeted test commands, failures, scoped reruns and skipped heavy case are retained in the report and local command records. Tests that launch Node subprocesses need an environment that permits them; sandbox `EPERM` failures are preserved separately from the unsandboxed passing reruns. The initial CLI selection inadvertently included the process-protection full-self-test case; it failed without the expected subprocess output and contributes no full-self-test evidence. Its rerun explicitly excludes that case. The full self-test, vector replays, card raster/QR matrices, Docker reproducibility verification, browser suites and executable builds are not acceptance claims of this review.

Finish by capturing the unchanged source and validating the paired reports:

```sh
python3 docs/audits/AUD-012-harnesses/audit.py snapshot review-end
python3 docs/audits/AUD-012-harnesses/validate-report.py
```

Three externally edited encoding files were noticed after the last unchanged baseline snapshot. The report preserves the baseline fingerprint and adds the latest manifest, three changed hashes and dedicated targeted receipts. Earlier broad checks apply to the initial fingerprint; the validator checks the final snapshot against the declared addendum without pretending the earlier tree stayed unchanged. No audit harness edits implementation files.

The validator exits nonzero on duplicate keys, schema/ID/ledger disagreement, missing links, undeclared source changes, inconsistent command/procedure hashes or staged local evidence. On success it writes local validation and checksum records.

Audit-only JavaScript/TypeScript harnesses were formatted after their evidence captures. Original executed harness/input hashes remain in the records; current formatted harness hashes are checked separately. Formatting does not change the source under audit.
