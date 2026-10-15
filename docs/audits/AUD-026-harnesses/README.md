# AUD-026 full audit harnesses

These harnesses belong to the all-files MnemoCode audit of commit `f2d4cffa5d7df369910243734f287ce6521ed033`, including any current working-tree changes captured by the audit snapshot. Use the pinned workspace toolchains and public/synthetic data only. Reports and command timestamps use UTC (+00:00).

From the repository root, use a fresh label for each command:

```sh
python3 -B docs/audits/AUD-026-harnesses/audit.py check-core node node_modules/vitest/vitest.mjs run test/core.test.ts --pool=threads --maxWorkers=1 --no-file-parallelism --reporter=dot
```

The recorder writes only ignored local files under `docs/audits/AUD-026-evidence/`. It records exact commands, source SHA-256 fingerprints before and after, log hashes, UTC times, exit codes and sampled process/host memory. It preserves a 3 GiB host-memory reserve, uses a 256 MiB Node heap and a sampled 1 GiB descendant RSS budget by default, and stops its owned processes on memory exhaustion or its 300-second deadline. These sampled checks do not enforce a kernel memory limit or control unrelated applications.

Profiles can be selected with `AUD026_HEAP_MIB` (128–768), `AUD026_RSS_MIB` (256–2048), and `AUD026_TIMEOUT_SECONDS` (1–600). Increasing a profile does not authorize full gallery/PDF generation or full-cost vector replays. Expected command results are recorded in the final report; failing, interrupted and excluded checks stay distinct. No harness edits source, weakens a test or publishes a release.

The Python recorder is an independent outside-Node watchdog using the standard library. It can retain evidence when the Node process exhausts its own heap. Its timestamp, command and source records are separate from assertions about a product contract.

## Inputs and inventories

Run `pnpm build` before the compiled-module probes. The fixed public SSKR cases come from `src/sskr/known-answers.ts`; fonts come from the retained `assets/fonts/DejaVuSans-UI.ttf`. Profile fixtures are synthetic. No personal seed phrase, passphrase or share is accepted. Tiny opaque byte documents used to test publication are not valid PDFs and are never rendered.

`surface-inventory.mjs` reads the local `file-inventory.json`. `serial-tests.py` reads `test-execution-plan.json`. The report JSON carries its complete per-file inventory; recreate a rerun plan explicitly from the stated admitted/excluded files rather than silently admitting the gallery. Both inputs live in the ignored evidence folder. AST inventory and mutation admission use the already available TypeScript 5.9.3 API in the workspace scratch `tmp/cancel-check`; the project's native TypeScript 7 compiler has no corresponding JavaScript API. No dependency installation is performed by a harness.

## Exact bounded probes

From the repository root, use the following commands behind `audit.py` with fresh labels:

```sh
node docs/audits/AUD-026-harnesses/contracts.mjs
node docs/audits/AUD-026-harnesses/interfaces.mjs
node node_modules/vitest/vitest.mjs run --config docs/audits/AUD-026-harnesses/runtime.config.mjs --pool=threads --maxWorkers=1 --no-file-parallelism --reporter=verbose
node docs/audits/AUD-026-harnesses/build-cleanup.mjs
node docs/audits/AUD-026-harnesses/mutation-needles.mjs
python3 -B docs/audits/AUD-026-harnesses/step-screen.py
```

- `contracts.mjs`: selector privacy, location snapshot, own-kind membership, Dash hint, disposed lists, font cmap, document failure ownership, confined names, null form, labels, fresh WASM pattern counts and final callback cancellation. Baseline: 33 cases, 27 failed contract assertions, exit 1. Pattern counts never dump memory.
- `interfaces.mjs`: published platform refusal codes, valid split, effective help-example mode, exclusive table selectors and all 59 export targets. Baseline: 7 cases, 3 failed assertions, exit 1.
- `runtime.probe.ts`: actual CLI refusal plus source Encode/publication, replacing only terminal services, opaque primary output, synthetic ENOSPC and a post-check mkdir seam. Baseline: 3 failures and 2 controls passing, exit 1. The explicit audit configuration keeps this probe out of the normal test suite. It creates only isolated public scratch files.
- `build-cleanup.mjs`: actual `--check` wrapper with a synthetic `docker` adapter first on its private PATH. It performs no Docker build, changes no generated file, and must still refuse mismatches. Baseline: wrapper exit 1 and one leftover temporary directory, so the cleanup assertion exits 1.
- `mutation-needles.mjs`: read-only admission of both actual self-test mutation inventories, not a mutation execution. Baseline: all 18 `DAMAGED_ANSWERS` needles exist; 6 of 10 `LOST_REFUSALS` needles are absent; exit 1. No installed-tree copy, source alteration or PDF work occurs.
- `step-screen.py`: one real Linux PTY question transition, then Ctrl+C before any export. Baseline: no fresh step clearing, cancellation exit 130; assertion exit 1.

The availability case is intentionally opt-in and must not be repeated merely to obtain another failure count:

