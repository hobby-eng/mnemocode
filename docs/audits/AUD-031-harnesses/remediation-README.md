# AUD-031 remediation evidence

The original README and baseline harnesses retain their accepted bytes. This separate helper
appends a dated verification record after the frozen AUD-031 baseline. It neither audits nor
repairs the product. The signed base commit is `0d7898fed2efc4af59b2bff91b0da77d1f99315f`.
The audited dirty baseline is separately identified by source fingerprint
`54edf4a5bc588673d6034f460c76d7867ddd6be63b905094cea90dfba8b7275e`;
the final remediation source is identified by its own local manifest and fingerprint.

Run from the repository root with the pinned Node.js:

```sh
node docs/audits/AUD-031-harnesses/remediation.mjs
node --experimental-vm-modules docs/audits/AUD-031-harnesses/remediation-probes.mjs
node docs/audits/AUD-031-harnesses/remediation.mjs --publish --code-commit FULL_COMMIT
```

The default writes ignored `remediation-preview.md` and `.json`. Publication appends to the
canonical pair only once. The code commit is optional before one exists; it is recorded without
claiming that the audit documentation already belongs to that commit. DOC002's audit-document
commit stays null to avoid a self-referential commit identifier.

Required local inputs in `AUD-031-evidence/` are `remediation-plan.json`,
`r47-current-source.json`, `r47-build-artifacts.json`, the immutable
`aud031-typescript-handoff.json`, and the primary/follow-up independent review dossiers named
by the plan. Executed command and log records remain in `AUD-030-evidence/`, where the retained
memory guard writes them; this adapter provenance does not turn a new check into an old run.
Review dossiers contain assessments and cannot be regenerated from a test command.

The helper verifies live source/artifact bytes, successful stable command/log records and
current-source receipt identity. Retained checks keep their own source fingerprint and explicit
admission limits. Publication requires complete independent acceptances and exact baseline pair
hashes, preserves original baseline finding objects, and separately identifies a regression
discovered after that baseline. A missing input, drift, rejected review or repeated publication
exits nonzero. Success exits 0 and prints source/report hashes. No package, tag or release is made.

Publication also requires `r50-remediation-review.json` with a complete status and
`acceptedFinalInputs: true`. Its unique `reviewedInputs` must bind all three follow-up harness files,
the plan, source/build/handoff manifests, the frozen canonical pair, the preview pair, every
referenced code/artifact review and every listed command record/log. Every bound input is
rehash-checked before either canonical file is written. The metadata review does not bind
its own bytes. Permitted generated changes from the accepted preview are the publication
timestamp, the later supplied code commit and associated remediation commit fields, and the
metadata acceptance's own hash/status/limits. All other claims come from the same bound inputs.

The probe uses the actual publisher in Node's VM with intercepted filesystem writes. It refuses
missing, rejected, incomplete and drifted metadata acceptance before any write; a complete
synthetic fixture reaches two intercepted writes. The canonical pair is hash-checked unchanged
after every case. Its fixture uses the retained initial `r49-remediation-review.json`; a synthetic
acceptance is never written to the real evidence path. Run the probes before publication while
the canonical pair is still the frozen baseline. Five PASS lines and exit 0 are expected.

After publication, independently validate the JSON against the shared
`multi-chain-wallet-tools/docs/audit-report.schema.json`, reject duplicate keys, compare finding
IDs and headings in both companions, run `node scripts/verify-audit-privacy.mjs` and
`node scripts/verify-audit-package.mjs`, and verify that no ignored evidence is staged. The
existing audit Python environment uses the pinned/hash-recorded packages in
`AUD-030-harnesses/requirements.md`; no installation is performed by this helper.
