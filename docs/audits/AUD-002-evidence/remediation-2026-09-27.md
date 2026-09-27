# AUD-002 remediation follow-up — 2026-09-27

All eight findings were corrected in commit
`b71aff4a5a1d3f5fcd07d6f0197df6e3729ebe55` and pushed to `origin/main`.

| Finding | Disposition | Verification |
| --- | --- | --- |
| AUD-002-BLD001 | verified | Correct invalid-checksum contract, different valid BIP84 address, BIP86/case/network regressions; local `pnpm verify` and GitHub CI pass. |
| AUD-002-SEC001 | verified | WIF, BIP39 passphrase and SSKR share files use the shared 1 MiB reader; exact-boundary, over-limit file and over-limit stdin tests pass. |
| AUD-002-API001 | verified | Shared canonical base-10 parser rejects hex, exponent, sign, padding, decimal and whitespace forms across table, recovery, derivation and SSKR commands. |
| AUD-002-API002 | verified | Address/WIF/xpub decode failures are stable and redacted; missing sources and nested/nonexistent output chains return project errors; overlap detection remains active. |
| AUD-002-API003 | verified | Truncation, signature, IHDR length/type, zero/excess dimensions, byte budget and decoder corruption are distinct; generated QR PNG still decodes. |
| AUD-002-DOC001 | verified | AUD-001 Markdown/JSON remediation, audit index and README are reconciled without deleting historical observations. |
| AUD-002-DOC002 | verified | PNG limits, Prettier/pnpm versions and pnpm commands are aligned. |
| AUD-002-DOC003 | verified | Reformatting and all 47 affected paths are documented; the regenerated AUD-001 manifest verifies. |

## Verification results

- `corepack pnpm install --frozen-lockfile`: passed.
- `corepack pnpm verify`: passed, including a clean TypeScript build and 343/343
  tests in 18/18 files.
- `corepack pnpm test:coverage`: passed, 341/341 tests. Global V8 coverage is
  55.70% statements, 43.28% branches, 66.13% functions and 56.67% lines. The
  remediation cases are explicit regressions; this is not a claim of exhaustive
  coverage of every renderer and CLI orchestration branch.
- `corepack pnpm audit --json`: exit 0, zero vulnerabilities at every severity,
  168 total dependencies.
- Audit JSON schema validation: AUD-001 and AUD-002 valid; no duplicate keys.
- AUD-001 evidence `sha256sum -c SHA256SUMS`: all entries pass after the documented
  manifest regeneration.
- GitHub Actions run [36338523182](https://github.com/hobby-eng/mnemocode/actions/runs/36338523182):
  passed frozen install, check, build, 343 tests and `pnpm audit --audit-level high`.

## Retained limits

Windows/macOS, physical print/camera, allocation/full-disk/RNG fault injection and
independent cryptographic review remain outside this follow-up.
