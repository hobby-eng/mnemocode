# MnemoCode

[![CI](https://github.com/hobby-eng/mnemocode/actions/workflows/ci.yml/badge.svg?branch=main)](https://github.com/hobby-eng/mnemocode/actions/workflows/ci.yml)
[![Executable](https://github.com/hobby-eng/mnemocode/actions/workflows/executable.yml/badge.svg?branch=main)](https://github.com/hobby-eng/mnemocode/actions/workflows/executable.yml)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue)](LICENSE)
[![Build provenance: GitHub attestations](https://img.shields.io/badge/build%20provenance-GitHub%20attestations-2ea44f)](https://github.com/hobby-eng/mnemocode/attestations)

This README describes version 0.1.0.

**Have you inherited a backup made with MnemoCode?** Start with [A guide for heirs](docs/HEIRS.md).

MnemoCode helps you keep a wallet seed phrase (a BIP39 mnemonic) on paper in a form that a stranger will not recognize and cannot use directly. It works completely offline, as the `mnemocode` command or as a TypeScript library.

- **Obfuscate the phrase.** The words are written as numbers, Unicode codes or colors, so the note does not look like a seed phrase. MnemoCode converts it back to the exact original words.
- **Mask the phrase with dates.** For additional protection, choose one or more dates that only you know. MnemoCode shifts every word of the phrase by a value taken from those dates. The result is a different, valid seed phrase, and only the same dates turn it back into yours.
- **Split the phrase into shares.** Shamir secret sharing creates several shares, and a number of them that you choose, for example any 2 of 3, restores the phrase.
- **Print cards and QR codes.** The encoded phrase or its shares can be printed as cards that look like business cards or material samples, with an optional QR code.
- **Recover a forgotten detail.** If words, part of a date, or some codes or share elements are forgotten or cannot be read, MnemoCode lists the candidates and checks them against a known address, public key or fingerprint.

These steps can be combined: for example, mask the phrase with dates, write the result as colors, and print it as cards.

Obfuscation and date masking only stop a stranger from recognizing the phrase. They are not encryption; [SECURITY.md](SECURITY.md#cryptographic-and-recovery-limits) lists the limits.

MnemoCode builds on ideas from Seedshift and BIP39Colors; see [Provenance and license](#provenance-and-license).

## Install and run

### One executable file

Each release has one file for Linux, Windows and macOS that runs without Node.js or anything else installed: `mnemocode-<version>-linux-x64`, `mnemocode-<version>-win-x64.exe` and `mnemocode-<version>-macos-arm64`. Next to each file is a file of the same name ending in `-licenses.txt`, for example `mnemocode-0.1.0-linux-x64-licenses.txt`, with the licenses of Node.js and of every library the file contains.

Check a download once before you run it. The release's `SHA256SUMS` holds the SHA-256 of every file and is signed with the maintainer's OpenPGP key: `SHA256SUMS.asc` is the signature and `RELEASE-SIGNING-KEY.asc` the public key, whose fingerprint is `28FC51B1DB80DF2101128CB30EDD4814591DD095`. GitHub shows the same key for the maintainer at https://github.com/hobby-eng.gpg. Look at the key's fingerprint before you import it, check the signature and the SHA-256 of your file, then run it as `mnemocode`:

```bash
gpg --show-keys RELEASE-SIGNING-KEY.asc
gpg --import RELEASE-SIGNING-KEY.asc
gpg --verify SHA256SUMS.asc SHA256SUMS
sha256sum --check --ignore-missing SHA256SUMS
chmod +x mnemocode-0.1.0-linux-x64
./mnemocode-0.1.0-linux-x64 self-test
```

`gpg --verify` must say "Good signature" for a key with that fingerprint. Its warning that the key is not certified with a trusted signature only means that you have not certified the key yourself. [Releasing](docs/RELEASING.md) describes how a release is built and signed.

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

Installed as a package, or as the single executable, the program is called `mnemocode`, and every example below uses that name. In a checkout, type `node dist/mnemocode.js` in its place after building, or `corepack pnpm dev --` to run it without building.

`mnemocode --help` lists the commands. `mnemocode <command> --help`, for example `mnemocode encode --help`, explains every option of that command with examples; `-h` gives a short summary.

## Menu

Run `mnemocode` without a command in a terminal, or double-click the executable file, and it shows a menu:

```text
What do you want to do?
› 1  Encode a seed phrase as numbers, codes or colors
  2  Decode numbers, codes or colors back into a seed phrase
  3  Split a seed phrase into standard Shamir shares
  4  Restore a seed phrase from Shamir shares
  5  Find a forgotten word, a date digit or a share code
  6  Print sample cards with a test seed phrase
  7  Look up a seed word, its number or its Unicode code
  8  Check that this copy of MnemoCode works
  9  Show every command and option
  0  Quit
```

Choose with the arrow keys and Enter, or press the number. Each entry asks its questions one at a time and shows examples where they help. Encode first shows what a test phrase looks like as word numbers, Unicode codes and colors, then asks about Seedshift, then whether to split the phrase into Shamir shares (the usual sets such as 2 of 3 or 3 of 5, or any other up to 16 shares), where the result should go, and last whether to print [instructions for heirs](#instructions-for-heirs). The menu always masks word numbers and English words with Seedshift: unmasked, anyone with the BIP39 word list reads them. Unicode codes and colors may stay unmasked, but then they only disguise the phrase. The shares are written in the form chosen, and restoring them gives that form back; [Splitting a mnemonic into shares](#splitting-a-mnemonic-into-shares) explains the two ways to split. On request, the whole phrase in that form is shown beside the shares, with a warning, for whoever keeps it and holds the shares in reserve. After the result, Encode offers to check the backup: you type it again from what you wrote down, with the dates, and MnemoCode says whether it restores the same seed phrase, without showing it. Before it runs, the menu shows the command that does the same, such as `mnemocode encode --ask-secrets --format 5 --mode direct`, so that you can type it next time. Escape goes back to the menu, and in the menu it quits; `q` works too.

Every answer is checked as soon as you give it. When one cannot be used, such as a word that is not in the BIP39 list, a date that does not exist or a share that cannot be read, one line says why, naming only its place, such as "Date 2" or "Share 3", and the same question comes again. What you answered before is kept. When a step finds nothing, for example no date that gives your wallet, or when a file cannot be saved, MnemoCode asks what to do next instead of stopping. A command ends early only when you choose it, with Ctrl+C or with Stop when MnemoCode asks what to do next, or when a self-test fails; after a failed self-test the menu no longer offers the entries that ask for a seed phrase or a share.

The seed phrase, the dates and the shares never become part of the command. They are typed on a private screen of their own, where you see what you type, and the result appears there too. When you press Enter, that screen is cleared and the terminal returns to where it was, so that nothing stays in the scrollback.

Every other answer of the menu has an option of its command, so that a command typed later asks only for the secrets: the wallet and how many addresses (`--scan-gap`), the limits of a long search (`--max-candidates`, `--max-tries`), the written-backup check (`--backup-check yes|no`), and in Decode how to tell codes marked with `?` (`--encoded-fingerprint`, a wallet option or `--list-candidates`) and what a text that may be a Shamir share is read as (`--input-kind codes|share`). `mnemocode <command> --help` lists them under each command.

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

Decoding such a record restores every other word exactly and lists every possible last word: 128 for a 12-word phrase, 8 for a 24-word phrase (the last column of the table below). Each candidate is shown with its fingerprint (the BIP32 master fingerprint), a short identifier of the wallet such as `73c5da0a`. Compare the fingerprint, or better an address or a public key of the wallet, to pick the right phrase.

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
mnemocode encode \
  --mode seedshift \
  --mnemonic "abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about" \
  --dates 23-09-2026 08-08-1988 07-11-1951 \
  --format 3
```

Real secrets typed this way can stay in the shell history and are visible in the list of running programs. `--ask-secrets` asks for them on a private screen instead:

```bash
mnemocode encode --mode seedshift --ask-secrets --format 3
```

| Command        | First prompt                                                   | Second prompt                                    |
| -------------- | -------------------------------------------------------------- | ------------------------------------------------ |
| `encode`       | Phrase                                                         | Dates                                            |
| `decode`       | Encoded seed phrase or record                                  | Dates, with `?` for a forgotten digit            |
| `recover-date` | Encoded seed phrase or record                                  | Dates, with `?` in place of each forgotten digit |
| `recover-word` | Phrase, with `?` for each forgotten word                       | None                                             |
| `sskr-combine` | Shares, separated by semicolons; `?` for an unreadable element | Dates, only with `--mode seedshift`; `?` allowed |

Type the dates as one line, for example `23-09-2026 08-08-1988 07-11-1951`. In `direct` mode there is no date prompt. When the dates hold `?` and every date gives a valid phrase, as in MnemoCode Seedshift, one more question asks how to recognise the wallet, unless an option gave it: by its fingerprint or one of its first receiving addresses, of Bitcoin or another coin. With the original Seedshift the checksum sorts out most dates by itself: Decode, and the menu before it searches a forgotten digit, still offer the wallet question, and you may answer "It cannot" to see every date that passes the checksum. [Date recovery helper](#date-recovery-helper) describes the search.

`--ask-secrets` works the same on Linux, macOS and Windows. MnemoCode switches the terminal to its alternate screen, a private screen, and reads the keys itself: you see what you type or paste, Backspace deletes a character, Ctrl+U the whole line, and Ctrl+C cancels. The result appears on the same screen. When you press Enter after it, the screen is cleared and the terminal returns to where it was, so that neither the secrets nor the result stay in the scrollback. Standard input must be the terminal; without one the command stops at once. Output sent to a file goes there as before.

Each answer on the private screen is checked at once, as in the [menu](#menu): a wrong one is explained in one line and asked again, and the answers before it are kept. While you type an answer, Escape does nothing, so that a slip of the finger loses nothing. In a list of choices, Escape does what the key hint below it says; when MnemoCode asks what to do next, that is the last choice, such as Stop. Keys typed before a question appears do not answer it. A paste of several lines is one answer: words, codes or dates may come one per line, and shares pasted one per line count as separated by semicolons.

`--mnemonic-file PATH` and `--input-file PATH` read the secret from a local file instead; the path `-` reads standard input. With `--ask-secrets`, `decode` and `recover-date` can take the record from `--input-file` or `--qr-file` and then ask only for the dates; when that file cannot be used, they offer another file, typing the record, or Stop.

Text input, from a prompt, a pipe or a file, may be up to 1 MiB. A QR image may be up to 16 MiB and 4096 pixels on a side. MnemoCode stops reading at the limit and refuses larger input.

## Commands

```bash
# Every example uses the public BIP39 test phrase.
TEST_MNEMONIC='abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about'

# Write the phrase as Unicode codes without changing it.
mnemocode encode --mode direct --mnemonic "$TEST_MNEMONIC" --format 3

# Mask the phrase with a date and show the result as words.
mnemocode encode --mode seedshift --mnemonic "$TEST_MNEMONIC" \
  --dates 23-09-2026 --format 1

# Make the same record as the original Seedshift program.
mnemocode encode --mode seedshift-legacy --mnemonic "$TEST_MNEMONIC" \
  --dates 23-09-2026 --format 1

# Legacy mode with a valid last word, saved to a new file.
mnemocode encode --mode seedshift-legacy --legacy-valid-last-word \
  --mnemonic "$TEST_MNEMONIC" --dates 23-09-2026 --format 1 \
  --output legacy-valid.txt

# List the possible original phrases; the file records the mode and the form.
mnemocode decode --input-file legacy-valid.txt --dates 23-09-2026

# Save the Unicode codes to a new file.
mnemocode encode --mode seedshift --mnemonic "$TEST_MNEMONIC" \
  --dates 23-09-2026 --format 3 --output encoded-unicode.txt

# Decode a legacy record typed by hand. It has no header, so give the mode and the form.
mnemocode decode --mode seedshift-legacy \
  --input "8F44901950118F44901950118F44901950118F4490194F5C" \
  --format 3 --dates 23-09-2026

# Find a forgotten day and check it against the fingerprint.
mnemocode recover-date --mode seedshift \
  --input "wool abuse actual wool abuse actual wool abuse actual wool abuse congress" \
  --format 1 --dates "??-09-2026" --master-fingerprint 73c5da0a

# The same, with the phrase typed on the private screen.
mnemocode recover-date --mode seedshift --ask-secrets \
  --format 1 --master-fingerprint 73c5da0a

# Find one forgotten word. Every word that passes the checksum test is shown.
mnemocode recover-word \
  --mnemonic "abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon ?"

# Mark the candidates that match a known fingerprint.
mnemocode recover-word --ask-secrets --master-fingerprint 73c5da0a

# Look up one word, index or Unicode code, or print the whole table.
mnemocode table --word abandon
mnemocode table --index 1
mnemocode table --unicode 5BF6
mnemocode table --all
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

Every result says which phrase it shows or holds: the original seed phrase, the wallet's, or the masked phrase (decoy) that Seedshift makes of it, which the codes and the shares of a masked backup hold and the dates turn back. After encoding, MnemoCode prints the fingerprint of the original phrase and of the masked phrase, the encoded fingerprint. A legacy result is a valid phrase only by chance; when it is not, only the original fingerprint is shown. Fingerprints are calculated for an empty BIP39 passphrase. They do not reveal the phrase.

Note both. When you decode on the private screen, look for a forgotten date digit, or restore Shamir shares of a phrase masked before the split, MnemoCode shows the encoded fingerprint again as soon as it has read the codes or the shares, before it asks for the dates. If it is not the one you noted, a code or a share was written down or typed wrongly, and you find out before typing the dates. The original fingerprint then shows whether the dates were right. When a search asks how to recognise the wallet, give the original fingerprint, the wallet's own: the search undoes Seedshift with each set of dates and compares the result, so the encoded fingerprint never matches there.

## Complete encode and decode examples

`--output PATH` saves the result as a [versioned record](#versioned-records-and-legacy-compatibility), so `decode` needs only the file and the dates:

```bash
mnemocode encode \
  --mode seedshift \
  --mnemonic "abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about" \
  --dates 23-09-2026 08-08-1988 07-11-1951 \
  --format 5 --output shifted-colors.txt
mnemocode decode --input-file shifted-colors.txt \
  --dates 23-09-2026 08-08-1988 07-11-1951
```

Replace `--format 5` with `1`, `2`, `3` or `4` for the other forms.

The same forms work without dates:

```bash
mnemocode encode --mode direct \
  --mnemonic "abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about" \
  --format 3 --output direct-unicode.txt
mnemocode decode --mode direct --input-file direct-unicode.txt --format 3
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

A file is written into a folder that already exists. Nothing is saved over an existing file or folder: when the name is taken, MnemoCode saves under the first free numbered name, such as `cards-1.pdf`, without spaces, so that it can be typed in a command as it is, and says so after saving. The name is settled before the seed phrase is asked, so a taken name never stops a command halfway. `--cards-dir` and `--images-dir` create their own new folder, numbered the same way when the name is taken.

The names, the company and the contact details on the cards are a decoy: camouflage that makes the cards look like ordinary business cards or design samples. They are not secret and play no part in recovery. MnemoCode invents them at random, as [Card identity defaults](docs/card-identities.md) describes, unless you type your own with `--card-name`, `--card-role`, `--card-company`, `--card-email`, `--card-phone`, `--card-website` and `--card-location`. Names must use Latin letters; spaces, apostrophes and hyphens are allowed. Other characters and text that does not fit are reported as errors.

In the menu, Encode offers "Also as printable cards" for a result in colors, and for shares in every form. It asks two questions about the files first, then the design:

- **The kind of file:** PDF, PNG or JPEG. Images need `pdftocairo`, and the menu says so at once when it is missing.
- **The layout:** A6 sheets, the usual choice, A4 sheets, or separate business cards of 90 × 50 mm, one file each.

Sheets in a PDF go into one file; images, and separate cards, go into a new folder. For sheets the menu then asks whether to add a QR code with all the codes of the sheet; separate cards never have one. Last it asks whether to type your own details. "No, random" keeps every detail invented; with "Yes", each detail is asked in turn, and Enter keeps that one random. The details are no secret, so they appear in the command that the menu shows.

`preview` prints a template with a public test phrase and test dates, never with a real secret. It draws the cards exactly as `encode` does. `--words` accepts 12, 15, 18, 21 or 24; the default is 12.

```bash
# All designs in one PDF.
mnemocode preview --all --words 24 --page-size a6 --pdf previews-a6.pdf
mnemocode preview --all --words 24 --page-size a4 --pdf previews-a4.pdf

# Preview a design with your own details.
mnemocode preview --template business-it --words 24 \
  --card-name "John Smith" --card-role "Systems Engineer" \
  --card-email "john@example.com" --page-size a6 --pdf my-preview.pdf

# Real export. The phrase and the dates are asked on the private screen.
mnemocode encode --mode seedshift --ask-secrets --format 5 \
  --template business-it --page-size a4 \
  --card-name "John Smith" --card-email "john@example.com" --pdf cards.pdf

mnemocode preview --list
```

QR codes are off by default. `--card-qr` adds one QR code with the whole encoded phrase to a collection sheet. Individual cards never have a QR code. A QR code holds only the encoded phrase in the form selected by `--format`. It holds no `MNC1` header, mode, format name, dates, personal details or fingerprints. The QR code of the sheets is also saved as a PNG image where they go: beside the PDF, as `cards-qr.png` for `cards.pdf`, or in the folder of the images; for Shamir shares one image per share, named after its reference, also in a folder of share cards. Decode reads it back with `--qr-file`, Restore with `--share-qr`. `--qr` names the image yourself instead.

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
mnemocode encode --mode seedshift --ask-secrets --format 5 \
  --template business-it --card-name "John Smith" \
  --card-company "Example Systems" --card-role "Systems Engineer" \
  --card-email "john@example.com" --cards-dir ./my-it-cards

# Public demonstration, without entering a phrase:
mnemocode preview --template business-it --words 24 \
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
mnemocode preview --template business-it --words 24 --page-size business --pdf business-cards.pdf
mnemocode preview --template material-vehicle --studio-name "AURORA STUDIO" --card-name "John Smith" --pdf wrap-preview.pdf
```

### Cards with several codes

Three templates put four, six or eight references on each card, so fewer cards are needed. With four per card, a 12-word phrase uses two cards and a 24-word phrase uses four. The last card can have fewer references. The references are numbered in order.

Individual cards are 90 × 50 mm, with four, six or eight codes.

### Collection-sheet identity

A collection sheet names a design studio. It is separate from the employer printed on the business cards. `--studio-name` sets the studio and `--card-company` sets the employer. [Card identity defaults](docs/card-identities.md) explains what is printed when they are omitted. Material sheets print `--card-name` as the recipient.

`--card-slogan`, `--card-subtitle`, `--card-footer` and `--card-reference-label` replace the text on the sheet. The value `-` hides a field. The default reference label is `Ref.`.

## Splitting a mnemonic into shares

`encode --sskr --threshold 2 --shares 3` splits the phrase into Shamir shares as the last step of encoding. `sskr-combine` restores the phrase from the shares, and `sskr-export` prints existing shares as cards.

There are two ways to split, and each gives back what it was given:

- **In the form you chose.** Encode in the menu, after word numbers, Unicode codes or colors and the dates, writes the shares in that same form (`--share-format indexes`, `unicode`, `colors` or `colors-unicode`). Restoring them gives back exactly that backup: the Unicode codes, the word numbers or the color codes, masked with the dates as before; with the dates, MnemoCode also shows the seed phrase. These shares are MnemoCode's own, like its color shares: other SSKR programs do not read them.
- **Classic SSKR of the seed phrase itself.** Entry 3 of the menu, "Split a seed phrase into standard Shamir shares", splits the bytes of the seed phrase as the SSKR standard does and writes the shares in Bytewords or as a short `ur:sskr/...` code (`--share-format words` or `ur`). Restoring them gives the seed phrase in words, and other SSKR programs read them too. English words chosen in Encode give these standard shares as well.

[Shamir secret sharing (SSKR)](docs/SSKR.md) describes the commands, the share formats and recovery.

### Damaged shares

When a share cannot be read in full, type each element you cannot read as `?` at its place: a word number, a Unicode code, a color, a Byteword or a pair of letters of a `ur:sskr` code. In a color or in the Unicode code of a word, written apart, you can also replace just the digits you cannot read, one `?` for each, such as `#B5?0??` or `4E?0`: the digits you can read then help, and far more damage can be repaired. A lone `?` between spaces stands for the whole color or code. Color Unicode codes, word numbers and Bytewords take a `?` only for a whole element. Several shares may each miss something, such as two words on each of three shares, and a share may also be given twice when two damaged copies of it are kept.

MnemoCode then repairs all the shares together. Every share has a checksum, all of them carry the same set number, and every share beyond the threshold repeats what the others already say: a third share of a 2-of-3 set holds the whole secret over again. Together this settles most of the marks without trying anything. What is still open is decided by a check of the secret that the shares keep, and before it tries anything MnemoCode shows how many combinations are left, how long they take, and which element, read again, or whether one more share would settle them. A search that takes up to 12 hours on your computer starts at once, and Ctrl+C stops it; a longer one is asked for first, and is limited to about a trillion combinations.

How long a repair takes depends on what is missing. These times were measured on a laptop with an Intel Core i7-1260P, for a 2-of-3 set with two shares given and the marks in the part of each share that holds the secret; marks in the first codes of a share, which all shares of a set have in common, cost less. Before it searches, MnemoCode shows its own estimate for your shares on your computer.

| Colors missing on a share | Whole color, `?` | One digit, `#B500C?` | Two digits, `#B500??` | Three digits, `#B50???` |
| ------------------------- | ---------------- | -------------------- | --------------------- | ----------------------- |
| 1                         | at once          | at once              | at once               | at once                 |
| 2                         | under a second   | at once              | at once               | at once                 |
| 2 on both shares          | about 3 hours    | at once              | at once               | at once                 |
| 3                         | about a month    | at once              | at once               | under a second          |
| 3 on both shares          | out of reach     | at once              | at once               | under a second          |
| 4                         | out of reach     | at once              | under a second        | under a second          |
| 4 on both shares          | out of reach     | at once              | under a second        | about 3 hours           |

| Unicode codes missing on a share | Whole code, `?` | One digit, `4E0?` | Two digits, `4E??` | Three digits, `4???` |
| -------------------------------- | --------------- | ----------------- | ------------------ | -------------------- |
| 1 or 2, on one or both shares    | at once         | at once           | at once            | at once              |
| 3, on one or both shares         | under a second  | at once           | under a second     | under a second       |
| 4                                | under a second  | at once           | under a second     | under a second       |
| 4 on both shares                 | about 40 s      | at once           | under a second     | about 40 s           |

"Out of reach" is beyond the trillion combinations that a repair tries at most. A search that takes up to 12 hours starts at once; a longer one is asked for first. Word numbers, Bytewords and `ur:sskr` codes take a `?` only for a whole element; [Repairing shares](docs/SSKR.md#damaged-shares) gives their numbers.

If more than one seed phrase passes, each is listed with its fingerprint, and none is chosen: compare them with your wallet, or give its fingerprint or an address of the wallet, of Bitcoin or another coin, which keeps only the matching phrase. Entry 5 of the menu, or `sskr-export`, gives the repaired shares back whole, in their own form, without showing the seed phrase, so that you can write them down again. [Repairing shares](docs/SSKR.md#damaged-shares) gives the numbers.

On the private screen the shares are read as soon as you press Enter. A share that cannot be read is named by its place, such as "Share 2", and only that share is typed again; the others are kept. When nothing tells which of two shares is wrong, for example two that carry the same share number but differ, both are named and you choose which one to change. When the shares restore nothing, MnemoCode asks what to change: type one share or all of them again, leave one out, add more, or stop. When the phrase does not match the wallet, it asks whether to change the dates, the wallet or a share, whether the phrase was masked with Seedshift, or to stop.

## Instructions for heirs

Encode can also save one sheet that tells someone else how to restore the backup: answer "Yes, A5" or "Yes, A6" to "Instructions for your heirs?" in the menu, or add `--heir-sheet heirs.pdf`, with `--heir-sheet-size a6` for the smaller size. It is optional.

It is meant for a backup that must be restored after you, by someone who may never have heard of MnemoCode. Without it, an heir who finds cards with colors or a list of numbers may not know what they are, or that a program turns them back into a seed phrase. Keep it apart from the backup: with a will, with a lawyer or a notary, or with the heir in a sealed envelope.

The PDF is one sheet to print on both sides, in A5, the size of a notebook, or A6, the size of a postcard and of the cards, with smaller print. The front says what the backup looks like, how many shares restore it (any 3 of the 5, for example) and how many secret dates it needs, and gives the rest of its room to a hint that you write by hand. The back gives the steps in the menu, what to do when one fails, and the basics for someone who has never used a wallet: what a seed phrase is, how the dates mask it, how to open the wallet, and the scams to avoid.

Write the hint so that only your heirs understand it: a clue to the dates, such as "the day we met and our son's birthday", never the dates themselves. Where it stands on the sheet protects nothing: whoever holds the sheet reads both sides.

It holds nothing that helps a stranger who finds it: no codes, no shares, no dates, no fingerprint, and not where the cards or shares are kept. A fingerprint would let the finder test guessed dates one after another, and a list of places would undo the point of splitting the backup. Whoever has only the sheet cannot restore the wallet.

The sheet prints one address, that of this repository, whose README starts with a link to [A guide for heirs](docs/HEIRS.md), which says the same at more length. Nothing else is linked: the sheet may be kept for decades, and a page elsewhere can change, vanish, or pass to someone who abuses its address.

## Versioned records and legacy compatibility

A file written by `encode --output PATH` starts with a header: `MNC1:<mode>:<format>:<data>`. The header records the mode (`direct`, `seedshift`, `seedshift-legacy` or `seedshift-legacy-valid`) and the format, so you do not have to remember them. Dates are never stored. If `--mode` or `--format` contradicts the header, MnemoCode stops; on the private screen it says so instead and offers to read the record as its header says or to give it again.

Terminal output, typed text and QR codes have no header. Give the original `--mode` when you decode them. On the private screen, without `--mode`, `decode` asks whether Seedshift was used and which one, and `recover-date` asks which Seedshift was used. Decode in the menu asks this before the codes and passes the answer on as `--mode`.

`encode --sskr --output` writes no `MNC1` record: the file holds one complete SSKR share per line, in the selected share format (`ur:sskr/…` by default). See [Shamir secret sharing (SSKR)](docs/SSKR.md).

The library decodes text. Reading a QR image is a function of the command-line program.

## Forgotten-word recovery

`recover-word` accepts an English BIP39 phrase with each forgotten word replaced by `?`. Where you remember a little more, write `ab*` for a word that begins with "ab", or `rich|rice` for one of a few words. MnemoCode tries every combination, up to 16,777,216 of them, and lists those that pass the checksum test: for one forgotten word, about 128 in a 12-word phrase and about 8 in 24 words; for two, about 262,144. With one forgotten word, each row shows the number of the candidate, the word, its number in the BIP39 list, the checksum bits and the whole phrase.

If a word is missing and you do not know where, give the words you have with `--missing-word`: every place and every word is tried, about 1,500 candidates for 12 words.

On the private screen the words are checked before anything else is asked, and words that give more than 16,777,216 combinations are asked again. When no phrase fits, or there are too many candidates to show, MnemoCode asks what to do: type the words again, check the candidates against the wallet, or stop.

Passing the checksum test does not prove that a candidate is your wallet. Add one of the [recovery checks](#exact-local-recovery-checks) to mark the matching rows; then MnemoCode checks every candidate itself, without the network, which for 262,144 candidates takes a few minutes. The other candidates are still shown when there are at most 2,048 of them.

Without a fingerprint or an address, only a search for funds can tell the candidates apart. `--candidates-file candidates.age` saves them as a list for the Discovery Scanner of the [multi-chain wallet tools](https://github.com/hobby-eng/multi-chain-wallet-tools), which checks each one online; candidate 5 on the screen is record 5 of the list. The list holds real seed phrases, so it is encrypted: to the one-time key that the Scanner shows (`--candidates-key age1…`), or with a passphrase. `sskr-combine` and `recover-date` save their candidates the same way. [Candidate lists](docs/CANDIDATES.md) describes the format.

For an old `seedshift-legacy` phrase whose last word fails the checksum test, `recover-word --legacy-valid-last-word` accepts the whole phrase without `?` and lists every valid last word. One row is marked `preserved`: it keeps the data bits of the old last word, and it is the word that legacy encoding suggests. These phrases are replacements for the stored phrase. The original wallet phrase is recovered from them with the dates.

## Codes that cannot be read

When some codes of an encoded seed phrase cannot be read, type `?` in their place in Decode (menu entry 2, or `decode --ask-secrets`): for a word number, a word, a Unicode code or a whole color. A few letters (`ab*`), words joined by `|`, or a `?` for one digit of a number or a code (`1?34`, `4E?0`) narrow it. Codes of MnemoCode Seedshift, and codes without Seedshift, keep a BIP39 checksum of their own, which leaves about one candidate in 16 for 12 words and one in 256 for 24 words. Decode then asks how to tell the right codes: by the encoded fingerprint that Encode showed for them, which needs no dates; by the wallet's fingerprint or an address, once the dates are typed, which may hold `?` too, so that codes and dates are found together; or, where the candidates are few, by listing them. It says how long the search takes before it starts, and shows the codes and dates it found, so that the written copy can be corrected. Up to 16,777,216 combinations are searched, about two whole words; a few letters or digits of a third narrow it enough.

A Shamir share typed into Decode or read from a QR code, complete or with `?`, is recognized as one. Decode then goes on to the restore from Shamir shares with it as the first share and asks for the others; a share read from a QR code is shown as text, and the next one can be read from another QR code image or typed. With many marks, when the text could be either a share or the codes, it asks which; `--input-kind` answers that from the command line.

## Date recovery helper

`recover-date` accepts one to three incomplete dates. Replace each forgotten digit with `?`, a forgotten day, month or year with one `?`, and a date you do not remember at all with one `?` in its place; join a few values you are unsure between with `|`:

| Pattern          | Search                       |
| ---------------- | ---------------------------- |
| `?3-09-2026`     | Days ending in 3             |
| `0?-09-2026`     | Days 1 to 9                  |
| `05\|15-09-2026` | Day 5 or day 15              |
| `15-?-2025`      | The 15th of every month      |
| `?-?-2026`       | Every date in 2026           |
| `?`              | Every date that is supported |

Complete and incomplete dates go together, such as `10-1?-2010 15-?-2025` or `15-12-2025 ?`.

Several incomplete dates multiply the number of attempts. Two identical patterns are tried once, not once for each order. Dates that shift every word alike are tried once too: Seedshift adds the year to a word number modulo the 2,048 words, so a year and the year 2,048 years later give the same phrase. A forgotten year therefore finds a phrase once, with the earliest year that gives it, not four or five times.

The command shows the number of attempts before it starts, and with a wallet check about how long they take on your computer. A search of up to 12 hours starts at once; a longer one is asked for first, or needs `--max-candidates` with at least its number of attempts. No search has more than 2,147,483,648 attempts. `--max-results` sets how many candidates are shown (100 by default), and `--progress-every` sets how often progress is reported. A search of every date has 3,652,059 attempts.

In the `seedshift` and `seedshift-legacy-valid` modes every date gives a valid phrase, so `recover-date` requires one of the [recovery checks](#exact-local-recovery-checks). In `seedshift-legacy` mode it can instead keep the candidates that pass the checksum test. A checksum of 4 to 8 bits is a weak filter.

Decode and Restore from Shamir shares search forgotten digits the same way. On their private screen, in the menu or with `--ask-secrets`, a date may hold `?`; in Restore also when share codes hold `?`, and in Decode when the codes hold `?` too. They follow the limits above: a search longer than 12 hours starts only when you choose it. Where every date gives a valid phrase, they ask for the wallet's fingerprint or one of its first receiving addresses, which tells the right dates, and show the matches as `recover-date` does. Decode asks for the wallet with the original Seedshift too, where you may leave it out. Restore searches the dates for each phrase that the shares can give; before it starts, it shows the whole work, share combinations times date combinations, and about how long it takes. Dates given with `--dates` must be complete, except for `recover-date`.

## Exact local recovery checks

`recover-date`, `recover-word`, `sskr-combine` and Decode can compare every candidate with a detail of your wallet that you already know. The comparison needs no network access.

```bash
# Stored phrase used by all three examples below:
# wool abuse actual wool abuse actual wool abuse actual wool abuse congress

# A native-SegWit receiving address, one of the first 20: here m/84'/0'/0'/0/0.
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

# An address of another coin, here the first Ethereum one: m/44'/60'/0'/0/0.
mnemocode recover-date --mode seedshift \
  --input "wool abuse actual wool abuse actual wool abuse actual wool abuse congress" \
  --format 1 --dates "??-09-2026" \
  --coin ethereum --coin-address 0x9858EfFD232B4033E47d90003D41EC34EcaEda94

# A 33-byte compressed public key at exactly one BIP44/49/84/86 path.
mnemocode recover-date --mode seedshift \
  --input "wool abuse actual wool abuse actual wool abuse actual wool abuse congress" \
  --format 1 --dates "??-09-2026" \
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

An address, a public key and a WIF are looked for among the first 20 receiving addresses of the wallet: mainnet, account `0`, receiving branch `0`, indexes `0` to `19`. Change the place with `--network testnet`, `--account`, `--branch` and `--index`, the first index compared, and how many addresses with `--scan-gap N`, up to 1000. When you know the exact place, `--scan-gap 1` compares that one address and searches faster. `--bitcoin-profile auto`, the default, tries the BIP44, BIP49, BIP84 and BIP86 address types at each place. In the menu, after the address, MnemoCode asks among how many of the first addresses to look; Enter takes 20.

The coins besides Bitcoin are those of mhfe, each on its standard paths, with single-key receiving addresses: Bitcoin Cash (`bitcoin-cash`, `bitcoincash:q…` or `1…`), Cosmos (`cosmos`, `cosmos1…`), Dash (`dash`, `X…`, or a Platform address `dash1k…`), Dogecoin (`dogecoin`, `D…`), Ethereum and every EVM network (`ethereum`, `0x…`), Ethereum Classic (`ethereum-classic`), Injective (`injective`, `inj1…`), Litecoin (`litecoin`, `L…`, `M…`, `3…` or `ltc1q…`), Tron (`tron`, `T…`), XRP (`xrp`, `r…`) and Zcash (`zcash`, transparent `t1…`; a shielded address cannot be checked). Bitcoin Cash and Ethereum Classic wallets use their own coin type or that of the chain they forked from, and both are tried. The address tells its type and its network, so `--network` and `--bitcoin-profile` are for Bitcoin only. In the menu, "Address of another coin" asks which coin, then its address.

A WIF can spend the funds. Never put it in a shell command or an issue report.

## Self-tests and public vectors

Before a command processes data, MnemoCode tests itself, in about a third of a second. It checks the length and the SHA-256 hash of both BIP39 word lists, encodes and decodes fixed test phrases in every mode, and compares each feature with known answers from published test vectors or from an independent implementation that first reproduces one: the BIP39 seed and master fingerprint, dates with `?` and `|`, codes and Shamir shares marked with `?`, the word search, the candidate list, wallet evidence and the addresses of the twelve coins, the sheet for heirs and share cards. If a check fails, the command stops:

```text
CRITICAL: MnemoCode core self-test failed.
No mnemonic data was processed.
```

Before it splits or combines shares, MnemoCode also restores a published set of test shares and checks the color form of a share.

Run the full test before you use a newly built or copied installation:

```bash
mnemocode self-test
```

It checks every phrase length, format and mode, the sorting of dates, the public test file, the 24 English BIP39 seed vectors, the date and word searches with a wallet, encrypted candidate lists, the check of a written backup, marked Shamir shares repaired together and with dates, every coin address vector, the sheet for heirs, share cards, QR images beside a sheet, and card export with every kind of artwork and font. The check of each feature is also given a case it must refuse. It prints each finished group with its time and a final line that says it passed.

The public test data is in [`vectors/mnemocode-v1.json`](vectors/mnemocode-v1.json). It contains only well-known test phrases.

## Compatibility and safety notes

[SECURITY.md](SECURITY.md) describes how to report a vulnerability, how to work offline, how secrets are handled and which risks remain. Read it before you work with a real phrase.

- Dates are written `DD-MM-YYYY`; `YYYY-MM-DD` is also accepted. The order in which you type them does not matter.
- A year always has four digits, from `0001` through `9999`. `23-09-26` is an error; the year 26 is written `0026`. Two years that are 2048 apart shift the words by the same amount.
- You can use one date for every three words: 4, 5, 6, 7 or 8 dates for 12, 15, 18, 21 or 24 words.
- The original Seedshift program does not support 21-word phrases; MnemoCode does.

### Protection while it runs

Every run is protected as far as Node.js allows: core dumps are off on Linux and macOS, and MnemoCode runs under the Node.js permission model. That model allows no network, and a command that does not need them cannot write files or start other programs. If you start MnemoCode under that model yourself and grant a right on purpose, such as `--allow-net`, it keeps that right. The library has the rights of the program that uses it. Node.js enforces the model, not the operating system, so it is not a sandbox. Before a secret is asked, the private screen shows this protection, and a warning if swap is not encrypted or a file would be saved into a cloud folder.

### Unencrypted swap

When memory runs short, the system can write part of the memory of MnemoCode, the seed phrase included, to the swap area on the disk, where it can stay for years. On Linux MnemoCode warns before a secret when swap is not encrypted, or when it cannot tell. Use encrypted swap or none at all; a live USB system is best. Swap on dm-crypt, also below LVM, and zram, which stays in memory, count as safe.

### Cloud folders

A file saved into a folder that Dropbox, OneDrive, Google Drive, iCloud Drive, Yandex Disk, Nextcloud, MEGA or pCloud synchronises is copied to that service's servers and kept there. MnemoCode warns when an output path lies in such a folder, which it recognises by the usual folder names. Save records, cards and shares to a local folder or a removable drive instead.

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

Each part of the library also has an entry point of its own, without Node.js code, for a program that needs only that part, such as a browser page: `mnemocode/core/date-search` searches forgotten date digits, and `mnemocode/sskr/share-set` restores Shamir shares, for example. The program passes what only it has, such as its PBKDF2 for the wallet check or its SSKR library. [Modules for other hosts](docs/ARCHITECTURE.md#modules-for-other-hosts) lists the parts.

Dependency versions are exact in `package.json`, and `pnpm-lock.yaml` records their hashes. The package is marked `private`: it is distributed through this repository, not through the npm registry.

## Continuous integration

GitHub Actions installs from the frozen lockfile, checks TypeScript, the formatting and that no Markdown list has a blank line inside it, builds the CLI and the library, runs the whole test suite, prints cards and Shamir share exports to PDF and reads their QR codes back from the rendered pages, and checks the dependencies for known high-severity vulnerabilities. The tests also run on Windows and macOS; the card tests that need Poppler run on Linux only. On all three systems `scripts/verify-terminal-input.py` drives the menu and the prompts for secrets in a real pseudo-terminal, and the release workflow does the same with each executable file.

A second workflow builds the single executable on Linux, Windows and macOS and runs each one on its own system. A version tag puts the executables, their license notices and `SHA256SUMS` into a draft release, only after the complete CI has passed and when the tag names the version in `package.json`. The maintainer then signs `SHA256SUMS` on their own computer and publishes the release, as [Releasing](docs/RELEASING.md) describes.

The tests encode and decode every phrase length in every mode and format. They also cover records with and without a header, secret input, the self-tests, date recovery, QR input and the recovery checks.

## Source layout and review

[Source layout](docs/ARCHITECTURE.md) describes the modules and the maintenance checks. The [audit index](docs/audits/README.md) lists the audit reports and their follow-ups.

## Provenance and license

MnemoCode is an independent TypeScript implementation. It is not affiliated with, endorsed by, or an official fork of Seedshift or BIP39Colors.

The MnemoCode source is MIT licensed. `NOTICE` attributes the compatible formats to [Seedshift by mifunetoshiro](https://github.com/mifunetoshiro/Seedshift), which is MIT licensed, and [BIP39Colors by EnteroPositivo](https://github.com/EnteroPositivo/bip39colors), which is CC BY 4.0. [`THIRD_PARTY_NOTICES.md`](THIRD_PARTY_NOTICES.md) records the dependencies and the origin of the word lists.
