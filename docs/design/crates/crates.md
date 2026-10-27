# Building blocks and crates of the Rust MnemoCode

Proposals only: every runtime dependency needs the owner's agreement (CORE-25), pinned as
`"=x.y.z"`. `crates.json` holds every block with its capabilities and all candidates; this page
gives the decisions, the evidence and what is open.

## Sources and method

- Needs: `standards`, `modules` and `platform` of the 244 capabilities in
  `model/capabilities.json` (MnemoCode `7d0d4ee`); current packages in
  `mnemocode/package.json:395-406`.
- Workspace choices: `mhfe/Cargo.toml` and `Cargo.lock`, `mnemocode/sskr-wasm/rust/Cargo.lock`,
  the five `Cargo.lock` files of `multi-chain-wallet-tools` (`packages/*-wasm/rust`, launcher).
- Versions: crates.io API on 2026-10-27, newest stable release (snapshots `work/meta/`).
- Advisories: RustSec advisory-db at `a78282a1` (2026-10-26), `cargo audit` 0.22.2 (`work/audit-d.log`).
- Tree: crates in `cargo tree -e normal --target <t>` of a one-dependency crate with the features
  listed in `work/cands.txt`, the crate and its proc-macro crates included (`work/trees.json`).
- unsafe: `unsafe {`, `unsafe fn`, `unsafe impl` in the crate's own `src` (`work/unsafe.json`).
- `no_std` is not needed: `wasm32-unknown-unknown` has `std`, and every proposed crate built for it
  (below).
- Licences: every crate of the proposed trees is MIT, Apache-2.0, BSD-2/3-Clause,
  BSD-2-Clause-Patent, Zlib, ISC, Unicode-3.0, IJG, 0BSD or CC0-1.0 in some combination (`cargo metadata`
  of `work/probe-d`, `work/probe-d-metadata.json`); Unicode-3.0 (unicode-normalization, yoke,
  zerofrom), ISC (rqrr), IJG (jpeg-encoder) and CC0-1.0 (bip39, bitcoin_hashes, hex-conservative)
  add notice text to `THIRD_PARTY_NOTICES.md`, which names the BIP-39 word lists (MIT) as provided
  by the bip39 crate, as the TS notice does for @scure/bip39.

## Decisions

1. **One RustCrypto generation, BIP39 apart.** sha2 0.11.1, hmac 0.13.0, ripemd 0.2.0, sha3
   0.12.0, hkdf 0.13.0, scrypt 0.12.0 (pbkdf2 0.13.0 inside it) and chacha20poly1305 0.11.0 share
   digest 0.11; with k256 0.14.0 and x25519-dalek 3.0.0. The bip39 crate (decision 2) brings
   bitcoin_hashes 0.14.101, a second SHA-256, SHA-512, HMAC and PBKDF2 that only the crate calls.
   bs58 without its `check` feature, which pulls sha2 0.10 (it does so in mhfe's
   `Cargo.lock`).
2. **BIP39 is the bip39 crate 3.0.0**, as in mhfe (owner, 2026-10-27: no own BIP39 code), with
   `default-features = false` and the features `zeroize` and `chinese-traditional`; off are `std`
   (it pulls serde), `alloc` (a second NFKD, into plain `String`s) and `rand` (CORE-46). The crate
   decides all that BIP39 defines: the English and Traditional Chinese lists, `find_word`, words
   to entropy with the checksum (`Mnemonic::parse_in_normalized`, `to_entropy_array`), entropy to
   words (`from_entropy_in`) and the seed (`to_seed_normalized`). MnemoCode keeps its input
   handling and formats around it: tokens split at JS `\s` after NFKD and lower case (the crate
   splits at Rust White_Space, which differs at U+0085 and U+FEFF), the count and word-place
   refusals before the crate is called, so the TS order of refusals holds, the packing of word
   indexes for its share layouts, sizes for plans and messages, Unicode codes and Seedshift. The
   searches check each candidate through the crate too: its canonical words in a stack buffer,
   then `parse_in_normalized`, 1.57 µs natively and 1.63 µs in WASM with no allocation, about 26 s
   for the word search's largest (2^24 candidates) without a wallet check; the date search's
   2^31 combinations, one check each, take about 56 minutes at that rate. Packing the indexes and
   comparing the checksum bits ourselves (289 ns) would be own BIP39 decoding. Checksum-valid last words
   (the legacy-valid mode, last-word replacement, Original Seedshift's 2^(11 - n/3) phrases per
   date) are the one place MnemoCode touches BIP39's layout: the known words go through
   `parse_in_normalized_without_checksum_check` and `to_entropy_array`, then each value of the
   entropy's free last 11 - n/3 bits through `from_entropy_in`, which derives the word and its
   checksum: 128 calls for 12 words, about 35 µs (the 34.9 µs measured for 128 `from_entropy_in`
   calls), where 2048 parses would take about 3.2 ms per date. With a wallet check
   the seed dominates: 1.10 ms natively, 1.61 ms in WASM, against 0.91 and 1.45 ms for pbkdf2
   0.13. Checked (`work/bip39-crate`): the lists equal @scure/bip39 2.4.0 and the TS self-test
   hashes; the 985 recorded scure answers; the checksum paths and the seeds agree with the TS
   method and the published vector; `cargo audit` of the locks with bip39 is clean.
