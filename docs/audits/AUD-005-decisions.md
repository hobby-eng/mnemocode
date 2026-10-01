# AUD-005 decisions

The main session asked for the audit and its remediation to be finished without questions. This
record lists every choice where more than one option was reasonable, what was chosen and why,
and what is left for the maintainer. It belongs to [AUD-005](AUD-005-2026-10-01.md).

## Audit

1. **Outcome words in the coverage ledger.** AUD-004 used `partial` and `finding`, which the
   guide does not define. AUD-005 uses only the guide's outcomes (`passed`, `failed`,
   `not-applicable`, …) and names the finding or the gap in the evidence column.
2. **Severity of the release findings.** BLD001 (a tag publishes without the test suite) and
   BLD002 (no license notices in the executable release) could be read as medium. Both are
   rated low: no release exists yet, neither changes a phrase, record or share, and the guide
   reserves medium for defects in supported behavior.
3. **No Docker rebuild.** The main session uses Docker, so the canonical SSKR WASM rebuild was
   not repeated. Evidence is the equality of all seven hashes with the files AUD-004 rebuilt.
4. **Generated card PDFs.** `scripts/check-card-output.mjs` wrote 29 PDFs to the unignored
   `goldens/`. They were public fixtures produced by the audit, so they were moved into the
   local evidence folder instead of being left in the checkout.
5. **The existing `release/` folder.** It held the three published executables. The audit's
   own build replaced the Linux file with identical bytes (the existing `SHA256SUMS` line
   matches); the `.sha256` side file the build added was moved to local evidence, so the folder
   is as it was.
6. **What is not a finding.** `matchBitcoinEvidence` without a location throws a TypeError: it
   rejects the call, which is the contract, so it is noted in the ledger only. The plain-form
   label line that `encode` prints before its result on stdout is the documented plain form.

## Open for the maintainer

- AUD-005-API003: the JSON output's `algorithm` field could name the mode in a later format
  version; it is left unchanged because encoded outputs must not change.
- AUD-005-BLD006: credential persistence in `ci.yml`, the artifact action versions, PDF dates
  and unused embedded assets are left as they are.
