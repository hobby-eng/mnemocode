# AUD-001 remediation follow-up — 2026-09-27

This note records later work committed as `b71aff4a5a1d3f5fcd07d6f0197df6e3729ebe55`
in the authoritative `mnemocode` repository. It does not rewrite the original audit
logs. Public and synthetic fixtures only were used.

## Disposition

- `AUD-001-SEC001`, `AUD-001-SEC002`, `AUD-001-FUN001`, `AUD-001-FUN002`, `AUD-001-API001`,
  `AUD-001-BLD001` and `AUD-001-DOC001`: verified by the AUD-002 follow-up and its
  successful GitHub CI run. `pnpm audit --json` reports zero vulnerabilities across
  168 dependencies. Address coverage includes BIP84 and BIP86 case rules, a different
  valid address, invalid checksum and wrong network.

## Commands re-run

- `corepack pnpm install --frozen-lockfile` — passed.
- `corepack pnpm verify` — passed: formatting, pinned-toolchain check, TypeScript,
  clean build, 18 test files and 343 tests.
- `corepack pnpm test:coverage` — passed: the same 341 tests; 55.70% statements,
  43.28% branches, 66.13% functions and 56.67% lines globally.
- `corepack pnpm audit --json` — exit 0; zero info/low/moderate/high/critical findings.
- Both audit JSON files validated against the canonical schema; no duplicate keys.
- GitHub Actions run [36338523182](https://github.com/hobby-eng/mnemocode/actions/runs/36338523182)
  passed frozen install, check, build, 343 tests and the high-severity dependency audit.

## Integrity-manifest correction

The following 47 entries had been mechanically reformatted before audit evidence
was excluded from Prettier. Their old hashes could no longer describe the retained
bytes; all 25 command-companion hashes of their referenced logs still matched.

`boundary-probes.command.json`, `build-artifacts.json`, `build.command.json`,
`dependency-audit-all.command.json`, `dependency-audit.command.json`,
`docs-local-links.json`, `environment.command.json`, `existing-artifacts.json`,
`extra-probes-retry.command.json`, `extra-probes.command.json`, `extra-probes.json`,
`harnesses/audit-extra.mjs`, `harnesses/audit-final-checks.mjs`,
`harnesses/audit-output-alias.mjs`, `harnesses/audit-probes.mjs`,
`harnesses/audit-render-matrix.mjs`, `harnesses/audit-static.mjs`,
`image-export-jpg.command.json`, `image-export-png.command.json`,
`image-export-verification.command.json`, `image-export-verification.json`,
`installed-test-format.command.json`, `installed-verify.command.json`,
`output-alias.command.json`, `output-alias.json`, `package-inventory.command.json`,
`post-test-snapshot.json`, `procedure-hashes.json`, `qr-render.command.json`,
`render-matrix-retry.command.json`, `render-matrix.command.json`, `render-matrix.json`,
`report-validation.json`, `scoped-snapshot.json`, `scoped-source-manifest.json`,
`self-test.command.json`, `snapshot.json`, `static-review-final.command.json`,
`static-review.command.json`, `static-review.json`, `test-remediation.json`,
`tests-host.command.json`, `tests.command.json`, `updated-final-tests.command.json`,
`updated-full-tests.command.json`, `updated-targeted.command.json`, `visual-review.json`.

`SHA256SUMS` was regenerated from every current evidence file except itself after
this note was added. The original mismatch remains visible in AUD-002 evidence.
