# AUD-010 audit harnesses

These scripts belong to the AUD-010 audit of MnemoCode, completed on 2026-10-07. The reviewed source is HEAD `5c658b85a08eb5f03e90a37a67a419775ec07483` with an uncommitted 6-file change: unused imports removed, and `noUnusedLocals` and `noUnusedParameters` in `tsconfig.json`. Its source fingerprint is `f0508715c10bb35c8d80e2ade8f5288c17c73a30dd6dc85b283c584332dbb789` (`snapshot.mjs`). The remediation was checked on the fixed tree with the same scripts; [the report](../AUD-010-2026-10-07.md) names the fix and verification commits.

They use public test data only:

- The phrases "abandon … about" and "abandon … art", the all-zero and counting entropy of each length, and synthetic dates.
- The Trezor BIP39 vectors and the published BIP44/49/84/86, EIP-55 and SLIP-44 address vectors.
- The published SSKR vectors in `vectors/sskr-v1.json`.

No real wallet material is needed.

## Inputs

- Run every command from the repository root, with the pinned Node.js 26.10.0 and the installed dependencies (`pnpm install --frozen-lockfile`).
- Scripts named `build-*` that read `dist/` need `pnpm build` first. `artifact-consistency.mjs` also needs `release/mnemocode-0.1.0-linux-x64` (`pnpm build:executable`) and the fresh compilation shown below.
- `shares-render-qr.ts` and the card checks use Poppler's `pdftoppm` and `pdftotext`.
- The `cli-pty-*` and `cli-color.py` scripts need Python 3 with its `pty` module, which means Linux or macOS.

## Running them

`run-command.mjs LABEL COMMAND ARGS...` runs one command and records it in the ignored, local folder `docs/audits/AUD-010-evidence/`: `LABEL.log` holds the output, and `LABEL.command.json` the exact command, the UTC start and end, the exit code and the SHA-256 of the log. It ends with the command's own exit code. For example:

```sh
node docs/audits/AUD-010-harnesses/snapshot.mjs baseline
node docs/audits/AUD-010-harnesses/run-command.mjs core-date-dedupe node --import tsx docs/audits/AUD-010-harnesses/core-date-dedupe.ts
pnpm exec tsc -p tsconfig.json --outDir docs/audits/AUD-010-evidence/compiled
node docs/audits/AUD-010-harnesses/artifact-consistency.mjs
python3 docs/audits/AUD-010-harnesses/validate-report.py
```

Run TypeScript probes with `node --import tsx FILE`. Run the `*.probe.ts` files with `pnpm exec vitest run --config docs/audits/AUD-010-harnesses/shares-vitest.config.mts FILE`.

Every probe prints what it checks and the values it compares, and exits non-zero when any check fails. The report's tables give each probe's exit code at the reviewed snapshot and after the remediation. A probe that showed a finding exits 1 at the reviewed snapshot and 0 on the fixed tree.

## Tools

- `snapshot.mjs LABEL`: the SHA-256 of every tracked and untracked non-ignored file outside `docs/audits/`, the fingerprint of that list, `git status`, HEAD and the hash of the uncommitted diff, written to `LABEL-snapshot.json`.
- `artifact-consistency.mjs`: compares the fresh compilation with `dist/` file by file, checks the SSKR integrity pins and that every package export resolves, and prints the executable's hash.
- `validate-report.py`: validates the report pair against the common schema with duplicate keys refused, checks the 32-item ledger, the finding IDs and the procedure hashes, checks that the baseline and review-end snapshots agree, and checks every command record's log hash. It writes `report-validation.json` and `SHA256SUMS`. It needs Python's `jsonschema`.

## Probes by area

Core: recovery, Seedshift and dates. `core-oracle.ts` is a shared independent oracle that packs the bits itself and uses `@scure/bip39` and `@noble/hashes` only.

- `core-date-dedupe.ts`: date recovery over every mode and length at the most dates, with `?` in the day, month and year. It checks that no phrase is yielded twice (AUD-010-FUN001) and that the search yields the same distinct phrases as the oracle. It takes about 2 minutes.
- `core-date-set-limit.ts`: the memory that a date search keeps for each combination (AUD-010-FUN002). It takes about 40 s.
  - With `--to-failure` it runs the search past 2^24 combinations: about 45 minutes and 1.3 GiB at the reviewed snapshot. Run that only in a memory-capped unit, such as `systemd-run --user --wait --pipe -p MemoryMax=3000M -p MemorySwapMax=0 ...`.
