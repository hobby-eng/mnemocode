# mnemocode agent instructions

This repository is part of the `bip_tools` workspace. If a workspace `AGENTS.md` exists one directory above this repository, read and follow it first. Its core rules: edit only this checkout in place, never create another copy or worktree, never delete project directories, use the toolchains it names, use only public test data, do not commit or push without an explicit request, and write everything in English only (code, comments, commits, documentation).

MnemoCode is a standalone offline program: it never depends on the other workspace projects (no import, no build step, no run-time link). They are named only where a reader needs them: comments name mhfe as the model of the terminal style, and the documents and help name MHFE as a separate program for encrypted long-term storage and as the source of the coin list, and the multi-chain wallet tools as a host of the library.

## Commands

- Install: `pnpm install --frozen-lockfile` (pnpm via Corepack, from `package.json` `packageManager`; Node.js from `.node-version`).
- Targeted: `pnpm check` (toolchain pins, no blank line inside a Markdown list, the release key's fingerprint in the documents that show it (`scripts/release-key.mjs`), no owner name and only UTC times in the published audit files (`scripts/verify-audit-privacy.mjs`), every published audit file in the npm package listing (`scripts/verify-audit-package.mjs`, an `npm pack --dry-run`), no copied code of 50 tokens or more in `src/` and `scripts/` (`scripts/verify-no-copies.mjs`; a deliberate copy says "deliberate copy" in a comment with its reason), `tsc` for the source and the tests, for `src/cards.ts` without Node.js types, and for the library modules under the strict options of a host (`tsconfig.strict-consumers.json`)); `pnpm exec vitest run <file>`; `pnpm build` then `node dist/mnemocode.js self-test`; after a change to the menu or hidden input, `pnpm build` then `python3 scripts/verify-terminal-input.py` (a real pseudo-terminal).
- Release-level (explicit request only): `pnpm verify` (format check, `pnpm check`, build, full tests); `pnpm audit --audit-level high`; `npm pack --dry-run --json --ignore-scripts`, a review of the whole file list (`pnpm check` checks only that the audit files are in it).
- Release notes: `docs/releases/v<version>.md`, written before tagging from the version's section of `CHANGELOG.md`; `.github/workflows/executable.yml` makes it the text of the draft release and refuses a tag without it.
- Release signing: `docs/RELEASING.md`. A tag only creates a draft release; the owner runs `node scripts/sign-release.mjs v<version>` (checks the draft, OpenPGP-signs `SHA256SUMS` with GnuPG, uploads the signature; `--publish` publishes, `--dry-run` prints the commands). Never run it without the owner's request.
- Formatting: `pnpm format:check`; `docs/audits/` is excluded from the formatter and must stay excluded.
- Protection: every run is under the Node.js permission model (`src/cli/protection.ts`, flags in `src/cli/protection-flags.json`, also embedded in the executable). A command that newly writes files or starts a program must say so in `neededPermissions`, or it fails with `ERR_ACCESS_DENIED`.
- SSKR engine: the Rust source is `sskr-wasm/rust/`. `pnpm build:sskr` builds it offline in `Dockerfile.sskr`, which declares each tool's version once, and rewrites `sskr-wasm/generated/` and `sskr-wasm/integrity.json`; `pnpm verify:sskr` rebuilds it and compares byte for byte, a long check for a release. Never replace the generated files with a host build.

## Generated exports

Never commit generated cards, PDFs, PNG/JPEG images, QR images, share files or encoded records. Write them to `output/` or an `export-*/` folder; both are ignored by Git.

## Documents

`README.md`, `CHANGELOG.md`, every document in `docs/` (all shipped in the package), and the audit records in `docs/audits/` with their harnesses (their evidence stays local, ignored by Git).
