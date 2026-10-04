# MnemoCode

[![CI](https://github.com/hobby-eng/mnemocode/actions/workflows/ci.yml/badge.svg?branch=main)](https://github.com/hobby-eng/mnemocode/actions/workflows/ci.yml)
[![Executable](https://github.com/hobby-eng/mnemocode/actions/workflows/executable.yml/badge.svg?branch=main)](https://github.com/hobby-eng/mnemocode/actions/workflows/executable.yml)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue)](LICENSE)
[![Build provenance: GitHub attestations](https://img.shields.io/badge/build%20provenance-GitHub%20attestations-2ea44f)](https://github.com/hobby-eng/mnemocode/attestations)

This README describes version 0.1.0.

MnemoCode helps you keep a wallet seed phrase (a BIP39 mnemonic) on paper in a form that a stranger will not recognize and cannot use directly. It works completely offline, as the `mnemocode` command or as a TypeScript library.

- **Obfuscate the phrase.** The words are written as numbers, Unicode codes or colors, so the note does not look like a seed phrase. MnemoCode converts it back to the exact original words.
- **Mask the phrase with dates.** For additional protection, choose one or more dates that only you know. MnemoCode shifts every word of the phrase by a value taken from those dates. The result is a different, valid seed phrase, and only the same dates turn it back into yours.
- **Split the phrase into shares.** Shamir secret sharing creates several shares, and a number of them that you choose, for example any 2 of 3, restores the phrase.
- **Print cards and QR codes.** The encoded phrase or its shares can be printed as cards that look like business cards or material samples, with an optional QR code.
- **Recover a forgotten detail.** If one word or part of a date is forgotten, MnemoCode lists the candidates and checks them against a known address, public key or fingerprint.

These steps can be combined: for example, mask the phrase with dates, write the result as colors, and print it as cards.

Obfuscation and date masking only stop a stranger from recognizing the phrase. They are not encryption; [SECURITY.md](SECURITY.md#cryptographic-and-recovery-limits) lists the limits.

MnemoCode builds on ideas from Seedshift and BIP39Colors; see [Provenance and license](#provenance-and-license).

## Install and run

### One executable file

Each release has one file for Linux, Windows and macOS that runs without Node.js or anything else installed: `mnemocode-<version>-linux-x64`, `mnemocode-<version>-win-x64.exe` and `mnemocode-<version>-macos-arm64`. Next to each file is a file of the same name ending in `-licenses.txt`, for example `mnemocode-0.1.0-linux-x64-licenses.txt`, with the licenses of Node.js and of every library the file contains. Compare its SHA-256 with the release's `SHA256SUMS` once after downloading, then run it as `mnemocode`:

```bash
sha256sum --check --ignore-missing SHA256SUMS
chmod +x mnemocode-0.1.0-linux-x64
./mnemocode-0.1.0-linux-x64 self-test
```

GitHub also signs where each file of a release was built. On the computer you downloaded it with, the [GitHub CLI](https://cli.github.com/) checks that the file was built from this repository by its release workflow, and was not replaced afterwards:

```bash
gh attestation verify mnemocode-0.1.0-linux-x64 --repo hobby-eng/mnemocode
```

The file holds Node.js, the program, the card artwork and fonts, and the SSKR engine. Making images from cards still needs Poppler's `pdftocairo`. Started without a command, for example by a double-click, it opens the [menu](#menu). To build the file for your own computer from a checkout, run `corepack pnpm build:executable`; it writes the file and its license notices to `release/`, which `pnpm build` leaves alone, and runs it once from an empty folder.

### From source

Building from source requires Node.js 26.10.0 or newer and Corepack, which selects the pnpm version recorded in `package.json`.

```bash
corepack pnpm install --frozen-lockfile
corepack pnpm build
node dist/mnemocode.js --help
```

For development, run commands without building first:

```bash
corepack pnpm dev -- encode --mnemonic "abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about" --dates 10-07-1963
```

Once the package is installed, the same commands are available as `mnemocode`. The examples below use both spellings.

`mnemocode --help` lists the commands. `mnemocode <command> --help`, for example `mnemocode encode --help`, explains every option of that command with examples; `-h` gives a short summary.

## Menu

Run `mnemocode` without a command in a terminal, or double-click the executable file, and it shows a menu:

```text
What do you want to do?
› 1  Encode a seed phrase as numbers, codes or colors
  2  Decode numbers, codes or colors back into a seed phrase
  3  Split a seed phrase into Shamir shares, as text or colors
  4  Restore a seed phrase from Shamir shares
  5  Find a forgotten word of a seed phrase or a date digit
  6  Print sample cards with a test seed phrase
  7  Look up a seed word, its number or its Unicode code
  8  Check that this copy of MnemoCode works
  9  Show every command and option
  0  Quit
```

Choose with the arrow keys and Enter, or press the number. Each entry asks its questions one at a time and shows examples where they help: Encode, for instance, shows what the test phrase looks like as word numbers, Unicode codes and colors, then asks about dates, Shamir shares and where the result should go. Before it runs, the menu shows in grey the command that does the same, such as `mnemocode encode --ask-secrets --format 5 --mode direct`, so that you can type it next time. `q` goes back to the menu, and in the menu it quits.

The seed phrase, the dates and the shares never become part of the command. They are typed on a private screen of their own, where you see what you type, and the result appears there too. When you press Enter, that screen is cleared and the terminal returns to where it was, so that nothing stays in the scrollback.

## Transformation modes

`--mode` selects what happens to the phrase before it is written down.

| `--mode`           | What it does                                                                                                                |
| ------------------ | --------------------------------------------------------------------------------------------------------------------------- |
| `direct`           | Writes the phrase in another form without changing it. It needs no dates.                                                   |
| `seedshift`        | Masks the phrase with dates. The result is always a valid BIP39 phrase. The same dates are needed to get the original back. |
| `seedshift-legacy` | Works exactly like the original Seedshift program. Use it for records made with Seedshift.                                  |

Without `--mode`, MnemoCode uses `seedshift` when `--dates` is given and `direct` otherwise.

A BIP39 phrase ends with a checksum: a few bits that let a wallet notice a mistyped phrase. The result of `seedshift-legacy` usually fails that test. MnemoCode therefore also shows a last word that passes it, and the whole phrase with that word. The exact legacy result is still the main result unless you add `--legacy-valid-last-word`:

```bash
mnemocode encode --mode seedshift-legacy --legacy-valid-last-word \
  --mnemonic "abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about" \
  --dates 23-09-2026 --format 1
```

With that option only the checksum bits of the last word are calculated again. The last word usually changes and its shifted value is lost, as with the same option in the original Seedshift. MnemoCode calls such a record `seedshift-legacy-valid`.

Decoding such a record restores every other word exactly and lists every possible last word: 128 for a 12-word phrase, 8 for a 24-word phrase (the last column of the table below). Each candidate is shown with its fingerprint (the BIP32 master fingerprint): a short public identifier of the wallet, such as `73c5da0a`. Compare the fingerprint, or better an address or a public key of the wallet, to pick the right phrase.

### How checksum-valid Seedshift works

A BIP39 phrase is made of random data followed by the checksum. Together they are cut into pieces of 11 bits, one piece per word. Every word except the last holds random data only. The last word holds the rest of the random data and then the checksum:

| Words | Data bits in the last word | Checksum bits | Possible last words |
| ----: | -------------------------: | ------------: | ------------------: |
|    12 |                          7 |             4 |                 128 |
|    15 |                          6 |             5 |                  64 |
|    18 |                          5 |             6 |                  32 |
|    21 |                          4 |             7 |                  16 |
|    24 |                          3 |             8 |                   8 |

Encoding takes four steps:

1. Check the phrase and remove its checksum.
2. Add a number to every 11-bit piece and keep the remainder of division by 2048. The numbers are the year, month and day of each date, oldest date first, repeated as often as needed.
3. Add the next number to the data bits of the last word and keep the remainder of division by the value in the last column.
4. Calculate a new checksum.

The checksum bits are never shifted, kept or guessed. Decoding subtracts the same numbers and calculates the checksum again. The right dates therefore always give back the original phrase. Nothing has to be searched or stored separately.

For example, take the public 12-word test phrase: `abandon` eleven times, then `about`. The data bits of its last word are `0000000`. With the single date `23-09-2026`, the number for the last word is 23, so the data bits become `(0 + 23) mod 128 = 23`, or `0010111`. After the other pieces are shifted and a new four-bit checksum is calculated, the result is:

```text
wool abuse actual wool abuse actual wool abuse actual wool abuse congress
```

Decoding calculates `(23 - 23) mod 128 = 0` and gets the original last word `about`.

Every set of dates gives a valid BIP39 phrase, just as every BIP39 passphrase gives a wallet. Wrong dates give a wrong but valid phrase, and different dates can give the same phrase. The checksum shows whether the stored phrase is damaged. It cannot show whether the dates are right. To be able to check a recovery, write down the fingerprint of the original phrase, or keep an address or a public key of the wallet.

The [formal construction](docs/SEEDSHIFT_CONSTRUCTION.md) proves that the transformation can always be reversed.

## Secret input styles

A phrase and dates typed in the command are convenient for public test phrases:

```bash
node dist/mnemocode.js encode \
  --mode seedshift \
  --mnemonic "abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about" \
  --dates 23-09-2026 08-08-1988 07-11-1951 \
  --format 3
```

Real secrets typed this way can stay in the shell history and are visible in the list of running programs. `--ask-secrets` asks for them on a private screen instead:

```bash
node dist/mnemocode.js encode --mode seedshift --ask-secrets --format 3
```

| Command        | First prompt                                    | Second prompt                                    |
| -------------- | ----------------------------------------------- | ------------------------------------------------ |
| `encode`       | Phrase                                          | Dates                                            |
| `decode`       | Encoded seed phrase or record                   | Dates                                            |
| `recover-date` | Encoded seed phrase or record                   | Dates, with `?` in place of each forgotten digit |
| `recover-word` | Phrase, with `?` in place of the forgotten word | None                                             |
| `sskr-combine` | Complete shares, separated by semicolons        | Dates, only with `--mode seedshift`              |

Type the dates as one line, for example `23-09-2026 08-08-1988 07-11-1951`. In `direct` mode there is no date prompt.

`--ask-secrets` works the same on Linux, macOS and Windows. MnemoCode switches the terminal to its alternate screen, a private screen, and reads the keys itself: you see what you type or paste, Backspace deletes a character, Ctrl+U the whole line, and Ctrl+C cancels. The result appears on the same screen. When you press Enter after it, the screen is cleared and the terminal returns to where it was, so that neither the secrets nor the result stay in the scrollback. Standard input must be the terminal; without one the command stops at once. Output sent to a file goes there as before.

`--mnemonic-file PATH` and `--input-file PATH` read the secret from a local file instead; the path `-` reads standard input. With `--ask-secrets`, `decode` and `recover-date` can take the record from `--input-file` or `--qr-file` and then ask only for the dates.

Text input, from a prompt, a pipe or a file, may be up to 1 MiB. A QR image may be up to 16 MiB and 4096 pixels on a side. MnemoCode stops reading at the limit and refuses larger input.

## Commands

```bash
# Every example uses the public BIP39 test phrase.
TEST_MNEMONIC='abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about'

# Write the phrase as Unicode codes without changing it.
node dist/mnemocode.js encode --mode direct --mnemonic "$TEST_MNEMONIC" --format 3

# Mask the phrase with a date and show the result as words.
node dist/mnemocode.js encode --mode seedshift --mnemonic "$TEST_MNEMONIC" \
  --dates 23-09-2026 --format 1

# Make the same record as the original Seedshift program.
node dist/mnemocode.js encode --mode seedshift-legacy --mnemonic "$TEST_MNEMONIC" \
  --dates 23-09-2026 --format 1

# Legacy mode with a valid last word, saved to a new file.
node dist/mnemocode.js encode --mode seedshift-legacy --legacy-valid-last-word \
  --mnemonic "$TEST_MNEMONIC" --dates 23-09-2026 --format 1 \
  --output legacy-valid.txt

# List the possible original phrases; the file records the mode and the form.
node dist/mnemocode.js decode --input-file legacy-valid.txt --dates 23-09-2026

# Save the Unicode codes to a new file.
node dist/mnemocode.js encode --mode seedshift --mnemonic "$TEST_MNEMONIC" \
  --dates 23-09-2026 --format 3 --output encoded-unicode.txt

# Decode a legacy record typed by hand. It has no header, so give the mode and the form.
node dist/mnemocode.js decode --mode seedshift-legacy \
  --input "8F44901950118F44901950118F44901950118F4490194F5C" \
  --format 3 --dates 23-09-2026

# Find a forgotten day and check it against the fingerprint.
node dist/mnemocode.js recover-date --mode seedshift \
  --input "wool abuse actual wool abuse actual wool abuse actual wool abuse congress" \
  --format 1 --dates "??-09-2026" --master-fingerprint 73c5da0a

# The same, with the phrase typed on the private screen.
node dist/mnemocode.js recover-date --mode seedshift --ask-secrets \
  --format 1 --master-fingerprint 73c5da0a

# Find one forgotten word. Every word that passes the checksum test is shown.
node dist/mnemocode.js recover-word \
  --mnemonic "abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon ?"

# Mark the candidates that match a known fingerprint.
node dist/mnemocode.js recover-word --ask-secrets --master-fingerprint 73c5da0a

# Look up one word, index or Unicode code, or print the whole table.
node dist/mnemocode.js table --word abandon
node dist/mnemocode.js table --index 1
node dist/mnemocode.js table --unicode 5BF6
node dist/mnemocode.js table --all
```

`--format` selects the form in which the phrase is written. `encode` writes English words when it is omitted.

| `--format`             | Form                                                                                                                                                                                                                                                                                              |
| ---------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `english` / `1`        | English BIP39 words.                                                                                                                                                                                                                                                                              |
| `indexes` / `2`        | The numbers of the words in the BIP39 list, from 1 through 2048, as in Seedshift.                                                                                                                                                                                                                 |
| `unicode` / `3`        | Four-digit Unicode codes. Each word is replaced by the character with the same number in the Traditional Chinese BIP39 list, and only the code of that character is written. Codes may be separated by spaces or joined.                                                                          |
| `colors-unicode` / `4` | The codes of format 5, each written as two four-digit codes from Unicode's Private Use Area.                                                                                                                                                                                                      |
| `colors` / `5`         | Color codes such as `#01AB63`: 8, 10, 12, 14 or 16 codes for 12, 15, 18, 21 or 24 words. The 12- and 24-word forms are compatible with BIP39Colors. Codes may be separated, joined with their `#` signs, or joined as one `RRGGBB` line. They may be kept in any order, but every code is needed. |

`colors-unicode` is a MnemoCode format, not a Unicode standard. It is ordinary text of digits and letters and needs no special font. An earlier form written as Private Use symbols can still be decoded.

For `decode` and `recover-date`, `--format` is usually optional. MnemoCode picks the form itself when exactly one form fits the whole record. Otherwise it asks in the terminal, and a script must pass `--format`.

After encoding, MnemoCode prints the fingerprint of the original phrase and of the masked phrase. A legacy result may not be a valid phrase, so only the original fingerprint is shown. Fingerprints are calculated for an empty BIP39 passphrase. They are public and are not secrets.

## Complete encode and decode examples

`--output PATH` saves the result as a [versioned record](#versioned-records-and-legacy-compatibility), so `decode` needs only the file and the dates:

```bash
node dist/mnemocode.js encode \
  --mode seedshift \
  --mnemonic "abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about" \
  --dates 23-09-2026 08-08-1988 07-11-1951 \
  --format 5 --output shifted-colors.txt
node dist/mnemocode.js decode --input-file shifted-colors.txt \
  --dates 23-09-2026 08-08-1988 07-11-1951
```

Replace `--format 5` with `1`, `2`, `3` or `4` for the other forms.

The same forms work without dates:

```bash
node dist/mnemocode.js encode --mode direct \
  --mnemonic "abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about" \
  --format 3 --output direct-unicode.txt
node dist/mnemocode.js decode --mode direct --input-file direct-unicode.txt --format 3
```

## Cards and QR codes

MnemoCode can print the encoded phrase as material that looks like something else. In the color formats the phrase is a short list of color codes. A template places these codes into a familiar kind of document, such as a print studio's proposal with sample business cards, or a sheet of material samples. Every card or sample shows one color and its six-digit code, printed as a reference such as `Ref. 01AB63`.

To anyone else the sheet is an ordinary set of design samples. For you, the printed codes are the whole value of the cards: `mnemocode decode` turns them back into the phrase. Photographs, printed colors, names, companies and contact details are decoration and are not needed for recovery.

MnemoCode includes sixteen templates. `mnemocode preview --list` prints their names, and `mnemocode encode --help` describes every card option. Cards need format 4 or 5. Terminal output and separate QR codes work with every format.

| Option                         | Result                                                 |
| ------------------------------ | ------------------------------------------------------ |
| `--template ID`                | The design, by name or number                          |
| `--pdf PATH`                   | The whole collection as one PDF                        |
| `--cards-dir NEW_FOLDER`       | [One file per card](#individual-business-cards)        |
| `--images-dir NEW_FOLDER`      | The collection pages as PNG images                     |
| `--image-format png\|jpg`      | The image format for `--images-dir` and `--cards-dir`  |
| `--page-size`, `--orientation` | See [Page sizes](#page-sizes)                          |
| `--card-qr`                    | One QR code on the collection sheet                    |
| `--title TEXT`                 | The collection title; by default it is the studio name |
| `--cards`                      | Color cards in the terminal                            |
| `--qr PATH`                    | A separate QR code as a PNG image                      |

A file is written into a folder that already exists. `--output`, `--pdf` and `--qr` replace a file that already has that name; files with Shamir shares never replace one. `--cards-dir` and `--images-dir` create their own new folder.

The person and the company on the cards are invented; see [Card identity defaults](docs/card-identities.md). To print your own details, use `--card-name`, `--card-role`, `--card-company`, `--card-email`, `--card-phone`, `--card-website` and `--card-location`. Names must use Latin letters; spaces, apostrophes and hyphens are allowed. Other characters and text that does not fit are reported as errors.

`preview` prints a template with a public test phrase and test dates, never with a real secret. It draws the cards exactly as `encode` does. `--words` accepts 12, 15, 18, 21 or 24; the default is 12.

```bash
# All designs in one PDF.
node dist/mnemocode.js preview --all --words 24 --page-size a6 --pdf previews-a6.pdf
node dist/mnemocode.js preview --all --words 24 --page-size a4 --pdf previews-a4.pdf

# Preview a design with your own details.
node dist/mnemocode.js preview --template business-it --words 24 \
  --card-name "John Smith" --card-role "Systems Engineer" \
  --card-email "john@example.com" --page-size a6 --pdf my-preview.pdf

# Real export. The phrase and the dates are asked on the private screen.
node dist/mnemocode.js encode --mode seedshift --ask-secrets --format 5 \
  --template business-it --page-size a4 \
  --card-name "John Smith" --card-email "john@example.com" --pdf cards.pdf

node dist/mnemocode.js preview --list
```

QR codes are off by default. `--card-qr` adds one QR code with the whole encoded phrase to a collection sheet. Individual cards never have a QR code. A QR code holds only the encoded phrase in the form selected by `--format`. It holds no `MNC1` header, mode, format name, dates, personal details or fingerprints.

```bash
# Print the exact codes and color cards in the terminal.
mnemocode encode --mode seedshift \
  --mnemonic "abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about" \
  --dates 23-09-2026 --format 5 --cards

# Save the encoded phrase as a PNG QR code.
mnemocode encode --mode seedshift \
  --mnemonic "abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about" \
  --dates 23-09-2026 --format 5 \
  --qr my-palette-qr.png

# Read the PNG QR code on this computer; the format is found automatically.
mnemocode decode --mode seedshift --qr-file my-palette-qr.png --dates 23-09-2026
```

Images need the Poppler program `pdftocairo`; PDF files do not. Images are made at 300 dpi. PNG keeps text and QR codes sharp; JPEG uses quality 90. The rounded corners of a separate card are transparent in PNG and white in JPEG. If `pdftocairo` is missing, MnemoCode says so before it asks for a secret.

`--events` gives one label per date for cards that print the dates with format 3. No template of that kind is included yet.

[Card designs](docs/card-designs.md) describes what is printed on a sheet.

### Individual business cards

`--cards-dir NEW_FOLDER` names the folder for separate cards and saves one file per card. It works with the card size or without a size, never with a sheet size. Choose a new folder: MnemoCode does not write into an existing one, and it creates the folder only when every card is ready. A collection saved by the same command must be outside that folder.

```bash
node dist/mnemocode.js encode --mode seedshift --ask-secrets --format 5 \
  --template business-it --card-name "John Smith" \
  --card-company "Example Systems" --card-role "Systems Engineer" \
  --card-email "john@example.com" --cards-dir ./my-it-cards

# Public demonstration, without entering a phrase:
node dist/mnemocode.js preview --template business-it --words 24 \
  --cards-dir ./sample-it-cards
```

Files are named `01-ABCDEF.pdf`, `02-123456.pdf`, and so on. Each file holds only its own reference, or its own group on [cards with several codes](#cards-with-several-codes).

This is **not Shamir secret sharing**. Every card is needed to recover the phrase, and each card reveals a part of the encoded phrase.

A preview folder holds one template, so `preview --all` cannot be used with `--cards-dir`.

## Page sizes

`--page-size` decides what you get. A sheet size puts the whole collection on one page. The card size gives real cards, each numbered and on its own page.

| `--page-size` | Size         | Result                          |
| ------------- | ------------ | ------------------------------- |
| `a6`          | 148 × 105 mm | One sheet. This is the default. |
| `a4`          | 210 × 297 mm | One sheet                       |
| `business`    | 90 × 50 mm   | Separate cards                  |

With the card size, `--pdf` saves one PDF with one card per page, `--images-dir` saves one image per card, and `--cards-dir` saves one file per card. `--orientation portrait|landscape` works with every size.

On a sheet the samples are scaled to the page, so a sheet is a design proposal and cannot be cut into cards. Print at **100% / actual size** so that the QR code keeps its size.

```bash
node dist/mnemocode.js preview --template business-it --words 24 --page-size business --pdf business-cards.pdf
node dist/mnemocode.js preview --template material-vehicle --studio-name "AURORA STUDIO" --card-name "John Smith" --pdf wrap-preview.pdf
```

### Cards with several codes

Three templates put four, six or eight references on each card, so fewer cards are needed. With four per card, a 12-word phrase uses two cards and a 24-word phrase uses four. The last card can have fewer references. The references are numbered in order.

Individual cards are 90 × 50 mm, with four, six or eight codes.

### Collection-sheet identity

A collection sheet names a design studio. It is separate from the employer printed on the business cards. `--studio-name` sets the studio and `--card-company` sets the employer. [Card identity defaults](docs/card-identities.md) explains what is printed when they are omitted. Material sheets print `--card-name` as the recipient.

`--card-slogan`, `--card-subtitle`, `--card-footer` and `--card-reference-label` replace the text on the sheet. The value `-` hides a field. The default reference label is `Ref.`.

## Splitting a mnemonic into shares

`encode --sskr --threshold 2 --shares 3` splits the phrase into Shamir shares as the last step of encoding. `sskr-combine` restores the phrase from the shares, and `sskr-export` prints existing shares as cards.

[Shamir secret sharing (SSKR)](docs/SSKR.md) describes the commands, the share formats and recovery.

## Versioned records and legacy compatibility

A file written by `encode --output PATH` starts with a header: `MNC1:<mode>:<format>:<data>`. The header records the mode (`direct`, `seedshift`, `seedshift-legacy` or `seedshift-legacy-valid`) and the format, so you do not have to remember them. Dates are never stored. If `--mode` or `--format` contradicts the header, MnemoCode stops.

Terminal output, typed text and QR codes have no header. Give the original `--mode` when you decode them.

`encode --sskr --output` writes no `MNC1` record: the file holds the SSKR shares themselves, one `ur:sskr/…` share per line. See [Shamir secret sharing (SSKR)](docs/SSKR.md).

The library decodes text. Reading a QR image is a function of the command-line program.

## Forgotten-word recovery

`recover-word` accepts an English BIP39 phrase with exactly one word replaced by `?`. It tries all 2,048 words and prints every word that passes the checksum test: about 128 words for a 12-word phrase and about 8 for a 24-word phrase. Each row shows the number of the candidate, the word, its number in the BIP39 list, the checksum bits and the whole phrase.

Passing the checksum test does not prove that a candidate is your wallet. Add one of the [recovery checks](#exact-local-recovery-checks) to mark the matching rows. The other candidates are still shown.

For an old `seedshift-legacy` phrase whose last word fails the checksum test, `recover-word --legacy-valid-last-word` accepts the whole phrase without `?` and lists every valid last word. One row is marked `preserved`: it keeps the data bits of the old last word, and it is the word that legacy encoding suggests. These phrases are replacements for the stored phrase. The original wallet phrase is recovered from them with the dates.

## Date recovery helper

`recover-date` accepts one to three incomplete dates. Replace each forgotten digit with `?`:

| Pattern      | Search                       |
| ------------ | ---------------------------- |
| `?3-09-2026` | Days ending in 3             |
| `0?-09-2026` | Days 1 to 9                  |
| `??-??-2026` | Every date in 2026           |
| `????-??-??` | Every date that is supported |

Several incomplete dates multiply the number of attempts. Two identical patterns are tried once, not once for each order.

The command shows the number of attempts before it starts. The default limit is 1,000,000 attempts; `--max-candidates` raises it up to 10,000,000. `--max-results` sets how many candidates are shown (100 by default), and `--progress-every` sets how often progress is reported. A search of every date has 3,652,059 attempts and needs `--max-candidates 3652059`. Large searches can take hours.

In the `seedshift` and `seedshift-legacy-valid` modes every date gives a valid phrase, so `recover-date` requires one of the [recovery checks](#exact-local-recovery-checks). In `seedshift-legacy` mode it can instead keep the candidates that pass the checksum test. A checksum of 4 to 8 bits is a weak filter.

## Exact local recovery checks

`recover-date` and `recover-word` can compare every candidate with a detail of your wallet that you already know. The comparison needs no network access.

```bash
# Stored phrase used by all three examples below:
# wool abuse actual wool abuse actual wool abuse actual wool abuse congress

# Its first native-SegWit receiving address: m/84'/0'/0'/0/0.
mnemocode recover-date --mode seedshift \
  --input "wool abuse actual wool abuse actual wool abuse actual wool abuse congress" \
  --format 1 --dates "??-09-2026" \
  --bitcoin-address bc1qcr8te4kr609gcawutmrza0j4xv80jy8z306fyu \
  --bitcoin-profile native-segwit

# A master or account extended public key. Standard and SLIP-132 forms are accepted:
# xpub, ypub, zpub, Ypub, Zpub; testnet tpub, upub, vpub, Upub, Vpub.
mnemocode recover-date --mode seedshift \
  --input "wool abuse actual wool abuse actual wool abuse actual wool abuse congress" \
  --format 1 --dates "??-09-2026" \
  --account-xpub zpub6rFR7y4Q2AijBEqTUquhVz398htDFrtymD9xYYfG1m4wAcvPhXNfE3EfH1r1ADqtfSdVCToUG868RvUUkgDKf31mGDtKsAYz2oz2AGutZYs \
  --bitcoin-profile native-segwit

# A 33-byte compressed public key at the selected BIP44/49/84/86 path.
mnemocode recover-date --mode seedshift \
  --input "wool abuse actual wool abuse actual wool abuse actual wool abuse congress" \
  --format 1 --dates "??-09-2026" \
  --compressed-public-key 03cc8a4bc64d897bddc5fbc2f670f7a8ba0b386779106cf1223c6fc5d7cd6fc115 \
  --bitcoin-profile taproot --account 0 --branch 0 --index 0
```

| Option                            | What you know                                                           |
| --------------------------------- | ----------------------------------------------------------------------- |
| `--master-xpub`, `--account-xpub` | An extended public key                                                  |
| `--bitcoin-address`               | An address                                                              |
| `--compressed-public-key`         | A public key                                                            |
| `--master-fingerprint`            | The fingerprint. It has only 32 bits, so it is a filter and not a proof |
| `--wif-file PATH`                 | A private key in WIF form, read from a protected local file             |
| `--bip39-passphrase-file PATH`    | The BIP39 passphrase, if the wallet uses one. The file is secret        |

An address, a public key and a WIF belong to one place in the wallet. By default it is mainnet, account `0`, receiving branch `0` and index `0`; change it with `--network testnet`, `--account`, `--branch` and `--index`. `--bitcoin-profile auto`, the default, tries the BIP44, BIP49, BIP84 and BIP86 address types at that one place.

A WIF can spend the funds. Never put it in a shell command or an issue report.

## Self-tests and public vectors

Before a command processes data, MnemoCode tests itself. It checks the length and the SHA-256 hash of the English BIP39 word list, and it encodes and decodes fixed test phrases in every mode. If a check fails, the command stops:

```text
CRITICAL: MnemoCode core self-test failed.
No mnemonic data was processed.
```

Before it splits or combines shares, MnemoCode also restores a published set of test shares and checks the color form of a share.

Run the full test before you use a newly built or copied installation:

```bash
node dist/mnemocode.js self-test
```

It checks every phrase length, format and mode, the sorting of dates, the public test file, writing and reading of QR codes, Shamir shares, and card export with every kind of artwork and font. It prints each finished group with its time and a final `PASS` line.

The public test data is in [`vectors/mnemocode-v1.json`](vectors/mnemocode-v1.json). It contains only well-known test phrases.

## Compatibility and safety notes

[SECURITY.md](SECURITY.md) describes how to report a vulnerability, how to work offline, how secrets are handled and which risks remain. Read it before you work with a real phrase.

Every run is protected as far as Node.js allows: no core dumps on Linux and macOS, no network, and no file writes or other programs for a command that does not need them. Before a secret is asked, the private screen shows this protection, and a warning if swap is not encrypted or a file would be saved into a cloud folder.

- Dates are written `DD-MM-YYYY`; `YYYY-MM-DD` is also accepted. The order in which you type them does not matter.
- A year always has four digits, from `0001` through `9999`. `23-09-26` is an error; the year 26 is written `0026`. Two years that are 2048 apart shift the words by the same amount.
- You can use one date for every three words: 4, 5, 6, 7 or 8 dates for 12, 15, 18, 21 or 24 words.
- The original Seedshift program does not support 21-word phrases; MnemoCode does.

## Library use

The TypeScript library exposes the same transformations used by the CLI:

```ts
import { encodeMnemonic, decodeInput, masterFingerprint, parseDate } from "mnemocode";

const dates = ["10-07-1963", "31-01-4489"].map(parseDate);
const encoded = encodeMnemonic(mnemonic, dates);
const recovered = decodeInput(encoded.unicodeCodePoints.join(""), "unicode", dates);
console.log(masterFingerprint(mnemonic));

// The same phrase in another form, without dates.
import { representMnemonic, decodeInputDirect, formatEncoded } from "mnemocode";
const direct = representMnemonic(mnemonic);
const directUnicode = formatEncoded(direct, "unicode");
const sameMnemonic = decodeInputDirect(directUnicode, "unicode");
```

Library exports are listed in `src/index.ts`. Shamir sharing has a separate `mnemocode/sskr` entry point.

Dependency versions are exact in `package.json`, and `pnpm-lock.yaml` records their hashes. The package is marked `private`: it is distributed through this repository, not through the npm registry.

## Continuous integration

GitHub Actions installs from the frozen lockfile, checks TypeScript and the formatting, builds the CLI and the library, runs the whole test suite, prints cards and Shamir share exports to PDF and reads their QR codes back from the rendered pages, and checks the dependencies for known high-severity vulnerabilities. The tests also run on Windows and macOS; the card tests that need Poppler run on Linux only. On all three systems `scripts/verify-terminal-input.py` drives the menu and the prompts for secrets in a real pseudo-terminal, and the release workflow does the same with each executable file.

A second workflow builds the single executable on Linux, Windows and macOS and runs each one on its own system. A version tag publishes the executables, their license notices and `SHA256SUMS` only after the complete CI has passed and when the tag names the version in `package.json`.

The tests encode and decode every phrase length in every mode and format. They also cover records with and without a header, secret input, the self-tests, date recovery, QR input and the recovery checks.

## Source layout and review

[Source layout](docs/ARCHITECTURE.md) describes the modules and the maintenance checks. The [audit index](docs/audits/README.md) lists the audit reports and their follow-ups.

## Provenance and license

MnemoCode is an independent TypeScript implementation. It is not affiliated with, endorsed by, or an official fork of Seedshift or BIP39Colors.

The MnemoCode source is MIT licensed. `NOTICE` attributes the compatible formats to [Seedshift by mifunetoshiro](https://github.com/mifunetoshiro/Seedshift), which is MIT licensed, and [BIP39Colors by EnteroPositivo](https://github.com/EnteroPositivo/bip39colors), which is CC BY 4.0. [`THIRD_PARTY_NOTICES.md`](THIRD_PARTY_NOTICES.md) records the dependencies and the origin of the word lists.
