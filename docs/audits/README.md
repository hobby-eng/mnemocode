# Audit index

Audits of the Rust MnemoCode, numbered in this repository. The audits of the TypeScript version,
AUD-001 to AUD-038, stay with it in [mnemocode_typescript](https://github.com/hobby-eng/mnemocode_typescript/tree/main/docs/audits). Each report has a Markdown and a JSON
record; the harnesses that made its evidence stay beside it.

| Report | Date | Scope | Result |
| ------ | ---- | ----- | ------ |
| [AUD-001](AUD-001-2026-11-02.md) | 2026-11-02 | Full scope of the port before 0.2.0, at `b677647`; fixes in `17da862` | No critical or high finding; 6 medium and 8 low verified fixed, 1 low deferred |
| [AUD-007](AUD-007-2026-11-16.md) | 2026-11-16 | 0.2.0 candidate at `4760919`, embroidery, QR, native and WASM release; fixes in `74b03e9`, coverage in `137cf8f` | Two release blockers; 17 findings verified fixed, 2 low fixed without their full check, 1 medium accepted. [JSON](AUD-007-2026-11-16.json) |
| [AUD-008](AUD-008-2026-11-17.md) | 2026-11-17 | 0.2.0 at `19addd5` plus recorded working-tree changes; recovery, file discovery, bindings, all current documentation and help | Hold: 34 new findings (12 medium, 22 low), 14 release blockers. Earlier DOC004 has a residual documentation gap. [JSON](AUD-008-2026-11-17.json) |
| [AUD-009](AUD-009-2026-11-17.md) | 2026-11-17 | AUD-008 remediation on `19addd5` plus working-tree diff `89b75c35` | 25 original findings verified, 5 source-fixed awaiting specific checks, 4 still open; 4 additional Low discovery/navigation defects. Current full source checks pass, but new binding acceptance remains incomplete. [JSON](AUD-009-2026-11-17.json) |
| [AUD-010](AUD-010-2026-11-18.md) | 2026-11-18 | AUD-009 fixes on `19addd5` plus working-tree diff `b181b946` | Seven of eight claimed fixes verified; Unicode export collision remains. Three older acceptance gaps remain. Fresh navigation checks pass; no full release acceptance. [JSON](AUD-010-2026-11-18.json) |

Current dispositions, fix identities and verification evidence are in the
[AUD-010 remediation register](AUD-010-2026-11-18.md#remediation-and-follow-up).
Earlier report verdicts describe their original snapshots.
