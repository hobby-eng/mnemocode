# MnemoCode audit reports

Audit numbers are global within this project. Findings retain their original category IDs across follow-up work. A report records a specific source snapshot and its limits; it is not a certification.

| Audit   | Date (UTC) | Scope                                                            | Result                                                                                                                   | Records                                                                                         |
| ------- | ---------- | ---------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------- |
| AUD-001 | 2026-09-27 | Correctness, security, tests/vectors, readability, documentation | Historical full-scope baseline with incomplete execution; all findings are verified by the committed follow-up and successful CI. | [Report](AUD-001-2026-09-27.md), [JSON](AUD-001-2026-09-27.json), [harness scripts](AUD-001-harnesses/) |
| AUD-002 | 2026-09-27 | Follow-up full scope: AUD-001 remediation verification, tests/vectors, code quality, documentation, security, canonical WASM rebuild | Historical snapshot reproduced one blocker; commit `b71aff4` verifies all eight findings with full local gates and successful GitHub CI. Original platform/physical/fault-injection limits remain. | [Report](AUD-002-2026-09-27.md), [JSON](AUD-002-2026-09-27.json), [harness scripts](AUD-002-harnesses/) |
| AUD-003 | 2026-09-29 | Targeted review: secret handling, the card rendering interface used by other programs, edge cases, documentation against code, readability | Two medium and seven low findings, none high. Eight are verified by the fix commit and successful CI; one was withdrawn as wrong. | [Report](AUD-003-2026-09-29.md), [JSON](AUD-003-2026-09-29.json) |

Exact model and reasoning effort are unknown in AUD-001 and are recorded as null. Its original dirty-tree baseline and expected-failure evidence remain preserved; current ordinary regressions and verification results are documented in the dated remediation notes.

AUD-002 was performed by Claude Code (model `claude-fable-5-1`; reasoning effort not retained, recorded as null). At commit `7b059c7`, it verified four AUD-001 production remediations and recorded two incomplete verifications. Commit `b71aff4` completed those checks, verified all eight AUD-002 findings and reconciled both Markdown and JSON records without changing the original snapshot evidence.

AUD-003 was performed by Claude Code (model `claude-fable-5-1`; reasoning effort not retained, recorded as null). It was a targeted review, not a full-scope audit: its coverage ledger lists the checks of the procedure that were not run. It keeps no evidence folder; its evidence is the commands in the report and the regression tests in the repository.

## Evidence and harness scripts

Since 2026-09-30, audit evidence (command logs and records, snapshots, checksums, rendered cards
and images) is kept only locally by the maintainer and is not published in this repository; a
report states the commands, counts, results and hashes a reader needs. The evidence folders of
AUD-001 and AUD-002 were removed from the repository then and remain in its history. The audit-only
scripts that produced the evidence are published, one folder per audit, each with a README that
explains what the scripts check and how to run them: [AUD-001](AUD-001-harnesses/) and
[AUD-002](AUD-002-harnesses/). Links in the reports to files in `AUD-001-evidence/` or
`AUD-002-evidence/` point to that local evidence.

## Commit identifiers in these reports

The history of this repository was rewritten on 2026-09-28 and 2026-09-29, so that every document exists in one version only. The rewrite changed the identifier of every commit. The identifiers cited in AUD-001 and AUD-002, such as `983dd55`, `7b059c7` and `b71aff4`, belong to the history before the rewrite and cannot be opened on `main`.

The reports stay valid as records of the reviewed source. Each report identifies its snapshot by the SHA-256 values recorded in the report and in its evidence folder, and those values do not depend on commit identifiers. The source files reviewed in both audits are still part of the current history; only the commits that carry them have new identifiers.

AUD-003 names its commits as they were on `main` on 2026-09-29. It also identifies each snapshot by a source fingerprint that depends neither on commit identifiers nor on documents, so it stays valid after a later rewrite:

```bash
git ls-tree -r COMMIT | grep -v '\.md$' | sha256sum
```
