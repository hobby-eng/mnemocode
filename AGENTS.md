# mnemocode agent instructions

This repository is part of the `bip_tools` workspace. If a workspace `AGENTS.md` exists one directory above this repository, read and follow it first. Its core rules: edit only this checkout in place, never create another copy or worktree, never delete project directories, use the toolchains it names, use only public test data, do not commit or push without an explicit request, and write everything in English only (code, comments, commits, documentation).

MnemoCode is a standalone offline program. Do not mention or depend on the other workspace projects in its code or documentation.

## Commands

- Install: `pnpm install --frozen-lockfile` (pnpm 12.8.1 via Corepack; Node 26.10.0 from `.node-version`).
- Targeted: `pnpm check` (toolchain pins + `tsc --noEmit`); `pnpm exec vitest run <file>`; `pnpm build` then `node dist/mnemocode.js self-test`.
- Release-level (explicit request only): `pnpm verify` (format check, type check, build, full tests); `pnpm audit --audit-level high`; `npm pack --dry-run --json --ignore-scripts`.
- Release notes: `docs/releases/v<version>.md`, written before tagging from the version's section of `CHANGELOG.md`; `.github/workflows/executable.yml` publishes that file and refuses a tag without it.
- Formatting: `pnpm format:check`; `docs/audits/` is excluded from the formatter and must stay excluded.
- SSKR engine: the Rust source is `sskr-wasm/rust/`. `pnpm build:sskr` builds it offline in `Dockerfile.sskr` (Rust 1.99.0, clang 18, wasm-bindgen 0.2.129) and rewrites `sskr-wasm/generated/` and `sskr-wasm/integrity.json`; `pnpm verify:sskr` rebuilds it and compares byte for byte, a long check for a release. Never replace the generated files with a host build. The toolchain stage of `Dockerfile.sskr` is a copy of the one in multi-chain-wallet-tools' `Dockerfile.reproducible`; change both together.

## Generated exports

Never commit generated cards, PDFs, PNG/JPEG images, QR images, share files or encoded records. Write them to `output/` or an `export-*/` folder; both are ignored by Git.

## Documents

`README.md`, `docs/ARCHITECTURE.md`, `docs/SSKR.md`, `docs/card-designs.md`, `docs/card-identities.md`, `CHANGELOG.md`, audit records in `docs/audits/` (AUD-001, AUD-002 and their evidence).
