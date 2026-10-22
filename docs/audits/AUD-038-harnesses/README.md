# AUD-038: release-candidate follow-up

This folder supports the targeted follow-up to AUD-037 at
`230425c912912e0f0964ac77c01880a6ee8b078e` and its recorded corrections.
It does not repeat a complete all-files audit. See the report pair for
the exact reviewed source, performed checks, retained results and limits.

`run.py` reuses the published AUD-026 Linux `/proc` memory monitor. It keeps
a 3 GiB host reserve, monitors a 3 GiB RSS budget for the command tree and limits each Node
heap to 384 MiB, and stops a check after 1,800 seconds. Docker's builder
does not belong to that command tree: the fresh container build also
uses its own 2 GiB memory limit. The host reserve remains monitored.
No new package is needed. Windows and macOS acceptance uses the repository's
existing native CI jobs, not this Linux monitor.
RSS and free memory are sampled every 0.2 seconds; this is not a hard OS
memory cap. A monitor stop always makes the wrapper fail, even if a child
handles termination by returning zero. The receipt preserves the child's
status, the stop reason, the wrapper status and hashes of both scripts.

Use the pinned repository toolchains and installed frozen dependencies.
Run from the repository root, with the workspace heavy-check lock:

```sh
flock ../tmp/heavy-checks.lock python3 docs/audits/AUD-038-harnesses/run.py gates pnpm check
flock ../tmp/heavy-checks.lock python3 docs/audits/AUD-038-harnesses/run.py build pnpm build
flock ../tmp/heavy-checks.lock python3 docs/audits/AUD-038-harnesses/run.py regressions pnpm exec vitest run test/color-placements.test.ts test/known-audit-defects.test.ts test/sskr-result-repeat.test.ts --maxWorkers=1
flock ../tmp/heavy-checks.lock python3 docs/audits/AUD-038-harnesses/run.py suite pnpm exec vitest run --maxWorkers=2
flock ../tmp/heavy-checks.lock python3 docs/audits/AUD-038-harnesses/run.py terminal python3 scripts/verify-terminal-input.py
python3 docs/audits/AUD-038-harnesses/check-runner.py stopped-check
```

The targeted tests cover reordered damaged colors in both forms, all 700
nonzero cyclic rotations with each color unread at five phrase lengths,
candidate enumeration and bounds, nullish wallet-evidence refusal, and a
complete SSKR result requested again after a mismatched written quorum.
The terminal suite includes the repeat-result regression with public data.
Rotations do not constitute every possible permutation. The existing
published vectors remain the independent fixtures; no private wallet is used.

The commands should exit zero. A failed assertion, timeout or resource stop
is a failure or incomplete check, never a pass. Each label is immutable:
choose a new label for a retry. Logs and JSON receipts go to the ignored
`docs/audits/AUD-038-evidence/` directory. Original execution records and
the additional masked small-screen probe are also machine-local under the
workspace's `tmp/aud037/release-readiness/`; they are not distributed.

Release-only commands, when authorized, are documented in `docs/RELEASING.md`.
`pnpm verify:sskr` compares the canonical generated engine without replacing
it. The report distinguishes its cached comparison from a fresh compilation
with the `built` stage cache disabled. This harness does not push, rewrite
history, tag, sign release files or publish a release.

`advisories.py` supplements the unavailable npm audit endpoint with the official
[GitHub global advisory API](https://docs.github.com/en/rest/security-advisories/global-advisories#list-global-security-advisories).
It needs Python 3.11 or later and an installed GitHub CLI, and sends only locked
public package names/versions. It covers all pnpm lockfile documents, optional
platform packages and registry Cargo versions, querying reviewed, malware and
unreviewed records. A known vulnerable lodash version must match as a positive
control. Run `python3 docs/audits/AUD-038-harnesses/advisories.py`: every live
run fetches into a fresh UTC-named local subfolder, printed on completion.
`--cached [RUN]` instead verifies retained query/response hashes without
network access, using that subfolder or the original retained root by default.
Cached results are not fresh checks. Both modes write local ignored JSON and
refuse a matched advisory. Neither makes a failed `pnpm audit` pass.
`python3 docs/audits/AUD-038-harnesses/check-advisories.py` checks the live/cache
distinction with a fake of the network edge; it makes no network request.
