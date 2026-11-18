# Command-line reference

For choosing a backup or recovery method, start with the [README](../README.md). This reference covers download verification, exact input and output formats, and command examples. All phrases and wallet references in examples are public test data.

## Download verification

Release assets provide one executable for each supported target: `mnemocode-<version>-linux-x64`, `mnemocode-<version>-linux-arm64`, `mnemocode-<version>-win-x64.exe`, `mnemocode-<version>-macos-arm64` and `mnemocode-<version>-macos-x64`. Linux needs glibc 2.35 or later; musl systems such as Alpine cannot run these files. Each executable has a companion `-licenses.txt` file: the MIT and Apache-2.0 licenses, the `NOTICE` and the third-party notices of what it contains.

Check a download before running it. `SHA256SUMS` lists its SHA-256 hash, `SHA256SUMS.asc` signs that list, and `RELEASE-SIGNING-KEY.asc` contains the public key, whose fingerprint must be `28FC51B1DB80DF2101128CB30EDD4814591DD095`; the maintainer also publishes it at <https://github.com/hobby-eng.gpg>. Run the commands below as one script with the name of the file you will run: it stops at the first failure, and it succeeds only when the key has that fingerprint, the signature over `SHA256SUMS` is good, and the line for exactly that file matches its bytes.

```bash
set -euo pipefail
file=mnemocode-0.2.0-linux-x64
gpg --show-keys --with-colons RELEASE-SIGNING-KEY.asc | grep -qx 'fpr:::::::::28FC51B1DB80DF2101128CB30EDD4814591DD095:'
gpg --import RELEASE-SIGNING-KEY.asc
gpg --status-fd 1 --verify SHA256SUMS.asc SHA256SUMS | grep -q '^\[GNUPG:\] VALIDSIG .*28FC51B1DB80DF2101128CB30EDD4814591DD095'
grep -x "[0-9a-f]\{64\}  $file" SHA256SUMS | sha256sum --check --strict
chmod +x "$file"
./"$file" self-test
```

A warning from `gpg --verify` that you have not certified the key is separate from signature validity. On macOS, replace `sha256sum --check --strict` with `shasum -a 256 --check`. On Windows, after the GnuPG steps, compare `(Get-FileHash -Algorithm SHA256 mnemocode-0.2.0-win-x64.exe).Hash` with the hash on the line for that file name in `SHA256SUMS`; `Get-FileHash` alone does not verify the signature.

