# Command-line reference

For choosing a backup or recovery method, start with the [README](../README.md). This reference covers download verification, exact input and output formats, and command examples. All phrases and wallet references in examples are public test data.

## Download verification

Release assets provide one executable for each supported target: `mnemocode-<version>-linux-x64`, `mnemocode-<version>-linux-arm64`, `mnemocode-<version>-win-x64.exe`, `mnemocode-<version>-macos-arm64` and `mnemocode-<version>-macos-x64`. Linux needs glibc 2.35 or later; musl systems such as Alpine cannot run these files. Each executable has a companion `-licenses.txt` file listing the licenses it contains.

Check a download before running it. `SHA256SUMS` lists its SHA-256 hash, `SHA256SUMS.asc` signs that list, and `RELEASE-SIGNING-KEY.asc` contains the public key. Check that the key fingerprint is `28FC51B1DB80DF2101128CB30EDD4814591DD095`; the maintainer also publishes it at <https://github.com/hobby-eng.gpg>.

```bash
gpg --show-keys RELEASE-SIGNING-KEY.asc
gpg --import RELEASE-SIGNING-KEY.asc
gpg --verify SHA256SUMS.asc SHA256SUMS
sha256sum --check --ignore-missing SHA256SUMS
chmod +x mnemocode-0.2.0-linux-x64
./mnemocode-0.2.0-linux-x64 self-test
```

`gpg --verify` must report a good signature from that key. A warning that you have not certified the key is separate from signature validity. On macOS, use `shasum -a 256` to compare the downloaded file's hash with its line in `SHA256SUMS`; on Windows, use `Get-FileHash -Algorithm SHA256`. These commands do not verify the signature: use GnuPG for that first.

