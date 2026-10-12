# AUD-017 remediation

The owner authorized the coordinator to fix all remaining AUD-017 items after the initial review. The paired report's dated addendum records the final source manifest, file changes and exact checks. No commit or release is implied. The original report, failed probes and source identities remain historical records.

## Runtime changes

`wallet-check.ts` fixes the common checked fields once. It copies other data descriptors and binds host accessors/methods to the original receiver, so private class fields work and unused getters remain lazy. Own fields stay available to JSON and own-property enumeration. This is a shallow result capture; bound operations retain host state and exact reflection equivalence is not promised.

`missing-codes-search.ts` checks cancellation after each awaited fingerprint, before retaining a row, as well as at final return. The ordinary cleanup regressions also require a positive number of captured buffers. Eight new tests in `test/aud-017.test.ts` cover private getters/methods/setters, inheritance, laziness, immutable one-read fields, JSON, symbols, prototype-named fields and null prototypes. Tests and probes use only public/synthetic data.

## Evidence corrections

The 12 earlier broad remediation logs are intact, but their missing per-command source/context identities cannot be reconstructed. They are not claimed as verification of the new final snapshot. Newly necessary checks use `run.py`: unchanged before/after fingerprints, cwd, UTC times, log hashes, memory limits/samples and the recorded wrapper/guard sources. Broad suites are not repeated merely to replace historical metadata.

The old checksum list is preserved. Its paths resolve from `AUD-016-evidence/`. A separate list now covers the 12 remediation log/command pairs and the retained remediation validation result, also relative to that parent directory:

```bash
cd docs/audits/AUD-016-evidence
sha256sum --check remediation/SHA256SUMS
sha256sum --check remediation/SHA256SUMS-current
```

The old validator identifies the original review and does not validate later addenda. It remains frozen; no assertion is removed. `remediation.py` appends only this audit's fix record, and `remediation-validate.py` validates the new envelope/addendum, each new source/log binding, positive test/probe outcomes, checksums and privacy, then reconstructs the original report hashes to prove preservation. Do not regenerate the initial report with `report.py` after remediation; it deliberately requires its original source identities.

```bash
python3 docs/audits/AUD-017-harnesses/remediation.py
python3 docs/audits/AUD-017-harnesses/remediation-validate.py
```

The new records use `fixed`, with null fix/verification commits. No PDF/card/QR generation, full vector replay, full/long suite, Docker, browser or paid CI acceptance is claimed.
