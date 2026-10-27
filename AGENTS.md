# MnemoCode in Rust: notes for agents

The workspace `AGENTS.md` and its coding guide apply. This repository adds:

- The design comes first: `docs/design/architect/` (architecture, gates, plan, ADRs) and
  `module-map.json`. A change that departs from them changes them in the same commit.
- Every tool, gate and check is Rust (TOOL-01; owner, 2026-10-27: no Node in this repository),
  a task of the `xtask` crate. The fast gates of CORE-43: `cargo xtask check` (rustfmt, dprint,
  clippy for every crate and for the binding's wasm32 build with each module alone, doc, tests,
  code-rules, copies, Markdown lists, notices, action pins, every page's WebAssembly file built and
  started in wasmi against its glue, the RustSec audit). Run it before every commit, with the workspace's Rust and
  `CARGO_BUILD_JOBS=4` under the workspace's heavy-checks lock.
- The TS known answers: the TS repository's `pnpm record:rust-parity <this repo>/vectors/ts-0.1.0`
  writes them from a clean commit there; never edit them by hand (DOC-04).
- `vendor/` holds the SSKR engine exactly as `UPSTREAM.json` records it; never edit it. The
  `bc-crypto` stand-in in `shims/` replaces crates.io's through `[patch.crates-io]`.
- Every browser-facing change goes to the wallet-tools session (workspace `AGENTS.md`).