On the connected computer used to download the release, the [GitHub CLI](https://cli.github.com/) can also check its build attestation:

```bash
gh attestation verify mnemocode-0.2.0-linux-x64 --repo hobby-eng/mnemocode
```

The executable contains the program, artwork, fonts and native SSKR engine. PDF, PNG and JPEG export need no external image converter. To package a source build for Linux x64:

```bash
cargo xtask release build x86_64-unknown-linux-gnu
cargo xtask verify-executable dist/release/mnemocode-0.2.0-linux-x64
```

Other target names and the canonical build are described in [Releasing](RELEASING.md). A development build uses `cargo build --locked -p mnemocode-cli`.

## Command help

`mnemocode --help` lists commands. `mnemocode <command> --help` describes the options and examples; `-h` gives a short summary. In a source checkout, replace `mnemocode` with `target/release/mnemocode`.

## Input files and limits

On the private screen, the fields for Shamir shares, forgotten words and encoded backups also accept a local text file path. Enter the path directly or drag the file into the terminal; no source selection is needed. MnemoCode reads its exported share files and MNC1 records unchanged. Paths with spaces may be quoted, and local `file:///` links work. Prefix a filename without an extension with `./`.

Escape at a secret-input prompt cancels the current action. When started from the menu, it returns to that menu; it does not quit MnemoCode. Ctrl+C also cancels. A standalone cancelled command ends with exit code 130.

Control and text-direction characters in displayed paths are replaced with U+FFFD; the actual filesystem names are unchanged. A command preview containing such characters is omitted, with a warning.

Long private-screen results are paged before the next question. This includes share sets, missing-code candidates, word/date matches and legacy-final-word alternatives. Move with Up/Down or PageUp/PageDown, use Home/End for the first or last page, and press Enter or Escape after copying. The end of the result then remains above the question. Ctrl+C cancels. Redirected output stays complete and has no page controls.

For `recover-word`, a list that fits one candidate per screen row shows every candidate. A longer result shows wallet matches; without a wallet or candidate-list destination, it offers a wallet check or encrypted list for the Discovery Scanner. The offer also applies to patterns read with `--mnemonic-file`. MnemoCode asks for the destination and encryption method, with the passphrase entered privately.

`--mnemonic-file PATH` reads a phrase; `--input-file PATH` reads codes or a record. The path `-` reads standard input. Decode and date recovery can combine `--input-file` or `--qr-file` with `--ask-secrets`, reading the backup from the file and asking for the remaining private answers.

Decode and Re-encode also accept Shamir shares in any supported form, pasted or read from a text file. Separate shares by newlines or `;`, and use `?` for unreadable codes or digits. Both commands keep every share and use Restore's repair questions.

Re-encode asks about Seedshift and its dates before confirming the original wallet phrase. Forgotten date digits can be searched against an original-wallet fingerprint or address. If several candidates survive, select and confirm one before creating the replacement. A wallet reference cannot replace a share below the threshold or repair an incorrect unmarked code.

Raw `--mnemonic`, `--input`, `--share`, `--date`/`--dates`, `--old-date`/`--old-dates` and `--last-word` values are refused, including public fixtures. Help names them as refused, with the option to use instead; none is accepted as an exception.

Refusal cannot remove text already entered in shell history or process arguments. Choose a safe input source before entering real material.

For headless operations, `--dates-file PATH` reads whitespace-separated dates; `recover-date` also accepts its `?` patterns there. Re-encode uses `--old-dates-file PATH` for the old backup and `--dates-file PATH` for the new one; a legacy-valid backup takes its original final word from `--last-word-file PATH`. These three options also accept `-`. Only one material source may read standard input in a command. Do not combine these date/final-word files with `--ask-secrets`, which asks for those answers itself. Protect and keep date files yourself: dates are not added to encoded records.

Each text input has its own limit, which `--help` names: 256 bytes for a seed phrase, 128 for dates, 4 KiB for a passphrase or a date pattern, 32 KiB for a `recover-word` pattern, 64 KiB for encoded input or a set of shares, as an answer or a file. A QR image may be up to 16 MiB, 4096 pixels on either side and 2 megapixels (2,097,152 pixels), with up to 8 bits per sample: a screen of 1920 × 1080 fits, and the QR images that MnemoCode saves are 720 px; crop a photograph or a page image to the code. The picture of a cross-stitch pattern may be a PNG or JPEG file of up to 40 MiB and 60 megapixels. Larger inputs are refused. An image is read whole, and Ctrl+C acts when that reading ends: an image of noise can keep it for seconds. A multiline paste is one answer: words, codes and dates may be on separate lines; separate shares become semicolon-separated.

## Public command examples

These examples use published BIP39 test data. Never fund this wallet. Run them in a fresh working directory; real recovery material belongs on the private screen or in protected local files. On a rerun, exports receive numbered names instead of replacing files: use the names MnemoCode reports.

Create the shared input files once:

```bash
mkdir -p output
printf '%s\n' 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about' \
  > output/public-mnemonic.txt
printf '%s\n' '23-09-2026' > output/public-dates.txt
printf '%s\n' '07-11-2026' > output/public-new-dates.txt
```

The tasks below follow the menu order. Each encode/decode pair uses the same file, mode and dates. A record carries its mode and format; a plain QR payload does not.

### Encode

```bash
# MnemoCode Seedshift as English words, saved as a self-describing record.
mnemocode encode --mode seedshift --mnemonic-file output/public-mnemonic.txt \
  --dates-file output/public-dates.txt --format english --output output/public-shifted.txt
mnemocode decode --input-file output/public-shifted.txt --dates-file output/public-dates.txt

# Direct Unicode: another representation, without dates.
mnemocode encode --mode direct --mnemonic-file output/public-mnemonic.txt \
  --format unicode --output output/public-direct.txt
mnemocode decode --input-file output/public-direct.txt

# Original Seedshift as Unicode, decoded with the same original dates.
mnemocode encode --mode seedshift-legacy --mnemonic-file output/public-mnemonic.txt \
  --dates-file output/public-dates.txt --format unicode --output output/public-legacy.txt
mnemocode decode --input-file output/public-legacy.txt --dates-file output/public-dates.txt

# Seedshift colors on A4 sheets, with the QR and its PNG copy.
mnemocode encode --mode seedshift --mnemonic-file output/public-mnemonic.txt \
  --dates-file output/public-dates.txt --format colors --template business-it \
  --page-size a4 --pdf output/public-color-cards.pdf --card-qr
mnemocode decode --mode seedshift --format colors \
  --qr-file output/public-color-cards-qr.png --dates-file output/public-dates.txt

# Separate JPEG cards and a record of the same direct Unicode backup.
mnemocode encode --mode direct --mnemonic-file output/public-mnemonic.txt \
  --format unicode --template business-it --cards-dir output/public-unicode-cards \
  --image-format jpg --output output/public-unicode-record.txt
mnemocode decode --input-file output/public-unicode-record.txt
```

Images are drawn by MnemoCode itself at 300 dpi. PNG keeps text and QR codes sharp; JPEG uses quality 90. Separate-card corners are transparent in PNG and white in JPEG.

A cross-stitch pattern needs a picture of your own; any photograph works for this public phrase:

```bash
# The masked phrase hidden in the legend of a pattern, the legend also saved as a line.
mnemocode stitch --mnemonic-file output/public-mnemonic.txt \
  --dates-file output/public-dates.txt --picture photo.jpg --stitches-across 150 \
  --pdf output/public-pattern.pdf --output output/public-legend.txt
mnemocode decode --input-file output/public-legend.txt --dates-file output/public-dates.txt
```

The legend is drawn at random within the counts the picture allows, so the same phrase gives a different legend each time. A legend line is a row's symbol number (1 to 70, as [SeedStitch](SEEDSTITCH.md#the-symbols) lists them), a colon and its stitches, rows in the legend's order. Decode takes it typed, pasted or from a file, and corrects one mistyped row, naming it.

### Re-encode

```bash
# Confirm the original test wallet by its fingerprint, then use new dates and colors.
mnemocode re-encode --input-file output/public-shifted.txt \
  --old-dates-file output/public-dates.txt --master-fingerprint 73c5da0a \
  --mode seedshift --dates-file output/public-new-dates.txt --format colors \
  --output output/public-replacement.txt
mnemocode decode --input-file output/public-replacement.txt \
  --dates-file output/public-new-dates.txt
```

A fingerprint is a short filter, not proof of recovery. For real material, the private screen lets you recognize the original words or compare a known wallet reference before replacing the backup. Input options use `--old-mode`, `--old-format` and `--old-dates-file`; output options describe the new backup. The original backup remains usable.

### Decode

The pairs above read records or QR images. For codes without a record header, keep their mode and provide `--format` when detection is ambiguous. For printed cards with decoys, `--words` limits the real backup to its original phrase length.

One material source may come from standard input. This public example writes the same direct Unicode record without a mnemonic input file:

```bash
cat output/public-mnemonic.txt | mnemocode encode --mode direct \
  --mnemonic-file - --format unicode --output output/public-stdin.txt
mnemocode decode --input-file output/public-stdin.txt
```

### Split into shares

```bash
# Standard SSKR: any 2 of 3 shares restore the unmasked phrase.
mnemocode sskr-split --mode direct --mnemonic-file output/public-mnemonic.txt \
  --threshold 2 --shares 3 --format ur --output output/public-shares.txt
mnemocode sskr-combine --share-file output/public-shares.txt

# Seedshift before sharing: restore with the same dates.
mnemocode encode --mode seedshift --mnemonic-file output/public-mnemonic.txt \
  --dates-file output/public-dates.txt --sskr --threshold 2 --shares 3 \
  --share-format unicode --output output/public-masked-shares.txt
mnemocode sskr-combine --share-file output/public-masked-shares.txt \
  --mode seedshift --dates-file output/public-dates.txt
```

These text files each hold **all shares**. They demonstrate a round trip, not separate storage. [SSKR](SSKR.md) covers share formats, QR images, cards and keeping enough distinct shares.

### Restore from shares

`sskr-combine` restores the phrase; `sskr-export` rewrites or prints existing shares without making a new set:

```bash
mnemocode sskr-combine --share-file output/public-shares.txt
mnemocode sskr-export --share-file output/public-shares.txt --format colors \
  --template business-it --page-size a5 --pdf output/public-share-cards.pdf --card-qr
```

Both `--share-file` and `--share-qr` may be repeated. For damaged shares, retain readable elements and replace unknown ones with `?`; see [share recovery](SSKR.md#damaged-shares).

### Recovery

```bash
# An unknown final word: check candidates against the original test wallet's fingerprint.
printf '%s\n' 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon ?' \
  > output/public-word-pattern.txt
mnemocode recover-word --mnemonic-file output/public-word-pattern.txt \
  --master-fingerprint 73c5da0a

# One word missing at an unknown position.
printf '%s\n' 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon' \
  > output/public-missing-word.txt
mnemocode recover-word --missing-word --mnemonic-file output/public-missing-word.txt \
  --master-fingerprint 73c5da0a

# Search the missing day of the date used in the first Encode example.
printf '%s\n' '??-09-2026' > output/public-date-patterns.txt
mnemocode recover-date --input-file output/public-shifted.txt \
  --dates-file output/public-date-patterns.txt --master-fingerprint 73c5da0a
```

`recover-word` enumerates checksum-valid candidates and marks wallet matches. For an interactive search, `--ask-secrets` asks for the pattern privately; when a long unfiltered result does not fit, it offers a wallet check or encrypted [candidate list](CANDIDATES.md). Missing backup codes use `decode`, and missing share codes use `sskr-combine` or `sskr-export`; neither has a separate command name.

See [date-search limits](#date-search-details) and [wallet-reference options](#wallet-check-examples-and-address-forms).

### Preview cards

```bash
mnemocode preview --list
mnemocode preview --all --words 24 --page-size a4 --pdf output/public-previews.pdf
mnemocode preview --template business-it --words 24 \
  --cards-dir output/public-preview-cards --image-format jpg
```

Preview uses random sample data, not your wallet. Card layout and output options are the same ones used for real exports.

### Word lookup

```bash
mnemocode table --word abandon
mnemocode table --index 1
mnemocode table --unicode 5BF6
mnemocode table --all

# A printable mapping, the standalone guide, or the full recovery pack.
mnemocode table --all --table-format mapping --output output/bip39-mapping.txt
mnemocode table --recovery-guide --output output/manual-recovery.md
mnemocode table --word-lists-dir output/recovery-pack
```

See [dictionary formats](#word-lists-and-manual-recovery).

### Self-test and help

```bash
mnemocode self-test
mnemocode --help
mnemocode encode --help
```

[Installation checks](#installation-checks) lists the startup and full self-test coverage. The menu's Quit entry has no command; Escape at the main menu also exits.

## Word lists and manual recovery

In the word lookup entry, Enter after a result asks for another value of the same kind; Escape returns to the main menu. **Export word lists and guide** saves the English list, the Traditional Chinese list, Unicode characters with their codes, the full correspondence table, or the [manual recovery guide](MANUAL_RECOVERY.md).

Dictionaries are UTF-8 with a header and 2,048 rows, numbered from 1. `table --all --table-format english|chinese|unicode|mapping` chooses the columns. Those tables use spaces for alignment and put the Chinese character last, avoiding dependence on its display width. `--output PATH` saves the table; taken names receive a number.

Without `--table-format`, the default number/English/Unicode-code table uses tabs for scripts.

**Full set**, or `table --word-lists-dir PATH`, saves all four numbered tables and `manual-recovery.md` together in a new folder. An existing folder is kept; MnemoCode chooses a numbered folder name.

The guide explains date sorting, the repeating year/month/day shifts, modular addition and subtraction, MnemoCode Seedshift's shorter last-word modulus, checksum calculation, exact and corrected legacy modes, and decoding colors. It includes a standalone Python helper that needs no MnemoCode installation. Print the full mapping too. Combining SSKR shares still requires a compatible SSKR implementation.

## Representation details

`encode --show-masked-words` also shows the English words after Seedshift, beside the chosen codes. This is the masked phrase: the original dates are still needed. `--show-original words` separately shows the original wallet phrase as English words for visual checking, with or without Shamir shares. Its former `codes` and `both` values are refused before any secret is read. The menu offers No or Yes, show the words, and leaves this display off by default. These display choices do not add the original to encoded or share files and QR images.

The [format table](../README.md#backup-formats) lists names and numbers. Input syntax differs by form:

| Form          | Accepted separators                                                                                            |
| ------------- | -------------------------------------------------------------------------------------------------------------- |
| Word numbers  | Spaces or commas; joined numbers are ambiguous and refused                                                     |
| Word Unicode  | Four hexadecimal digits per code, separated or joined                                                          |
| Colors        | Separated codes, joined `#RRGGBB` codes, or one joined `RRGGBB` line                                           |
| Color Unicode | Two four-digit Private Use Area codes per color, separated or joined, or the Private Use characters themselves |

Color Unicode needs no special font when written as hexadecimal text.

On a terminal, formats 3 and 4 show both spaced codes for checking and a joined line for copying. This applies to phrases and shares; the spaced form makes it easier to replace an unreadable code with `?`.

Formats 1, 2 and 5 already use spaces. Their terminal output wraps between words or codes within 78 columns; narrower terminals may wrap again. Files and pipes receive one line of codes.

The layout follows where the output goes: a terminal gets headings, labelled facts, numbered phrases and marked notices, and a file, a pipe or `TERM=dumb` the plain lines of a script. On a terminal each candidate of `recover-word` and each match of `recover-date` is a part of its own, with the words or dates found, the wallet check and the phrase as labelled facts; a file or a pipe gets one row of tab-separated fields for each. Colour is decided apart from it: `NO_COLOR` or `CLICOLOR=0` takes the colours away and keeps the terminal layout, and `CLICOLOR_FORCE` adds colour without changing the form.

For `decode` and `recover-date`, `--format` is usually optional. MnemoCode picks the form itself when exactly one form fits the whole record. Otherwise it asks in the terminal, and a script must pass `--format`.

## Card options

| Option                         | Result                                                                                                |
| ------------------------------ | ----------------------------------------------------------------------------------------------------- |
| `--template ID`                | The design, by name or number                                                                         |
| `--pdf PATH`                   | The whole collection as one PDF                                                                       |
| `--cards-dir NEW_FOLDER`       | [One file per card](../README.md#individual-business-cards); for shares, one file or folder per share |
| `--images-dir NEW_FOLDER`      | The collection pages as PNG images                                                                    |
| `--image-format png\|jpg`      | The image format for `--images-dir` and `--cards-dir`                                                 |
| `--page-size`, `--orientation` | See [Page sizes](../README.md#page-sizes)                                                             |
| `--card-qr`                    | One QR code on the collection sheet                                                                   |
| `--title TEXT`                 | The collection title; by default it is the studio name                                                |
| `--cards`                      | Color cards in the terminal                                                                           |
| `--qr PATH`                    | A separate QR code as a PNG image                                                                     |

Replace random identity fields with `--card-name`, `--card-role`, `--card-company`, `--card-email`, `--card-phone`, `--card-website` and `--card-location`. Names accept Latin letters, spaces, apostrophes and hyphens. Characters missing from the font and text that does not fit are refused before any secret is asked or read. `--studio-name` names the collection studio; material sheets print `--card-name` as the recipient. [Identity defaults](card-identities.md) describes the generated values.

`--card-slogan`, `--card-subtitle`, `--card-footer` and `--card-reference-label` replace the text on the sheet. The value `-` hides a field. The default reference label is `Ref.`.

Images are drawn by MnemoCode itself at 300 dpi. PNG keeps text and QR codes sharp; JPEG uses quality 90. Separate-card corners are transparent in PNG and white in JPEG.

[Card designs](card-designs.md) describes what is printed on a sheet.

| Page size      | Dimensions   |
| -------------- | ------------ |
| `a6` (default) | 148 × 105 mm |
| `a5`           | 148 × 210 mm |
| `a4`           | 210 × 297 mm |
| `business`     | 90 × 50 mm   |

`--orientation portrait|landscape` fixes the orientation. Otherwise the sheet is turned to fit at least three rows where possible, with the largest cards. `--cards-dir` cannot be combined with `preview --all`. For the cards of a backup it accepts business size or no size, and only business card designs. For shares it saves one file or folder per share at any page size: a sheet size gives one collection sheet per share, as [Share cards](SSKR.md#share-cards) describes. A collection saved by the same command must be outside that folder. Individual filenames contain the card number alone, such as `01.pdf`, never the printed code.

For shares, QR PNG copies are named after each share's reference, including inside a share-card folder. A sheet QR contains only the real codes; the random padding cards are excluded.

## Date search details

Complete and incomplete dates can be combined, such as `10-1?-2010 15-?-2025` or `15-12-2025 ?`.

Several incomplete dates multiply the number of attempts. Two identical patterns are tried once, not once for each order. Dates that shift every word alike are tried once too: Seedshift adds the year to a word number modulo the 2,048 words, so a year and the year 2,048 years later give the same phrase. A forgotten year therefore finds a phrase once, with the earliest year that gives it, not four or five times.

Before searching, the command shows the attempt count and, with a wallet check, an estimate for your computer. Searches estimated at up to 12 hours start immediately. Longer ones need confirmation, or `--max-candidates` at least as large as the attempt count.

A date search is capped at 2,147,483,648 combinations. Searching every supported date takes 3,652,059 attempts. Decode combines each marked-code candidate with every date combination, so its total work may be larger; it estimates that work and asks for consent in the same way.

`--max-results` limits displayed matches, 100 by default. `--progress-every` controls progress reporting.

In the `seedshift` and `seedshift-legacy-valid` modes every date gives a valid phrase, so `recover-date` requires one of the [recovery checks](../README.md#exact-local-recovery-checks). In `seedshift-legacy` mode it can instead keep the candidates that pass the checksum test. A checksum of 4 to 8 bits is a weak filter.

Decode and Restore use the same date search on the private screen, even when codes or shares are also marked. They ask for a wallet reference when required; with original Seedshift, Decode also offers the choice "It cannot" to list checksum-valid results. Restore estimates the combined work for all share and date combinations. Dates in `--dates-file` must be complete except in `recover-date`.

## Wallet-check examples and address forms

```bash
# The public stored phrase and the date pattern of all four examples below, in local files:
mkdir -p output
printf '%s\n' 'wool abuse actual wool abuse actual wool abuse actual wool abuse congress' \
  > output/public-stored.txt
printf '%s\n' '??-09-2026' > output/public-date-pattern.txt

# A native-SegWit receiving address, one of the first 20: here m/84'/0'/0'/0/0.
mnemocode recover-date --mode seedshift \
  --input-file output/public-stored.txt \
  --format 1 --dates-file output/public-date-pattern.txt \
  --bitcoin-address bc1qcr8te4kr609gcawutmrza0j4xv80jy8z306fyu \
  --bitcoin-profile native-segwit

# A master or account extended public key. Standard and SLIP-132 forms are accepted:
# xpub, ypub, zpub, Ypub, Zpub; testnet tpub, upub, vpub, Upub, Vpub.
mnemocode recover-date --mode seedshift \
  --input-file output/public-stored.txt \
  --format 1 --dates-file output/public-date-pattern.txt \
  --account-xpub zpub6rFR7y4Q2AijBEqTUquhVz398htDFrtymD9xYYfG1m4wAcvPhXNfE3EfH1r1ADqtfSdVCToUG868RvUUkgDKf31mGDtKsAYz2oz2AGutZYs \
  --bitcoin-profile native-segwit

# An address of another coin, here the first Ethereum one: m/44'/60'/0'/0/0.
mnemocode recover-date --mode seedshift \
  --input-file output/public-stored.txt \
  --format 1 --dates-file output/public-date-pattern.txt \
  --coin ethereum --coin-address 0x9858EfFD232B4033E47d90003D41EC34EcaEda94

# A 33-byte compressed public key at exactly one BIP44/49/84/86 path.
mnemocode recover-date --mode seedshift \
  --input-file output/public-stored.txt \
  --format 1 --dates-file output/public-date-pattern.txt \
  --compressed-public-key 03cc8a4bc64d897bddc5fbc2f670f7a8ba0b386779106cf1223c6fc5d7cd6fc115 \
  --bitcoin-profile taproot --account 0 --branch 0 --index 0 --scan-gap 1
```

| Option                            | What you know                                                                                                               |
| --------------------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| `--master-xpub`, `--account-xpub` | An extended public key                                                                                                      |
| `--bitcoin-address`               | An address                                                                                                                  |
| `--coin-address` with `--coin`    | An address of another coin                                                                                                  |
| `--compressed-public-key`         | A public key                                                                                                                |
| `--master-fingerprint`            | The wallet's own fingerprint, the original one, not the encoded one. It has only 32 bits, so it is a filter and not a proof |
| `--wif-file PATH`                 | A private key in WIF form, read from a protected local file                                                                 |
| `--bip39-passphrase-file PATH`    | The BIP39 passphrase, if the wallet uses one. The file is secret                                                            |

`--index` sets the first address and `--scan-gap N` the count to compare, up to 1000. `--bitcoin-profile auto` tries BIP44, BIP49, BIP84 and BIP86. A comma-separated list such as `native-segwit,taproot` selects profiles without repeats; an incompatible address type is refused before secret input.

For an account extended public key, `--account` selects the account. `--branch` and `--index` describe addresses within it and are refused beside `--account-xpub`. Standard and SLIP-132 versions are accepted as listed above.

Other coins use standard single-key paths and infer type/network from the address:

| Coin                      | `--coin`           | Address forms                                         |
| ------------------------- | ------------------ | ----------------------------------------------------- |
| Bitcoin Cash              | `bitcoin-cash`     | `bitcoincash:q…` or `1…`                              |
| Cosmos                    | `cosmos`           | `cosmos1…`                                            |
| Dash                      | `dash`             | `X…`, Platform `dash1k…`, testnet Platform `tdash1k…` |
| Dogecoin                  | `dogecoin`         | `D…`                                                  |
| Ethereum and EVM networks | `ethereum`         | `0x…`                                                 |
| Ethereum Classic          | `ethereum-classic` | `0x…`                                                 |
| Injective                 | `injective`        | `inj1…`                                               |
| Litecoin                  | `litecoin`         | `L…`, `M…`, `3…` or `ltc1q…`                          |
| Tron                      | `tron`             | `T…`                                                  |
| XRP                       | `xrp`              | `r…`                                                  |
| Zcash                     | `zcash`            | Transparent `t1…` only                                |

Zcash shielded addresses are unsupported. Bitcoin Cash and Ethereum Classic try both their own coin type and their parent chain's. `--network` and `--bitcoin-profile` apply only to Bitcoin.

A WIF can spend the funds. Never put it in a shell command or an issue report.

## Installation checks

Before processing data, MnemoCode runs its startup self-test: quick checks without files, renderers or a share engine. Known answers come from published vectors or an independent implementation that first reproduces one. They cover:

- Both BIP39 word lists' lengths and SHA-256 hashes, the BIP39 seed and master fingerprint.
- Every transformation mode; exact 12- and 24-word answers in all five representations, 15-, 18- and 21-word answers with MnemoCode Seedshift, and independent legacy-valid answers for all five lengths, with numbering, checksum and Color Unicode refusals.
- Date patterns, marked codes and shares, word searches, candidate lists, written-backup checks and wallet evidence.
- Addresses of all twelve coins, heir-sheet text, share-card and card-set content, word hints and re-encoding.
- Published SSKR Bytewords and refusals of incomplete quorums, duplicates, mixed sets and corrupt checksums.

If a check fails, the command stops:

```text
CRITICAL: MnemoCode core self-test failed.
No mnemonic data was processed.
```

In the menu, a failed self-test leaves only Run the self-test, the help and Quit; the other entries stay closed.

Before it splits or combines shares, MnemoCode also restores an official grouped set and a set holding the 32-byte secret of a 24-word phrase, creates a test set from a fixed seed and restores it from every two of its shares, makes sure that another seed gives other shares, and checks that the engine refuses an incomplete quorum and a damaged share value even when its transport checksum is correct. The fixed creation seeds are public test data and are never used for a person's shares.

For the full self-test, including PDF rendering:

```bash
mnemocode self-test
```

The full self-test includes the startup self-test plus every phrase length/format/mode combination, date sorting, the public test file, 24 English BIP39 seed vectors, wallet-assisted searches, the marked-code search, encrypted candidate lists and the candidate list writer, joint share/date repair, share split and restore, every coin vector, actual heir-sheet/card/QR exports with all artwork and fonts, and card pages read back as drawing steps. Each feature gets a refusal case too. Finished groups show their times, followed by an overall result.

The public test data is in [`vectors/mnemocode-v1.json`](../vectors/mnemocode-v1.json). It contains only well-known test phrases.

## Library example

The [library guide](LIBRARY.md) contains a Rust example, WebAssembly entry points and ownership contracts.

## Output destinations in the menu

Each choice includes the screen and the destination it names. `Screen and printable cards`
saves the cards without a record file. Choices do not include earlier entries; `All of these`
is the choice that adds every offered destination.

Unicode codes, colors as text and colors offer printable cards. Their card questions also ask
whether to include QR output, so the destination menu omits a separate QR choice. English words,
word numbers and standard shares offer standalone QR images directly. Explicit `--qr` and
`--qr-dir` command-line options remain available regardless of the menu choices.

## Copying the displayed backup

Terminal results mark the data to save with `SAVE THIS BACKUP`, or `SAVE THIS SHARE` for each
Shamir share. Copy the entire block in the displayed order, up to `End of backup` or `End of share`.
The data is bold where terminal styling is enabled; the labels remain visible with `NO_COLOR`.
Seedshift still needs its original dates. Optional original words are for visual checking.
These display labels are not added to records, QR payloads or redirected data.
For joined codes, an alternate joined copy follows the end label; use either version, not both.

## Automatic QR checks

Every generated PNG QR image is decoded and compared with the exact backup or share before it is saved. MnemoCode reports a successful check as `QR code verified`; unreadable or mismatching output is not saved, and on the private screen you can try creating it again, choose another name or skip it. QR matrices are also decoded and compared before they are drawn into PDF or page images, including A4, A5 and A6. These checks cover the generated data and symbol; they do not certify a later printed copy or a camera.

For Shamir shares, `--qr-dir NEW_FOLDER` saves one complete share per PNG, named `share-1-qr.png`, `share-2-qr.png` and so on. It works in every share format without printable cards. All shares are in that folder: separate them for storage. A taken folder name is numbered instead of replaced. `sskr-combine --share-qr PATH` reads the images.

The separate “Check the backup now?” question checks what you copied by hand: words, word numbers, Unicode codes, colors or shares. Type that copy back; automatic QR verification does not verify your handwriting.
