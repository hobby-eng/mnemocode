# AUD-027 bounded executable checks

This short follow-up reviews the uncommitted remediation after `f2d4cffa5d7df369910243734f287ce6521ed033`. It is not the complete release acceptance procedure. The report records the exact source manifest, dependency results and omitted checks.

Build with the pinned Node.js and pnpm, from the repository root:

```sh
pnpm build
node scripts/build-executable.mjs
mkdir -p docs/audits/AUD-027-evidence
node docs/audits/AUD-027-harnesses/executable-smoke.mjs
python3 -B scripts/verify-terminal-input.py release/mnemocode-0.1.0-linux-x64
```

The smoke harness runs the real executable from an empty temporary folder on disk, using only the published `direct-12` and `checksum-valid-seedshift-12` vectors. It checks startup, exact transformations, two-of-three SSKR recovery, one readable IT business-card PDF sheet, notices and checksums. It prints eight `ok` lines and exits zero only when all assertions pass. It removes its public temporary exports and writes local evidence under `AUD-027-evidence/`. It does not run the full self-test, render every template, compare PDF pixels or replay large vector sets.

Checks reuse the sequential memory guard in `../AUD-026-harnesses/audit.py`: a 256 MiB Node heap, a sampled 1 GiB process-tree RSS budget and a 3 GiB host-memory reserve. The executable build alone uses a 2 GiB RSS budget after the initial 1 GiB attempt was stopped. Its original command records are retained unchanged; this follow-up's records are collected under `AUD-027-evidence/`. Linux `/proc` and Python's standard library are needed for that guard. Native runs are required when the agent sandbox prevents Node subprocess creation. All report and record times are UTC.
