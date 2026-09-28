# mnemocode agent instructions

This repository is part of the `bip_tools` workspace. If a workspace `AGENTS.md` exists one directory above this repository, read and follow it first. Its core rules: edit only this checkout in place, never create another copy or worktree, never delete project directories, use the toolchains it names, use only public test data, do not commit or push without an explicit request, and write everything in English only (code, comments, commits, documentation).

MnemoCode is a standalone offline program. Do not mention or depend on the other workspace projects in its code or documentation.

## Commands

- Install: `pnpm install --frozen-lockfile` (pnpm 10.19.0 via Corepack; Node 26.10.0 from `.node-version`).
- Targeted: `pnpm check` (toolchain pins + `tsc --noEmit`); `pnpm exec vitest run <file>`; `pnpm build` then `node dist/mnemocode.js self-test`.
- Release-level (explicit request only): `pnpm verify` (format check, type check, build, full tests); `pnpm audit --audit-level high`; `npm pack --dry-run --json --ignore-scripts`.
- Formatting: `pnpm format:check`; `docs/audits/` is excluded from the formatter and must stay excluded.
- Vendored SSKR WASM in `vendor/sskr/` is regenerated only in the pinned reproducible container recorded in `docs/audits/` (Rust 1.98.1, clang 18, wasm-bindgen 0.2.128) and compared byte for byte against `vendor/sskr/integrity.json`; never replace it with a host build.

## Generated exports

Never commit generated cards, PDFs, PNG/JPEG images, QR images, share files or encoded records. Write them to `output/` or an `export-*/` folder; both are ignored by Git.

## Documents

`README.md`, `docs/ARCHITECTURE.md`, `docs/SSKR.md`, `docs/card-designs.md`, `docs/card-identities.md`, `CHANGELOG.md`, audit records in `docs/audits/` (AUD-001, AUD-002 and their evidence).
