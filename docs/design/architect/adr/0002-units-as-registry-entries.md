# Units are registry entries behind Cargo features

## Context

Requirement 3: a coin family, a share form, a card template and a recovery search are each a unit a
host takes or leaves, with its own checks; adding one must not touch the core. CORE-31: a build
without a unit carries none of its checks or text (the Dash edition has no Bitcoin or Ethereum
text). wallet-tools already builds editions with fewer coins and without shares or cards
(`multi-chain-wallet-tools/tooling/key-derivation-features.mjs:115-162`,
`packages/recovery-backup/src/mnemocode-offered-coins.ts:1-8`). The TS reaches the same through
39 entry modules and a test (CAP-CLI-PORTABLE-PARTS).

## Decision

Every registry is a trait, one module per entry and one static list in the registry module; the
list line of an entry carries `#[cfg(feature = "<unit>")]` (checked to compile on stable Rust with
a probe, rustc 1.98.1). An entry brings its own self-check rows through its trait, so the rows
follow the feature. Registries: coins, encoded forms, modes, share forms, card templates, self-check
rows. Features: `coin-*` (12), `sskr`, `share-form-*` (6), `search-date`, `search-word`,
`search-marked-codes`, `template-*` (13); default all. Forms and modes are registries without
features: every host takes them.

## Rejected alternatives

- Closed enums with `match` in every caller: a new item grows cases in many places (CORE-06).
- Linker-section registration (inventory, linkme): a new dependency, and the linker instead of one
  list decides the order, which is a recorded result (RUST-14).
- One feature per model capability: 244 switches, most of which no host leaves out.

## Consequences

- Front ends read option values, help lists, menu answers and self-test rows from the registries;
  adding an entry changes its module, one list line and the manifests' feature lists.
- Each unit feature must build alone: the feature matrix gate (release) and the edition builds
  (every push) keep the cfg lines honest.
- Shared readers (Base58Check, Bech32, EVM, places, marked codes) are built with any unit that uses
  them; a unit never reaches another unit's module.
- Amended with increments 3 and 4 (2026-10-27): forms and modes, which no build leaves out, are
  closed enums, not traits: a sixth form or a fifth mode is a variant whose every `match` the
  compiler names, without a trait object or a list for what never varies by build. Coins, share
  forms, templates and searches stay entries behind their features.
