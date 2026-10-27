# MnemoCode in Rust: notes for agents

The workspace `AGENTS.md` and its coding guide apply. This repository adds:

- The design comes first: `docs/design/architect/` (architecture, gates, plan, ADRs) and
  `module-map.json`. A change that departs from them changes them in the same commit.
- The fast gates of CORE-43: `scripts/check.sh` (rustfmt, clippy for every crate and for the
  binding's wasm32 build with each module alone, doc, tests, code-rules, copies, Prettier, Markdown
  lists, notices, every page's WebAssembly file). Run it before every commit, with the workspace's
  Rust and Node.js and `CARGO_BUILD_JOBS=4` under the workspace's heavy-checks lock.
- The TS known answers: `node parity/record.mjs ../mnemocode <commit>` writes `vectors/ts-0.1.0/`
  from the TS build of that commit; never edit them by hand (DOC-04).
- `vendor/` holds the SSKR engine exactly as `UPSTREAM.json` records it; never edit it. The
  `bc-crypto` stand-in in `shims/` replaces crates.io's through `[patch.crates-io]`.
- Every browser-facing change goes to the wallet-tools session (workspace `AGENTS.md`).
