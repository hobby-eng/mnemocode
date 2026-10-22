# Command-line reference

For choosing a backup or recovery method, start with the [README](../README.md). This reference covers download verification, exact input and output formats, and command examples. All phrases and wallet references in examples are public test data.

## Download verification

Release assets use one executable file for Linux, Windows and macOS that runs without Node.js or anything else installed: `mnemocode-<version>-linux-x64`, `mnemocode-<version>-win-x64.exe` and `mnemocode-<version>-macos-arm64`. Next to each file is a file of the same name ending in `-licenses.txt`, for example `mnemocode-0.1.0-linux-x64-licenses.txt`, with the licenses of Node.js and of every library the file contains.

Check a download once before you run it. The release's `SHA256SUMS` holds the SHA-256 of every file and is signed with the maintainer's OpenPGP key: `SHA256SUMS.asc` is the signature and `RELEASE-SIGNING-KEY.asc` the public key, whose fingerprint is `28FC51B1DB80DF2101128CB30EDD4814591DD095`. GitHub shows the same key for the maintainer at https://github.com/hobby-eng.gpg. Look at the key's fingerprint before you import it, check the signature and the SHA-256 of your file, then run it as `mnemocode`:

```bash
gpg --show-keys RELEASE-SIGNING-KEY.asc
gpg --import RELEASE-SIGNING-KEY.asc
gpg --verify SHA256SUMS.asc SHA256SUMS
sha256sum --check --ignore-missing SHA256SUMS
chmod +x mnemocode-0.1.0-linux-x64
./mnemocode-0.1.0-linux-x64 self-test
```

`gpg --verify` must say "Good signature" for a key with that fingerprint. Its warning that the key is not certified with a trusted signature only means that you have not certified the key yourself. [Releasing](RELEASING.md) describes how a release is built and signed.

