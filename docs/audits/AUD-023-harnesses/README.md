# AUD-023 harnesses

The scripts of AUD-023, the full audit of MnemoCode at HEAD `8de80e24c7e98b14a443cb9a0e3dc43aa73a7917` with its uncommitted changes, source fingerprint `89c0cf323e39545dcbb37b5f37027314cc3b39f57cf6cbfd9004bc2a7f34c68d` (the source that the AUD-022 remediation left). The audit is in progress: its report is not written yet. Command evidence stays in the ignored `docs/audits/AUD-023-evidence/`.

Run every script from the repository root after `pnpm build`, with the pinned Node.js and pnpm and Python 3. `baseline.sh` also needs the Python package `jsonschema` and a `multi-chain-wallet-tools` checkout beside this repository, whose `docs/audit-report.schema.json` the record schema check reads (through `../AUD-022-harnesses/validate-records.py`); `cap.sh` needs `flock` and a systemd user session (`systemd-run --user`). Public test data only.

| Script | What it does | Expected |
| --- | --- | --- |
| `snapshot.py [out.json]` | The source fingerprint by the method of AUD-020 to AUD-022: SHA-256 of compact JSON of the sorted path/SHA-256 entries of the tracked and untracked non-ignored files, without `docs/audits/` | Prints commit, fingerprint and file count |
| `record.py <evidence> <label> <command…>` | Runs one check and keeps its log, UTC start and end, exit code, log SHA-256 and the fingerprint before and after | The command's exit code |
| `cap.sh <command…>` | Runs one heavy command at a time: it waits for the heavy-job lock shared by every session of the workspace (`HEAVY_LOCK`, by default `../tmp/claude/aud023/heavy.lock`, whose folder must exist), then runs with a 6 GiB memory cap, no swap, and a 30-minute deadline | The command's exit code |
| `baseline.sh <evidence>` | The checks that the AUD-022 remediation run did not make at this source: frozen lockfile, dependency advisories, package manifest, record schemas, the Seedshift oracle, and line coverage from the test files that draw no PDFs | Exit 0 when every check passes; the coverage run can time out one long candidate test under instrumentation |

```bash
python3 docs/audits/AUD-023-harnesses/snapshot.py
bash docs/audits/AUD-023-harnesses/baseline.sh docs/audits/AUD-023-evidence
```
