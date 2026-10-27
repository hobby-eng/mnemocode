# One WASM file per page

## Context

Requirement 5: wallet-tools pages embed one or two MnemoCode WASM files, never dozens, with features
chosen at build time. The pages are single HTML files that embed every byte
(`multi-chain-wallet-tools/dist/multi-chain-edition/key-derivation/Wallet_Key_Derivation_Tool.html`
25.9 MB,
`multi-chain-wallet-tools/dist/multi-chain-edition/discovery-scanner/Wallet_Discovery_Scanner.html`
11.5 MB). The Deriver uses every part and prints cards
(`apps/key-derivation/src/ui/recovery-mnemocode-cards.ts`, `recovery-mnemocode-card-images.ts`);
the Discovery Scanner only opens candidate lists
(`apps/discovery-scanner/src/candidate-list-import.ts:11-26`). Editions offer different coins and
parts (ADR 0002). mhfe ships one WASM with `browser-*` features, built in its repository and
vendored with `modules.json` and a build id
(`multi-chain-wallet-tools/packages/recovery-mhfe-wasm/README.md`).

## Decision

`mnemocode-wasm` is built once per page profile: `wasm-profiles.json` names, per edition and page,
the `browser-*` modules and the unit features, and the page embeds that one file. The Deriver's
file has every module with `browser-cards`; the Scanner's has `browser-candidates` and no unit.
MnemoCode builds and verifies the files reproducibly; wallet-tools vendors them with
`modules.json`, as it does mhfe's.

## Rejected alternatives

- Two files per edition, rules and drawing: the Deriver embeds both, and the drawing file repeats
  bip39, forms, modes, backup, sskr and qr with their crates; the Scanner still gets every part.
- One file per edition with everything: the Scanner carries drawing, searches and shares it never
  calls.
- A file per part: dozens of files, against requirement 5.
- wallet-tools building from MnemoCode sources: two build recipes for one artifact.

## Consequences

- A page's operations run in one instance; nothing passes between WASM files. A page that wants
  drawing apart, for example in a worker, instantiates the same file again.
- The artifact gate checks per profile that the exports match its modules and that no text of a
  left-out unit is in the bytes (CORE-31).
- A new page or edition is a new profile line, agreed with the wallet-tools session.
