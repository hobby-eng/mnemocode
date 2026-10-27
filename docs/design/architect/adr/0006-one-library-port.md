# One library port: randomness

## Context

The TS takes from its host PBKDF2, HMAC, the SSKR engine, PNG and QR codecs, a uniform choice,
bundled files, a clock, abort signals and a wallet-check callback (CAP-SSKR-HOST-PLATFORM,
CAP-CARDS-RENDER-PLATFORM, CAP-WALLET-HOST-CHECK-CONTRACT), because JavaScript hosts differ. A
Rust build links one implementation of each everywhere. CORE-09 and CORE-46 ask for randomness from
outside; CORE-13 says a seam with one implementation and no fake is indirection; requirement 3 asks
for ports for every host service.

## Decision

The library has one port, `random::Random` (fill bytes, fallible), with adapters over getrandom
0.4.3 in the CLI and in the binding (`wasm_js`), and a deterministic fake in tests. Everything else
is linked (the bip39 crate with its PBKDF2, hmac, the vendored engine, qrcodegen, rqrr, png, fonts) or stays with the host:
the clock (the host times each search's public pace sample and its steps, ADR 0005), files and
terminal (the CLI). The wallet check is the library's own; the host gives wallet evidence as data
and gets a typed `WalletMatch`. Secret page locks and the allocator are `cfg` adapters per target,
not traits.

## Rejected alternatives

- Keeping the TS host platforms as traits: one implementation each and no fake (CORE-13), and
  callbacks into JS per candidate would carry phrases out of the WASM.
- A clock port: the library needs time only for estimates, which the host can compute from the
  pace it measures; `Instant::now` traps on wasm32 (crates report decision 9).

## Consequences

- No host can swap the PBKDF2 or the engine; a second engine would be a new decision.
- The malformed-answer refusals of the wallet-check contract cannot occur and are not written.
- The library has no clock, file, process or environment calls: `clippy.toml`'s
  `disallowed-methods` and `disallowed-types` for the library crates make that a gate.
