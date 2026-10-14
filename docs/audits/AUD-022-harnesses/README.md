# AUD-022 harnesses

The scripts of AUD-022: the re-check of the AUD-021 fixes and the full audit of the MnemoCode 0.1.0 working tree, HEAD `8de80e24c7e98b14a443cb9a0e3dc43aa73a7917` with its uncommitted changes, source fingerprint `991f61a993042265cf6ed9575cddc5ab0d84e605fbf0a1aaa2fccb62120e468e`. The report is [AUD-022-2026-10-13.md](../AUD-022-2026-10-13.md); command evidence stays in the ignored `docs/audits/AUD-022-evidence/`.

Run every script from the repository root after `pnpm build`, with the pinned Node.js and pnpm and Python 3 (`jsonschema` for the two record scripts). `validate-records.py` and `make-report.py` also read a `multi-chain-wallet-tools` checkout beside this repository: its `docs/audit-report.schema.json` and the procedure files of the audit standard. `cap.sh` needs a systemd user session (`systemd-run --user`). The scripts use public test data only: the BIP39 test phrase and `vectors/*.json`. Never substitute a real seed phrase or share.

| Script | What it checks | Expected |
| --- | --- | --- |
| `snapshot.py [out.json]` | The source fingerprint by the AUD-020 and AUD-021 method: SHA-256 of compact JSON of the sorted path/SHA-256 entries of the tracked and untracked non-ignored files, without `docs/audits/` | Prints commit, fingerprint and file count |
| `record.py <evidence> <label> <command…>` | Runs one check and keeps its log, UTC start and end, exit code, log SHA-256 and the fingerprint before and after | The command's exit code |
| `cap.sh <command…>` | Runs a command with an 8 GiB memory cap (no swap) and a 15-minute deadline, so that it cannot hang the machine | The command's exit code |
| `run-tests.sh <evidence> [prefix]` | The whole suite in parts: the files without PDFs with four workers, then the PDF-generating files three at a time | Exit 0 when every part passes; at the reviewed snapshot exit 1, two tests failing (AUD-022-API001, AUD-022-BLD001); exit 0 on the remediated source |
| `aud021-fixed.mjs` | The fixed state of every AUD-021 finding, with variants beyond its acceptance tests: PNG admission, age identity redaction, Color Unicode marks, marked shares with decoys, candidate entropy, re-encoding ownership | `ALL PASS`, exit 0 |
| `repair-leading-marks.mjs` | One share below its threshold, its first three elements marked, for every deterministic set and form, through the single repair and `sskr-export` | Prints each case and the count without a unique repair or with "do not fit": 33 of 45 at the reviewed snapshot (AUD-022-FUN001); on the remediated source 18, none with "do not fit", the variant lists and refusals that three marked colors or 128-bit Unicode codes leave; exit 0 |
| `reencode-stdout.py` | Interactive `re-encode --ask-secrets` with standard input and error on a pseudo-terminal and standard output sent to a file, stopped at the confirmation (AUD-022-SEC001); Linux and macOS | `PASS` for the confirmation asked, the phrase on the private screen and none of it in the file; exit 0 on the remediated source, exit 1 at the reviewed snapshot |
| `remediation-checks.sh <evidence>` | Every check of the remediated source, one at a time under `cap.sh`: the fingerprint, build, `pnpm check`, Prettier, the suite in parts, the self-test, the terminal checks on source and executable, card output, the scripts above and the independent SSKR check | Exit 0 when every check passes; the records feed the addendum of `make-report.py` |
| `validate-records.py` | Every `docs/audits/AUD-*.json` against the workspace schema, without duplicate keys, each finding ID in its Markdown twin | Exit 0 |
| `make-report.py` | Writes the AUD-022 report and record with its remediation addendum, from the recorded checks (the `remediation-*` ones and `snapshot-remediation.json` for the addendum), validates them (schema, paired IDs, privacy) and writes the local `SHA256SUMS` and `report-validation.json` | Prints the validation record; exit 0 |

```bash
python3 docs/audits/AUD-022-harnesses/snapshot.py
bash docs/audits/AUD-022-harnesses/run-tests.sh docs/audits/AUD-022-evidence
node docs/audits/AUD-022-harnesses/aud021-fixed.mjs
node docs/audits/AUD-022-harnesses/repair-leading-marks.mjs
python3 docs/audits/AUD-022-harnesses/reencode-stdout.py
python3 docs/audits/AUD-022-harnesses/validate-records.py
```