```sh
AUD026_TIMEOUT_SECONDS=25 AUD026_HEAP_MIB=128 AUD026_RSS_MIB=768 python3 -B docs/audits/AUD-026-harnesses/audit.py broad-once node docs/audits/AUD-026-harnesses/contracts.mjs broad-color-digits
python3 -B docs/audits/AUD-026-harnesses/audit.py narrow-control node docs/audits/AUD-026-harnesses/contracts.mjs narrow-color-digits
```

The broad case terminates at the explicit 128 MiB V8 heap before a plan is returned; the narrow case returns `determined` and exits 0. This does not establish default-host exhaustion. `serial-tests.py` and `followup-checks.mjs` run their admitted tests in separate guarded processes, stop at a resource boundary, and retain genuine assertion failures. The former baseline exits 1 for nine production failures; the latter exits 0 with 128 passing cases and seven selected-out cases. Neither runs the complete gallery.

## Report validation

```sh
node docs/audits/AUD-026-harnesses/validate-report.mjs docs/audits/AUD-026-2026-10-14.json
```

This checks duplicate keys, every applicable keyword of the pinned canonical envelope, record IDs, 32 procedure checks, the 882-file ledger, unchanged non-audit fingerprint, each command-log hash, UTC/privacy, published links and unstaged evidence. It writes local `report-validation.json` and exits 0 on success. It verifies the record, not that all product tests pass or that every possible defect was found. The original historical evidence is never rewritten by validation.

## Remediation follow-up

The baseline above remains frozen. Its default contract script now stops at the correctly refused explicit `null` share format, and its runtime race injection targets the former single-directory rename boundary. Do not change these historical scripts to obtain green counts. The 47 normal regression tests in `test/aud-026-{core,sskr,export,cli}.test.ts` cover the corrected contracts, including directory creation during staging before the new exclusive reservation.

Run those four files with one worker and no file parallelism. `contracts.mjs broad-color-digits` now returns a determined plan within the original 128 MiB heap instead of exhausting it; the narrow control remains determined. `interfaces.mjs`, `step-screen.py`, and the synthetic `build-cleanup.mjs` can be run unchanged.

`legacy-valid-oracles.py` generates five independent answers from zero entropy, SHA-256 and integer packing after reproducing the published Original Seedshift vector. Obtain a JSON array from the pinned `@scure/bip39/wordlists/english.js` English wordlist and run:

```sh
python3 -B docs/audits/AUD-026-harnesses/legacy-valid-oracles.py ../tmp/mnemocode-aud-026-remediation/english-words.json
```

It prints one published control count and the source/stored public phrases plus candidate counts for 12, 15, 18, 21 and 24 words. A failed control exits nonzero. The fixed startup literals are in `core/representations-self-test.ts`; no product encoder is imported by this oracle.

`validate-report.mjs` verifies the original baseline only. After remediation, use:

```sh
node docs/audits/AUD-026-harnesses/validate-remediation.mjs
```

The new validator imports the schema and duplicate-key functions from the unchanged baseline validator, retains its SHA-256, and checks the original baseline fields against the local `AUD-026-evidence/baseline-report.json`, saved before status updates. It permits only finding-status changes there, validates the appended 22 fix mappings, current 533-file non-audit source manifest, each baseline/remediation log hash, UTC/privacy, published report links and unstaged evidence. It writes local `remediation-report-validation.json`. The manifest count is specific to the remediation snapshot, not a new whole-repository coverage claim; source changes require an explicit follow-up snapshot.

PDF galleries, full-cost vector replays and release/browser acceptance remain excluded. The remediations were implemented and checked by the owning session without subagents. Logs from a failed Codex subprocess-output environment stay retained separately from passing unrestricted scoped reruns.

`font-check.py` needs fontTools from the hash-pinned `scripts/build-ui-font-requirements.txt` and the installed upstream font/license matching `build-ui-font.py`'s source hashes. Run it from the root with that environment's Python. It invokes the actual font builder, requires unchanged output SHA-256, and compares the outlines and horizontal metrics of every baseline-mapped codepoint against the audited commit's single font blob through `git show`. It creates no repository copy and renders no PDF. Expected: 389 retained codepoints match, 632 added, 119804 bytes; exit zero. Missing source/fontTools or a mismatch fails. This is a deterministic asset rebuild, not a read-only runtime probe.

`host-parity.py` independently reads the finished wallet-tools AUD-032 matrix and manifests in the sibling checkout. It compares all 188 imported portable/license/asset files with this checkout, all ten bridge pins with its generated files, each operation's controller/owner/regression hash, all four artifact hashes and the eight retained successful command/source records. Inputs: `multi-chain-wallet-tools/docs/audits/AUD-032-evidence/parity-complete.json`, its named manifests/commands/artifacts, and this audit's local frozen source manifest. Run from the MnemoCode root using `python3 -B docs/audits/AUD-026-harnesses/host-parity.py`; no sibling file is modified. It exits nonzero for a mismatch. Expected counts are 188/10/59/38, no confirmed missing full-edition operation. This verifies byte bindings and reads scoped host evidence; it does not run browsers, repeat the host tests, or assert complete runtime acceptance. The two initial scratch-harness mistakes remain in local evidence.
