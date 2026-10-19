# AUD-037 harnesses

Scripts of [AUD-037](../AUD-037-2026-10-19.md), the full pre-release audit of MnemoCode at commit
`f8d9a933ba9bde8290da39d42fa3a380de78385a` (begun at `4978a620d43a8571b89ccfc01f3b5a58b3a8c421`).
Run every command from the repository root, with the toolchains of the workspace `AGENTS.md`
(Node.js 26.10.0, pnpm 12.8.1, Python 3) and after `pnpm install --frozen-lockfile` and `pnpm build`.
Only public test data is used: the BIP39 phrase "abandon … about", its masked word numbers and the
README's date.

| Script | What it does | Expected result |
| --- | --- | --- |
| `run.mjs` | Runs one command and keeps its local evidence in `docs/audits/AUD-037-evidence/` (ignored by Git): `<name>.log` with everything it printed and `<name>.command.json` with the command, UTC start and end, exit code and the log's SHA-256. `node docs/audits/AUD-037-harnesses/run.mjs <name> <program> [arguments...]`; a command with a pipe goes as `sh -c "..."`. It refuses to overwrite an earlier result. | The command's own exit code. |
| `report.mjs` | Writes `AUD-037-2026-10-19.md` and `.json` from `report-data.json` after checking the data: the envelope of `multi-chain-wallet-tools/docs/audit-report.schema.json` (required fields, ID patterns, severities, statuses), no duplicate JSON keys, finding IDs unique and numbered in order per category, all 32 procedure checks present, every remediation row naming a finding, and the report privacy rules (no home directory other than `/home/user`, no local time offset). `node docs/audits/AUD-037-harnesses/report.mjs` writes; `--check` only compares. | Exit 0 with "agree with the data" for `--check`; 1 with the problems otherwise. |
| `report-data.json` | The one source of both records. | — |
| `fingerprint-probe.py` | AUD-037-UI001: runs `decode --ask-secrets --mode seedshift` in a pseudo-terminal (through `scripts/terminal_session.py`), types the masked word numbers and reads the emulated frame when the dates are asked. | Exit 1 while the encoded fingerprint is missing from that frame (the defect at f8d9a93); 0 once it is shown. |
| `fit-probe.py` | AUD-037-UI002: runs `encode --sskr --ask-secrets` on a colour terminal of 80x24 for five share sets and reads the final frame of each set that is not paged. | Exit 1 while an unpaged set loses a share from the frame (2-of-3 in words with Seedshift at f8d9a93); 0 once every share stays readable. |
| `paging-probe.py` | The fix of 7facfcc for the Unicode variant of AUD-028-UI001: checks that 2-of-3, 3-of-3 and 4-of-4 Unicode share sets page on a colour terminal of 80x24. | Exit 0 at f8d9a93; 1 if a Unicode set stops paging. |

The reviewers' other probes and the verification workflow's records are local evidence of this audit
(the workspace scratch folder and `docs/audits/AUD-037-evidence/`); each finding states its
reproduction in the report so that it can be repeated without them.
