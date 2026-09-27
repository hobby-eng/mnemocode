# AUD-002 retained evidence

All inputs are public fixtures (`abandon … about`, the BCR-2020-011 SSKR vector, zero or counting entropy). No wallet material, user output directories or package caches are included. The reviewed snapshot is identified by `snapshot.json` (commit `7b059c73…`, tree `44b89d67…`); `scoped-source-manifest.json` hashes every tracked file.

Thirty-eight retained command logs have a `<name>.command.json` companion recording the exact command text, working directory, UTC start and end, exit code and the SHA-256 of the log. Five `.log` files do not have companions: `run-all.log`, `run-probes-2.log` and `run-probes-3.log` are batch-progress summaries; `environment.log` is a standalone environment capture; `typecheck-sskr-only-without-types-node.log` is an intermediate-tree diagnostic whose exact command metadata was not retained. The last two are not treated as independently replayable command evidence. `harnesses/` contains the audit-only scripts (`lib.sh` writes the companions); replay them only in a disposable workspace.

Retained mistakes: `sskr-cards-probe-attempt1.*` is a harness error (PNG files rasterised as PDFs) and is not a product result; the corrected run is `sskr-cards-probe.*`. In `sskr-cards-probe.json`, the `fragments-summary` step mis-mapped members to folders; `fragment-qr-check.json` is the authoritative per-fragment result (50/50). `format-check-docs.log` exits 2 because `NOTICE` has no Prettier parser; the project's own `format:check` passed.

`wasm-canonical-rebuild.*` is the host rebuild (differs from the committed binary; `exitCode` 1 records that difference). `wasm-canonical-docker.*` is the rebuild inside the sibling repository's pinned `Dockerfile.reproducible` (`multi-chain-wallet-tools` at `76cce41`), which reproduced all four committed files byte for byte. `typecheck-sskr-only-without-types-node.log` was captured on an intermediate tree without the `qrcode` import; it does not describe the reviewed snapshot, whose `tsconfig.json` already contains `"types": ["node"]`, and it supports no finding in the corrected report.

Snapshot caveat: `snapshot.json` records the working tree as clean at the stated start, but no timestamped raw `git status --short` log or command companion was retained. `environment.log`, captured later after evidence collection had begun, records one uncommitted entry. The commit, tree hash and tracked-source manifest still identify the reviewed tracked bytes.

Temporary probe workspaces under `/tmp` were deleted after their JSON summaries were written; paths inside the companions are machine-local descriptions, not downloadable assets.

`remediation-2026-09-27.md` records the later uncommitted fixes, exact local gates,
coverage totals and retained remote-CI/platform limits. It supplements rather than
rewrites the snapshot logs above. `SHA256SUMS` covers every file in this directory
except itself and was regenerated after the remediation note was added.
