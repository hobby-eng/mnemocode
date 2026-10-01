# MnemoCode audit reports

Audit numbers are global within this project. Findings retain their original category IDs across follow-up work. A report records a specific source snapshot and its limits; it is not a certification.

| Audit   | Date (UTC) | Scope                                                            | Result                                                                                                                   | Records                                                                                         |
| ------- | ---------- | ---------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------- |
| AUD-001 | 2026-09-27 | Correctness, security, tests/vectors, readability, documentation | Historical full-scope baseline with incomplete execution; all findings are verified by the committed follow-up and successful CI. | [Report](AUD-001-2026-09-27.md), [JSON](AUD-001-2026-09-27.json), [harness scripts](AUD-001-harnesses/) |
| AUD-002 | 2026-09-27 | Follow-up full scope: AUD-001 remediation verification, tests/vectors, code quality, documentation, security, canonical WASM rebuild | Historical snapshot reproduced one blocker; commit `5547c9e6f47c719c7caef691807b097d40c06bfb` verifies all eight findings with full local gates and successful GitHub CI. Original platform/physical/fault-injection limits remain. | [Report](AUD-002-2026-09-27.md), [JSON](AUD-002-2026-09-27.json), [harness scripts](AUD-002-harnesses/) |
| AUD-003 | 2026-09-29 | Targeted review: secret handling, the card rendering interface used by other programs, edge cases, documentation against code, readability | Two medium and seven low findings, none high. Eight are verified by the fix commit and successful CI; one was withdrawn as wrong. | [Report](AUD-003-2026-09-29.md), [JSON](AUD-003-2026-09-29.json) |
| AUD-004 | 2026-09-30 | Full current-tree audit: core, recovery, SSKR, CLI, cards, dependencies and canonical WASM | One medium and five low findings, all fixed in the next commit and all verified, SEC001 and DOC001 after follow-up tests; the suite now also runs on Windows and macOS; 434 tests and 39 actual PDFs pass; all four freshly generated SSKR artifacts match. No production edits or release approval. | [Report](AUD-004-2026-09-30.md), [JSON](AUD-004-2026-09-30.json), [harness scripts](AUD-004-harnesses/) |
| AUD-005 | 2026-10-01 | Full audit after the executable release work: core and Seedshift against an independent oracle, records, recovery, SSKR and its integrity gate, cards and QR, secret input, terminal and help, single executable, dependencies, CI and documents | Twelve low findings, none higher: release path, executable license notices, hidden input outside Linux, two lenient decoders, a folder mode, help layout, an untested integrity gate and stale documents. 446 tests, 7 vectors, 6,000 oracle comparisons and 30 documented examples pass; the Linux executable is reproducible. | [Report](AUD-005-2026-10-01.md), [JSON](AUD-005-2026-10-01.json), [harness scripts](AUD-005-harnesses/), [decisions](AUD-005-decisions.md) |

Exact model and reasoning effort are unknown in AUD-001 and are recorded as null. Its original dirty-tree baseline and expected-failure evidence remain preserved; current ordinary regressions and verification results are documented in the dated remediation notes.

AUD-002 was performed by Claude Code (model `claude-fable-5-1`; reasoning effort not retained, recorded as null). At commit `b4f334f982044ef586002c9b9816646631b3751e`, it verified four AUD-001 production remediations and recorded two incomplete verifications. Commit `5547c9e6f47c719c7caef691807b097d40c06bfb` completed those checks, verified all eight AUD-002 findings and reconciled both Markdown and JSON records without changing the original snapshot evidence.

AUD-003 was performed by Claude Code (model `claude-fable-5-1`; reasoning effort not retained, recorded as null). It was a targeted review, not a full-scope audit: its coverage ledger lists the checks of the procedure that were not run. It keeps no evidence folder; its evidence is the commands in the report and the regression tests in the repository.

AUD-005 was performed by Claude Code as the workspace maintainer subagent (model `claude-opus-5-5`; reasoning effort not exposed, recorded as null). It reviewed commit `7e05adee3f4b25d7461cde6e6e86f2521d058e21` with a clean tree and then fixed its findings in separate commits; its [decisions record](AUD-005-decisions.md) lists every choice made without the maintainer.

## Evidence and harness scripts

Since 2026-09-30, audit evidence (command logs and records, snapshots, checksums, rendered cards
and images) is kept only locally by the maintainer and is not published in this repository; a
report states the commands, counts, results and hashes a reader needs. The evidence folders of
AUD-001 and AUD-002 were removed from the repository then and remain in its history. The audit-only
scripts that produced the evidence are published, one folder per audit, each with a README that
explains what the scripts check and how to run them: [AUD-001](AUD-001-harnesses/),
[AUD-002](AUD-002-harnesses/), [AUD-004](AUD-004-harnesses/) and [AUD-005](AUD-005-harnesses/). Links in the reports to files in `AUD-001-evidence/` or
`AUD-002-evidence/` point to that local evidence.

## Commit identifiers in these reports

The history of this repository was rewritten on 2026-09-28 and 2026-09-29, so that every document exists in one version only. The rewrite changed the identifier of every commit. The identifiers cited in AUD-001 and AUD-002, such as `f17c323268f431d54123fbcbe018d9add4312cd5`, `b4f334f982044ef586002c9b9816646631b3751e` and `5547c9e6f47c719c7caef691807b097d40c06bfb`, belong to the history before the rewrite and cannot be opened on `main`.

The reports stay valid as records of the reviewed source. Each report identifies its snapshot by the SHA-256 values recorded in the report and in its evidence folder, and those values do not depend on commit identifiers. The source files reviewed in both audits are still part of the current history; only the commits that carry them have new identifiers.

AUD-003 names its commits as they were on `main` on 2026-09-29. It also identifies each snapshot by a source fingerprint that depends neither on commit identifiers nor on documents, so it stays valid after a later rewrite:

```bash
git ls-tree -r COMMIT | grep -v '\.md$' | sha256sum
```