3. **SSKR stays the vendored engine, unchanged** (CORE-47), linked into the WASM: no engine file,
   no SHA-256 pins. bc-ur and bc-tags go: at run time the engine takes from them only the 256
   Bytewords and two tag numbers (`sskr-wasm/rust/src/share_text.rs:17,23,25`); CBOR heads,
   CRC-32 and Bytewords are already its own code. bc-shamir takes from bc-crypto only
   `hash::hmac_sha256`, `memzero` and `memzero_vec_vec_u8` (`vendor/bc-shamir-0.13.0/src/shamir.rs:1`,
   `interpolate.rs:1`, `hazmat.rs:1`, `recovery_secret.rs:52`), yet bc-crypto's default features
   compile the C libsecp256k1, which failed to build for wasm32 with the system clang 21
   (`work/build-probe.log`: implicit `memmove`); it is the only C code of the engine's build, for
   which `Dockerfile.sskr:14-15` pins clang and wasi-libc. Nothing ready avoids this (searched
   2026-10-27, `work/online-bc`): sskr 0.12.0, bc-shamir 0.13.0, bc-crypto 0.14.0 and bc-rand
   0.5.0 of 2025-12-05 are the newest and equal their repositories' master; bc-crypto is still on
   sha2 0.10 and hmac 0.12 with secp256k1 among its defaults; the defect is open upstream since
   2026-08-07 (<https://github.com/BlockchainCommons/bc-shamir-rust/issues/4>); no other Rust crate
   implements BCR-2020-011 and none exposes these three items. Decided (d) (owner, 2026-10-27):
   - (d) the workspace's `[patch.crates-io] bc-crypto = { path = "shims/bc-crypto" }`: our own crate
     `bc-crypto` 0.14.0 with those three items over hmac 0.13.0, sha2 0.11.1 and zeroize 1.9.1,
     unsafe forbidden, no features, since bc-shamir names none (`work/shim/bc-crypto`, 32 lines).
     It holds no cryptography of its own: HMAC-SHA-256 through the same RustCrypto calls as
     bc-crypto's `src/hash.rs:61-69`, wiping through zeroize; it gives the RFC 4231 answers and the
     bytes of the published bc-crypto 0.14.0 for key lengths 0 to 200, each with message lengths 0,
     1, 31, 32, 33, 63, 64, 65, 255 and 1000 (`work/online-bc/diff-check.log`).
     Every vendored file stays byte-equal. No C code, no older RustCrypto generation: the engine's
     tree has 30 crates on wasm32, the core WASM 82 (78 before the bip39 crate); in the whole set 4 crates stay in two versions
     (getrandom and rand_core through bc-rand, miniz_oxide inside png, syn among proc macros).
     Checked (`work/build-probe-d.log`, `work/build-probe-d2.log`): copies byte-equal to
     `sskr-wasm/rust/vendor`; the bridge's 22 tests, the vendored crates' 7 tests and 5 doc tests
     pass; the 30 published BCR-2020-011 quorums, its Bytewords set and the five recorded
     deterministic splits of `vectors/sskr-v1.json` give the same bytes
     (`work/engine-d/tests/vectors.rs`); the wasm32 release build succeeds without RUSTFLAGS; no
     `cc` in the wasm32 or native tree; clippy clean on Rust 1.99.1.
   - (b) the vendored manifest with `bc-crypto` `default-features = false`: no C code, but the
     core WASM has 111 crates, 23 crates appear in two or three versions (19 only through
     bc-crypto's older RustCrypto generation), and its rand_core 0.6 needs getrandom 0.2.17 with
     the `js` feature, which brings js-sys back;
   - (c) bc-crypto replaced by hmac and sha2 in 4 vendored source files and the manifest: core
     WASM 77, the same 4 duplicates as (d).
   - (b) and (c) edit vendored files, which the owner's 2026-10-20 rule and ARCHITECTURE §2 keep
     unchanged.
4. **age v1 is own code** over chacha20poly1305, hkdf, hmac, sha2, x25519-dalek, scrypt, base64ct
   and bech32, checked with the C2SP CCTV age vectors
   (<https://github.com/C2SP/CCTV/tree/main/age>). The age crate 0.12.1 has a tree of 136 crates
   on the older RustCrypto generation, i18n and plugin code, and its p256 pulls crypto-bigint 0.5.5,
   affected by RUSTSEC-2026-0387 with no patched 0.5 release (`cargo audit` on `work/trees/ttf`).
   The header admission is MnemoCode's own already (`src/core/candidate-file-admission.ts`). In the
   WASM, X25519 no longer needs WebCrypto.
5. **Page images are drawn in-process** with tiny-skia, png and jpeg-encoder, from the same drawing
   scene that pdf-writer writes. pdftocairo, the pipe that hands it the whole backup
   (CAP-CARDS-PAGE-IMAGES) and the reader of the program's own PDFs (CAP-CARDS-PDF-READER) go.
6. **Fonts on fontations, without a shaper**: skrifa 0.49.0 and subsetter 0.2.6. ttf-parser and
   rustybuzz are unmaintained (RUSTSEC-2026-0192, RUSTSEC-2026-0206). The owner dropped ligatures
   (2026-10-27): each character is drawn as its own glyph from the cmap, so letters copied by hand
   from a card stay apart, and harfrust 0.15.0 goes; ccmp and locl go with it, which for NFC card
   text changes only a combining mark with no precomposed glyph. fontkit applies the font's GSUB (ligatures ff, fi, fl, ffi, ffl; ccmp; locl)
   and measures widths as the hmtx advances of the substituted glyphs
   (`pdf-lib/cjs/core/embedders/CustomFontEmbedder.js:61-65`), and widths decide the "too long to
   fit" refusals; without the ligatures a width is the sum of
   the characters' advances, a difference the card parity level covers (PLAN).
7. **Unicode**: NFKD and NFC from unicode-normalization 0.1.26 (Unicode 18.0.0,
   `src/tables.rs:18`), as the owner wants. Properties from unicode-properties 0.1.4 and
   unicode-script 0.5.8 (Unicode 17.0.0), the version Node.js 26.12.1 uses today (ICU 78.3,
   Unicode 17.0, `process.versions`), so the card text rules and safe display refuse what the TS
   refuses.
8. **Protections, memory, terminal and signals are mhfe's own code** over libc 0.2.191 and
   windows-sys 0.61.2, with no wrapper crate (nix, rustix, landlock, seccompiler, crossterm,
   ctrlc). Gaps against the TS that mhfe's code does not cover yet: macOS `sandbox_init` (not
   in libc: one `extern "C"` declaration), Windows WER, mitigation policies, job object and
   `VirtualLock` (all present in windows-sys 0.61.2 under `Win32_System_ErrorReporting`,
   `Win32_System_Threading`, `Win32_System_JobObjects`, `Win32_System_Memory`), and SIGTSTP and
   SIGWINCH, which ctrlc does not offer.
9. **Randomness is the library's one port; the host measures time** (`design/architect/adr/0005`,
   `0006`).
   `std::time::Instant::now` traps on `wasm32-unknown-unknown` (Rust 1.99.1, `work/instant-probe`:
   `trap: unreachable`), and the library needs time only for estimates: the CLI times its steps
   with `std::time::Instant`, the page with `performance.now`; no crate. Randomness is a
   fill-bytes port (CORE-46); its adapters use getrandom 0.4.3, whose `wasm_js` feature alone
   selects the browser backend (`src/backends.rs:172-178`). bc-rand pulls getrandom 0.3.4, which
   does the same from its `wasm_js` feature (`getrandom-0.3.4/src/backends.rs:188-192`,
   `CHANGELOG.md:9-17`): the binding enables that feature through a direct wasm32 dependency; no
   RUSTFLAGS (`work/build-probe-d.log`). No js-sys: getrandom needs it only with
   `target_feature = "atomics"` (`getrandom-0.4.3/Cargo.toml:98-101`, `getrandom-0.3.4/Cargo.toml:82`);
   mhfe takes it for `JsString` results and `Function` callbacks (`mhfe/src/wasm_api.rs:187-195`,
   `wasm_api/core.rs:286-287`), which the zeroing allocator (ADR 0003) and steps without callbacks
   (ADR 0005) make unneeded. Without it the core WASM has 6 crates fewer.
10. **Colour maths** is own code with libm 0.2.16 for `cbrt`, `pow` and `hypot`, so that the system
    libm (glibc, macOS, MSVC runtime, wasm32) cannot change a palette colour or a material sample
    between hosts (the model's defect on `material-artwork.ts:512,632`).

## Proposed set

Tree: crates of the candidate's own tree, wasm32 (native where different). Released: the
pinned version's release date; rand_chacha 0.9.0, rand_core 0.9.5 and getrandom 0.3.4 stay on
older lines because bc-rand 0.5.0 requires them (newest 0.10.0, 0.10.1 and 0.4.3).

| Crate                                                                 | Version             | Released             | Block                                | Tree                                                                                    | unsafe                             | Already in the workspace    |
| --------------------------------------------------------------------- | ------------------- | -------------------- | ------------------------------------ | --------------------------------------------------------------------------------------- | ---------------------------------- | --------------------------- |
| unicode-normalization                                                 | 0.1.26              | 2026-10-16           | NFKD, NFC                            | 2                                                                                       | 5                                  | mhfe                        |
| unicode-properties                                                    | 0.1.4               | 2025-10-30           | text properties                      | 1                                                                                       | 0                                  | no                          |
| unicode-script                                                        | 0.5.8               | 2025-12-03           | text properties                      | 1                                                                                       | 0                                  | no                          |
| sha2                                                                  | 0.11.1              | 2026-10-12           | hashes                               | 7 (8)                                                                                   | 39                                 | mhfe                        |
| hmac                                                                  | 0.13.0              | 2026-03-29           | hashes                               | 8                                                                                       | 0                                  | mhfe                        |
| bip39                                                                 | 3.0.0               | 2026-09-17           | BIP39 lists, words, entropy, seed    | 10; beside the set +4 (bitcoin_hashes 0.14.101, hex-conservative 0.2.3, arrayvec 0.7.8) | 0 (bitcoin_hashes 17, arrayvec 52) | mhfe                        |
| ripemd                                                                | 0.2.0               | 2026-03-27           | HASH160                              | 6                                                                                       | forbid                             | no                          |
| sha3                                                                  | 0.12.0              | 2026-05-15           | Keccak-256                           | 8                                                                                       | forbid                             | mhfe                        |
| k256                                                                  | 0.14.0              | 2026-07-08           | secp256k1                            | 22                                                                                      | forbid                             | mhfe                        |
| bech32                                                                | 0.12.0              | 2026-06-12           | addresses, age keys                  | 1                                                                                       | 0                                  | mhfe                        |
| bs58                                                                  | 0.5.1               | 2024-03-19           | addresses                            | 1                                                                                       | 1                                  | mhfe                        |
| zeroize                                                               | 1.9.1               | 2026-10-06           | secrets                              | 6                                                                                       | 17                                 | mhfe, sskr-wasm             |
| chacha20poly1305                                                      | 0.11.0              | 2026-06-28           | age                                  | 14 (15)                                                                                 | 0                                  | no (0.10.1)                 |
| hkdf                                                                  | 0.13.0              | 2026-03-30           | age                                  | 9                                                                                       | 0                                  | no (0.12.4)                 |
| x25519-dalek                                                          | 3.0.0               | 2026-07-06           | age                                  | 6 (12)                                                                                  | 0                                  | no (2.0.1)                  |
| scrypt                                                                | 0.12.0              | 2026-04-22           | age                                  | 15 (16)                                                                                 | 10                                 | no (0.11.0)                 |
| base64ct                                                              | 1.8.3               | 2026-01-12           | age                                  | 1                                                                                       | 4                                  | mhfe and sskr-wasm locks    |
| sskr, bc-shamir (vendored, unchanged) with own bc-crypto stand-in (d) | 0.12.0, 0.13.0      | 2025-12-05           | SSKR                                 | 30 (d); 58 as vendored, 53 (b), 29 (c)                                                  | 0; stand-in forbid                 | sskr-wasm                   |
| bc-rand, rand_chacha, rand_core                                       | 0.5.0, 0.9.0, 0.9.5 | 2025-12-05, 0.9 line | SSKR seed                            | in sskr                                                                                 | 0                                  | sskr-wasm                   |
| getrandom                                                             | 0.4.3               | 2026-06-17           | randomness adapters                  | 12 (3)                                                                                  | 109                                | mhfe                        |
| getrandom                                                             | 0.3.4               | 2025-10-14           | `wasm_js` feature for bc-rand's tree | 12 (3)                                                                                  | 92                                 | sskr-wasm, multi-chain      |
| wasm-bindgen                                                          | 0.2.129             | 2026-09-25           | WASM                                 | 11                                                                                      | 110                                | mhfe, multi-chain           |
| qrcodegen                                                             | 1.8.0               | 2022-04-17           | QR encode                            | 1                                                                                       | forbid                             | no                          |
| rqrr                                                                  | 0.11.0              | 2026-09-02           | QR decode                            | 11                                                                                      | 0                                  | no                          |
| png                                                                   | 0.18.1              | 2026-02-14           | PNG                                  | 10                                                                                      | forbid                             | no                          |
| miniz_oxide                                                           | 0.9.1               | 2026-03-13           | deflate                              | 2                                                                                       | forbid                             | multi-chain (0.8.9)         |
| jpeg-encoder                                                          | 0.7.1               | 2026-07-27           | JPEG write                           | 1                                                                                       | forbid without `simd`              | no                          |
| zune-jpeg                                                             | 0.5.15              | 2026-03-26           | JPEG decode                          | 2                                                                                       | 79                                 | no                          |
| pdf-writer                                                            | 0.15.0              | 2026-05-27           | PDF                                  | 5                                                                                       | forbid                             | no                          |
| subsetter                                                             | 0.2.6               | 2026-06-04           | font subset                          | 2                                                                                       | forbid                             | no                          |
| skrifa                                                                | 0.49.0              | 2026-10-21           | font                                 | 18                                                                                      | forbid                             | no                          |
| tiny-skia                                                             | 0.12.0              | 2026-02-02           | raster                               | 8                                                                                       | 151                                | no                          |
| libm                                                                  | 0.2.16              | 2026-01-24           | colour maths                         | 1                                                                                       | 56                                 | multi-chain (dash-shielded) |
| thiserror                                                             | 2.0.21              | 2026-09-23           | SSKR (the vendored manifests pin it) | 1 (5 at build time)                                                                     | 0                                  | mnemocode `sskr-wasm`       |
| libc                                                                  | 0.2.191             | 2026-10-16           | native protections, terminal         | 1                                                                                       | 790                                | mhfe                        |
| windows-sys                                                           | 0.61.2              | 2025-10-06           | native protections, console          | 2                                                                                       | 12530                              | mhfe                        |

"forbid": none, and the crate forbids or denies `unsafe_code`.

38 direct runtime dependencies: 25 for the core (bip39 in place of pbkdf2, which stays in the tree
inside scrypt), 11 for rendering (no harfrust), 2 native only; 17 of them are
new to the workspace or a new version of a crate in its locks (the rows marked "no" and
miniz_oxide 0.9.1). Under (d) the bc-crypto stand-in is own code, not a dependency.

Whole trees (`work/split-{b,c,d}`, `work/probe`, `work/probe-c`, `work/probe-d`):

|                                | core WASM | rendering | all, native |
| ------------------------------ | --------- | --------- | ----------- |
| (d) bc-crypto stand-in         | 82        | 52        | 124         |
| (b) bc-crypto without defaults | 111       | 53        | 149         |
| (c) bc-crypto replaced         | 77        | 53        | 121         |

(d) with the bip39 crate and without harfrust (`work/bip39-crate`, `work/no-shaper`: only
harfrust leaves the trees, its other crates being skrifa's); (b) and (c) were measured before
both changes.

## wasm32 check

Probe crates (every proposed crate, Rust 1.99.1, `cdylib`), built under the shared lock with
`CARGO_BUILD_JOBS=4`, no RUSTFLAGS and no `.cargo/config.toml`:

- `work/probe-d`, the recommended set: the vendored engine byte-equal, the stand-in patched in;
  release build for `wasm32-unknown-unknown` and native `cargo check` succeed
  (`work/build-probe-d.log`); the engine's own crate with the stand-in in `work/engine-d`
  (decision 3);
- `work/probe`, (b) from the crates.io engine: with bc-crypto's defaults `secp256k1-sys` 0.11.0
  fails to compile for wasm32 (`work/build-probe.log`); with `default-features = false`
  (`work/patched/bc-shamir`) debug and release builds for wasm32 and native `cargo check` succeed
  (`work/build-probe-2.log`);
- `cargo audit` on the (d) lock (142 entries), (b) (180) and (c) (141): no vulnerability, no
  warning (`work/audit-d.log`).
- `work/bip39-crate`: the RustCrypto set with and without bip39 3.0.0, built for wasm32 in
  release (116,892 and 221,282 bytes); agreement tests and timings in `run.log` and `run2.log`;
  `cargo audit` on the (d) locks with bip39 (97 and 145 entries): no vulnerability, no warning.

Option (c) was resolved (`work/probe-c`), not built.

## Blocks

Recommended choice first; the other candidates with tree size, unsafe and the reason against them
are in `crates.json`.

| Block                                                 | Current                          | Recommendation                                                                                            | Reason                                                     |
| ----------------------------------------------------- | -------------------------------- | --------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------- |
| BIP39 lists, lookup, words, entropy, seed             | @scure/bip39 + own               | bip39 3.0.0 (zeroize, chinese-traditional)                                                                | decision 2                                                 |
| NFKD, NFC                                             | `String.normalize` (Unicode 17)  | unicode-normalization 0.1.26                                                                              | decision 7                                                 |
| Unicode properties, cell widths                       | JS `\p{}`, own ranges            | unicode-properties 0.1.4, unicode-script 0.5.8, own constants                                             | decision 7                                                 |
| PBKDF2-HMAC-SHA512                                    | host (OpenSSL)                   | bip39 3.0.0 `to_seed_normalized`                                                                          | decision 2; 1.10 ms per seed natively, 1.61 ms in WASM     |
| Hashes, HMAC                                          | @noble/hashes, OpenSSL           | sha2, hmac, ripemd, sha3                                                                                  | decision 1                                                 |
| BIP32, SLIP-132                                       | @scure/bip32                     | own code from `mhfe/src/wallet.rs`                                                                        | bip32 0.6.0 brings 38 crates and sha2 0.10                 |
| secp256k1, Taproot                                    | @noble/curves                    | k256 0.14.0; tweak from `mhfe/src/wallet.rs:1029-1060`                                                    | pure Rust; secp256k1 0.33.1 is C                           |
| Address encodings                                     | @scure/base, @scure/btc-signer   | bs58 0.5.1, bech32 0.12.0; Base58Check checksum, CashAddr (`mhfe/src/wallet.rs:599-660`), EIP-55, WIF own | decision 1                                                 |
| SSKR                                                  | vendored engine in its own WASM  | vendored engine linked in unchanged, bc-crypto stand-in (d)                                               | decision 3                                                 |
| Bytewords, UR, CBOR                                   | own + bc-ur list                 | own code, BCR-2020-012 and -005 vectors                                                                   | decision 3                                                 |
| CRC-32                                                | own                              | own code                                                                                                  | the core must not depend on png                            |
| age v1                                                | age-encryption 0.3.1             | own code over RustCrypto and dalek                                                                        | decision 4                                                 |
| QR encode                                             | qrcode 1.5.4                     | qrcodegen 1.8.0                                                                                           | PLAN, parity with TS                                       |
| QR decode                                             | jsQR 1.4.0                       | rqrr 0.11.0                                                                                               | PLAN, parity with TS                                       |
| PNG                                                   | pngjs 7.0.0, zlib                | png 0.18.1 behind the ported admission                                                                    | forbids unsafe, decoder limits                             |
| Deflate                                               | pako, zlib                       | miniz_oxide 0.9.1                                                                                         | already in png's tree                                      |
| JPEG                                                  | pdf-lib pass-through, pdftocairo | jpeg-encoder 0.7.1, zune-jpeg 0.5.15                                                                      | decision 5                                                 |
| PDF write                                             | pdf-lib 1.17.1                   | pdf-writer 0.15.0                                                                                         | low level, no metadata unless written                      |
| PDF read                                              | own reader over pdf-lib          | none                                                                                                      | decision 5                                                 |
| Fonts, subset                                         | @pdf-lib/fontkit 1.1.1           | skrifa, subsetter; no shaper                                                                              | decision 6                                                 |
| Raster                                                | pdftocairo                       | tiny-skia 0.12.0                                                                                          | decision 5                                                 |
| Colour maths                                          | own                              | own code, libm 0.2.16                                                                                     | decision 10                                                |
| Randomness                                            | node:crypto, getRandomValues     | port; getrandom 0.4.3 in adapters, 0.3.4 feature in the binding                                           | decision 9                                                 |
| Wiping, owner types                                   | own SecretValue                  | zeroize 1.9.1, types as `mhfe/src/memory.rs`                                                              | RUST-13                                                    |
| Memory locking, swap warning                          | none, /proc/swaps                | own code from mhfe over libc, windows-sys                                                                 | decision 8                                                 |
| No core dumps, no debugger                            | node:ffi                         | own code over libc, windows-sys                                                                           | decision 8                                                 |
| seccomp                                               | node:ffi                         | own code from `mhfe/src/bin/mhfe/protect.rs:620-713`                                                      | decision 8                                                 |
| Landlock                                              | node:ffi                         | own code from `mhfe/src/bin/mhfe/protect.rs:715-880`                                                      | decision 8                                                 |
| Terminal                                              | Node tty, /bin/stty              | own code from `mhfe/src/bin/mhfe/hidden_input.rs`, `terminal.rs`                                          | decision 8                                                 |
| Signals                                               | Node process                     | own sigaction, SetConsoleCtrlHandler                                                                      | decision 8                                                 |
| Arguments                                             | own                              | own code                                                                                                  | messages and help are RUST-14 results; clap writes its own |
| WASM bindings                                         | wasm-bindgen 0.2.129             | wasm-bindgen 0.2.129                                                                                      | workspace pin; no js-sys (decision 9)                      |
| Clock                                                 | performance.now, turns           | none in the library: the host measures                                                                    | decision 9                                                 |
| Files                                                 | node:fs                          | std, libc                                                                                                 | one std call per step                                      |
| Dates, repair algebra, JSON, Padmé, assets, world map | own                              | own code                                                                                                  | no primitive involved                                      |

Capabilities with no building block beyond `std`: CAP-PHRASE-FORMATS-FORM-SELECTION,
CAP-WALLET-BITCOIN-PROFILES, CAP-SSKR-FORM-CHOICE, CAP-CLI-SHELL-QUOTED-COMMAND; release
capabilities (CAP-CLI-LICENSE-NOTICES, -EXECUTABLE-VERIFICATION, -RELEASE-PIPELINE, -NPM-PACKAGE)
need tools, not runtime crates.

## Owner decisions

Decided on 2026-10-27: the runtime crates (CORE-25), now 38 with 17 new to the workspace;
BIP39 from the bip39 crate (decision 2); ligatures dropped (decision 6); the parity levels
where byte equality cannot hold (`design/architect/PLAN.md`, "Parity with TS 0.1.0"); the
bc-crypto adapter (d) after the online search (decision 3). Nothing is open.
