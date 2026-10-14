# MnemoCode

[![CI](https://github.com/hobby-eng/mnemocode/actions/workflows/ci.yml/badge.svg?branch=main)](https://github.com/hobby-eng/mnemocode/actions/workflows/ci.yml)
[![Executable](https://github.com/hobby-eng/mnemocode/actions/workflows/executable.yml/badge.svg?branch=main)](https://github.com/hobby-eng/mnemocode/actions/workflows/executable.yml)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue)](LICENSE)
[![Build provenance: GitHub attestations](https://img.shields.io/badge/build%20provenance-GitHub%20attestations-2ea44f)](https://github.com/hobby-eng/mnemocode/attestations)

This README describes version 0.1.0.

**Have you inherited a backup made with MnemoCode?** Start with [A guide for heirs](docs/HEIRS.md).

MnemoCode helps you keep a wallet seed phrase (a BIP39 mnemonic) on paper in a form that a stranger will not recognize and cannot use directly. It works completely offline, as the `mnemocode` command or as a TypeScript library.

- **[Obfuscate the phrase](#commands).** The words are written as numbers, Unicode codes or colors, so the note does not look like a seed phrase. MnemoCode converts it back to the exact original words.
- **[Mask the phrase with dates](#transformation-modes).** For additional protection, choose one or more dates that only you know. MnemoCode shifts every word of the phrase by a value taken from those dates. The result is a different, valid seed phrase, and those dates turn it back into yours.
- **[Split the phrase into shares](#splitting-a-mnemonic-into-shares).** Shamir secret sharing creates several shares, and a number of them that you choose, for example any 2 of 3, restores the phrase.
- **[Print cards and QR codes](#cards-and-qr-codes).** The encoded phrase or its shares can be printed as cards that look like business cards or material samples, with an optional QR code.
- **[Recover a forgotten detail](#recovery).** If words, part of a date, or some codes or share elements are forgotten or cannot be read, MnemoCode lists the candidates and checks them against a known address, public key or fingerprint.

These steps can be combined: for example, mask the phrase with dates, write the result as colors, and print it as cards.

Obfuscation and date masking only stop a stranger from recognizing the phrase. They are not encryption; [SECURITY.md](SECURITY.md#cryptographic-and-recovery-limits) lists the limits.

MnemoCode builds on ideas from Seedshift and BIP39Colors; see [Provenance and license](#provenance-and-license).

For encrypted long-term storage, you can use [MHFE](https://github.com/hobby-eng/mhfe), which encrypts a seed phrase into another valid BIP39 seed phrase.

[Install](#install-and-run) · [Menu](#menu) · [Commands](#commands) · [Safety](#compatibility-and-safety-notes) · [Library](#library-use)

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

Run `mnemocode` without a command in a terminal, or double-click the executable file, and it shows a menu (a terminal that says `TERM=dumb` cannot draw it and gets the help instead):

```text
What do you want to do?
› 1  Encode a seed phrase as numbers, codes or colors
  2  Re-encode a backup with other dates or in another form
  3  Decode numbers, codes or colors back into a seed phrase
  4  Split a seed phrase into standard Shamir shares
  5  Restore a seed phrase from Shamir shares
  6  Find a forgotten word, code, date digit or share code
  7  Print sample cards with a test seed phrase
  8  Look up a seed word, its number or its Unicode code
  9  Run the self-test
  0  Show every command and option
     Quit
```

Choose with the arrow keys and Enter, or press the number. Escape returns to the menu, and in the menu it quits, as do `q` and the last entry, Quit, which has no number. Questions appear one at a time. Where you type words, such as a seed phrase, a word to look up, English codes or shares in Bytewords, the words that begin like the one you type appear below it: after one letter how many, from two letters the words themselves. Tab completes the word. Encode shows examples of the forms, asks about Seedshift, optional shares (2 of 3, 3 of 5, or another set up to 16), output files, also all of them at once with All of these, and [instructions for heirs](#instructions-for-heirs). [Re-encode](#re-encoding-a-backup) asks for a backup made before as Decode does, and for the new one as Encode does once its seed phrase is confirmed.

The menu always masks word numbers and English words with Seedshift, because anyone with the BIP39 list can read them. Unicode codes and colors may stay unmasked. Shares use the chosen form; the [sharing section](#splitting-a-mnemonic-into-shares) explains what they restore. You may also show the whole encoded phrase beside the shares, with a warning, to keep it as a backup to them.

After Encode, the optional backup check asks you to type the written copy and dates again. It reports whether they restore the same seed phrase without displaying it. Before running, the menu shows the equivalent command, for example `mnemocode encode --ask-secrets --format 5 --mode direct`. Secrets are entered only on the [private screen](#secret-input-styles).

Every other answer has a command option: address range (`--scan-gap`), search limits (`--max-candidates`, `--max-tries`), backup check (`--backup-check yes|no`), and Decode's candidate check (`--encoded-fingerprint`, a wallet option or `--list-candidates`) and input kind (`--input-kind codes|share`). Command help lists them all. Failed searches and saves offer a next step; Ctrl+C or Stop cancels. A failed self-test disables entries that handle secrets.

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
  --dates 23-09-2026 --format 1 --output legacy-valid.txt
mnemocode decode --input-file legacy-valid.txt --dates 23-09-2026
```

With that option only the checksum bits of the last word are calculated again. The last word usually changes and its shifted value is lost, as with the same option in the original Seedshift. MnemoCode calls such a record `seedshift-legacy-valid`.

Decoding such a record restores every other word exactly and lists every possible last word, with its BIP32 master fingerprint, such as `73c5da0a`. The table below gives the counts; [recovery checks](#exact-local-recovery-checks) help identify your wallet.

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

| Command        | First prompt                                                   | Second prompt                                                                      |
| -------------- | -------------------------------------------------------------- | ---------------------------------------------------------------------------------- |
| `encode`       | Phrase                                                         | Dates                                                                              |
| `decode`       | Encoded seed phrase or record                                  | Dates, with `?` for a forgotten digit                                              |
| `recover-date` | Encoded seed phrase or record                                  | Dates, with `?` in place of each forgotten digit                                   |
| `recover-word` | Phrase, with `?` for each forgotten word                       | None                                                                               |
| `re-encode`    | Encoded seed phrase or record                                  | Dates; then the new backup, once it is confirmed                                   |
| `sskr-split`   | Phrase                                                         | Dates, only with `--mode seedshift`                                                |
| `sskr-combine` | Shares, separated by semicolons; `?` for an unreadable element | Dates, only with `--mode seedshift`; `?` allowed                                   |
| `sskr-export`  | Shares, separated by semicolons; `?` for an unreadable element | Dates, only with `--mode seedshift`, which also needs a wallet option; `?` allowed |

Enter dates on one line, for example `23-09-2026 08-08-1988 07-11-1951`. Direct mode asks for none. Incomplete dates may trigger a wallet-check question; [Date recovery helper](#date-recovery-helper) explains when it is required.

`--ask-secrets` works the same on Linux, macOS and Windows. MnemoCode switches the terminal to its alternate screen, a private screen, and reads the keys itself: you see what you type or paste, Backspace deletes a character, Ctrl+U the whole line, and Ctrl+C cancels. The result appears on the same screen. When you press Enter after it, the screen is cleared and the terminal returns to where it was, so that neither the secrets nor the result stay in the scrollback. Standard input must be the terminal; without one the command stops at once, and so it does in a terminal that says `TERM=dumb`, as some editors' consoles do, which cannot clear its screen. Output sent to a file goes there as before.

Answers are checked at once. An invalid word, date or share is explained in one line by its place, such as "Date 2" or "Share 3", and only that answer is asked again; earlier answers are kept. Escape does nothing while typing; in a choice it follows the key hint, usually the last option, such as Stop. Keys typed before a question appears cannot answer it. A multiline paste is one answer: words, codes or dates may come one per line; separate shares count as semicolon-separated.

`--mnemonic-file PATH` and `--input-file PATH` read the secret from a local file instead; the path `-` reads standard input. With `--ask-secrets`, `decode` and `recover-date` can take the record from `--input-file` or `--qr-file` and then ask only for the dates; when that file cannot be used, they offer another file, typing the record, or Stop.

Text input, from a prompt, a pipe or a file, may be up to 1 MiB. A QR image may be up to 16 MiB and 4096 pixels on a side. MnemoCode stops reading at the limit and refuses larger input.

## Commands

```bash
# Public test data; use --ask-secrets for your own seed phrase.
TEST_MNEMONIC='abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about'

# Write the phrase as Unicode codes without changing it.
mnemocode encode --mode direct --mnemonic "$TEST_MNEMONIC" --format 3

# Mask the phrase with a date and show the result as words.
mnemocode encode --mode seedshift --mnemonic "$TEST_MNEMONIC" \
  --dates 23-09-2026 --format 1

# Make the same record as the original Seedshift program.
mnemocode encode --mode seedshift-legacy --mnemonic "$TEST_MNEMONIC" \
  --dates 23-09-2026 --format 1

# Decode a legacy record typed by hand. It has no header, so give the mode and the form.
mnemocode decode --mode seedshift-legacy \
  --input "8F44901950118F44901950118F44901950118F4490194F5C" \
  --format 3 --dates 23-09-2026

# Find a forgotten day and check it against the fingerprint.
mnemocode recover-date --mode seedshift \
  --input "wool abuse actual wool abuse actual wool abuse actual wool abuse congress" \
  --format 1 --dates "??-09-2026" --master-fingerprint 73c5da0a

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

`--format` selects the form; `encode` defaults to English words. [Complete examples](#complete-encode-and-decode-examples) show saving and reading files. Recovery of [words](#forgotten-word-recovery), [codes](#codes-that-cannot-be-read), [dates](#date-recovery-helper) and [shares](#damaged-shares) is described below; `sskr-export` prints existing shares, `re-encode` [makes a backup again](#re-encoding-a-backup), and `preview` makes public sample cards.

| `--format`             | Form                                                                                                                                                                                                                                                                                              |
| ---------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `english` / `1`        | English BIP39 words.                                                                                                                                                                                                                                                                              |
| `indexes` / `2`        | The numbers of the words in the BIP39 list, from 1 through 2048, as in Seedshift. Numbers are separated by spaces or commas: run together they cannot be told apart.                                                                                                                              |
| `unicode` / `3`        | Four-digit Unicode codes. Each word is replaced by the character with the same number in the Traditional Chinese BIP39 list, and only the code of that character is written. Codes may be separated by spaces or joined.                                                                          |
| `colors-unicode` / `4` | The codes of format 5, each written as two four-digit codes from Unicode's Private Use Area. Codes may be separated by spaces or joined.                                                                                                                                                          |
| `colors` / `5`         | Color codes such as `#01AB63`: 8, 10, 12, 14 or 16 codes for 12, 15, 18, 21 or 24 words. The 12- and 24-word forms are compatible with BIP39Colors. Codes may be separated, joined with their `#` signs, or joined as one `RRGGBB` line. They may be kept in any order, but every code is needed. |

`colors-unicode` is a MnemoCode format, not a Unicode standard. It is ordinary text of digits and letters and needs no special font. An earlier form written as Private Use symbols can still be decoded.

On a terminal, codes that formats 3 and 4 write joined are shown twice, for the phrase and for its shares: apart, separated by spaces, so that each code can be told and an unreadable one replaced by `?`, and then joined on one line, for copying. A file or a pipe gets the joined line alone.

For `decode` and `recover-date`, `--format` is usually optional. MnemoCode picks the form itself when exactly one form fits the whole record. Otherwise it asks in the terminal, and a script must pass `--format`.

Results distinguish the original seed phrase from the masked phrase (decoy) held by its codes and shares. Encode prints their fingerprints: **original** for the wallet and **encoded** for the stored phrase. An invalid legacy phrase has no encoded fingerprint. Both use an empty BIP39 passphrase and reveal no phrase; note both, but [keep their verification limits in mind](#exact-local-recovery-checks).

On the private screen, Decode, date recovery and restoration of masked shares show the encoded fingerprint before asking for dates. A mismatch points to wrongly copied codes or shares. A wallet check uses the original fingerprint after undoing the dates; the encoded one is only for checking or [repairing stored codes](#codes-that-cannot-be-read).

## Complete encode and decode examples

`--output PATH` saves the result as a [versioned record](#versioned-records-and-legacy-compatibility), so `decode` needs only the file and the dates:

```bash
mnemocode encode --mode seedshift --ask-secrets --format 5 --output shifted-colors.txt
mnemocode decode --input-file shifted-colors.txt --ask-secrets
```

Replace `--format 5` with `1`, `2`, `3` or `4` for the other forms.

The same forms work without dates:

```bash
mnemocode encode --mode direct --ask-secrets --format 3 --output direct-unicode.txt
mnemocode decode --mode direct --input-file direct-unicode.txt --format 3
```

## Cards and QR codes

Templates place the codes on business cards or material samples, as a print studio's design proposal. Each sample shows one code: a color and its six-digit reference, such as `Ref. 01AB63`, or a four-digit Unicode code in a color that only decorates it. **The printed codes recover the phrase**; photographs, displayed colors and personal details are decoration.

MnemoCode includes thirteen templates. `mnemocode preview --list` prints their numbers and names, and `mnemocode encode --help` describes every card option. Cards need format 3, 4 or 5. Terminal output and separate QR codes work with every format.

A set of cards ends with a few random codes that belong to nothing, at least one, so that every row of a sheet is full. A sheet has at least three rows where they fit, spread evenly over its height, and of those the largest cards the page allows. The cards are numbered, but no card says how many there are. The QR code holds only the real codes, and the [sheet for heirs](#instructions-for-heirs) says how many words the phrase has. To decode codes typed from cards, give that number with `--words`; the menu asks for it.

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

MnemoCode invents the card identity at random; [Card identity defaults](docs/card-identities.md) explains it. Replace fields with `--card-name`, `--card-role`, `--card-company`, `--card-email`, `--card-phone`, `--card-website` and `--card-location`. Names accept Latin letters, spaces, apostrophes and hyphens. Unsupported characters and text that does not fit are refused.

In the menu, Encode offers "Also as printable cards" for a result or shares in colors or in Unicode codes. It asks about the files first, then the design:

- **The kind of file:** PDF, PNG or JPEG.
- **The layout:** A6 sheets, the usual choice, A5 or A4 sheets, or separate business cards of 90 × 50 mm, one file each, which only the business card designs have.
- **For sheets, how they are turned:** landscape, portrait, or whichever fills the sheet best: at least three rows where they fit, then the largest cards.

The menu then asks about a sheet QR code and personal details. "No, random" invents every detail; "Yes" asks each in turn, with Enter keeping that field random. These details appear in the equivalent command because they are not secrets. File layout is described under [Page sizes](#page-sizes).

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

QR codes are off by default. `--card-qr` adds one to the collection sheet; individual cards never have one. It holds only the encoded phrase in the selected format, with no `MNC1` header, mode or format name, dates, identity or fingerprints. A PNG copy is saved beside the PDF (`cards-qr.png` for `cards.pdf`) or inside the image folder. For shares, one PNG per share is named after its reference, also in a share-card folder. `--qr` chooses the PNG path yourself. Read it with `decode --qr-file` or `sskr-combine --share-qr`.

```bash
# Print the exact codes and color cards in the terminal.
mnemocode encode --mode seedshift --ask-secrets --format 5 --cards

# Save the encoded phrase as a PNG QR code.
mnemocode encode --mode seedshift --ask-secrets --format 5 --qr my-palette-qr.png

# Read the PNG QR code on this computer; the format is found automatically.
mnemocode decode --mode seedshift --qr-file my-palette-qr.png --dates 23-09-2026
```

Images need Poppler's `pdftocairo`; PDFs do not. A missing converter is reported before asking for a secret. Images use 300 dpi; PNG keeps text and QR codes sharp, while JPEG uses quality 90. Separate-card corners are transparent in PNG and white in JPEG.

[Card designs](docs/card-designs.md) describes what is printed on a sheet.

### Individual business cards

`--cards-dir NEW_FOLDER` saves one file per card, in the business card designs only: a design of material samples is a collection that only its sheet shows, so it is printed on sheets. It accepts the business size or no size, never a sheet size, and creates the new folder only after every card is ready. A collection saved by the same command must be outside it; [output naming](#cards-and-qr-codes) handles a taken name.

```bash
mnemocode encode --mode seedshift --ask-secrets --format 5 \
  --template business-it --card-name "John Smith" \
  --card-company "Example Systems" --card-role "Systems Engineer" \
  --card-email "john@example.com" --cards-dir ./my-it-cards

# Public demonstration, without entering a phrase:
mnemocode preview --template business-it --words 24 \
  --cards-dir ./sample-it-cards
```

Files are named after their number and the code they print, such as `01-ABCDEF.pdf`, `02-123456.pdf` or, in Unicode codes, `01-7684.pdf`. Each file holds only its own code. The last files hold the codes that belong to nothing.

This is **not Shamir secret sharing**. Every card is needed to recover the phrase, and each card reveals a part of the encoded phrase.

A preview folder holds one template, so `preview --all` cannot be used with `--cards-dir`.

## Page sizes

`--page-size` decides what you get. A sheet size puts the whole collection on one page. The card size gives real cards, each numbered and on its own page.

| `--page-size` | Size         | Result                          |
| ------------- | ------------ | ------------------------------- |
| `a6`          | 148 × 105 mm | One sheet. This is the default. |
| `a5`          | 148 × 210 mm | One sheet                       |
| `a4`          | 210 × 297 mm | One sheet                       |
| `business`    | 90 × 50 mm   | Separate cards                  |

With the card size, `--pdf` saves one PDF with one card per page, `--images-dir` saves one image per card, and `--cards-dir` saves one file per card. `--orientation portrait|landscape` works with every size; without it, a sheet is turned the way that gives it at least three rows of the largest cards.

On a sheet the samples are scaled to the page, so a sheet is a design proposal and cannot be cut into cards. Print at **100% / actual size** so that the QR code keeps its size.

```bash
mnemocode preview --template business-it --words 24 --page-size business --pdf business-cards.pdf
mnemocode preview --template material-vehicle --studio-name "AURORA STUDIO" --card-name "John Smith" --pdf wrap-preview.pdf
```

### Collection-sheet identity

A collection sheet names a design studio. It is separate from the employer printed on the business cards. `--studio-name` sets the studio and `--card-company` sets the employer. [Card identity defaults](docs/card-identities.md) explains what is printed when they are omitted. Material sheets print `--card-name` as the recipient.

`--card-slogan`, `--card-subtitle`, `--card-footer` and `--card-reference-label` replace the text on the sheet. The value `-` hides a field. The default reference label is `Ref.`.

## Splitting a mnemonic into shares

`encode --sskr --threshold 2 --shares 3` splits the phrase into Shamir shares as the last step of encoding. `sskr-combine` restores the phrase from the shares, and `sskr-export` prints existing shares as cards.

Shares restore what was split; if it was masked, the dates are still needed. Choose between:

- **The chosen representation.** Encode in the menu writes shares in the selected form (`--share-format indexes`, `unicode`, `colors` or `colors-unicode`). Restoration returns those exact word numbers, Unicode codes or colors, and with the dates also the seed phrase. These are MnemoCode formats; other SSKR programs cannot read them directly.
- **Standard SSKR.** Entry 4 splits the seed phrase's bytes and writes shares in Bytewords or `ur:sskr/...` (`--share-format words` or `ur`). They restore words and work with other SSKR programs. Choosing English words in Encode also produces standard shares.

[Shamir secret sharing (SSKR)](docs/SSKR.md) describes the commands, the share formats and recovery.

### Damaged shares

Replace an unreadable share element with `?` in its place: a word number, Unicode code, color, Byteword or UR letter pair. For colors, word Unicode codes and Color Unicode codes written apart, digit marks such as `#B5?0??`, `4E?0` or `E1?A` retain the readable digits and greatly reduce the work. A lone `?` between spaces marks a whole element. In codes run together a `?` stands for a whole code, so copy the codes apart, as the screen shows them, to mark a digit. Word numbers, Bytewords and UR pairs allow only whole-element marks. Several shares may be damaged, and two damaged copies of the same share may both be given.

MnemoCode repairs the shares together using their checksums, common set number and redundancy beyond the threshold: a third share in a 2-of-3 set adds a whole secret's worth of information. Remaining combinations are tested against the secret's digest. Before searching, it estimates the work and suggests which element to reread or whether another share would settle it. Searches estimated at up to 12 hours start at once; longer ones require confirmation, up to about a trillion combinations. Ctrl+C stops them.

The following times were measured on an Intel Core i7-1260P laptop with two shares of a 2-of-3 set and marks in their secret data. Marks in the common metadata near the start cost less. MnemoCode estimates your actual input on your computer before searching.

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

"Out of reach" exceeds the repair limit. [Repairing shares](docs/SSKR.md#damaged-shares) gives the estimates for the other formats and the algorithm's details.

If several seed phrases pass, all are listed with their fingerprints; none is chosen automatically. A [local recovery check](#exact-local-recovery-checks) keeps the matching phrase. Entry 6 or `sskr-export` returns repaired shares in their own form without showing the seed phrase, so you can correct the written copies.

The private screen identifies a bad share by its place. For conflicting copies, it names both and asks which to change. If restoration finds nothing, choose to retype one or all shares, omit one, add more, or stop. A wallet mismatch offers changes to dates, the wallet reference, a share or the Seedshift choice.

## Instructions for heirs

Encode can also save one sheet that tells someone else how to restore the backup: answer "Yes, A5" or "Yes, A6" to "Instructions for your heirs?" in the menu, or add `--heir-sheet heirs.pdf`, with `--heir-sheet-size a6` for the smaller size. It is optional.

It helps an heir recognize and restore a backup even if they have never heard of MnemoCode. Keep it apart from the backup: with a will, a lawyer or notary, or the heir in a sealed envelope.

Print the sheet on both sides: A5 is notebook-sized; A6 is postcard-sized, with smaller text. The front describes the backup, its share threshold and number of dates, how many words the phrase has or how many codes each share has, so that the codes that belong to nothing at the end of printed cards are left out, and leaves room for a handwritten hint. The back gives the menu steps, help when they fail, and wallet basics: seed phrases, date masking, opening the wallet and avoiding scams.

Write the hint so that only your heirs understand it: a clue to the dates, such as "the day we met and our son's birthday", never the dates themselves. Where it stands on the sheet protects nothing: whoever holds the sheet reads both sides.

The generated sheet contains no codes, shares, dates, fingerprint or storage locations. A fingerprint would help test guessed dates, and locations would undermine splitting the backup. The sheet alone cannot restore the wallet; the hint you add must not disclose the dates.

Its only link is this repository, whose README leads to [A guide for heirs](docs/HEIRS.md). A printed sheet may last decades; outside pages can vanish or change hands.

## Versioned records and legacy compatibility

A file written by `encode --output PATH` starts with a header: `MNC1:<mode>:<format>:<data>`. The header records the mode (`direct`, `seedshift`, `seedshift-legacy` or `seedshift-legacy-valid`) and the format, so you do not have to remember them. Dates are never stored. If `--mode` or `--format` contradicts the header, MnemoCode stops; on the private screen it says so instead and offers to read the record as its header says or to give it again.

Terminal output, typed text and QR codes have no header. Give the original `--mode` when you decode them. On the private screen, without `--mode`, `decode` asks whether Seedshift was used and which one, and `recover-date` asks which Seedshift was used. Decode in the menu asks this before the codes and passes the answer on as `--mode`.

`encode --sskr --output` writes no `MNC1` record: the file holds one complete SSKR share per line, in the selected share format (`ur:sskr/…` by default). See [Shamir secret sharing (SSKR)](docs/SSKR.md).

The library decodes text. Reading a QR image is a function of the command-line program.

## Re-encoding a backup

`re-encode` makes a backup again from one you already have: with new dates, another mode or another form, as cards or as Shamir shares. You never type the seed phrase itself. MnemoCode reads the old backup and at once its dates, shows the seed phrase, and only once you confirm it asks how to encode it again, with the same questions as Encode. In the menu it is entry 2, after Encode.

A valid checksum does not prove that the old backup was decoded right: with MnemoCode Seedshift every date gives a valid seed phrase, so a mistyped date would quietly give you a backup of another wallet. So nothing is encoded until you confirm the phrase, in one of two ways:

- you recognise the seed phrase or its fingerprint, shown on the private screen;
- MnemoCode compares it with an address of your wallet, of Bitcoin or another coin, or with its fingerprint. A fingerprint has only 32 bits and is a filter, not proof: MnemoCode says so and accepts the seed phrase without calling it confirmed. An address proves it.

```bash
# Public test data: the masked test phrase unmasked as Unicode codes, accepted by its fingerprint (a filter, not proof).
mnemocode re-encode --input "wool abuse actual wool abuse actual wool abuse actual wool abuse congress" \
  --old-mode seedshift --old-dates 23-09-2026 --mode direct --format 3 --master-fingerprint 73c5da0a

# A record file masked again with new dates, as colors.
mnemocode re-encode --ask-secrets --input-file shifted-colors.txt --mode seedshift --format 5
```

The old backup takes the options of `decode`, with `--old-mode`, `--old-format` and `--old-dates` for its mode, form and dates; the new backup takes those of `encode`, and without them `--ask-secrets` asks for it once the phrase is confirmed. A backup of the original Seedshift with a valid last word keeps nothing of the original last word: you give it, as you remember it (`--last-word`). On the command line, give a wallet option or `--recognised`. Every code and date of the old backup is needed: [find forgotten ones](#recovery) first. Afterwards the old backup still restores the same wallet, so destroy it if the new one replaces it.

## Recovery

Choose the operation for what is damaged:

| What you have                             | Operation                                        | Menu entry |
| ----------------------------------------- | ------------------------------------------------ | ---------- |
| Original seed phrase with forgotten words | [recover-word](#forgotten-word-recovery)         | 6          |
| Encoded phrase with unreadable codes      | [Decode](#codes-that-cannot-be-read)             | 3          |
| Masked phrase with forgotten dates        | [recover-date](#date-recovery-helper), or Decode | 6 or 3     |
| Incomplete Shamir shares                  | [Restore or repair shares](#damaged-shares)      | 5 or 6     |

### Word and code patterns

For words and encoded phrases, keep each unreadable element in its place:

| Pattern        | Meaning                                            | Where it works                          |
| -------------- | -------------------------------------------------- | --------------------------------------- |
| `?`            | One whole word, word number, Unicode code or color | Word recovery and Decode                |
| `ab*`          | A word beginning with `ab`                         | English words                           |
| `rich\|rice`   | One of the given words                             | English words                           |
| `1?34`, `4E?0` | One unknown digit                                  | Word numbers or Unicode codes in Decode |

These searches try up to **16,777,216 combinations**: enough for two whole words, or more positions narrowed by letters or digits. The BIP39 checksum filters original phrases and direct or checksum-valid Seedshift backups: about one in 16 combinations for 12 words, one in 256 for 24. Original `seedshift-legacy` codes have no such filter. Expected remaining candidates when the checksum applies are:

| Whole words unknown | 12-word phrase | 24-word phrase |
| ------------------- | -------------: | -------------: |
| One                 |            128 |              8 |
| Two                 |        262,144 |         16,384 |

The checksum does not identify your wallet; use a [local recovery check](#exact-local-recovery-checks) or, without a known wallet reference, a [candidate list for discovery](#candidate-lists-for-discovery). Dates and shares have their own patterns and search limits, described in their sections.

## Forgotten-word recovery

`recover-word` takes an English BIP39 phrase using the [word patterns above](#word-and-code-patterns). With one forgotten word, each row shows the candidate number, word, BIP39 word number, checksum bits and whole phrase. If its position is unknown, use `--missing-word` with the remaining words: every insertion position is tried, giving about 1,500 candidates for 12 words.

Words are checked first on the private screen, including the combination limit. When none fit or too many remain to display, choose to retype, check against the wallet, or stop. A wallet check marks matching rows; nonmatches remain visible when there are at most 2,048 candidates. Checking 262,144 candidates locally may take a few minutes.

For an old `seedshift-legacy` phrase with an invalid last-word checksum, `recover-word --legacy-valid-last-word` accepts the complete phrase without `?` and lists valid replacement last words. The `preserved` row keeps the old data bits and matches legacy encoding's suggestion. These are replacements for the **stored** phrase; the dates recover the original wallet phrase from them.

## Codes that cannot be read

Use Decode (entry 3 or `decode --ask-secrets`) with the [word and code patterns above](#word-and-code-patterns) in the stored representation. It offers three ways to select the right codes:

- **Encoded fingerprint:** the value printed by Encode for the stored phrase; no dates are needed.
- **Wallet reference:** the original fingerprint or an address, checked after undoing the dates. Dates can also hold `?`, so both are recovered together.
- **List candidates:** available when few remain.

Decode estimates the search time before starting and returns the codes and dates found, so the written copy can be corrected.

A complete or marked Shamir share, typed or read with `--qr-file`, is forwarded to [share restoration](#damaged-shares) as the first share. QR input is shown as text; subsequent shares can be typed or read from QR images. Ambiguous text triggers a choice between codes and a share; `--input-kind codes|share` supplies it directly.

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

Decode and Restore use the same date search on the private screen, even when codes or shares are also marked. They ask for a wallet reference when required; with original Seedshift, Decode also offers the choice "It cannot" to list checksum-valid results. Restore estimates the combined work for all share and date combinations. Dates passed with `--dates` must be complete except in `recover-date`.

## Exact local recovery checks

`recover-date`, `recover-word`, `sskr-combine` and Decode can compare candidates with a known wallet reference, entirely offline. Choose an address or public key when possible; a master fingerprint is a short filter, not proof of a match.

```bash
# Public stored phrase used by all four examples below:
STORED_PHRASE='wool abuse actual wool abuse actual wool abuse actual wool abuse congress'

# A native-SegWit receiving address, one of the first 20: here m/84'/0'/0'/0/0.
mnemocode recover-date --mode seedshift \
  --input "$STORED_PHRASE" \
  --format 1 --dates "??-09-2026" \
  --bitcoin-address bc1qcr8te4kr609gcawutmrza0j4xv80jy8z306fyu \
  --bitcoin-profile native-segwit

# A master or account extended public key. Standard and SLIP-132 forms are accepted:
# xpub, ypub, zpub, Ypub, Zpub; testnet tpub, upub, vpub, Upub, Vpub.
mnemocode recover-date --mode seedshift \
  --input "$STORED_PHRASE" \
  --format 1 --dates "??-09-2026" \
  --account-xpub zpub6rFR7y4Q2AijBEqTUquhVz398htDFrtymD9xYYfG1m4wAcvPhXNfE3EfH1r1ADqtfSdVCToUG868RvUUkgDKf31mGDtKsAYz2oz2AGutZYs \
  --bitcoin-profile native-segwit

# An address of another coin, here the first Ethereum one: m/44'/60'/0'/0/0.
mnemocode recover-date --mode seedshift \
  --input "$STORED_PHRASE" \
  --format 1 --dates "??-09-2026" \
  --coin ethereum --coin-address 0x9858EfFD232B4033E47d90003D41EC34EcaEda94

# A 33-byte compressed public key at exactly one BIP44/49/84/86 path.
mnemocode recover-date --mode seedshift \
  --input "$STORED_PHRASE" \
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

The coins besides Bitcoin are those of mhfe, each on its standard paths, with single-key receiving addresses: Bitcoin Cash (`bitcoin-cash`, `bitcoincash:q…` or `1…`), Cosmos (`cosmos`, `cosmos1…`), Dash (`dash`, `X…`, or a Platform address `dash1k…`), Dogecoin (`dogecoin`, `D…`), Ethereum and every EVM network (`ethereum`, `0x…`), Ethereum Classic (`ethereum-classic`), Injective (`injective`, `inj1…`), Litecoin (`litecoin`, `L…`, `M…`, `3…` or `ltc1q…`), Tron (`tron`, `T…`), XRP (`xrp`, `r…`) and Zcash (`zcash`, transparent `t1…`; a shielded address cannot be checked). Bitcoin Cash and Ethereum Classic wallets use their own coin type or that of the chain they forked from, and both are tried. The address tells its type and its network, so `--network` and `--bitcoin-profile` are for Bitcoin only. In the menu, after Address, "Which coin is the address for?" lists every coin, Bitcoin first with the forms of its addresses, then asks for the address.

A WIF can spend the funds. Never put it in a shell command or an issue report.

## Candidate lists for discovery

Without a known wallet reference, candidates can be checked for funds with the Discovery Scanner of the [multi-chain wallet tools](https://github.com/hobby-eng/multi-chain-wallet-tools). `recover-word`, `recover-date` and `sskr-combine` save them with `--candidates-file candidates.age`; candidate 5 on screen is record 5 in the list.

**The list contains seed phrases.** It is encrypted to the Scanner's one-time key (`--candidates-key age1…`) or with a passphrase. MnemoCode stays offline; the Scanner performs the online search. [Candidate lists](docs/CANDIDATES.md) describes protection, limits and the file format.

## Self-tests and public vectors

Before processing data, MnemoCode runs quick checks without files, renderers or a share engine. Known answers come from published vectors or an independent implementation that first reproduces one. They cover:

- Both BIP39 word lists' lengths and SHA-256 hashes, the BIP39 seed and master fingerprint.
- Every transformation mode; exact 12- and 24-word answers in all five representations, and 15-, 18- and 21-word answers with MnemoCode Seedshift, with numbering, checksum and Color Unicode refusals.
- Date patterns, marked codes and shares, word searches, candidate lists, written-backup checks and wallet evidence.
- Addresses of all twelve coins, heir-sheet text, share-card and card-set content, word hints and re-encoding.
- Published SSKR Bytewords and refusals of incomplete quorums, duplicates, mixed sets and corrupt checksums.

If a check fails, the command stops:

```text
CRITICAL: MnemoCode core self-test failed.
No mnemonic data was processed.
```

Before it splits or combines shares, MnemoCode also restores an official grouped set and a set holding the 32-byte secret of a 24-word phrase, creates an exact deterministic test set, and checks that the engine refuses an incomplete quorum and a damaged share value even when its transport checksum is correct. The fixed creation seed is public test data and is never used for a person's shares.

Run the full test before you use a newly built or copied installation:

```bash
mnemocode self-test
```

The full test includes the quick checks plus every phrase length/format/mode combination, date sorting, the public test file, 24 English BIP39 seed vectors, wallet-assisted searches, encrypted candidate lists, joint share/date repair, every coin vector and actual heir-sheet/card/QR exports with all artwork and fonts. Each feature gets a refusal case too. Finished groups show their times, followed by an overall result.

The public test data is in [`vectors/mnemocode-v1.json`](vectors/mnemocode-v1.json). It contains only well-known test phrases.

## Compatibility and safety notes

[SECURITY.md](SECURITY.md) describes how to report a vulnerability, how to work offline, how secrets are handled and which risks remain. Read it before you work with a real phrase.

- Dates are written `DD-MM-YYYY`; `YYYY-MM-DD` is also accepted. The order in which you type them does not matter.
- A year always has four digits, from `0001` through `9999`. `23-09-26` is an error; the year 26 is written `0026`. [Date recovery](#date-recovery-helper) explains why some years produce the same shift.
- You can use one date for every three words: 4, 5, 6, 7 or 8 dates for 12, 15, 18, 21 or 24 words.
- The original Seedshift program does not support 21-word phrases; MnemoCode does.

### Protection while it runs

Every run is protected as far as the system allows: core dumps are off on Linux and macOS, and MnemoCode runs under the Node.js permission model. That model allows no network, and a command that does not need them cannot write files or start other programs. Re-encode with `--ask-secrets` and no option of the new backup, as the menu runs it, asks where the new backup goes only after the old one is read and its seed phrase confirmed, so until then it keeps both rights; the permission model then gives up those the answers do not need, while the operating system's limits below stay as they were set at the start. If you start MnemoCode under that model yourself and grant a right on purpose, such as `--allow-net`, it keeps that right. The library has the rights of the program that uses it. Node.js enforces the model itself, so the operating system enforces what it can below it:

- Linux: seccomp refuses new sockets and, where a command starts no program, starting one. Landlock refuses file writes where a command saves nothing, on kernels that can apply it to every thread at once, such as Linux 7.0. Memory is locked out of swap where the system lets a program lock all of it, which usually needs root.
- macOS: no debugger can attach, and the system sandbox refuses the network and, where a command starts none, other programs.
- Windows: crash reports leave out the heap, extension DLLs and DLLs from network shares are refused, and a job object refuses other programs.

Each of these is checked by trying what it forbids before MnemoCode names it. What a system does not offer is left out, without a refusal; `mnemocode self-test` says what was not available and why. Before a secret is asked, the private screen shows this protection, and a warning if swap is not encrypted or a file would be saved into a cloud folder.

### Unencrypted swap

When memory runs short, the system can write part of the memory of MnemoCode, the seed phrase included, to the swap area on the disk, where it can stay for years. On Linux MnemoCode warns before a secret when swap is not encrypted, or when it cannot tell, unless its memory is locked. Use encrypted swap or none at all; a live USB system is best. Swap on dm-crypt, also below LVM, and zram, which stays in memory, count as safe.

### Cloud folders

A file saved into a folder that Dropbox, OneDrive, Google Drive, iCloud Drive, Yandex Disk, Nextcloud, MEGA or pCloud synchronises is copied to that service's servers and kept there. MnemoCode warns when an output path lies in such a folder, which it recognises by the usual folder names. Save records, cards and shares to a local folder or a removable drive instead.

## Library use

The TypeScript library exposes the same transformations used by the CLI:

```ts
import { encodeMnemonic, formatEncoded, masterFingerprint, parseDate } from "mnemocode";
import { EncodedBackup } from "mnemocode/core/encoded-backup";

const dates = ["10-07-1963", "31-01-4489"].map(parseDate);
const encoded = encodeMnemonic(mnemonic, dates);
const unicode = formatEncoded(encoded, "unicode");
const recovered = EncodedBackup.read(unicode, "unicode", "seedshift").decode(dates);
console.log(recovered.recoveredMnemonic, masterFingerprint(mnemonic));

// The same phrase in another form, without dates.
import { representMnemonic } from "mnemocode";
const direct = formatEncoded(representMnemonic(mnemonic), "unicode");
const sameMnemonic = EncodedBackup.read(direct, "unicode", "direct").decode([]);
```

Library exports are listed in `src/index.ts`. Shamir sharing has a separate `mnemocode/sskr` entry point.

Each part of the library also has an entry point of its own, without Node.js code, for a program that needs only that part, such as a browser page: `mnemocode/core/date-search` searches forgotten date digits, and `mnemocode/sskr/share-set` restores Shamir shares, for example. The program passes what only it has, such as its PBKDF2 for the wallet check or its SSKR library. [Modules for other hosts](docs/ARCHITECTURE.md#modules-for-other-hosts) lists the parts.

Dependency versions are exact in `package.json`, and `pnpm-lock.yaml` records their hashes. The package is marked `private`: it is distributed through this repository, not through the npm registry.

## Continuous integration

GitHub Actions installs the frozen lockfile and checks toolchain pins, types, formatting, Markdown lists, the documented signing key and copied code. It builds the CLI/library, runs the test suite, restores the SSKR vectors without the share engine (`scripts/verify-sskr-known-answers.py`) and audits dependencies for high-severity vulnerabilities. Linux also renders PDF/card/share exports and reads their QR codes back; Poppler-dependent tests are skipped on Windows and macOS. All three systems exercise menu and secret input in real pseudo-terminals with `scripts/verify-terminal-input.py`.

A second workflow builds the single executable on Linux, Windows and macOS and runs each one on its own system. A version tag puts the executables, their license notices and `SHA256SUMS` into a draft release, only after the complete CI has passed and when the tag names the version in `package.json`. The maintainer then signs `SHA256SUMS` on their own computer and publishes the release, as [Releasing](docs/RELEASING.md) describes.

The unit and terminal tests also cover records with and without headers, secret input, self-test gates, recovery and QR input; [self-tests](#self-tests-and-public-vectors) describe the transformation and known-answer coverage.

## Source layout and review

[Source layout](docs/ARCHITECTURE.md) describes the modules and the maintenance checks. The [audit index](docs/audits/README.md) lists the audit reports and their follow-ups.

## Provenance and license

MnemoCode is an independent TypeScript implementation. It is not affiliated with, endorsed by, or an official fork of Seedshift or BIP39Colors.

The MnemoCode source is MIT licensed. `NOTICE` attributes the compatible formats to [Seedshift by mifunetoshiro](https://github.com/mifunetoshiro/Seedshift), which is MIT licensed, and [BIP39Colors by EnteroPositivo](https://github.com/EnteroPositivo/bip39colors), which is CC BY 4.0. [`THIRD_PARTY_NOTICES.md`](THIRD_PARTY_NOTICES.md) records the dependencies and the origin of the word lists.
