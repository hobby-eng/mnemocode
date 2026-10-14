# AUD-024 harnesses

The scripts of AUD-024, the compact audit of MnemoCode at commit `ee4499e891754158b4e6bcf0c919dc360ffc8b4e` (main, clean working tree), source fingerprint `522419b9a2e40a76f641a3c51fe0319122709c92c2c2d66e462a37ca3a0fe018`. The report is [AUD-024-2026-10-14.md](../AUD-024-2026-10-14.md). Command evidence stays in the ignored `docs/audits/AUD-024-evidence/`.

Run every script from the repository root, after `pnpm build`, with the pinned Node.js and pnpm and Python 3. `baseline.sh` also uses the AUD-023 `record.py`, `snapshot.py` and `cap.sh` (which needs `flock`, a systemd user session and the lock folder `../tmp/claude/aud023/`), the AUD-022 `run-tests.sh` and probes, the AUD-005 Seedshift oracle and Docker for `pnpm verify:sskr`. `make-report.py` needs the Python package `jsonschema` and a `multi-chain-wallet-tools` checkout beside this repository, whose `docs/audit-report.schema.json` it validates against. Public test data only.

| Script | What it does | Expected |
| --- | --- | --- |
| `baseline.sh <evidence>` | Every check of the audit, one at a time, each recorded with its log, UTC times, exit code and the source fingerprint before and after: the fingerprint of 870effe, frozen lockfile, build, `pnpm check`, Prettier, the suite in parts, self-test, pseudo-terminal check, card output, the AUD-022 and AUD-021 probes, SSKR known answers, Seedshift oracle, `pnpm verify:sskr`, `pnpm audit`, `npm pack` | Exit 0 when every check passes |
| `source-at-commit.py <commit> [fingerprint]` | The source fingerprint of a commit's tree by the method of AUD-020 to AUD-023 | Prints commit, fingerprint and file count; exit 1 when an expected fingerprint differs |
| `truncated-share.mjs` | AUD-024-FUN001: five `ur:sskr` records whose CBOR is cut short and whose CRC32 is valid must be refused as invalid input | Exit 1 at the reviewed commit (the finding); exit 0 with the fix |
| `entry-types.sh` | AUD-024-API001: a host project in `../tmp/aud024-entry-types` imports the types of the joint repair's results from `mnemocode/sskr/joint-repair` and compiles | Exit 1 at the reviewed commit; exit 0 with the fix |
| `code-rules-gaps.sh` | AUD-024-BLD001 and BLD002: `scripts/verify-code-rules.mjs`, copied into small trees in `../tmp/aud024-code-rules`, must refuse an unpinned Python import and Cargo dependencies in table or dotted form, and pass two controls | Exit 1 at the reviewed commit; exit 0 with the fix |
| `remediation-checks.sh <evidence>` | The checks of the remediated source, each recorded as `remediation-<label>`: build, `pnpm check`, Prettier, the 17 test files of the fixes and the code they touch, self-test, pseudo-terminal check, SSKR known answers and the three probes above | Exit 0 when every check passes, the probes included |
| `make-report.py` | Writes the Markdown and JSON report from `report_data.py` and the evidence, validates the JSON against the schema, checks privacy, writes the local `SHA256SUMS` and `report-validation.json` | Exit 0 when the report passes its checks |

```bash
bash docs/audits/AUD-024-harnesses/baseline.sh docs/audits/AUD-024-evidence
node docs/audits/AUD-024-harnesses/truncated-share.mjs
bash docs/audits/AUD-024-harnesses/entry-types.sh
bash docs/audits/AUD-024-harnesses/code-rules-gaps.sh
bash docs/audits/AUD-024-harnesses/remediation-checks.sh docs/audits/AUD-024-evidence
python3 docs/audits/AUD-024-harnesses/make-report.py
```
