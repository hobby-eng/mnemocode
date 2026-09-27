# AUD-001 retained evidence

Only public/synthetic fixture inputs and scoped project source are included. No pre-existing user `tmp`, `output`, local package-cache contents, or wallet exports are bundled. `source-snapshot.tar.gz` contains the original 127-file dirty-tree source snapshot; dependencies are not included. `scoped-source-manifest.json` hashes each entry. `baseline.diff` additionally records the tracked Git difference at capture.

The original suite and subsequent authorized test-only verification are separate logs. `test-remediation.patch` changes tests only. `test-remediation.json` identifies installed test hashes. Six tests used explicit expected-failure markers in the original snapshot; the later disposition is recorded in `remediation-2026-09-27.md` without altering those historical logs.

Each command companion records its exit code and UTC times. Initial sandbox subprocess failures, a 300-second matrix harness timeout, and two diagnostic-harness/test mistakes are retained alongside successful corrected runs; do not count them as product defects. The first registry audit was blocked before execution; the user then authorized transmission and both completed registry results are included.

`harnesses/` are audit-only programs. They preserve original `/tmp/mnemocode-aud-001` workspace paths for traceability. Review and adjust these paths to a disposable workspace before replay. Never replace paths with live wallet data. Start with the archived source, matching dependencies, and `npm run build`; the existing node_modules used in this audit matched every direct version pin. No fresh frozen install is claimed.

The native WASM was not rebuilt. Platform, adversarial-allocation and physical-print limitations are detailed in the report. `SHA256SUMS` covers this bundle except itself. The report JSON is validated against the user-supplied canonical schema, identified by its retained procedure hash.

## Integrity-manifest remediation, 2026-09-27

Before `docs/audits/` was excluded from Prettier, 41 JSON files and six audit harnesses
were mechanically reformatted. Their original hashes therefore no longer matched even
though all 25 command-companion log hashes still verified. The affected paths and reason
are listed in `remediation-2026-09-27.md`. `SHA256SUMS` was regenerated from the current
bytes after adding that note; the original mismatch is retained in the AUD-002 evidence.