- `core-date-pace.ts`: the time estimate of a date search against its real run time, in each mode and length (AUD-010-UI005).
- `core-last-words.ts`, `core-representations.ts`, `core-seedshift.ts`, `core-missing-codes.ts` (about 2.5 minutes), `core-bounds.ts`, `core-encryption.ts`, `core-backup-reading.ts`, `core-white-space.ts`: the core checks against the oracle and published vectors, with their limits and refusals.
- `core-aud009-regressions.ts`: the AUD-009 fixes.

Coins. `coins-oracle.ts` derives addresses with `node:crypto`, using `@noble/hashes` only for Keccak, after it reproduces the published vectors.

- `coins-addresses.ts`, `coins-parsing.ts`, `coins-scan.ts`, `coins-fingerprint.ts`: every coin's addresses and their parsing, the scan with `--scan-gap`, the wiping of keys, and the master fingerprint.
- `coins-refusal-reason.ts`: every valid address given as each other coin must be refused as another coin's (AUD-010-API003).
- `coins-dash-composition.mjs`: bundles what the Deriver's Dash edition imports and looks for other coins' code and words (AUD-010-BLD007).
- `coins-selftest-mutation.ts`: changes one expected value in a copy of each family self-test, which must then fail.
- `coins-cli.mjs` and `coins-cli-messages.mjs`: real CLI runs, and the refusals they print (AUD-010-UI002).

Shares and cards. `shares-oracle.ts` writes shares in every form itself, from `docs/SSKR.md`, and `shares-oracle-check.ts` checks it against the published values.

- `shares-card-content.probe.ts`: the codes that the cards print, their QR payloads and their decorative colors.
- `shares-render-qr.ts`: rendered sheets, rasterized, with their QR codes decoded and their text extracted.
- `shares-qr-card.ts`, `shares-cli-qr-business.ts`: the QR card on the business size (AUD-010-FUN003).
- `shares-material-page.ts`, `shares-material-default-random.ts`: the page size of material share sheets (AUD-010-UI001).
- `shares-qr-echo.probe.ts`: control characters from a QR image (AUD-010-SEC002).
- `shares-heir-sheet-form.ts`, `shares-it-reference.ts`, `shares-card-file-names.ts`: AUD-010-DOC004, AUD-010-UI004 and AUD-010-DOC005.
- `shares-restore.ts`, `shares-split-bounds.ts`, `shares-output-names.ts`, `shares-handover.probe.ts`, `shares-sheet-capacity.ts`, `shares-sheet-random.ts`, `shares-reference-contrast.ts`: restore, split, file names, the Decode-to-Restore handover and sheet capacity.

The command line.

- `cli-argv.mjs`: refusals without a terminal. Its group `defects` checks AUD-010-SEC001 and AUD-010-API004.
- `cli-pty-flows.py`: real pseudo-terminal scenarios. Its scenarios `sskr-argv-dates` and `term-dumb` check AUD-010-SEC001 and AUD-010-UI003.
- `cli-color.py`, `cli-oracles.ts`, `cli-typed-command.ts`: colours, independent oracles of recover-word, and the command line that the menu shows.

Build and architecture.

- `build-exports.mjs`, `build-module-graph.mjs`, `build-offline.mjs`, `build-sskr-integrity.mjs`, `build-workflows.mjs`, `build-docs.mjs`, `build-release-files.mjs`, `build-gate-side-effects.mjs`, `build-valid-last-words.ts`: package exports, the import graph, the offline boundary, pins, workflows, documentation links, release files, and the portability gate.
- `build-startup-host.ts`: the quick self-test of each feature without a render platform (AUD-010-API002).
- `build-startup-mutations.mjs`: changes one built module in memory with `build-mutation-hook.mjs` and checks that the startup self-test catches the change (AUD-010-BLD004, AUD-010-BLD005).
- `build-startup-timing.mjs`: the startup self-test's time.
- `build-dependencies.mjs`: AUD-010-BLD006.
- `build-dead-exports.mjs`: lists dead exports, and exits 1 while it finds any.
- `build-aud009-binding.mjs`: AUD-010-DOC006.

Earlier harnesses that this audit ran again:

- `docs/audits/AUD-008-harnesses/core-oracles.mjs`.
- `docs/audits/AUD-009-harnesses/core-invariants.ts`. It gives 10 of 12: the two pattern-mutation checks now throw TypeError on frozen arrays, which AUD-009 recorded as intended.
- `docs/audits/AUD-009-harnesses/sskr-boundaries.mjs`.
