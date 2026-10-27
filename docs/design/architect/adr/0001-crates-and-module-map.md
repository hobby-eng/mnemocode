# Four crates and a checked module map

## Context

The 244 capabilities form an acyclic graph whose five model domains are not layers: masking rules
use the share-form choice, backup reading uses shares and marked codes, share restoring uses the
date search (`model/graph.json`). The owner wants boundaries enforced by gates (requirement 4), a
library both front ends call (CORE-01, RUST-15), and no inflated structure (requirement 7). Cargo
enforces direction between crates only; inside a crate any `pub(crate)` item is reachable.

## Decision

Four crates: `mnemocode` (every rule), `mnemocode-cards` (drawing), `mnemocode-cli` (the binary and
its OS code), `mnemocode-wasm` (the bindings), plus the vendored SSKR crates unchanged, workspace
members as in TS, and the bc-crypto stand-in `shims/bc-crypto` (owner, 2026-10-27)
(ARCHITECTURE.md §2). Inside a crate,
modules follow the module map of ARCHITECTURE.md §3, kept in the repository as `module-map.json`
and compared by the `code-rules` layers check with every `use` path. The same file lists each
crate's allowed direct dependencies, a second check over `cargo metadata`.

## Rejected alternatives

- A crate per model domain (phrase, wallet, sskr, recovery, cards): cycles between domains
  (MASKING-RULES → SSKR-FORM-CHOICE → FORM-SELECTION), so pieces would move between crates anyway,
  and a module check is still needed inside each crate.
- A crate per unit (coin, share form, template, search): about 35 manifests for what a feature and
  a registry line do.
- One crate with everything: drawing dependencies and artwork would sit in the core tree, and the
  library could not be told apart from the front ends by Cargo.
- A native-adapter crate apart from the CLI: no second user; mhfe keeps its protections in its
  binary (`mhfe/src/bin/mhfe/protect.rs`).

## Consequences

- Cargo refuses the rules depending on drawing, the CLI or the binding; the script refuses an
  edge inside a crate that the map does not list, and a listed edge no code uses.
- `make-mapping.py` already holds the capability graph to this map, read from `module-map.json`:
  51 edges are redrawn, each with its reason.
- A new module or edge is a change of `module-map.json`, seen in review.