On the connected computer used to download the release, the [GitHub CLI](https://cli.github.com/) can also check that the file was built by the release workflow from the tag:

```bash
gh attestation verify mnemocode-0.2.0-linux-x64 --repo hobby-eng/mnemocode --signer-workflow hobby-eng/mnemocode/.github/workflows/release.yml --source-ref refs/tags/v0.2.0
```

The executable contains the program, artwork, fonts and native SSKR engine. PDF, PNG and JPEG export need no external image converter. To package a source build for Linux x64:

```bash
cargo xtask release build x86_64-unknown-linux-gnu
cargo xtask verify-executable dist/release/mnemocode-0.2.0-linux-x64
```

Other target names and the canonical build are described in [Releasing](RELEASING.md). A development build uses `cargo build --locked -p mnemocode-cli`.

## Command help

`mnemocode --help` lists commands. `mnemocode <command> --help` describes the options and examples; `-h` gives a short summary. In a source checkout, replace `mnemocode` with `target/release/mnemocode`.

The Encode menu (including Embroidery) asks for the Seedshift version and immediately asks for its dates, before the remaining settings. Choosing no Seedshift skips dates. Dates stay on the private screen and are never added to the command preview. The equivalent `encode --configure --ask-secrets` (optionally `--format`, or `--sskr` as the menu's Split into shares runs it) or `stitch --configure --ask-secrets` asks the same settings. Plain `--ask-secrets` with explicit settings keeps its existing phrase-then-dates order. On Linux, the socket filter is active while paths are being selected; file writes stay open until output preflight, then are restricted to the selected folders before the seed phrase is read. Available protections differ by platform and are reported on the private screen.

## Input files and limits

On the private screen, the fields for Shamir shares, forgotten words and encoded backups also accept a local text file path. Enter the path directly or drag the file into the terminal; no source selection is needed. MnemoCode reads its exported share files and saved codes unchanged, and records of earlier versions, which start with MNC1. Paths with spaces may be quoted, and local `file:///` links work. Prefix a filename without an extension with `./`. The fields for encoded backups and shares also take the files of printed cards (PDF, PNG or JPEG), QR images and patterns' PDFs, or a folder: MnemoCode reads it with the folders inside it, lists every backup and set of shares it finds, with the kind of codes and the files, and reads the one you choose; shares of one set and cards of one backup found in several files are read together. It only reads the folder.

Escape at a secret-input prompt cancels the current action. When started from the menu, it returns to that menu; it does not quit MnemoCode. In the questions of a menu task, Escape returns to the main menu at every question, and Shift+Tab goes back to the question before; at the seed phrase of Encode, Embroidery and Split it goes back to the last question, where the folder for the files can no longer change. At the first question of a command that the menu started, Shift+Tab goes back to the menu's last question, its answer kept; such a command ends with exit code 3. Ctrl+C also cancels. A standalone cancelled command ends with exit code 130.

Control and text-direction characters in displayed paths are replaced with U+FFFD; the actual filesystem names are unchanged. A command preview containing such characters is omitted, with a warning.

Long private-screen results are paged before the next question. This includes share sets, missing-code candidates, word/date matches and the two phrases of Original Seedshift codes read without their last word. Move with Up/Down or PageUp/PageDown, use Home/End for the first or last page, and press Enter or Escape after copying. The end of the result then remains above the question. Ctrl+C cancels. Redirected output stays complete and has no page controls.

For `recover-word`, a list that fits one candidate per screen row shows every candidate. A longer result shows wallet matches; without a wallet or candidate-list destination, it offers a wallet check or encrypted list for the Discovery Scanner. The offer also applies to patterns read with `--mnemonic-file`. MnemoCode asks for the destination and encryption method, with the passphrase entered privately.

`--mnemonic-file PATH` reads a phrase; `--input-file PATH` reads codes or a record. The path `-` reads standard input. Decode and date recovery can combine `--input-file` or `--qr-file` with `--ask-secrets`, reading the backup from the file and asking for the remaining private answers.

Decode and Re-encode also accept Shamir shares in any supported form, pasted or read from a text file. Separate shares by newlines or `;`, and use `?` for unreadable codes or digits. Both commands keep every share and use Restore's repair questions.

Re-encode asks about Seedshift and its dates before confirming the original wallet phrase. Forgotten date digits can be searched against an original-wallet fingerprint or address. If several candidates survive, select and confirm one before creating the replacement. A wallet reference cannot replace a share below the threshold or repair an incorrect unmarked code.

Raw `--mnemonic`, `--input`, `--share`, `--date`/`--dates`, `--old-date`/`--old-dates` and `--last-word` values are refused, including public fixtures. Help names them as refused, with the option to use instead; none is accepted as an exception.

Refusal cannot remove text already entered in shell history or process arguments. Choose a safe input source before entering real material.

For headless operations, `--dates-file PATH` reads whitespace-separated dates; `recover-date` also accepts its `?` patterns there. Re-encode uses `--old-dates-file PATH` for the old backup and `--dates-file PATH` for the new one; an Original Seedshift backup that MnemoCode wrote takes the last word Encode named from `--last-word-file PATH`. These three options also accept `-`. Only one material source may read standard input in a command. Do not combine these date/final-word files with `--ask-secrets`, which asks for those answers itself. Protect and keep date files yourself: dates are not added to encoded records.

Each text input has its own limit, which `--help` names: 256 bytes for a seed phrase, 128 for dates, 4 KiB for a passphrase or a date pattern, 32 KiB for a `recover-word` pattern, 64 KiB for encoded input or a set of shares, as an answer or a file. A QR image may be up to 16 MiB, 4096 pixels on either side and 2 megapixels (2,097,152 pixels), with up to 8 bits per sample: a screen of 1920 × 1080 fits, and the QR images that MnemoCode saves are 720 px; crop a photograph or a page image to the code. The picture of a cross-stitch pattern may be a PNG, JPEG or WebP file of up to 40 MiB and 60 megapixels, and a pattern's PDF is read up to 64 MiB. A folder is read with the folders inside it, up to 6 levels down: only its files ending in .pdf, .png, .jpg or .jpeg, at most 1,024 of them, each up to 64 MiB; links are not followed. Larger inputs are refused. An image is read whole, and Ctrl+C acts when that reading ends: an image of noise can keep it for seconds. A multiline paste is one answer: words, codes and dates may be on separate lines; separate shares become semicolon-separated.

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

The tasks below follow the menu order. Each encode/decode pair uses the same file, mode and dates. A saved file and a QR payload hold only the codes: give `--mode`, unless the dates file makes it `seedshift`.

### Encode

```bash
# MnemoCode Seedshift as English words, saved as a text file; the dates make it seedshift.
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
mnemocode decode --mode seedshift-legacy --input-file output/public-legacy.txt \
  --dates-file output/public-dates.txt

# Seedshift colors on A4 sheets, with the QR and its PNG copy.
mnemocode encode --mode seedshift --mnemonic-file output/public-mnemonic.txt \
  --dates-file output/public-dates.txt --format colors --template business-it \
  --page-size a4 --pdf output/public-color-cards.pdf --card-qr --card-qr-png
mnemocode decode --mode seedshift --format colors \
  --qr-file output/public-color-cards-qr.png --dates-file output/public-dates.txt

# Separate JPEG cards of a direct Unicode backup, read back from their folder.
mnemocode encode --mode direct --mnemonic-file output/public-mnemonic.txt \
  --format unicode --template business-it --cards-dir output/public-unicode-cards \
  --image-format jpg
mnemocode decode --input-file output/public-unicode-cards --words 12
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

`--fabric` names the fabric that the cover gives the finished size for and the floss key the skeins: Aida by its count, 6 to 28 stitches an inch, or `linen-N`, linen of N threads an inch from 20 to 40 stitched over one thread with one strand; 14, for Aida 14, unless given. The menu asks for the fabric, Aida 11, 14, 16 or 18 or linen 28, and offers paper sizes from A6 to A2 with the stitches of the picture in each, leaving out a sheet that gives no more stitches than a smaller one. The legend is drawn at random within the counts the picture allows, so the same phrase gives a different legend each time. A legend line is a row's symbol number (1 to 70, as [SeedStitch](SEEDSTITCH.md#the-symbols) lists them), a colon and its stitches, rows in the legend's order. A pattern too small or too plain for that form also uses the order of its rows, and each row names its DMC thread too, as `15:407:38` (format 2). Like `encode`, `stitch` also saves the legend line as text (`--output`) and as a QR code image (`--qr`, with `--qr-hidden` and `--qr-text`), shows the copies on the screen (`--show-original words`, `--show-masked-words`) and adds the sheet for heirs (`--heir-sheet`). `--mode seedshift-legacy` masks it with the Original Seedshift, written with a last word that passes the checksum: the legend is as long as in the other modes, and Decode asks for the last word that was named to remember. With `--threshold` and `--shares`, `stitch` splits the phrase into Shamir shares as `sskr-split` does and hides each share in a pattern of its own, all from the same picture: `--pdf-dir` names the new folder of `share-1-pattern.pdf`, `share-2-pattern.pdf` and so on, `--output` saves every legend line, one per line, and `--qr-dir` a folder of their QR images; `--pdf` and `--qr` are for a single pattern. `sskr-combine` takes the patterns' PDFs, legend lines or QR images as shares (`--share-file`, `--share-qr`, or typed), and Decode refers a share's legend there. `--mode direct` hides the phrase itself, with no dates, for a phrase protected some other way: anyone who knows the format reads it from the legend. Decode takes the line typed, pasted, from a file or from the pattern's PDF, asks whether Seedshift was used, as the legend does not say, then the dates where it was, and corrects one mistyped row, naming it where only that row explains the change; a legend of the usual form typed with its DMC numbers reads too.

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

The pairs above read saved codes or QR images. Saved codes do not name their mode: give `--mode`, and `--format` when detection is ambiguous. For printed cards with decoys, `--words` limits the real backup to its original phrase length.

A folder is read with the folders inside it. Decode lists every backup and set of shares it finds, with the kind of codes and the files: with `--ask-secrets` you choose one, and without it a folder of several is refused with that list, so give the file of one or narrow the search with `--find all|patterns|qr|cards`. One found alone is read at once. A single file of a share, such as one pattern's PDF, finds the rest of its set in its own folder. Where `--find` names a kind that the folder lacks, a script is refused; with `--ask-secrets` what the folder holds instead is listed, and nothing is read until you choose it. With the word count, the mode and the form given, nothing is asked:

```bash
# A folder searched for printed cards: a 12-word Seedshift backup in colors.
mnemocode encode --mode seedshift --mnemonic-file output/public-mnemonic.txt \
  --dates-file output/public-dates.txt --format colors --template business-it \
  --pdf output/backups/cards.pdf
mnemocode decode --input-file output/backups --find cards --words 12 \
  --mode seedshift --format colors --dates-file output/public-dates.txt

# Every backup and set of shares in a folder, listed on the private screen to choose from.
mnemocode decode --ask-secrets --input-file output

# Original Seedshift codes with the last word Encode named to remember: addict for this
# public phrase and date. With it the phrase comes back exactly; without it, Decode lists
# the one or two phrases the codes give, each with its fingerprint.
printf '%s\n' addict > output/public-last-word.txt
mnemocode decode --mode seedshift-legacy --input-file output/public-legacy.txt \
  --dates-file output/public-dates.txt --last-word-file output/public-last-word.txt
```

One material source may come from standard input. Then the keyboard cannot reach the private screen, so the result must not go to a terminal either: send standard output to a file or a pipe. This public example writes the same direct Unicode record without a mnemonic input file:

```bash
cat output/public-mnemonic.txt | mnemocode encode --mode direct \
  --mnemonic-file - --format unicode --output output/public-stdin.txt > /dev/null
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

# Original Seedshift before sharing: restore with the dates and the last word to remember.
mnemocode sskr-split --mode seedshift-legacy --mnemonic-file output/public-mnemonic.txt \
  --dates-file output/public-dates.txt --threshold 2 --shares 3 \
  --output output/public-legacy-shares.txt
mnemocode sskr-combine --mode seedshift-legacy --share-file output/public-legacy-shares.txt \
  --dates-file output/public-dates.txt --last-word-file output/public-last-word.txt
```

These text files each hold **all shares**. They demonstrate a round trip, not separate storage. [SSKR](SSKR.md) covers share formats, QR images, cards and keeping enough distinct shares.

### Restore from shares

`sskr-combine` restores the phrase; `sskr-export` rewrites or prints existing shares without making a new set:

```bash
mnemocode sskr-combine --share-file output/public-shares.txt
mnemocode sskr-export --share-file output/public-shares.txt --format colors \
  --template business-it --page-size a5 --pdf output/public-share-cards.pdf --card-qr
```

`--share-file` also takes the files of share cards, patterns' PDFs or a folder of them, read with the folders inside it:

```bash
# Share cards in colors, one sheet per share in a new folder; the folder restores them.
mnemocode sskr-split --mode direct --mnemonic-file output/public-mnemonic.txt \
  --threshold 2 --shares 3 --format colors --template business-it \
  --cards-dir output/share-cards --card-layout collection
mnemocode sskr-combine --share-file output/share-cards
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

The guide explains reading printed cards, color codes, Color Unicode and cross-stitch legends, date sorting, the repeating year/month/day shifts, modular addition and subtraction, MnemoCode Seedshift's shorter last-word modulus, checksum calculation, and the Original Seedshift both as the original program writes it and as MnemoCode writes it, with a last word that passes the checksum. It includes standalone Python helpers, for the phrase and for a cross-stitch legend, that need no MnemoCode installation. Print the full mapping too. Combining SSKR shares still requires a compatible SSKR implementation.

## Representation details

`encode --show-masked-words` also shows the English words after Seedshift, beside the chosen codes. This is the masked phrase: the original dates are still needed. `--show-original words` separately shows the original wallet phrase as English words for visual checking, with or without Shamir shares. Its former `codes` and `both` values are refused before any secret is read. The menu asks about neither: a masked result always shows the English words after Seedshift too, and the original phrase is never shown. These display choices do not add the original to encoded or share files and QR images.

The [format table](../README.md#backup-formats) lists names and numbers. Input syntax differs by form:

| Form                | Accepted separators                                                                                            |
| ------------------- | -------------------------------------------------------------------------------------------------------------- |
| English words       | Spaces or line breaks between words                                                                            |
| Word numbers        | Spaces or commas; joined numbers are ambiguous and refused                                                     |
| Word Unicode        | Four hexadecimal digits per code, separated or joined                                                          |
| Colors              | Separated codes, joined `#RRGGBB` codes, or one joined `RRGGBB` line                                           |
| Color Unicode       | Two four-digit Private Use Area codes per color, separated or joined, or the Private Use characters themselves |
| Cross-stitch legend | Rows from the top as `symbol:stitches`, or `symbol:DMC:stitches` in format 2, separated by spaces or lines     |

Color Unicode needs no special font when written as hexadecimal text.

On a terminal, formats 3 and 4 show both spaced codes for checking and a joined line for copying. This applies to phrases and shares; the spaced form makes it easier to replace an unreadable code with `?`.

Formats 1, 2 and 5 already use spaces. Their terminal output wraps between words or codes within 78 columns; narrower terminals may wrap again. Files and pipes receive one line of codes.

The layout follows where the output goes: a terminal gets headings, labelled facts, numbered phrases and marked notices, and a file, a pipe or `TERM=dumb` the plain lines of a script. On a terminal each candidate of `recover-word` and each match of `recover-date` is a part of its own, with the words or dates found, the wallet check and the phrase as labelled facts; a file or a pipe gets one row of tab-separated fields for each. Colour is decided apart from it: `NO_COLOR` or `CLICOLOR=0` takes the colours away and keeps the terminal layout, and `CLICOLOR_FORCE` adds colour without changing the form.

For `decode` and `recover-date`, `--format` is usually optional. MnemoCode picks the form itself when exactly one form fits the whole record. Otherwise it asks in the terminal, and a script must pass `--format`.

## Card options

| Option                                     | Result                                                                                                |
| ------------------------------------------ | ----------------------------------------------------------------------------------------------------- |
| `--template ID`                            | The design, by name or number                                                                         |
| `--pdf PATH`                               | The whole collection as one PDF                                                                       |
| `--cards-dir NEW_FOLDER`                   | [One file per card](../README.md#individual-business-cards); for shares, one file or folder per share |
| `--images-dir NEW_FOLDER`                  | The collection pages as PNG images                                                                    |
| `--image-format png\|jpg`                  | The image format for `--images-dir` and `--cards-dir`                                                 |
| `--page-size`, `--orientation`             | See [Page sizes](../README.md#page-sizes)                                                             |
| `--card-qr`                                | One QR code on the collection sheet                                                                   |
| `--card-qr-png`                            | That QR code also as a PNG image beside the PDF or in the image folder                                |
| `--qr-hidden`                              | The QR code's record hidden behind a contact or `--qr-text`; see [Hidden QR records](HIDDEN_QR.md)    |
| `--qr-text TEXT`                           | The public text of a separate hidden QR PNG                                                           |
| `--card-layout qr\|collection\|individual` | For shares: how each share is printed; see [Share cards](SSKR.md#share-cards)                         |
| `--title TEXT`                             | The collection title; by default it is the studio name                                                |
| `--cards`                                  | Color cards in the terminal                                                                           |
| `--qr PATH`                                | A separate QR code as a PNG image                                                                     |

Replace random identity fields with `--card-name`, `--card-role`, `--card-company`, `--card-email`, `--card-phone`, `--card-website` and `--card-location`. Names accept Latin letters, spaces, apostrophes and hyphens. Characters missing from the font and text that does not fit are refused before any secret is asked or read. `--studio-name` names the collection studio; material sheets print `--card-name` as the recipient. [Identity defaults](card-identities.md) describes the generated values.

`--card-slogan`, `--card-subtitle` and `--card-footer` replace the sheet text. `--card-reference-label` sets the label on separate business cards; it does not add a label to a collection sheet. The value `-` hides a field. The default reference label is `Ref.`.

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

Wrong dates give valid phrases: every wrong date in `seedshift` mode; in `seedshift-legacy` mode one or two for most wrong dates with codes that MnemoCode writes, unless the last word to remember is given, and one wrong date in 16 to 256 with codes of the original program. So `recover-date` requires one of the [recovery checks](../README.md#exact-local-recovery-checks).

Decode and Restore use the same date search on the private screen, even when codes or shares are also marked. They ask for a wallet reference when a date has `?`. Restore estimates the combined work for all share and date combinations. Dates in `--dates-file` must be complete except in `recover-date`.

## Wallet-check examples and address forms

```bash
# The public stored phrase and the date pattern of all four examples below, in local files:
mkdir -p output
printf '%s\n' 'wool abuse actual wool abuse actual wool abuse actual wool abuse congress' \
  > output/public-stored.txt
printf '%s\n' '??-09-2026' > output/public-date-pattern.txt

# An address of any coin, one of the first 20 receiving ones. Its form names the
# path: here Bitcoin's native SegWit, m/84'/0'/0'/0/0.
mnemocode recover-date --mode seedshift \
  --input-file output/public-stored.txt \
  --format 1 --dates-file output/public-date-pattern.txt \
  --coin-address bc1qcr8te4kr609gcawutmrza0j4xv80jy8z306fyu

# A master or account extended public key. Standard and SLIP-132 forms are accepted:
# xpub, ypub, zpub, Ypub, Zpub; testnet tpub, upub, vpub, Upub, Vpub.
mnemocode recover-date --mode seedshift \
  --input-file output/public-stored.txt \
  --format 1 --dates-file output/public-date-pattern.txt \
  --account-xpub zpub6rFR7y4Q2AijBEqTUquhVz398htDFrtymD9xYYfG1m4wAcvPhXNfE3EfH1r1ADqtfSdVCToUG868RvUUkgDKf31mGDtKsAYz2oz2AGutZYs

# An 0x… address, read as Ethereum and Ethereum Classic, whose paths are both
# searched: here the first Ethereum one, m/44'/60'/0'/0/0.
mnemocode recover-date --mode seedshift \
  --input-file output/public-stored.txt \
  --format 1 --dates-file output/public-date-pattern.txt \
  --coin-address 0x9858EfFD232B4033E47d90003D41EC34EcaEda94

# A 33-byte compressed public key at index 0 of account 0, looked for at BIP44,
# BIP49, BIP84 and BIP86.
mnemocode recover-date --mode seedshift \
  --input-file output/public-stored.txt \
  --format 1 --dates-file output/public-date-pattern.txt \
  --compressed-public-key 03cc8a4bc64d897bddc5fbc2f670f7a8ba0b386779106cf1223c6fc5d7cd6fc115 \
  --account 0 --branch 0 --index 0 --scan-gap 1
```

| Option                            | What you know                                                                                                               |
| --------------------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| `--master-xpub`, `--account-xpub` | An extended public key                                                                                                      |
| `--coin-address`                  | An address of any coin; `--coin` narrows it to one                                                                          |
| `--bitcoin-address`               | A Bitcoin address, refused on the other network                                                                             |
| `--compressed-public-key`         | A public key                                                                                                                |
| `--master-fingerprint`            | The wallet's own fingerprint, the original one, not the encoded one. It has only 32 bits, so it is a filter and not a proof |
| `--wif-file PATH`                 | A private key in WIF form, read from a protected local file                                                                 |
| `--bip39-passphrase-file PATH`    | The BIP39 passphrase, if the wallet uses one. The file is secret                                                            |

`--index` sets the first address and `--scan-gap N` the count to compare, up to 1000. A Bitcoin address's form names its path: `1…` BIP44, `3…` BIP49, `bc1q…` BIP84 and `bc1p…` BIP86. A ypub or upub names BIP49 and a zpub or vpub BIP84; any other extended key form, a compressed public key or a WIF is looked for at all four. SLIP-132's Ypub, Zpub, Upub and Vpub name multisig accounts, which these single-key paths do not hold.

For an account extended public key, `--account` selects the account. `--branch` and `--index` describe addresses within it and are refused beside `--account-xpub`. Standard and SLIP-132 versions are accepted as listed above.

Every coin uses its standard single-key paths, and the address tells its coin, type and network. `--coin-address` reads an address as every coin whose form it has: where coins share one, as `1…` (Bitcoin and Bitcoin Cash), `3…` (Bitcoin and Litecoin) and `0x…` (Ethereum and Ethereum Classic) do, the paths of each are searched. `--coin` narrows it to one coin:

| Coin                      | `--coin`           | Address forms                                                  |
| ------------------------- | ------------------ | -------------------------------------------------------------- |
| Bitcoin                   | `bitcoin`          | `1…`, `3…`, `bc1q…`, `bc1p…`; testnet `m…`, `n…`, `2…`, `tb1…` |
| Bitcoin Cash              | `bitcoin-cash`     | `bitcoincash:q…` or `1…`                                       |
| Cosmos                    | `cosmos`           | `cosmos1…`                                                     |
| Dash                      | `dash`             | `X…`, Platform `dash1k…`, testnet Platform `tdash1k…`          |
| Dogecoin                  | `dogecoin`         | `D…`                                                           |
| Ethereum and EVM networks | `ethereum`         | `0x…`                                                          |
| Ethereum Classic          | `ethereum-classic` | `0x…`                                                          |
| Injective                 | `injective`        | `inj1…`                                                        |
| Litecoin                  | `litecoin`         | `L…`, `M…`, `3…` or `ltc1q…`                                   |
| Tron                      | `tron`             | `T…`                                                           |
| XRP                       | `xrp`              | `r…`                                                           |
| Zcash                     | `zcash`            | Transparent `t1…` only                                         |

Zcash shielded addresses are unsupported. Bitcoin Cash and Ethereum Classic try both their own coin type and their parent chain's. `--network` applies only to Bitcoin evidence given with `--bitcoin-address`, a key or a WIF; an address of any coin names its own.

A WIF can spend the funds. Never put it in a shell command or an issue report.

## Installation checks

Before processing data, MnemoCode runs its startup self-test: quick checks without files or renderers, including SSKR engine checks. Known answers come from published vectors or an independent implementation that first reproduces one. They cover:

- Both BIP39 word lists' lengths and SHA-256 hashes, the BIP39 seed and master fingerprint.
- Every transformation mode; exact 12- and 24-word answers in all five representations, 15-, 18- and 21-word answers with MnemoCode Seedshift, and Original Seedshift answers with the last word MnemoCode writes for all five lengths, with numbering, checksum and Color Unicode refusals.
- Date patterns, marked codes and shares, word searches, candidate lists, written-backup checks and wallet evidence.
- Addresses of all twelve coins, heir-sheet text, share-card and card-set content, word hints and re-encoding.
- Published SSKR Bytewords and refusals of incomplete quorums, duplicates, mixed sets and corrupt checksums.
- The SeedStitch example legends of both formats, one misread row corrected and two refused, and the hidden QR record format.

If a check fails, the command stops:

```text
CRITICAL: MnemoCode core self-test failed.
No mnemonic data was processed.
```

In the menu, a failed self-test leaves only Run the self-test, the help and Quit; the other entries stay closed.

The startup self-test also restores an official grouped set and a set holding the 32-byte secret of a 24-word phrase, creates a test set from a fixed seed and restores it from every two of its shares, makes sure that another seed gives other shares, and checks that the engine refuses an incomplete quorum and a damaged share value even when its transport checksum is correct. The fixed creation seeds are public test data and are never used for a person's shares.

For the full self-test, including PDF rendering:

```bash
mnemocode self-test
```

The full self-test includes the startup self-test plus every phrase length/format/mode combination, date sorting, the public test file, 24 English BIP39 seed vectors, wallet-assisted searches, the marked-code search, encrypted candidate lists and the candidate list writer, joint share/date repair, share split and restore, every coin vector, actual heir-sheet/card/QR exports, a cross-stitch pattern made from a picture with its legend read back from the PDF, a hidden QR record written and read back, with all artwork and fonts, and card pages read back as drawing steps. Each feature gets a refusal case too. Finished groups show their times, followed by an overall result.

The public test data is in [`vectors/mnemocode-v1.json`](../vectors/mnemocode-v1.json). It contains only well-known test phrases.

## Library example

The [library guide](LIBRARY.md) contains a Rust example, WebAssembly entry points and ownership contracts.

## Output destinations in the menu

The question is a checklist: Space ticks a destination, Enter confirms, and the screen shows the
result in any case. Nothing ticked keeps it on the screen only; ticking printable cards alone
saves the cards without a record file.

The checklist offers a record file and, for Unicode codes, colors as text and colors, printable
cards; shares offer a text file and, in those three forms, printable cards; a cross-stitch pattern
offers a PDF pattern and a text file of its legend line (for shares, PDF patterns and a text file of
every legend line). Printable cards and PDF patterns start ticked. A QR code is never in the
checklist; it has its own question, "Add a QR code?". With sheets of cards it follows the card
design and offers seven answers: no QR code, or an ordinary one or one with hidden data, each on the
cards only, on the cards and as a PNG file, or as a PNG file only. With separate business cards or
without cards it offers no QR code, an ordinary QR code or one with hidden data, saved as a PNG file
(one per share for shares). Explicit `--qr` and `--qr-dir` command-line options remain available
regardless of the menu choices.

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