GitHub also signs where each file of a release was built. On the computer you downloaded it with, the [GitHub CLI](https://cli.github.com/) checks that the file was built by a GitHub Actions workflow of this repository, and was not replaced afterwards:

```bash
gh attestation verify mnemocode-0.1.0-linux-x64 --repo hobby-eng/mnemocode
```

The file holds Node.js, the program, artwork, fonts and the SSKR engine. Image export also needs Poppler's `pdftocairo` in a folder of `PATH`. To build the executable from a checkout, run `corepack pnpm build:executable`; it writes the file and license notices to `release/` and checks it from an empty folder.

## Command help

`mnemocode --help` lists commands. `mnemocode <command> --help` describes the options and examples; `-h` gives a short summary. In a source checkout, replace `mnemocode` with `node dist/mnemocode.js`, or use `corepack pnpm dev --`.

## Public command examples

```bash
# Public fixtures only; use the private screen or protected local files for real material.
TEST_MNEMONIC='abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about'
mkdir -p output
printf '%s\n' "$TEST_MNEMONIC" > output/public-mnemonic.txt
printf '%s\n' '23-09-2026' > output/public-dates.txt

# Write the phrase as Unicode codes without changing it.
mnemocode encode --mode direct --mnemonic-file output/public-mnemonic.txt --format 3

# Mask the phrase with file dates and also save a self-describing record.
mnemocode encode --mnemonic-file output/public-mnemonic.txt \
  --dates-file output/public-dates.txt --format 1 --output output/public-shifted.txt

# Make the same record as the original Seedshift program.
mnemocode encode --mode seedshift-legacy --mnemonic-file output/public-mnemonic.txt \
  --dates-file output/public-dates.txt --format 1

# Decode a public legacy record without a header: give its mode and form.
printf '%s\n' '8F44901950118F44901950118F44901950118F4490194F5C' > output/public-legacy.txt
mnemocode decode --mode seedshift-legacy \
  --input-file output/public-legacy.txt --format 3 --dates-file output/public-dates.txt

# Find a forgotten day and check it against the fingerprint.
printf '%s\n' '??-09-2026' > output/public-date-patterns.txt
mnemocode recover-date --mode seedshift \
  --input-file output/public-shifted.txt \
  --dates-file output/public-date-patterns.txt --master-fingerprint 73c5da0a

# Find one forgotten word. Every word that passes the checksum test is shown.
printf '%s\n' 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon ?' > output/public-word-pattern.txt
mnemocode recover-word --mnemonic-file output/public-word-pattern.txt

# One material source may come from standard input, without an intermediate input file.
printf '%s\n' "$TEST_MNEMONIC" | mnemocode encode --mode direct --mnemonic-file - --format 3

# Mark the candidates that match a known fingerprint.
mnemocode recover-word --ask-secrets --master-fingerprint 73c5da0a

# Look up one word, index or Unicode code, or print the whole table.
mnemocode table --word abandon
mnemocode table --index 1
mnemocode table --unicode 5BF6
mnemocode table --all

# Save all numbered words, characters and codes, and a standalone English recovery guide.
mnemocode table --all --table-format mapping --output output/bip39-mapping.txt
mnemocode table --recovery-guide --output output/manual-recovery.md
mnemocode table --word-lists-dir output/recovery-pack
```

## Word lists and manual recovery

In the word lookup entry, Enter after a result asks for another value of the same kind; Escape returns to the main menu. **Export word lists and guide** saves the English list, the Traditional Chinese list, Unicode characters with their codes, the full correspondence table, or the [manual recovery guide](MANUAL_RECOVERY.md).

Every dictionary has 2,048 rows numbered from 1 under a header, in UTF-8. `table --all --table-format english|chinese|unicode|mapping` selects the columns, lined up with spaces for reading and printing, the Chinese character last so that no column after it depends on how wide a font draws it; `--output PATH` saves them instead of printing them. With no `--table-format`, the original number/English/Unicode-code table is unchanged, its columns separated by tabs for a script. Existing files are kept and the new file receives a numbered name.

**Full set**, or `table --word-lists-dir PATH`, saves all four numbered tables and `manual-recovery.md` together in a new folder. An existing folder is kept; MnemoCode chooses a numbered folder name.

The guide explains date sorting, the repeating year/month/day shifts, modular addition and subtraction, MnemoCode Seedshift's shorter last-word modulus, checksum calculation, exact and corrected legacy modes, and decoding colors. It includes a standalone Python helper that needs no MnemoCode installation. Print the full mapping too. Combining SSKR shares still requires a compatible SSKR implementation.

## Representation details

`encode --show-masked-words` also shows the English words after Seedshift, beside the chosen codes. This is the masked phrase: the original dates are still needed. `--show-original words` separately shows the original wallet phrase as English words for visual checking, with or without Shamir shares. Its former `codes` and `both` values are refused before any secret is read. The menu offers No or Yes, show the words, and leaves this display off by default. These display choices do not add the original to encoded or share files and QR images.

The [format table](../README.md#commands) lists names and numbers. Input syntax differs by form:

| Form          | Accepted separators                                                                                            |
| ------------- | -------------------------------------------------------------------------------------------------------------- |
| Word numbers  | Spaces or commas; joined numbers are ambiguous and refused                                                     |
| Word Unicode  | Four hexadecimal digits per code, separated or joined                                                          |
| Colors        | Separated codes, joined `#RRGGBB` codes, or one joined `RRGGBB` line                                           |
| Color Unicode | Two four-digit Private Use Area codes per color, separated or joined, or the Private Use characters themselves |

Color Unicode needs no special font when written as hexadecimal text.

On a terminal, codes that formats 3 and 4 write joined are shown twice, for the phrase and for its shares: apart, separated by spaces, so that each code can be told and an unreadable one replaced by `?`, and then joined on one line, for copying. The codes of formats 1, 2 and 5, which are separated by spaces already, are wrapped at those spaces within 78 columns, so that a terminal of 80 columns or more never breaks a word or a code in two; a narrower one wraps the lines again where it ends. A file or a pipe gets the codes on one line.

The layout follows where the output goes: a terminal gets headings, labelled facts, numbered phrases and marked notices, and a file, a pipe or `TERM=dumb` the plain lines of a script. On a terminal each candidate of `recover-word` and each match of `recover-date` is a part of its own, with the words or dates found, the wallet check and the phrase as labelled facts; a file or a pipe gets one row of tab-separated fields for each. Colour is decided apart from it: `NO_COLOR` or `CLICOLOR=0` takes the colours away and keeps the terminal layout, and `CLICOLOR_FORCE` adds colour without changing the form.

For `decode` and `recover-date`, `--format` is usually optional. MnemoCode picks the form itself when exactly one form fits the whole record. Otherwise it asks in the terminal, and a script must pass `--format`.

## Input files and limits

On the private screen, the fields for Shamir shares, forgotten words and encoded backups also accept a local text file path. Enter the path directly or drag the file into the terminal; no source selection is needed. MnemoCode reads its exported share files and MNC1 records unchanged. Paths with spaces may be quoted, and local `file:///` links work. Prefix a filename without an extension with `./`.

Escape at a secret-input prompt cancels the current action. When started from the menu, it returns to that menu; it does not quit MnemoCode. Ctrl+C also cancels. A standalone cancelled command ends with exit code 130.

Control and text-direction characters in displayed paths are replaced with U+FFFD; the actual filesystem names are unchanged. A command preview containing such characters is omitted, with a warning.

On the private screen, a result that does not fit with the question or prompt under it, such as a long share set with its heading and notices, missing-code candidates, the candidates of `recover-word`, the matches of `recover-date` or the phrases of an Original Seedshift record with a replaced last word, is shown whole by pages first. Use Up/Down or PageUp/PageDown to move, Home/End to reach the first or last page, and Enter or Escape when finished copying; the end of the result then stays above the question. Ctrl+C cancels. Output redirected to a file or pipe stays complete and has no page controls. `recover-word` shows every candidate there when the list would fit on the screen as one row per candidate, as a file gets it; a longer list shows only the candidates that match the wallet, and without a wallet or a candidate list offers to check them against one.

`--mnemonic-file PATH` reads a phrase; `--input-file PATH` reads codes or a record. The path `-` reads standard input. With `--ask-secrets`, Decode and date recovery can read `--input-file` or `--qr-file` and then ask only for dates. Decode and Re-encode also accept a file or paste of Shamir shares, separated by lines or `;`, in any share form; their mixed input prompt explains the separator and using `?` for each missing or unreadable share code or digit. Both keep every share and use Restore's questions, including repair of share codes marked with `?`. Re-encode asks about Seedshift and takes its dates before confirming the original phrase; it never confirms the masked phrase as the wallet's. Forgotten date digits can be searched with the original wallet's fingerprint or address. If several candidates remain, choose one and confirm it before making a new backup. A wallet reference cannot replace a missing share below the threshold or make inconsistent unmarked codes fit.

Raw `--mnemonic`, `--input`, `--share`, `--date`/`--dates`, `--old-date`/`--old-dates` and `--last-word` values are refused, including public fixtures. Help names them as refused, with the option to use instead; none is accepted as an exception.

Refusal cannot remove text already entered in shell history or process arguments. Choose a safe input source before entering real material.

For headless operations, `--dates-file PATH` reads whitespace-separated dates; `recover-date` also accepts its `?` patterns there. Re-encode uses `--old-dates-file PATH` for the old backup and `--dates-file PATH` for the new one; a legacy-valid backup takes its original final word from `--last-word-file PATH`. These three options also accept `-`. Only one material source may read standard input in a command. Do not combine these date/final-word files with `--ask-secrets`, which asks for those answers itself. Protect and keep date files yourself: dates are not added to encoded records.

Text input may be up to 1 MiB. A QR image may be up to 16 MiB, 4096 pixels on either side and 8 megapixels, with up to 8 bits per sample. Larger inputs are refused. A multiline paste is one answer: words, codes and dates may be on separate lines; separate shares become semicolon-separated.

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

Replace random identity fields with `--card-name`, `--card-role`, `--card-company`, `--card-email`, `--card-phone`, `--card-website` and `--card-location`. Names accept Latin letters, spaces, apostrophes and hyphens. Characters missing from the font and text that does not fit are refused. `--studio-name` names the collection studio; material sheets print `--card-name` as the recipient. [Identity defaults](card-identities.md) describes the generated values.

`--card-slogan`, `--card-subtitle`, `--card-footer` and `--card-reference-label` replace the text on the sheet. The value `-` hides a field. The default reference label is `Ref.`.

Images need Poppler's `pdftocairo` in a folder of `PATH`, given by its full path; PDFs do not. A missing converter is reported before asking for a secret. Images use 300 dpi; PNG keeps text and QR codes sharp, while JPEG uses quality 90. Separate-card corners are transparent in PNG and white in JPEG.

[Card designs](card-designs.md) describes what is printed on a sheet.

| Page size      | Dimensions   |
| -------------- | ------------ |
| `a6` (default) | 148 × 105 mm |
| `a5`           | 148 × 210 mm |
| `a4`           | 210 × 297 mm |
| `business`     | 90 × 50 mm   |

`--orientation portrait|landscape` fixes the orientation. Otherwise the sheet is turned to fit at least three rows where possible, with the largest cards. `--cards-dir` cannot be combined with `preview --all`. For the cards of a backup it accepts business size or no size, and only business card designs. For shares it saves one file or folder per share at any page size: a sheet size gives one collection sheet per share, as [Share cards](SSKR.md#share-cards) describes. A collection saved by the same command must be outside that folder. Individual filenames contain the card number and printed code, such as `01-ABCDEF.pdf` or `01-7684.pdf`.

For shares, QR PNG copies are named after each share's reference, including inside a share-card folder. A sheet QR contains only the real codes; the random padding cards are excluded.

## Date search details

Complete and incomplete dates can be combined, such as `10-1?-2010 15-?-2025` or `15-12-2025 ?`.

Several incomplete dates multiply the number of attempts. Two identical patterns are tried once, not once for each order. Dates that shift every word alike are tried once too: Seedshift adds the year to a word number modulo the 2,048 words, so a year and the year 2,048 years later give the same phrase. A forgotten year therefore finds a phrase once, with the earliest year that gives it, not four or five times.

The command shows the number of attempts before it starts, and with a wallet check about how long they take on your computer. A search of up to 12 hours starts at once; a longer one is asked for first, or needs `--max-candidates` with at least its number of attempts. No date search has more than 2,147,483,648 date combinations. Decode tries each candidate of marked codes with every date combination, so their joint search can be larger; it is timed and asked for as any search is. `--max-results` sets how many candidates are shown (100 by default), and `--progress-every` sets how often progress is reported. A search of every date has 3,652,059 attempts.

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

`--index` selects the first address compared and `--scan-gap N` the number of addresses, up to 1000. `--bitcoin-profile auto` tries BIP44, BIP49, BIP84 and BIP86; a list such as `native-segwit,taproot` names each type once. Extended public keys accept the standard and SLIP-132 versions named in the example.

The other coins use standard single-key paths: Bitcoin Cash (`bitcoin-cash`, `bitcoincash:q…` or `1…`), Cosmos (`cosmos`, `cosmos1…`), Dash (`dash`, `X…` or Platform `dash1k…`; testnet Platform `tdash1k…`), Dogecoin (`dogecoin`, `D…`), EVM networks (`ethereum`, `0x…`), Ethereum Classic (`ethereum-classic`), Injective (`injective`, `inj1…`), Litecoin (`litecoin`, `L…`, `M…`, `3…` or `ltc1q…`), Tron (`tron`, `T…`), XRP (`xrp`, `r…`) and Zcash (`zcash`, transparent `t1…`). Zcash shielded addresses cannot be checked. Bitcoin Cash and Ethereum Classic try both their own coin type and that of their parent chain. The address determines type and network; `--network` and `--bitcoin-profile` apply to Bitcoin only.

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

```ts
import { encodeMnemonic, formatEncoded, masterFingerprint, parseDate } from "mnemocode";
import { EncodedBackup } from "mnemocode/core/encoded-backup";

const dates = ["10-07-1963", "31-01-4489"].map(parseDate);
const encoded = encodeMnemonic(mnemonic, dates);
const unicode = formatEncoded(encoded, "unicode");
using encodedBackup = EncodedBackup.read(unicode, "unicode", "seedshift");
const recovered = encodedBackup.decode(dates);
// recovered.recoveredMnemonic is secret; do not log it.
const originalFingerprint = masterFingerprint(mnemonic);

// The same phrase in another form, without dates.
import { representMnemonic } from "mnemocode";
const direct = formatEncoded(representMnemonic(mnemonic), "unicode");
using directBackup = EncodedBackup.read(direct, "unicode", "direct");
const sameMnemonic = directBackup.decode([]);
```

The creating scope disposes both backups, including when decoding fails. Returned strings and
copied views belong to the caller; JavaScript cannot erase them when their owner is disposed.

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
