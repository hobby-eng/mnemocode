# MnemoCode

[![CI](https://github.com/hobby-eng/mnemocode/actions/workflows/ci.yml/badge.svg?branch=main)](https://github.com/hobby-eng/mnemocode/actions/workflows/ci.yml)
[![Executable](https://github.com/hobby-eng/mnemocode/actions/workflows/executable.yml/badge.svg)](https://github.com/hobby-eng/mnemocode/actions/workflows/executable.yml)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue)](LICENSE)
[![Build provenance: GitHub attestations](https://img.shields.io/badge/build%20provenance-GitHub%20attestations-2ea44f)](https://github.com/hobby-eng/mnemocode/attestations)

This README describes version 0.1.0, which has not been released.

**Have you inherited a backup made with MnemoCode?** Start with [A guide for heirs](docs/HEIRS.md).

MnemoCode keeps a wallet seed phrase (a BIP39 mnemonic) on paper as numbers, Unicode codes or colors. It works offline, as the `mnemocode` command or a TypeScript library.

- **[Obfuscate](#commands):** change how the words are written and recover the exact original phrase.
- **[Mask with dates](#transformation-modes):** turn the phrase into a different, valid seed phrase; the same dates restore yours.
- **[Split into shares](#splitting-a-mnemonic-into-shares):** require a chosen number of shares, for example any 2 of 3, to restore the phrase.
- **[Print](#cards-and-qr-codes):** put codes or shares on business cards or material samples, with optional QR codes.
- **[Recover](#recovery):** search forgotten words, codes, date digits or share elements and compare candidates with a known wallet reference.

These steps can be combined. Obfuscation and date masking are **not encryption**; they can disguise the phrase but do not protect it against informed guessing. For encrypted long-term storage, [MHFE](https://github.com/hobby-eng/mhfe) encrypts a seed phrase into another valid BIP39 seed phrase. Read the [security limits](SECURITY.md#cryptographic-and-recovery-limits) before choosing a backup.

[Start](#install-and-run) · [Formats](#commands) · [Shares](#splitting-a-mnemonic-into-shares) · [Recovery](#recovery) · [Safety](#compatibility-and-safety-notes) · [Library](#library-use)

## Install and run

### From source

Use Node.js 26.10.0 or newer and Corepack:

```bash
corepack pnpm install --frozen-lockfile
corepack pnpm build
node dist/mnemocode.js
```

### One executable file

The executable builds target Linux x64, Windows x64 and macOS arm64, with Node.js included. [Download verification and build instructions](docs/CLI.md#download-verification) cover signatures, checksums and GitHub attestations. The release signing key fingerprint is `28FC51B1DB80DF2101128CB30EDD4814591DD095`. PNG/JPEG export also needs Poppler's `pdftocairo`; PDF export does not.

The examples below use `mnemocode`. In a checkout, use `node dist/mnemocode.js` in its place. For options, run `mnemocode <command> --help`.

## Menu

Run `mnemocode` without arguments in a terminal. The menu offers encoding, re-encoding, decoding, sharing, recovery, sample cards and word lookup. The lookup entry also exports numbered dictionaries and a [printable guide to recovery without MnemoCode](docs/MANUAL_RECOVERY.md).

The menu always masks word numbers and English words with Seedshift, because the BIP39 list makes them easy to read. Unicode codes and colors can remain unmasked. The command line also allows direct word numbers and English words.

After Encode, the optional backup check asks for the written copy and dates again and checks that they restore the same seed phrase. The menu shows the equivalent command, with secrets omitted.

You can also show the phrase after Seedshift as words. When creating shares, you can separately show the original wallet phrase as words, codes or both; that original copy needs no shares or dates. These choices affect the screen only.

## Transformation modes

| Mode               | Use it for                                    | Dates    |
| ------------------ | --------------------------------------------- | -------- |
| `direct`           | Another representation of the original phrase | None     |
| `seedshift`        | Date masking with a valid BIP39 result        | Required |
| `seedshift-legacy` | Compatibility with Original Seedshift         | Required |

Without `--mode`, supplying `--dates-file` selects `seedshift`; otherwise the mode is `direct`.

Enter recovery material on the private screen or through local files, never as command-line text. Raw phrase, backup, share, date and final-word arguments are refused, even for public examples. Headless operations accept `--mnemonic-file`, `--input-file`, `--share-file`, `--dates-file`, `--old-dates-file` and `--last-word-file`; one source may use `-` for standard input. Refusal cannot remove text already entered from shell history or process arguments. See [input files and limits](docs/CLI.md#input-files-and-limits).

**Wrong dates can produce a valid phrase for a different wallet.** A checksum does not confirm the dates. Keep an original fingerprint, address or public key for a [recovery check](#exact-local-recovery-checks).

Original Seedshift usually produces an invalid BIP39 checksum. Its `--legacy-valid-last-word` option replaces the checksum but loses information from the last word. A record in this mode is called `seedshift-legacy-valid`; decoding gives 128, 64, 32, 16 or 8 possible last words for 12, 15, 18, 21 or 24 words. A wallet reference is needed to distinguish them.

### How checksum-valid Seedshift works

MnemoCode Seedshift shifts the entropy represented by each word and then calculates a new checksum. Decoding subtracts the shifts and restores the original phrase with the same dates. Different dates can produce the same shift. The [construction and worked example](docs/SEEDSHIFT_CONSTRUCTION.md) describe the bit packing and its limits.

## Secret input styles

Use the menu or `--ask-secrets` for a real seed phrase. Putting secrets in command arguments exposes them to shell history and process listings.

```bash
mnemocode encode --mode seedshift --ask-secrets --format 3
```

The private screen shows the secret and result, then clears them when you leave it. It requires an interactive terminal, and refuses `TERM=dumb`. This does not protect against screen capture, terminal logging or a compromised computer.

For scripts, `--mnemonic-file PATH` and `--input-file PATH` read local files; `-` reads standard input. [Input limits and QR files](docs/CLI.md#input-files-and-limits) are documented separately.

## Commands

| Format                 | What is stored                                                             |
| ---------------------- | -------------------------------------------------------------------------- |
| `english` / `1`        | English BIP39 words                                                        |
| `indexes` / `2`        | Word numbers from **1 to 2048**                                            |
| `unicode` / `3`        | Four-digit codes of the corresponding Traditional Chinese BIP39 characters |
| `colors-unicode` / `4` | Each color represented by two four-digit Unicode codes                     |
| `colors` / `5`         | `#RRGGBB` codes: 8, 10, 12, 14 or 16 for 12, 15, 18, 21 or 24 words        |

Colors can be reordered, but every real code is needed. The 12- and 24-word color forms are compatible with BIP39Colors. Color Unicode is MnemoCode's text format, not a Unicode standard; it is also read as the Private Use characters themselves. [Separators and public command examples](docs/CLI.md#representation-details) cover copying each form.

Encode shows two fingerprints: **original** identifies the wallet with an empty BIP39 passphrase; **encoded** identifies the stored phrase. They do not reveal the phrase. The encoded fingerprint checks the written codes without dates; a wallet reference checks the result after undoing dates. An invalid legacy phrase has no encoded fingerprint.

## Complete encode and decode examples

Save a record with its mode and format, then read it back:

```bash
mnemocode encode --mode seedshift --ask-secrets --format 5 --output shifted-colors.txt
mnemocode decode --input-file shifted-colors.txt --ask-secrets
```

Without date masking:

```bash
mnemocode encode --mode direct --ask-secrets --format 3 --output direct-unicode.txt
mnemocode decode --input-file direct-unicode.txt --ask-secrets
```

## Cards and QR codes

Cards print the recoverable codes. Photographs, decorative colors and personal details do not carry the phrase. Thirteen designs are available; `mnemocode preview --list` lists them. Cards require format 3, 4 or 5.

```bash
mnemocode encode --mode seedshift --ask-secrets --format 5 \
  --template business-it --pdf cards.pdf --card-qr
```

Printed sets include extra random codes to disguise their length. To decode manually copied cards, use `--words` for the original phrase length and leave out those extra codes. The sheet for heirs records that length.

A QR code contains only the real codes: **no mode, format header or dates**. `--card-qr` adds one to the collection sheet and saves a PNG copy beside it; individual cards never have a QR code. `--qr PATH` saves a separate PNG. Read a backup with `decode --qr-file PATH`, or a share with `sskr-combine --share-qr PATH`.

Files and folders are not overwritten; taken names receive a number. Folder exports are prepared privately, but interruption while publishing can leave partial output or a private temporary copy. See [export precautions](SECURITY.md#secret-lifecycle-and-local-boundaries).

[Card designs](docs/card-designs.md), [identity defaults](docs/card-identities.md) and [card options](docs/CLI.md#card-options) describe customization. `preview` uses a public test phrase, so you can try a design without entering a secret.

### Individual business cards

`--cards-dir NEW_FOLDER` saves one PDF, PNG or JPEG per card, for business card designs only. Each file contains one code; one extra card contains a decoy code.

**This is not Shamir sharing.** Every real card is needed, and each exposes part of the encoded phrase. Use shares when you want a threshold.

## Page sizes

A6, A5 and A4 produce collection sheets. `--page-size business` produces 90 × 50 mm cards: one per PDF page or image. `--cards-dir` puts them in separate files. Sheet samples are scaled to fit and are not cut-out cards. Print at **100% / actual size** to preserve QR dimensions.

`--image-format png|jpg` selects images. PNG preserves sharp codes and transparent card corners; JPEG has white corners. [Card options](docs/CLI.md#card-options) list output and orientation settings.

### Collection-sheet identity

`--studio-name` names the design studio; `--card-company` names the employer on business cards. Material sheets use `--card-name` for the recipient. [Identity defaults](docs/card-identities.md) and [custom text fields](docs/CLI.md#card-options) explain the remaining details.

## Splitting a mnemonic into shares

```bash
mnemocode encode --mode direct --ask-secrets --sskr --threshold 2 --shares 3
mnemocode sskr-combine --ask-secrets
```

The required threshold can be at most the share count, up to 16. Standard Bytewords and `ur:sskr/…` shares work with other SSKR tools. Encode can also share word numbers, Unicode codes or colors; these forms require MnemoCode. Shares restore the phrase that was split: if it was masked, the dates are still needed.

`sskr-export` prints existing shares. Keep shares in separate places: one collection PDF or page-image folder can contain **all** of them. [SSKR commands and formats](docs/SSKR.md) explain the choices.

### Damaged shares

Put `?` where a share element is unreadable. Separated color and Unicode codes also accept missing digits, such as `#B5?0??` or `4E?0`; retaining readable digits can reduce a search from months to seconds. Bytewords, word numbers and UR pairs accept whole-element marks only.

Repair uses checksums, matching set metadata and redundancy from extra shares. More than one damaged share, including two copies of one share, can be supplied. The program estimates the work before searching and asks before estimates above 12 hours; the maximum is about a trillion combinations. See [patterns and timing examples](docs/SSKR.md#damaged-shares).

If several phrases survive, none is selected automatically. A [wallet check](#exact-local-recovery-checks) distinguishes them. `sskr-export` returns repaired shares without displaying the seed phrase, so you can correct the copies.

## Instructions for heirs

`--heir-sheet heirs.pdf` makes a double-sided A5 guide; `--heir-sheet-size a6` makes a smaller one. It records the backup type, phrase length, share threshold and number of dates, but no codes, shares, dates, fingerprints or storage locations.

Keep it apart from the backup. A handwritten hint should help your heirs remember dates without disclosing them. The sheet cannot restore the wallet on its own. [A guide for heirs](docs/HEIRS.md) explains recovery and wallet precautions.

## Versioned records and legacy compatibility

`encode --output` saves `MNC1:<mode>:<format>:<data>`. It records how to decode the backup, but never the dates. Conflicting explicit options are refused; the private screen offers to use the header's values instead.

Typed codes and QR codes have no header: retain the original mode. MnemoCode can usually detect the format; ambiguous input needs `--format`. With `--sskr`, the output file instead contains one share per line.

## Re-encoding a backup

`re-encode` reads an existing backup, restores its phrase and makes another with new dates, mode, form, cards or shares. It requires recognition of the recovered phrase or a wallet check before creating the replacement. A valid checksum alone is not confirmation.

```bash
mnemocode re-encode --ask-secrets --input-file shifted-colors.txt --mode seedshift --format 5
```

Use `--old-mode`, `--old-format` and `--old-dates-file` for the input; the ordinary encoding options describe the output. Legacy-valid input also needs the remembered original final word, entered privately or supplied with `--last-word-file`. For scripts, supply a wallet reference or `--recognised`. Recover missing codes or dates first. The old backup remains usable after re-encoding.

## Recovery

| What is missing              | Operation                                       |
| ---------------------------- | ----------------------------------------------- |
| Words of the original phrase | [recover-word](#forgotten-word-recovery)        |
| Codes of a stored phrase     | [Decode](#codes-that-cannot-be-read)            |
| Masking dates                | [recover-date or Decode](#date-recovery-helper) |
| Share elements               | [Restore or repair shares](#damaged-shares)     |

### Word and code patterns

| Pattern        | Meaning                                            |
| -------------- | -------------------------------------------------- |
| `?`            | One unreadable word, number, Unicode code or color |
| `ab*`          | An English word beginning with `ab`                |
| `rich\|rice`   | One of the listed English words                    |
| `1?34`, `4E?0` | One unknown digit in a number or Unicode code      |

Word and code searches allow up to **16,777,216 combinations**. A BIP39 checksum leaves roughly 128 candidates for one unknown word in 12 words, or 8 in 24 words; for two unknown words, roughly 262,144 or 16,384. Original Seedshift codes have no checksum filter. A checksum-valid candidate is not necessarily your wallet.

## Forgotten-word recovery

`recover-word` takes the original English phrase with the patterns above. If one word is missing at an unknown position, use `--missing-word` with the remaining words.

A wallet check marks matching candidates. Nonmatches remain visible when there are at most 2,048 candidates; checking hundreds of thousands can take minutes. With no wallet reference, use a [candidate list for discovery](#candidate-lists-for-discovery).

For an invalid Original Seedshift last word, `--legacy-valid-last-word` lists valid replacement words for the **stored** phrase. The `preserved` row keeps the old data bits. Dates are still needed to recover the original phrase.

## Codes that cannot be read

Decode accepts the same patterns in stored codes. Select candidates by the encoded fingerprint, without dates; by a wallet reference after undoing dates; or by listing a small set. Missing date digits can be searched at the same time. The result includes the repaired codes and dates.

Decode also accepts Shamir shares, pasted one per line or read from a text file or QR image, and keeps all of them when opening share restoration. When damaged text could be either codes or a share, choose the kind or pass `--input-kind codes|share`.

## Date recovery helper

`recover-date` accepts up to three incomplete dates. Use `?` for a digit, a day/month/year or a whole date; `|` lists alternatives:

| Pattern          | Meaning            |
| ---------------- | ------------------ |
| `?3-09-2026`     | A day ending in 3  |
| `05\|15-09-2026` | Day 5 or 15        |
| `15-?-2025`      | Any month          |
| `?-?-2026`       | Any date in 2026   |
| `?`              | Any supported date |

MnemoCode Seedshift and legacy-valid searches require a wallet reference: every date can give a valid phrase. Original Seedshift can instead use the checksum as a weak filter. Searches above an estimated 12 hours need confirmation, and no date search exceeds 2,147,483,648 attempts. [Date search details](docs/CLI.md#date-search-details) explain equivalent dates, result limits and combined share/date repair.

## Exact local recovery checks

Candidates can be compared offline with an address, compressed public key, master/account extended public key, WIF from a file, or original master fingerprint. A fingerprint has only 32 bits: it is a filter, not proof. Prefer a known address or public key.

Bitcoin searches default to mainnet, account 0, receiving branch 0 and indexes 0–19, trying BIP44/49/84/86. `--account`, `--branch`, `--index`, `--scan-gap` (up to 1000), `--network` and `--bitcoin-profile` select the range. An exact location with `--scan-gap 1` is faster. Eleven other coins use their standard single-key paths and infer the network from the address.

If the wallet uses a BIP39 passphrase, give it with `--bip39-passphrase-file`, also together with `--ask-secrets`; the private screen and the menu do not ask for it, and without the file wallet checks use an empty passphrase. It is separate from the masking dates. [Reference options, supported coins and examples](docs/CLI.md#wallet-check-examples-and-address-forms) cover the details. WIFs are private keys: keep them out of command arguments and reports.

## Candidate lists for discovery

With no known reference, save candidates using `--candidates-file candidates.age` for the Discovery Scanner of the [multi-chain wallet tools](https://github.com/hobby-eng/multi-chain-wallet-tools). Candidate N on screen is record N in the file.

**The file contains seed phrases.** It is encrypted to the Scanner's one-time key (`--candidates-key age1…`) or with a passphrase. MnemoCode stays offline; the Scanner checks for funds online. [Candidate lists](docs/CANDIDATES.md) describes the format, privacy and limits.

## Self-tests and public vectors

The startup self-test, quick known-answer and refusal checks, runs before secret operations; a failure stops the operation. Share operations also check the SSKR engine against published answers. These checks do not replace verifying a download or the stored backup.

`mnemocode self-test` runs the full self-test, the startup self-test and more, including PDF and QR rendering, and can take longer. [Check coverage](docs/CLI.md#installation-checks) lists what it exercises; [public vectors](vectors/mnemocode-v1.json) are available for independent verification.

## Compatibility and safety notes

- Dates accept `DD-MM-YYYY` or `YYYY-MM-DD`, with a four-digit year from `0001` to `9999`; their input order does not matter.
- Use at most one date per three words: 4–8 dates for 12–24 words.
- MnemoCode accepts 21-word legacy phrases, which Original Seedshift did not support.

Read [SECURITY.md](SECURITY.md) for the remaining cryptographic, recovery and host risks.

### Protection while it runs

The CLI restricts network access, file writes and child processes according to the command. Additional operating-system protections depend on what the system supports. The library inherits its host's permissions. [Runtime protection](SECURITY.md#secret-lifecycle-and-local-boundaries) describes the actual guarantees and exceptions.

### Unencrypted swap

On Linux, MnemoCode warns when swap is unencrypted or cannot be assessed. Secret bytes may be written to disk through swap; use encrypted swap or none. The program cannot lock its Node.js memory out of swap.

### Cloud folders

A synchronized folder can upload records, cards and shares. MnemoCode warns for usual cloud-folder names, but cannot detect every configuration. Use a local folder or removable drive.

## Library use

The library's host-neutral modules provide the same transformations, recovery, sharing and rendering plans as the CLI. Hosts supply their own randomness, file access, rendering or share engine where required. The package is distributed from this repository and is not published to npm.

[Modules for other hosts](docs/ARCHITECTURE.md#modules-for-other-hosts) describes the entry points and ownership contracts; [library examples](docs/CLI.md#library-example) show encoding and decoding.

## Continuous integration

CI checks source, tests and platform input handling; release workflows build and check the executables. [Releasing](docs/RELEASING.md) describes the signing and acceptance requirements.

## Source layout and review

See the [architecture](docs/ARCHITECTURE.md) and [audit index](docs/audits/README.md).

## Provenance and license

MnemoCode is an independent TypeScript implementation, not an official fork of Seedshift or BIP39Colors. Its source is MIT licensed. [NOTICE](NOTICE) attributes the compatible formats to [Seedshift](https://github.com/mifunetoshiro/Seedshift) (MIT) and [BIP39Colors](https://github.com/EnteroPositivo/bip39colors) (CC BY 4.0). [Third-party notices](THIRD_PARTY_NOTICES.md) record dependencies, word-list origins and the origin of the card artwork.
