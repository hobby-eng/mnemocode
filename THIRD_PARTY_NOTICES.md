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
[`@scure/bip32`](https://github.com/paulmillr/scure-bip32), and
[`@scure/btc-signer`](https://github.com/paulmillr/scure-btc-signer), which are
MIT licensed. Their pinned versions are recorded in `package.json` and the
lockfile after installation.

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

The vendored SSKR Rust/WASM bridge uses Blockchain Commons `sskr 0.12.0` / `bc-shamir 0.13.0` and the Bytewords transport. See [vendor notices](vendor/sskr/NOTICE.md), [SSKR dependency notices and licenses](vendor/sskr/UPSTREAM_NOTICES.md), and the retained Cargo.lock for exact dependencies.
