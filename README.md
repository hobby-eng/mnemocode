# MnemoCode

[![CI](https://github.com/hobby-eng/mnemocode/actions/workflows/ci.yml/badge.svg?branch=main)](https://github.com/hobby-eng/mnemocode/actions/workflows/ci.yml)
[![Release](https://github.com/hobby-eng/mnemocode/actions/workflows/release.yml/badge.svg)](https://github.com/hobby-eng/mnemocode/actions/workflows/release.yml)
[![RustSec audit](https://github.com/hobby-eng/mnemocode/actions/workflows/audit.yml/badge.svg)](https://github.com/hobby-eng/mnemocode/actions/workflows/audit.yml)
[![License: MIT OR Apache-2.0](https://img.shields.io/badge/license-MIT%20OR%20Apache--2.0-blue)](#provenance-and-license)
[![Build provenance: GitHub attestations](https://img.shields.io/badge/build%20provenance-GitHub%20attestations-2ea44f)](https://github.com/hobby-eng/mnemocode/attestations)

This README describes MnemoCode 0.2.0, the Rust version. Until 0.2.0 is released, the published executables are in the [TypeScript repository](https://github.com/hobby-eng/mnemocode_typescript/releases). Existing MnemoCode records and shares remain readable.

MnemoCode writes a wallet seed phrase (a BIP39 mnemonic) as numbers, Unicode codes or colors. You can mask it with dates, divide it into Shamir shares, print it on cards, or search for missing recovery material. It works offline as a command-line program, Rust library or WebAssembly module.

The [documentation index](https://github.com/hobby-eng/mnemocode/tree/main/docs) lists all guides and reference documents, with a short description of each.

**Inherited a MnemoCode backup?** Start with [A guide for heirs](docs/HEIRS.md).

Changing the way a phrase is written and masking it with dates are **not encryption**. Read the [security limits](SECURITY.md#cryptographic-and-recovery-limits) before choosing a backup. For encrypted long-term storage, [MHFE](https://github.com/hobby-eng/mhfe) is a separate program that encrypts a seed phrase into another valid BIP39 phrase.

## Install and run

<a id="one-executable-file"></a>

### Download an executable

[Releases](https://github.com/hobby-eng/mnemocode/releases) provide executables for Linux x64 and ARM64, Windows x64, and macOS ARM64 and x64. Linux needs glibc 2.35 or later, as in Ubuntu 22.04 or Debian 12; musl systems such as Alpine cannot run these binaries. Follow [download verification](docs/CLI.md#download-verification) before running one: the release signing key fingerprint is `28FC51B1DB80DF2101128CB30EDD4814591DD095`.

On Linux x64, after verification:

```bash
chmod +x mnemocode-0.2.0-linux-x64
./mnemocode-0.2.0-linux-x64
```

The executable includes its artwork, fonts and SSKR engine. It draws PDFs, PNGs and JPEGs itself; Node.js and Poppler are not needed.

<a id="from-source"></a>

### Run from source

Use Rust 1.99.1, as pinned in `rust-toolchain.toml`:

```bash
git clone https://github.com/hobby-eng/mnemocode.git
cd mnemocode
cargo build --locked --release -p mnemocode-cli
target/release/mnemocode
```

The examples below use `mnemocode` for your executable's name or path. In a source checkout, replace it with `target/release/mnemocode`. Run `mnemocode <command> --help` for the full option list.

## Menu

Run `mnemocode` without arguments in a terminal. The sections below follow the menu in the same order; each task's **More** link opens its own section.

| Menu | Task                                          | What it does                                                        |
| ---- | --------------------------------------------- | ------------------------------------------------------------------- |
| 1    | [Encode](#1-encode)                           | Make a backup in another form, with optional dates, shares or cards |
| 2    | [Re-encode](#2-re-encode)                     | Restore an existing backup and make a replacement                   |
| 3    | [Decode](#3-decode)                           | Read a backup and recover the original words                        |
| 4    | [Split into shares](#4-split-into-shares)     | Make standard Shamir shares                                         |
| 5    | [Restore from shares](#5-restore-from-shares) | Combine enough shares and undo date masking if used                 |
| 6    | [Recovery](#6-recovery)                       | Find missing words, codes, date digits or share elements            |
| 7    | [Preview cards](#7-preview-cards)             | Try designs with sample data                                        |
| 8    | [Word lookup](#8-word-lookup)                 | Look up a word or export dictionaries and a recovery guide          |
| 9    | [Self-test](#9-self-test)                     | Check the installation                                              |
| 0    | [Help](#0-help)                               | Read commands and options                                           |
| —    | [Quit](#quit)                                 | Leave the program                                                   |

<a id="secret-input-styles"></a>

Use the menu or `--ask-secrets` for real recovery material. Enter it on the private screen or read it from protected local files; never put seed phrases, codes, shares or dates in command arguments. The program refuses those arguments, but cannot remove what you already typed from shell history or process listings.

The private screen clears its contents when you leave it. It needs an interactive terminal and refuses `TERM=dumb`; it cannot prevent screen capture, terminal logging or observation by a compromised computer. Escape at a secret-input prompt returns to the main menu when started there; a standalone cancelled command ends with exit code 130.

## 1. Encode

Choose how to write the backup, whether to mask it with dates, and where to save it. The screen marks the part to keep with **SAVE THIS BACKUP**, or **SAVE THIS SHARE** for each share. Copy the entire marked block in the displayed order. If you use Seedshift, keep the original dates too.

### Backup formats

<a id="commands"></a>

These are formats selected by `--format`, not separate commands:

| Format                 | What you save                                                              |
| ---------------------- | -------------------------------------------------------------------------- |
| `english` / `1`        | English BIP39 words of the masked phrase                                   |
| `indexes` / `2`        | BIP39 word numbers from **1 to 2048**                                      |
| `unicode` / `3`        | Four-digit codes of the corresponding Traditional Chinese BIP39 characters |
| `colors-unicode` / `4` | Two four-digit Unicode codes for each color                                |
| `colors` / `5`         | `#RRGGBB` codes: 8, 10, 12, 14 or 16 for 12, 15, 18, 21 or 24 words        |

English words and word numbers require Seedshift in the menu, command line and library. Unicode codes and colors can be used without dates. Colors may be reordered, but every real color code is needed; word codes must keep their order. The 12- and 24-word color forms are compatible with BIP39Colors. Color Unicode is MnemoCode's text format, also accepted as Private Use characters. [Representation details](docs/CLI.md#representation-details) explain separators and copying.

### Transformation modes

The mode decides whether the phrase itself changes; the format decides how the result is written.

| Mode               | What happens                                           | Dates    |
| ------------------ | ------------------------------------------------------ | -------- |
| `direct`           | Writes the original phrase in another form             | None     |
| `seedshift`        | Masks the phrase and calculates a valid BIP39 checksum | Required |
| `seedshift-legacy` | Reproduces Original Seedshift                          | Required |

Without `--mode`, a `--dates-file` selects `seedshift`; otherwise the mode is `direct`. Dates accept `DD-MM-YYYY` or `YYYY-MM-DD`, with years `0001`–`9999`. Their input order does not matter. You can use up to one date per three words: at most 4–8 dates for 12–24 words.

**Wrong dates can produce a valid phrase for a different wallet.** A checksum cannot confirm the dates. Keep an original wallet fingerprint, address or public key for a [recovery check](#exact-local-recovery-checks).

Original Seedshift usually produces an invalid BIP39 checksum. Its `--legacy-valid-last-word` option makes the checksum valid but loses information from the last word. Such a record is named `seedshift-legacy-valid`; decoding leaves 128, 64, 32, 16 or 8 possible last words for 12, 15, 18, 21 or 24 words. A wallet reference distinguishes them. MnemoCode also accepts 21-word legacy phrases, which Original Seedshift did not support.

#### How checksum-valid Seedshift works

MnemoCode Seedshift shifts the entropy represented by each word and calculates a new checksum. Decoding with the same dates subtracts those shifts and restores the original phrase. Different dates can produce the same shift. The [construction](docs/SEEDSHIFT_CONSTRUCTION.md) and [worked example](docs/MANUAL_RECOVERY.md#worked-12-word-example-public-test-data) explain the calculation.

### Make a backup and read it back

<a id="complete-encode-and-decode-examples"></a>

Each pair below decodes the file made by the preceding command. `--ask-secrets` asks privately for the phrase and any dates needed. Run the pairs separately; keep the dates apart from the backup.

```bash
# Seedshift as colors: save a record, then restore it with the same dates.
mnemocode encode --mode seedshift --ask-secrets --format colors \
  --output shifted-colors.txt
mnemocode decode --input-file shifted-colors.txt --ask-secrets

# Unicode without date masking: save and restore the original phrase.
mnemocode encode --mode direct --ask-secrets --format unicode \
  --output direct-unicode.txt
mnemocode decode --input-file direct-unicode.txt --ask-secrets

# Original Seedshift as English words: keep and reuse the original dates.
mnemocode encode --mode seedshift-legacy --ask-secrets --format english \
  --output legacy-words.txt
mnemocode decode --input-file legacy-words.txt --ask-secrets
```

A record stores its mode and format, so Decode does not need them again. [File-based examples](docs/CLI.md#public-command-examples) use public test data for scripts; [input files and limits](docs/CLI.md#input-files-and-limits) list the available sources.

### Check what you saved

Encode offers to check the backup by asking for the written copy and dates again. This checks your transcription. Every generated QR PNG is separately read back and compared with the expected content before saving; a mismatch offers another try.

Encode shows an **original** fingerprint for the wallet with an empty BIP39 passphrase and an **encoded** fingerprint for the stored phrase. They do not reveal the phrase. The encoded fingerprint checks the codes before dates are removed; an original wallet reference checks the recovered phrase. An invalid legacy phrase has no encoded fingerprint.

You can also show the masked phrase as English words with `--show-masked-words`, or the original words for visual checking with `--show-original words`. These screen-only choices never add the original phrase to encoded files or share exports. Keep the original words apart from the backup.

### Cards and QR codes

Recovery uses the **printed code values**: four-digit Unicode codes or `#RRGGBB` color codes. Copy the real codes exactly, following the card numbers and leaving out the decoys described below. For colors, keep the printed hexadecimal values rather than matching shades by eye. Pictures, names and contact details are decoration; on Unicode cards, the colors are decorative too.

Cards need format 3, 4 or 5; `preview --list` lists the thirteen designs.

```bash
# Seedshift colors on A4 sheets, with a QR code and its PNG copy.
mnemocode encode --mode seedshift --ask-secrets --format colors \
  --template business-it --page-size a4 --pdf color-cards.pdf --card-qr
mnemocode decode --mode seedshift --format colors \
  --qr-file color-cards-qr.png --ask-secrets

# Direct Unicode as separate JPEG business cards, plus a record to decode.
mnemocode encode --mode direct --ask-secrets --format unicode \
  --template business-it --cards-dir unicode-cards --image-format jpg \
  --output unicode-record.txt
mnemocode decode --input-file unicode-record.txt --ask-secrets

# A standalone QR backup in legacy Unicode, without printable cards.
mnemocode encode --mode seedshift-legacy --ask-secrets --format unicode \
  --qr legacy-unicode.png
mnemocode decode --mode seedshift-legacy --format unicode \
  --qr-file legacy-unicode.png --ask-secrets
```

A QR code contains the real codes, **without a mode, format header or dates**. Keep that information yourself. `--card-qr` puts the QR on a collection sheet and saves a PNG copy beside the PDF or in the image folder; individual cards never have a QR. `--qr PATH` saves a standalone PNG. Decode reads the PNG, not a PDF or a photograph of the whole sheet.

Printed sets also contain extra random codes. When typing codes from cards, give `--words` for the original phrase length and omit those extra codes. The sheet for heirs records the length. Recheck a backup before relying on it.

Files and folders are never overwritten: taken names receive a number, which MnemoCode reports. Use that reported name when decoding. Folder exports can be incomplete after interruption; [export precautions](SECURITY.md#secret-lifecycle-and-local-boundaries) explain what may remain.

#### Individual business cards

`--cards-dir NEW_FOLDER` saves one PDF, PNG or JPEG per card, for business card designs only. Each file holds one code; an extra card holds a decoy code. Names such as `01.pdf` do not include the codes.

These cards are **not Shamir shares**. Every real card is needed and exposes part of the encoded phrase. To require only a subset, [split the phrase into shares](#4-split-into-shares).

#### Page sizes

A6, A5 and A4 produce collection sheets. `--page-size business` produces 90 × 50 mm cards, one per PDF page or image; `--cards-dir` puts each in a separate file. Samples on collection sheets are scaled to fit and are not cut-out cards. Print at **100% / actual size** to preserve QR dimensions.

`--image-format png|jpg` selects images. PNG preserves sharp codes and transparent card corners; JPEG has white corners. [Card options](docs/CLI.md#card-options) cover layout and orientation.

#### Collection-sheet identity

`--studio-name` names the design studio; `--card-company` names the employer on business cards. Material sheets use `--card-name` for the recipient. See [card designs](docs/card-designs.md), [identity defaults](docs/card-identities.md) and [custom text fields](docs/CLI.md#card-options).

### Instructions for heirs

`--heir-sheet heirs.pdf` adds a double-sided A5 guide; `--heir-sheet-size a6` makes a smaller one. It records the backup type, phrase length, share threshold and number of dates, but no recovery material, fingerprints or storage locations.

Keep it apart from the backup. A handwritten hint should help heirs remember dates without disclosing them. The sheet cannot restore the wallet on its own; [A guide for heirs](docs/HEIRS.md) explains what else they need.

<a id="re-encoding-a-backup"></a>

## 2. Re-encode

Read an existing backup, restore the original phrase and make a replacement with another mode, dates, format, cards or shares. MnemoCode asks you to recognize the original words or check them against your wallet before proceeding. A valid checksum alone is not confirmation. The old backup remains usable.

```bash
# Replace the color record from Encode with a new date-masked Unicode record.
mnemocode re-encode --input-file shifted-colors.txt --ask-secrets \
  --mode seedshift --format unicode --output replacement-unicode.txt
mnemocode decode --input-file replacement-unicode.txt --ask-secrets
```

On the private screen, you can also paste Shamir shares in any supported form, separated by `;` or line breaks, or enter a share file path. Mark unreadable codes with `?`. Re-encode uses the same repair as Restore, asks about Seedshift and its old dates, and then confirms the **original** phrase. At least the threshold number of shares is needed; an address or fingerprint cannot replace one.

For scripts, `--old-mode`, `--old-format` and `--old-dates-file` describe the input; the ordinary encoding options describe the replacement. Supply a wallet reference or `--recognised`, and repair incomplete input before re-encoding. [Re-encode options](docs/CLI.md#input-files-and-limits) explain interactive share and date recovery.

## 3. Decode

Read a saved record, pasted codes, a text file or a QR PNG. With Seedshift, enter the original dates to recover the original words. For damaged codes or dates, use the corresponding [recovery option](#6-recovery).

The [Encode examples](#make-a-backup-and-read-it-back) read records back directly; the [card and QR examples](#cards-and-qr-codes) give the mode and format needed for a headerless QR. To read Unicode codes copied into your own text file:

```bash
mnemocode decode --mode seedshift --format unicode \
  --input-file copied-unicode.txt --ask-secrets
```

The private screen also accepts Shamir shares and opens share restoration, keeping all shares you supplied. If marked text could be either a backup or a share, choose which it is, or use `--input-kind codes|share`.

### Versioned records and legacy compatibility

A record from `encode --output` has the form `MNC1:<mode>:<format>:<data>`. It contains no dates. Explicit options that conflict with the header are refused; on the private screen you can choose to use the header's values.

Typed codes and QR payloads lack the header. Keep the mode; when the format cannot be determined unambiguously, give `--format` too. With `--sskr`, an output file contains one share per line instead of an MNC1 record.

For legacy-valid input, provide the original final word privately or with `--last-word-file`. If ordinary legacy decoding fails its checksum, the private screen can offer the replaced-final-word path when applicable. Choose it only if that word was replaced when making the backup. Wrong dates or mistyped codes can also fail a checksum; a word outside the BIP39 list is a separate input error.

<a id="splitting-a-mnemonic-into-shares"></a>

## 4. Split into shares

Make standard Shamir shares of the seed phrase itself. Choose a threshold and a total count, for example any 2 of 3 shares. The threshold is at least 2 and no greater than the count; at most 16 shares can be made. Keep them in separate places.

```bash
# Standard SSKR shares, with no date masking; then restore from the saved file.
mnemocode sskr-split --mode direct --ask-secrets --threshold 2 --shares 3 \
  --format ur --output standard-shares.txt
mnemocode sskr-combine --share-file standard-shares.txt
```

The file above holds **all shares**. It is convenient for checking the result, but keeping it together defeats separate storage. Standard UR and Bytewords forms can be read by other SSKR tools. A BIP39 passphrase is not included in shares.

To combine date masking, custom formats and cards, use **Encode** with `--sskr`:

```bash
# Seedshift shares as Unicode, on A5 sheets with one QR per share.
mnemocode encode --mode seedshift --ask-secrets --sskr \
  --threshold 2 --shares 3 --share-format unicode \
  --template business-it --page-size a5 --pdf unicode-shares.pdf --card-qr \
  --output unicode-shares.txt
mnemocode sskr-combine --mode seedshift --ask-secrets

# Direct shares as color codes, with separate QR images and a text copy.
mnemocode encode --mode direct --ask-secrets --sskr \
  --threshold 2 --shares 3 --share-format colors \
  --qr-dir color-share-qr --output color-shares.txt
mnemocode sskr-combine --share-file color-shares.txt
```

For the Seedshift restore above, enter `unicode-shares.txt` at the private share prompt, then enter the same dates used for the split. Unicode, word-number and color shares need MnemoCode. Dates and mode are not stored in shares: a Seedshift set needs both to restore the original wallet. Legacy Seedshift modes cannot be combined with shares. A PDF or image folder can contain **every share**; separate them before storage.

Use `sskr-export` to print or change the presentation of existing shares without making a new set:

```bash
mnemocode sskr-export --share-file unicode-shares.txt --format unicode \
  --template business-it --page-size a4 --pdf reprinted-shares.pdf --card-qr
```

[SSKR](docs/SSKR.md) explains share formats, card layouts and interoperability.

## 5. Restore from shares

Supply at least the threshold number of distinct shares from the same set. Paste them one per line or separated by `;`, give a text file, or read the shares' QR PNGs. Duplicate copies of one share do not count as extra members.

```bash
# Enter standard shares privately, without Seedshift.
mnemocode sskr-combine --ask-secrets

# Enter shares that were masked before splitting, then the original dates.
mnemocode sskr-combine --mode seedshift --ask-secrets

# Read two share QR images saved by a 2-of-3 split, without date masking.
mnemocode sskr-combine --share-qr first-share.png --share-qr second-share.png
```

If Seedshift was used, select it and enter its dates. On the private screen, complete shares show the encoded fingerprint before asking for dates, so you can compare it with the one from the split. A forgotten digit can be marked with `?`; MnemoCode asks for a wallet reference to search the dates. Mark damaged share codes with `?` too; see [Damaged shares](#damaged-shares).

<a id="recovery"></a>

## 6. Recovery

Choose what is missing. These four options appear in the same order in the recovery menu:

| Missing material              | What to use                                             |
| ----------------------------- | ------------------------------------------------------- |
| A word of the original phrase | [Forgotten word recovery](#forgotten-word-recovery)     |
| A code of the encoded phrase  | [Codes that cannot be read](#codes-that-cannot-be-read) |
| A digit of a masking date     | [Date recovery helper](#date-recovery-helper)           |
| A code of a Shamir share      | [Damaged shares](#damaged-shares)                       |

<a id="word-and-code-patterns"></a>

### Forgotten word recovery

Replace each unknown word with `?`, or keep a known prefix such as `aban*`. MnemoCode can also find where a missing word belongs. A valid checksum narrows the list; it does not identify the wallet.

```bash
# Enter the pattern privately and compare candidates with an address you know.
mnemocode recover-word --ask-secrets

# Use a known original master fingerprint as a filter.
mnemocode recover-word --ask-secrets --master-fingerprint 73c5da0a
```

On a terminal, when unfiltered candidates do not fit on the screen, MnemoCode offers to check them against a wallet reference or save an encrypted list. This also works with a pattern read using `--mnemonic-file`. All candidates remain available in redirected output. See [input handling](docs/CLI.md#input-files-and-limits) and `mnemocode recover-word --help` for options and limits.

### Codes that cannot be read

Decode accepts `?` for an unreadable code and known prefixes or suffixes where the format supports them. It can check the encoded fingerprint without dates, check the original wallet after undoing dates, or list a small set. Missing date digits can be searched at the same time. The result includes repaired codes and dates.

```bash
mnemocode decode --mode seedshift --format unicode --ask-secrets
```

Use the recovery menu's second option to choose this workflow explicitly. Retain every readable part; `mnemocode decode --help` describes the supported patterns and limits.

### Date recovery helper

`recover-date` accepts up to three incomplete dates. Use `?` for a digit, a day/month/year or a whole date, and `|` for alternatives:

| Pattern          | Meaning            |
| ---------------- | ------------------ |
| `?3-09-2026`     | A day ending in 3  |
| `05\|15-09-2026` | Day 5 or 15        |
| `15-?-2025`      | Any month          |
| `?-?-2026`       | Any date in 2026   |
| `?`              | Any supported date |

```bash
# Read the color record made in Encode and ask privately for date patterns.
mnemocode recover-date --input-file shifted-colors.txt --ask-secrets \
  --master-fingerprint 73c5da0a
```

The example fingerprint belongs to a public test wallet; use your original wallet's reference for your own backup. MnemoCode Seedshift and legacy-valid searches need a wallet reference because every date can give a valid phrase. Original Seedshift can instead use its checksum as a weak filter. Searches estimated above 12 hours need confirmation, and no date search exceeds 2,147,483,648 attempts. See [date search details](docs/CLI.md#date-search-details).

### Damaged shares

Put `?` where a share element cannot be read. Separated color and Unicode codes also accept missing digits, such as `#B5?0??` or `4E?0`. Bytewords, word numbers and UR pairs accept whole-element marks only.

Restore uses checksums, set metadata and redundancy from extra shares to repair the shares together. Supply every share you have, including damaged copies. More than one surviving phrase is listed; none is selected automatically. A [wallet check](#exact-local-recovery-checks) helps distinguish them. `sskr-export` can return repaired shares without displaying the phrase.

Before searching, MnemoCode estimates the work and asks for confirmation above 12 hours. The maximum is about a trillion combinations. [Share repair patterns](docs/SSKR.md#damaged-shares) explain how keeping readable digits reduces the work.

### Exact local recovery checks

Candidates can be compared offline with an address, compressed public key, master/account extended public key, WIF from a file, or original master fingerprint. A fingerprint is only 32 bits and is a filter, not proof; prefer a known address or public key.

Bitcoin searches default to mainnet, account 0, receiving branch 0 and indexes 0–19, trying BIP44/49/84/86. Narrow the location with `--account`, `--branch`, `--index`, `--scan-gap`, `--network` and `--bitcoin-profile`. Eleven other coins use their standard single-key paths and infer the network from the address. [Wallet check examples](docs/CLI.md#wallet-check-examples-and-address-forms) list references, supported coins and options.

If the wallet uses a BIP39 passphrase, supply `--bip39-passphrase-file`, including with `--ask-secrets`. The menu and private screen do not ask for it; without the file, wallet checks use an empty passphrase. This passphrase is separate from masking dates. WIFs are private keys: keep them out of command arguments and reports.

### Candidate lists for discovery

With no known wallet reference, save candidates for the Discovery Scanner of the [multi-chain wallet tools](https://github.com/hobby-eng/multi-chain-wallet-tools). For example:

```bash
mnemocode recover-word --ask-secrets --candidates-file candidates.age
```

**The file contains seed phrases.** Encrypt it to the Scanner's one-time key with `--candidates-key age1…`, or use a passphrase. Candidate N on screen is record N in the file. MnemoCode stays offline; the Scanner checks for funds online. [Candidate lists](docs/CANDIDATES.md) explains the format, privacy and limits.

## 7. Preview cards

Try a design with a random sample phrase before entering your own. Use `--list` to see design names, one `--template` to preview it, or `--all` to compare every design.

```bash
mnemocode preview --list
mnemocode preview --all --words 24 --page-size a4 --pdf sample-designs.pdf
mnemocode preview --template business-it --words 24 \
  --cards-dir sample-cards --image-format jpg
```

These are samples, not wallet backups. The same [card options](docs/CLI.md#card-options) control actual exports from Encode.

## 8. Word lookup

Find the BIP39 row linking an English word, its 1-based number and its Unicode code. You can also export numbered dictionaries and a guide for recovery without MnemoCode.

```bash
mnemocode table --word abandon
mnemocode table --index 1
mnemocode table --unicode 5BF6

# All four dictionaries and the recovery guide, in one new folder.
mnemocode table --word-lists-dir recovery-pack
```

In the menu, Enter after a lookup asks for another value of the same kind; Escape returns to the main menu. **Export word lists and guide** lets you choose one table or the full set. [Dictionary export options](docs/CLI.md#word-lists-and-manual-recovery) describe individual files. The [manual recovery guide](docs/MANUAL_RECOVERY.md) includes a standalone Python helper; combining SSKR shares still requires a compatible implementation.

<a id="self-tests-and-public-vectors"></a>

## 9. Self-test

Run the full installation self-test, including PDF and QR rendering:

```bash
mnemocode self-test
```

Secret operations also run a quicker startup self-test; share operations check the SSKR engine against published answers. If startup checks fail, the menu offers only Self-test, Help and Quit. These checks cannot replace verifying a download or checking the backup you stored. See [check coverage](docs/CLI.md#installation-checks) and the [public vectors](vectors/mnemocode-v1.json).

## 0. Help

Read the command list or the options for a particular task:

```bash
mnemocode --help
mnemocode encode --help
mnemocode sskr-combine --help
```

These are the actual commands, grouped in menu order:

| Command        | Purpose                                                |
| -------------- | ------------------------------------------------------ |
| `encode`       | Write a backup, optionally with date masking or shares |
| `re-encode`    | Restore a backup and create its replacement            |
| `decode`       | Read a backup and recover the phrase                   |
| `sskr-split`   | Make standard Shamir shares                            |
| `sskr-combine` | Restore from shares                                    |
| `sskr-export`  | Repair or print existing shares                        |
| `recover-word` | Search missing words                                   |
| `recover-date` | Search missing date digits                             |
| `preview`      | Render sample card designs                             |
| `table`        | Look up words or export dictionaries                   |
| `self-test`    | Check the installation                                 |

Damaged backup codes use `decode`; damaged share codes use `sskr-combine` or `sskr-export`. [The command-line reference](docs/CLI.md) covers file limits, detailed options and public examples.

## Quit

Choose Quit, press `q`, or press Escape at the main menu to leave MnemoCode. At a task question, Escape goes back or cancels that action. After a result, follow the prompt: it may offer Escape to quit, while a repeated word lookup returns to the menu. Ctrl+C cancels the current operation.

## Compatibility and safety notes

Use a trusted computer without a network connection. [SECURITY.md](SECURITY.md) describes the cryptographic, recovery and host risks and how to report a vulnerability.

### Protection while it runs

The CLI asks the operating system to restrict network access and file writes where supported. It reports the protections that actually applied; there is no restriction on starting child processes. The library inherits its host's permissions; [runtime protection](SECURITY.md#secret-lifecycle-and-local-boundaries) states the guarantees and exceptions.

### Unencrypted swap

On Linux, MnemoCode warns when swap is unencrypted or cannot be assessed. Secret bytes may reach disk through swap. Use encrypted swap or none. Secret owners request page locks, but locks have a budget and may be refused; large rendered pages and some working copies remain unlocked.

### Memory lock

Small secret buffers request `mlock` on Linux and macOS, or `VirtualLock` on Windows, before being filled. A refused lock warns once. Secret owners wipe their memory when dropped; large buffers can be wiped without being locked. See [memory limits](SECURITY.md#input-screens-and-memory).

### Cloud folders

A synchronized folder can upload records, cards or shares. MnemoCode warns for usual cloud-folder names, but cannot detect every configuration. Use a local folder or removable drive.

## Library use

The `mnemocode` crate provides transformations, recovery, shares and wallet checks; `mnemocode-cards` draws the printable output. Browser hosts use the feature-selected `mnemocode-wasm` binding. Hosts supply randomness and drive resumable searches; native file access and terminal questions stay in the CLI. The crates are built from this repository, not published to crates.io. [The library guide](docs/LIBRARY.md) covers examples, ownership and host contracts; [the module inventory](docs/ARCHITECTURE.md#modules-for-other-hosts) maps them to source.

<a id="continuous-integration"></a>

## Source layout and review

See the [architecture](docs/ARCHITECTURE.md), [audit index](docs/audits/README.md) and [release procedure](docs/RELEASING.md). CI checks source, tests and platform input handling; release workflows build and check the executables.

## Provenance and license

MnemoCode is an independent Rust implementation, not an official fork of Seedshift or BIP39Colors. Its source is available under either the [MIT license](LICENSE-MIT) or the [Apache License, Version 2.0](LICENSE-APACHE), at your option. [NOTICE](NOTICE) attributes the compatible formats to [Seedshift](https://github.com/mifunetoshiro/Seedshift) (MIT) and [BIP39Colors](https://github.com/EnteroPositivo/bip39colors) (CC BY 4.0). The [third-party notices](THIRD_PARTY_NOTICES.md) list dependencies, word-list origins and card artwork.
