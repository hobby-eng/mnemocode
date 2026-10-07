# Third-party notices

## Seedshift

MnemoCode implements a compatible date-shift mode based on the public behavior
and documentation of [Seedshift](https://github.com/mifunetoshiro/Seedshift) by
mifunetoshiro. Seedshift is distributed under the MIT License. See `NOTICE`.

## BIP39Colors

MnemoCode implements the documented color-code format of
[BIP39Colors](https://github.com/EnteroPositivo/bip39colors) by EnteroPositivo for
12- and 24-word containers. BIP39Colors is licensed under CC BY 4.0. This project
does not include the BIP39Colors source code; `NOTICE` provides attribution.

## BIP39 word lists

The English and Traditional Chinese BIP39 word lists are the standard lists from
[BIP-39](https://github.com/bitcoin/bips/blob/master/bip-0039.mediawiki). They are
provided by the `@scure/bip39` dependency in this project.

## @scure libraries

MnemoCode depends on [`@scure/bip39`](https://github.com/paulmillr/scure-bip39),
[`@scure/bip32`](https://github.com/paulmillr/scure-bip32),
[`@scure/btc-signer`](https://github.com/paulmillr/scure-btc-signer), and
[`@scure/base`](https://github.com/paulmillr/scure-base), which reads and writes the
addresses of the other coins, which are MIT licensed. Their pinned versions are recorded in `package.json` and the
lockfile after installation.

## age encryption and @noble libraries

Candidate lists are encrypted with [`age-encryption`](https://github.com/FiloSottile/typage)
by Filippo Valsorda, which is licensed under the BSD 3-Clause License; its built files
carry no license header, so this notice names it. It uses
[`@noble/ciphers`](https://github.com/paulmillr/noble-ciphers),
[`@noble/curves`](https://github.com/paulmillr/noble-curves),
[`@noble/hashes`](https://github.com/paulmillr/noble-hashes),
[`@noble/post-quantum`](https://github.com/paulmillr/noble-post-quantum) and
[`@scure/base`](https://github.com/paulmillr/scure-base) by Paul Miller, which are MIT
licensed. MnemoCode also uses `@noble/hashes` directly for the checksum test of the word
search and, with `@noble/curves`, for the addresses of the other coins: SHA-256,
RIPEMD-160 and Keccak-256 of their keys, and secp256k1 and Taproot output keys. Their pinned versions are recorded in `package.json` and the lockfile.

## QR generation and reading

QR PNG generation uses [`qrcode`](https://github.com/soldair/node-qrcode),
which is MIT licensed. The standalone CLI's local PNG QR reader uses
[`jsQR`](https://github.com/cozmo/jsQR) and
[`pngjs`](https://github.com/pngjs/pngjs). jsQR is Apache-2.0 licensed; pngjs is
MIT licensed. Their pinned versions are recorded in `package.json` and the
lockfile after installation.

## Embedded Droid Sans Fallback subset

`assets/fonts/DroidSansFallback-BIP39.ttf` is a generated subset of Droid Sans Fallback
covering the Traditional Chinese BIP39 symbols. Droid Sans Fallback is licensed under Apache License 2.0. The
upstream notice and full license are included as `assets/fonts/DroidSansFallback-NOTICE`.
The reproducible subset script is `scripts/build-cjk-font.py`; it does not alter
the character outlines.

`assets/fonts/DejaVuSans-UI.ttf` is a generated subset of DejaVu Sans covering
ASCII and Cyrillic text used by headings and event labels. Its upstream license
notice is included as `assets/fonts/DejaVuSans-NOTICE`.

## World map

The world map on collection sheets is drawn from the Natural Earth land polygons at 1:110 million scale, stored as `assets/maps/ne_110m_land.geojson`. Natural Earth map data is in the public domain; see `assets/maps/NOTICE`.

## PDF and barcode export dependencies

The export infrastructure retains MIT-licensed `pdf-lib` (1.17.1),
`@pdf-lib/fontkit` (1.1.1), and `bwip-js` (4.11.4).
Visual designs are installed individually after approval.

## Standalone SSKR

The SSKR Rust/WASM bridge in `sskr-wasm/` uses Blockchain Commons `sskr 0.12.0` / `bc-shamir 0.13.0` and the Bytewords transport. See [bridge notices](sskr-wasm/NOTICE.md), [SSKR dependency notices and licenses](sskr-wasm/UPSTREAM_NOTICES.md), and the retained Cargo.lock for exact dependencies.
