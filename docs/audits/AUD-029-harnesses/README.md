# AUD-029 scoped CORE review harnesses

These read-only probes belong to the CORE conformance assessment of the dirty tree on
`f2d4cffa5d7df369910243734f287ce6521ed033`, source fingerprint
`0a043cc331f95f371aa9eb753b2e266ba0e511f4755928768fa2c0a299ec53b0`.
They are not a whole security audit or release verification.

Run from the repository root:

```sh
node docs/audits/AUD-029-harnesses/core-inventory.mjs
node docs/audits/AUD-029-harnesses/secret-owner-probe.mjs
node docs/audits/AUD-029-harnesses/sign-cancel-probe.mjs
python3 -B docs/audits/AUD-029-harnesses/validate-report.py
```

- The inventory parses source and tooling with the retained TypeScript5.9.3 at workspace
  `tmp/cancel-check/node_modules/typescript`; it installs nothing. Exit0 means no syntax
  diagnostics. Counts and declarations are leads for review, not counts of violations.
- The owner probe needs the existing matching `dist/` and public SSKR fixture. It prints
  only lifetime capabilities and a frozen-storage flag. Exit1 means an explicit wipe/dispose
  contract remains absent, not an assertion of external leakage.
- The signing probe reads only two AST declarations from the release helper. It runs the
  pre-child cancellation branch in an isolated context, with an inert scheduler and a child
  function that must never be called. It never invokes release main, gh, GnuPG or signing.
  Exit1 means cancellation is still a rejection rather than a returned outcome.
- The validator uses the existing Python jsonschema environment and read-only canonical
  schema in the sibling procedure repository. It checks paired IDs,52CORE rules,32CHECK
  tasks, command/log hashes, exact baseline source and ignored unstaged evidence.

`run.py LABEL COMMAND...` records commands through the shared sequential memory guard.
Logs, source manifests, inventory and checksums stay local in ignored `AUD-029-evidence/`.
No source, key, release or dependency mutation is performed by these probes.
