# MnemoCode

[![CI](https://github.com/hobby-eng/mnemocode/actions/workflows/ci.yml/badge.svg?branch=main)](https://github.com/hobby-eng/mnemocode/actions/workflows/ci.yml)
[![Release](https://github.com/hobby-eng/mnemocode/actions/workflows/release.yml/badge.svg)](https://github.com/hobby-eng/mnemocode/actions/workflows/release.yml)
[![RustSec audit](https://github.com/hobby-eng/mnemocode/actions/workflows/audit.yml/badge.svg)](https://github.com/hobby-eng/mnemocode/actions/workflows/audit.yml)
[![Build provenance: GitHub attestations](https://img.shields.io/badge/build%20provenance-GitHub%20attestations-2ea44f)](https://github.com/hobby-eng/mnemocode/attestations)
[![License: MIT OR Apache-2.0](https://img.shields.io/badge/license-MIT%20OR%20Apache--2.0-blue)](#provenance-and-license)

This README describes MnemoCode 0.2.0, the Rust version; its executables are on the [releases page](https://github.com/hobby-eng/mnemocode/releases). Records and shares of earlier versions remain readable.

MnemoCode writes a wallet seed phrase (a BIP39 mnemonic) as numbers, Unicode codes or colors, or hides it in the legend of a cross-stitch pattern. You can mask it with dates, divide it into Shamir shares, print it on cards, or search for missing recovery material. It works offline as a command-line program, Rust library or WebAssembly module.

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

| Menu | Task                                          | What it does                                                                                  |
| ---- | --------------------------------------------- | --------------------------------------------------------------------------------------------- |
| 1    | [Encode](#1-encode)                           | Make a backup in another form or a cross-stitch pattern, with optional dates, shares or cards |
| 2    | [Re-encode](#2-re-encode)                     | Restore an existing backup and make a replacement                                             |
| 3    | [Decode](#3-decode)                           | Read a backup and recover the original words                                                  |
| 4    | [Split into shares](#4-split-into-shares)     | Make standard Shamir shares                                                                   |
| 5    | [Restore from shares](#5-restore-from-shares) | Combine enough shares and undo date masking if used                                           |
| 6    | [Recovery](#6-recovery)                       | Find missing words, codes, date digits or share elements                                      |
| 7    | [Preview cards](#7-preview-cards)             | Try designs with sample data                                                                  |
| 8    | [Word lookup](#8-word-lookup)                 | Look up a word or export dictionaries and a recovery guide                                    |
| 0    | [Self-test](#0-self-test)                     | Check the installation                                                                        |
| s    | [Help](#s-help)                               | Read commands and options                                                                     |
| q    | [Quit](#quit)                                 | Leave the program                                                                             |

<a id="secret-input-styles"></a>

Use the menu or `--ask-secrets` for real recovery material. Enter it on the private screen or read it from protected local files; never put seed phrases, codes, shares or dates in command arguments. The program refuses those arguments, but cannot remove what you already typed from shell history or process listings.

The private screen clears its contents when you leave it. It needs an interactive terminal and refuses `TERM=dumb`; it cannot prevent screen capture, terminal logging or observation by a compromised computer. Escape at a secret-input prompt returns to the main menu when started there; a standalone cancelled command ends with exit code 130.

## 1. Encode

Choose how to write the backup, whether to mask it with dates, and where to save it. The screen marks the part to keep with **SAVE THIS BACKUP**, or **SAVE THIS SHARE** for each share; a cross-stitch pattern shows its legend line, to keep in its exact order unless you keep the PDF that holds it. Copy the entire marked block in the displayed order. If you use Seedshift, keep the original dates too.

### Backup formats

<a id="commands"></a>

A backup takes one of six forms. The first five are selected by `--format`; the last is made by `stitch`, or Embroidery among the forms of the menu:

| Format                 | What you save                                                                                                                                        |
| ---------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| `english` / `1`        | English BIP39 words of the masked phrase                                                                                                             |
| `indexes` / `2`        | BIP39 word numbers from **1 to 2048**                                                                                                                |
| `unicode` / `3`        | Four-digit codes of the corresponding Traditional Chinese BIP39 characters                                                                           |
| `colors-unicode` / `4` | Two four-digit Unicode codes for each color                                                                                                          |
| `colors` / `5`         | `#RRGGBB` codes: 8, 10, 12, 14 or 16 for 12, 15, 18, 21 or 24 words                                                                                  |
| Cross-stitch legend    | A pattern made from your picture; its legend holds the phrase: each row's symbol and the last digits of its stitch count ([Embroidery](#embroidery)) |

English words and word numbers require Seedshift in the menu, command line and library. Unicode codes and colors can be used without dates. Colors may be reordered, but every real color code is needed; word codes must keep their order. The 12- and 24-word color forms are compatible with BIP39Colors. Color Unicode is MnemoCode's text format, also accepted as Private Use characters. [Representation details](docs/CLI.md#representation-details) explain separators and copying.

### Transformation modes

The mode decides whether the phrase itself changes; the format decides how the result is written.

| Mode               | What happens                                           | Dates    |
| ------------------ | ------------------------------------------------------ | -------- |
| `direct`           | Writes the original phrase in another form             | None     |
| `seedshift`        | Masks the phrase and calculates a valid BIP39 checksum | Required |
| `seedshift-legacy` | Masks the words as Original Seedshift does             | Required |

Without `--mode`, a `--dates-file` selects `seedshift`; otherwise the mode is `direct`. Dates accept `DD-MM-YYYY` or `YYYY-MM-DD`, with years `0001`–`9999`. Their input order does not matter. You can use up to one date per three words: at most 4–8 dates for 12–24 words.

**Wrong dates can produce a valid phrase for a different wallet.** A checksum cannot confirm the dates. Keep an original wallet fingerprint, address or public key for a [recovery check](#exact-local-recovery-checks).

Original Seedshift shifts each word number, so its result usually fails the BIP39 checksum. MnemoCode writes it with a last word that passes the checksum, so the backup is a valid phrase like that of every other mode, and shows the original last word to remember. Decode asks for that word: with it the phrase comes back exactly; without it, one or two phrases remain, each with its fingerprint, and a wallet reference tells them apart. Codes made by the original Seedshift program, whose last word fails the checksum, decode exactly without it. MnemoCode also accepts 21-word phrases, which Original Seedshift did not support.

#### How checksum-valid Seedshift works

MnemoCode Seedshift shifts the entropy represented by each word and calculates a new checksum. Decoding with the same dates subtracts those shifts and restores the original phrase. Different dates can produce the same shift. The [construction](docs/SEEDSHIFT_CONSTRUCTION.md) and [worked example](docs/MANUAL_RECOVERY.md#worked-12-word-example-public-test-data) explain the calculation.

### Make a backup and read it back

<a id="complete-encode-and-decode-examples"></a>

Every new backup in the menu asks the same questions in the same order: Seedshift, the form's own questions (a pattern's picture, fabric and size), Shamir shares, the sheet for heirs, where to save the result, with the card questions where cards are ticked, and last, just before the seed phrase, the Seedshift dates. An answer that a form cannot take stays greyed in its place, with the reason. With Seedshift, the result also shows the seed phrase after Seedshift in English words, unless the backup is those words already. Where to save the result is a checklist: Space ticks each place, Enter confirms, and nothing ticked keeps the result on the screen. Where anything is saved, the menu then asks once for the folder of all the task's files: Enter keeps the folder MnemoCode started in. The files go into a new folder made inside it, `design-files` (`design-files-1` where that name is taken), each under its usual name: before the dates and the seed phrase are asked, MnemoCode closes every other folder to writing, so that nothing it runs can change the folders you already have. A task left before anything is saved may leave that folder empty; MnemoCode names it. Each pair below decodes the file made by the preceding command. `--ask-secrets` asks privately for the phrase and any dates needed. Run the pairs separately; keep the dates apart from the backup.

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

The file holds only the codes, as the screen shows them: Decode asks how they were masked, finds the form itself, and asks for the dates. Keep the mode with the dates. [File-based examples](docs/CLI.md#public-command-examples) use public test data for scripts; [input files and limits](docs/CLI.md#input-files-and-limits) list the available sources.

### Check what you saved

Encode offers to check the backup by asking for the written copy and dates again; `--backup-check yes` or `no` answers in advance. This checks your transcription. Embroidery reads each legend back before it writes the PDF. Every generated QR PNG is separately read back and compared with the expected content before saving; a mismatch offers another try.

Encode shows an **original** fingerprint for the wallet with an empty BIP39 passphrase and an **encoded** fingerprint for the stored phrase. They do not reveal the phrase. The encoded fingerprint checks the codes before dates are removed; an original wallet reference checks the recovered phrase. Every backup MnemoCode writes is a valid phrase, so each has an encoded fingerprint; codes of the original Seedshift program, whose last word fails the checksum, have none.

You can also show the masked phrase as English words with `--show-masked-words`, or the original words for visual checking with `--show-original words`. The menu always shows the English words of a masked result and never the original words. These screen-only choices never add the original phrase to encoded files or share exports. Keep the original words apart from the backup.

### Cards and QR codes

Recovery uses the **printed code values**: four-digit Unicode codes or `#RRGGBB` color codes. Copy the real codes exactly, following the card numbers and leaving out the decoys described below. For colors, keep the printed hexadecimal values rather than matching shades by eye. Pictures, names and contact details are decoration; on Unicode cards, the colors are decorative too.

Cards need format 3, 4 or 5; `preview --list` lists the thirteen designs.

```bash
# Seedshift colors on A4 sheets, with a QR code and its PNG copy.
mnemocode encode --mode seedshift --ask-secrets --format colors \
  --template business-it --page-size a4 --pdf color-cards.pdf --card-qr \
  --card-qr-png
mnemocode decode --mode seedshift --format colors \
  --qr-file color-cards-qr.png --ask-secrets

# Direct Unicode as separate JPEG business cards, read back from their folder.
mnemocode encode --mode direct --ask-secrets --format unicode \
  --template business-it --cards-dir unicode-cards --image-format jpg
mnemocode decode --input-file unicode-cards --ask-secrets

# A standalone QR backup in Original Seedshift Unicode, without printable cards.
mnemocode encode --mode seedshift-legacy --ask-secrets --format unicode \
  --qr legacy-unicode.png
mnemocode decode --mode seedshift-legacy --format unicode \
  --qr-file legacy-unicode.png --ask-secrets
```

A QR code contains the real codes, **without a mode, format header or dates**. Keep that information yourself. `--card-qr` puts the QR on a collection sheet; `--card-qr-png` also saves it as a PNG beside the PDF or in the image folder (for the shares of a command line, in a new folder named after the PDF, such as `shares-qr-codes`); individual cards never have a QR. `--qr PATH` saves a standalone PNG. In the menu one question covers all of this: no QR code, an ordinary one or one with hidden data, on the cards only, on the cards and as a PNG file, or as a PNG file only; with separate business cards, or without cards, the QR code can only be a PNG file.

Each file of the cards, a PDF, PNG or JPEG, also keeps the codes as named color swatches in its design metadata (XMP), as files from design programs do. Decode, Re-encode and Restore from shares read them from the file, or from the folder of the cards, without typing; it does not read a photograph or a scan of a sheet.

Printed sets also contain extra random codes. When typing codes from cards, give `--words` for the original phrase length and omit those extra codes. The sheet for heirs records the length. Recheck a backup before relying on it.

Files and folders are never overwritten: taken names receive a number, which MnemoCode reports. Use that reported name when decoding. A command line's files are made, empty, before the seed phrase is read, and filled when the result is saved; a command that ends before it, refused or cancelled, can leave them empty, and names them. Folder exports can be incomplete after interruption; [export precautions](SECURITY.md#secret-lifecycle-and-local-boundaries) explain what may remain.

#### Individual business cards

`--cards-dir NEW_FOLDER` saves one PDF, PNG or JPEG per card, for business card designs only. Each file holds one code; an extra card holds a decoy code. Names such as `01.pdf` do not include the codes.

These cards are **not Shamir shares**. Every real card is needed and exposes part of the encoded phrase. To require only a subset, [split the phrase into shares](#4-split-into-shares).

#### Page sizes

A6, A5 and A4 produce collection sheets. `--page-size business` produces 90 × 50 mm cards, one per PDF page or image; `--cards-dir` puts each in a separate file. Samples on collection sheets are scaled to fit and are not cut-out cards. Print at **100% / actual size** to preserve QR dimensions.

`--image-format png|jpg` selects images. PNG preserves sharp codes and transparent card corners; JPEG has white corners. [Card options](docs/CLI.md#card-options) cover layout and orientation.

#### Collection-sheet identity

`--studio-name` names the design studio; `--card-company` names the employer on business cards. Material sheets use `--card-name` for the recipient. See [card designs](docs/card-designs.md), [identity defaults](docs/card-identities.md) and [custom text fields](docs/CLI.md#card-options).

#### QR codes with hidden records

The QR export choice shows a public contact or text to compatible ordinary scanners while retaining selected backup codes in its filler bytes. MnemoCode reads the hidden record; an ordinary reader only returns the visible text, and some strict readers may reject the QR. PDF exports use the printed contact; standalone PNGs accept `--qr-text`. Add `--qr-hidden` to select this mode. `qr-hide` wraps an existing record and `qr-open` extracts it unchanged. This is camouflage, not encryption; raw-byte tools can detect it. See [Hidden QR records](docs/HIDDEN_QR.md) for examples, limits and the public format.

### Instructions for heirs

`--heir-sheet heirs.pdf` adds a double-sided A5 guide, for codes, shares or a cross-stitch pattern; `--heir-sheet-size a6` makes a smaller one. It records the backup type, phrase length, share threshold and number of dates, but no recovery material, fingerprints or storage locations.

Keep it apart from the backup. A handwritten hint should help heirs remember dates without disclosing them. For the Original Seedshift the sheet also asks for the last word the owner was told to remember. The sheet cannot restore the wallet on its own; [A guide for heirs](docs/HEIRS.md) explains what else they need.

### Embroidery

Choose **Embroidery** among the forms, or run `stitch`, to hide the phrase in a cross-stitch pattern made from your own picture: a PNG, JPEG or WebP file. MnemoCode masks the phrase with your dates, as Seedshift does, and turns the picture into a chart in DMC threads. The menu offers the three answers of every new backup: "MnemoCode Seedshift", "Original Seedshift" or "No Seedshift". With either Seedshift, the dates are asked last, after the picture and where to save the pattern, just before the seed phrase; choose "No Seedshift" only for a phrase already protected some other way, since anyone who knows MnemoCode reads it from the legend. The masked phrase is in the legend: in each row's symbol and in the last one or two digits of its stitch count. Nothing on the pattern names MnemoCode.

```bash
mnemocode stitch --ask-secrets --picture cat.jpg --stitches-across 200 \
  --pdf cross-stitch-pattern.pdf --output legend.txt
mnemocode decode --input-file legend.txt --ask-secrets
```

The PDF looks like a pattern bought from a designer, in three pages: a cover with the picture as it looks stitched, the design size, the finished size on Aida 11 to 18 and on linen 28 and how to start; the floss key, every thread on one page; and the whole chart in colour with its symbols, a bold line every ten stitches and arrows at the centre.

The menu asks for the fabric: Aida 14 unless you choose 11, 16 or 18, or linen of 28 threads an inch stitched over one thread, whose stitches are half the size of those on Aida 14 and take one strand, for detail in a small piece. Then it asks how large the embroidery is: a paper size from A6 to A2, each shown with the stitches your picture takes in it and their size in centimetres, or a width in centimetres or in stitches. A sheet that gives no more stitches than a smaller one is not offered. The picture is fitted into the sheet inside a 1 cm margin, turned whichever way holds it larger, and the chart is drawn on a sheet of that size: on Aida 14, A4 holds up to 104 by 152 stitches. `stitch` takes `--stitches-across` and `--fabric`, such as `14` or `linen-28`; 200 stitches across make about 36 cm on Aida 14 and 18 cm on linen 28. The width can be 40 to 500, and a pattern is at most 800 stitches high. A photograph with smooth shades works best. A flat picture with a few colors cannot hold a phrase: MnemoCode says so and asks for another picture or size, offering the sheets again, and keeps what you typed.

Decode needs the legend, not the picture; it asks whether Seedshift was used, and which, and then the dates, since the legend does not say. Give it the pattern's PDF (In a cross-stitch pattern, or `--input-file` with the PDF): the PDF keeps the legend line, compressed where no viewer shows it. Or type the legend. Type each row from the top as the symbol's number, a colon and its stitches: `28:1725 25:2163 57:3275 …`. A small pattern, too small for the phrase otherwise, also uses the order of its rows, and its line names each row's DMC number between them: `15:407:38 23:703:169 …`. The PDF shows the symbols; [the SeedStitch format](docs/SEEDSTITCH.md#the-symbols) numbers them 1 to 70, and `--output` saves the legend already typed out. A single mistyped row is corrected: Decode names the row to check on paper, or asks you to check them all where a change of any of several rows gives the same phrase. A legend of the usual form typed with the DMC numbers that its key prints reads too.

A pattern is a new backup like the others: it also offers the legend line as a text file, a QR code image of it, the phrase after Seedshift on the screen and the sheet for heirs (`--output`, `--qr`, `--show-masked-words`, `--heir-sheet`; `stitch` also takes `--show-original`). In every mode the legend holds a phrase of the same length, so nothing in it tells which mode was used. With the Original Seedshift the legend holds the phrase with a last word that passes the checksum, and MnemoCode shows the word to remember, as Encode does; Decode asks for it.

A pattern can also be split into [Shamir shares](#splitting-a-mnemonic-into-shares): choose a set such as 2 of 3 at "Split it into Shamir shares?", or give `--threshold` and `--shares`. MnemoCode makes one pattern per share from the same picture, numbered `share-1-pattern.pdf`, `share-2-pattern.pdf` and so on in a new folder (`--pdf-dir`). The embroideries look almost the same; their legends differ. Restore from shares reads any threshold of them back: give the folder that holds their PDFs, each pattern's PDF, or its legend line typed. Given a folder, MnemoCode looks through it and the folders inside it: a set found alone is taken and named, and several are listed to choose from. `--output` saves every share's legend line, one per line, and `--qr-dir` a QR code image of each. Decode recognises a share's pattern and sends it to the restore. A share holds 5 bytes more than the phrase, so its pattern needs a few more threads; with too few, MnemoCode asks for another picture or size.

```bash
mnemocode stitch --ask-secrets --picture cat.jpg --threshold 2 --shares 3 \
  --pdf-dir cat-patterns --output legends.txt
mnemocode sskr-combine --share-file cat-patterns/share-1-pattern.pdf \
  --share-file cat-patterns/share-3-pattern.pdf --ask-secrets
```

Treat the legend like an encoded backup: with the dates, or alone where the phrase is not masked, it gives the phrase. Keep the legend page or the legend line. A finished embroidery holds the same counts, but counting thousands of stitches by hand is no practical way back.

<a id="re-encoding-a-backup"></a>

## 2. Re-encode

Read an existing backup, restore the original phrase and make a replacement with another mode, dates, format, cards or shares. The old backup is read as Decode reads it: typed, from a record file or a QR image, from a cross-stitch pattern or the files of printed cards, or found in a folder. MnemoCode asks you to recognize the original words or check them against your wallet before proceeding. A valid checksum alone is not confirmation. The old backup remains usable.

```bash
# Replace the color record from Encode with a new date-masked Unicode record.
mnemocode re-encode --input-file shifted-colors.txt --ask-secrets \
  --mode seedshift --format unicode --output replacement-unicode.txt
mnemocode decode --input-file replacement-unicode.txt --ask-secrets
```

On the private screen, you can also paste Shamir shares in any supported form, separated by `;` or line breaks, or enter a share file path. Mark unreadable codes with `?`. Re-encode uses the same repair as Restore, asks about Seedshift and its old dates, and then confirms the **original** phrase. At least the threshold number of shares is needed; an address or fingerprint cannot replace one.

For scripts, `--old-mode`, `--old-format` and `--old-dates-file` describe the input; the ordinary encoding options describe the replacement. Supply a wallet reference or `--recognised`, and repair incomplete input before re-encoding. [Re-encode options](docs/CLI.md#input-files-and-limits) explain interactive share and date recovery.

## 3. Decode

Read pasted codes, a text file, a QR PNG, the legend of a [cross-stitch pattern](#embroidery) or the files of [printed cards](#cards-and-qr-codes), or give a folder: Decode reads it with the folders inside it and lists every backup and set of shares it finds, with the kind of codes and the files, and you choose one (**Autodetect** in the menu; `--find` narrows the search). A folder is searched up to 6 levels down, its files ending in .pdf, .png, .jpg or .jpeg, at most 1,024; a single file of a share finds the rest of its set in its folder. With Seedshift, enter the original dates to recover the original words. For damaged codes or dates, use the corresponding [recovery option](#6-recovery).

The [Encode examples](#make-a-backup-and-read-it-back) read records back directly; the [card and QR examples](#cards-and-qr-codes) give the mode and format needed for a headerless QR. To read Unicode codes copied into your own text file:

```bash
mnemocode decode --mode seedshift --format unicode \
  --input-file copied-unicode.txt --ask-secrets

# Every backup and set of shares in a folder, listed to choose from.
mnemocode decode --ask-secrets --input-file ./backups

# The cards of a 12-word Seedshift backup in colors, found in a folder, read without questions.
mnemocode decode --input-file ./backups --find cards --words 12 \
  --mode seedshift --format colors --dates-file dates.txt

# Original Seedshift codes with the last word Encode named to remember, kept in a file.
mnemocode decode --mode seedshift-legacy --input-file legacy-words.txt \
  --dates-file dates.txt --last-word-file last-word.txt
```

The private screen also accepts Shamir shares and opens share restoration, keeping all shares you supplied. If marked text could be either a backup or a share, choose which it is, or use `--input-kind codes|share`.

### Saved codes and older records

A file from `encode --output` holds only the codes, as the screen shows them: no mode, format or dates. Keep the mode; when the format cannot be determined unambiguously, give `--format` too. With `--sskr`, an output file holds one share per line. A record saved by an earlier version has the form `MNC1:<mode>:<format>:<data>` and still reads: options that conflict with its header are refused, and on the private screen you can choose to use the header's values.

For Original Seedshift codes that MnemoCode wrote, Decode, Re-encode and Restore from shares ask for the last word Encode named, or read it from `--last-word-file` in scripts. Without it, Decode shows the one or two phrases the codes give, each with its fingerprint. Wrong dates or mistyped codes can still give a wrong phrase; a word outside the BIP39 list is a separate input error.

<a id="splitting-a-mnemonic-into-shares"></a>

## 4. Split into shares

Make standard Shamir shares of the seed phrase, or of its mask where you choose MnemoCode or Original Seedshift first. Choose a threshold and a total count, for example any 2 of 3 shares. The threshold is at least 2 and no greater than the count; at most 16 shares can be made. Keep them in separate places.

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

For the Seedshift restore above, enter `unicode-shares.txt` at the private share prompt, then enter the same dates used for the split. Unicode, word-number and color shares need MnemoCode. Dates and mode are not stored in shares: a Seedshift set needs both to restore the original wallet. Either Seedshift can be used; with the Original Seedshift the restore also asks for the last word Encode named. A PDF or image folder can contain **every share**; separate them before storage. Shares can also be cross-stitch patterns, one per share from the same picture: see [Embroidery](#embroidery).

Use `sskr-export` to print or change the presentation of existing shares without making a new set:

```bash
mnemocode sskr-export --share-file unicode-shares.txt --format unicode \
  --template business-it --page-size a4 --pdf reprinted-shares.pdf --card-qr
```

[SSKR](docs/SSKR.md) explains share formats, card layouts and interoperability.

## 5. Restore from shares

Supply at least the threshold number of distinct shares from the same set. Paste them one per line or separated by `;`, give a text file, the shares' QR PNGs, the files of share cards or patterns, or a folder that holds them: MnemoCode reads it with the folders inside it and takes the shares of one set together. Duplicate copies of one share do not count as extra members.

```bash
# Enter standard shares privately, without Seedshift.
mnemocode sskr-combine --ask-secrets

# Enter shares that were masked before splitting, then the original dates.
mnemocode sskr-combine --mode seedshift --ask-secrets

# Read two share QR images saved by a 2-of-3 split, without date masking.
mnemocode sskr-combine --share-qr first-share.png --share-qr second-share.png
```

If Seedshift was used, select which one and enter its dates; with the Original Seedshift, also the last word Encode named. On the private screen, complete shares show the encoded fingerprint before asking for dates, so you can compare it with the one from the split. A forgotten digit can be marked with `?`; MnemoCode asks for a wallet reference to search the dates. Mark damaged share codes with `?` too; see [Damaged shares](#damaged-shares).

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

Decode accepts `?` for an unreadable code and known prefixes or suffixes where the format supports them. It can check the encoded fingerprint without dates (`--encoded-fingerprint`), check the original wallet after undoing dates, or list a small set (`--list-candidates`). Missing date digits can be searched at the same time. The result includes repaired codes and dates. A cross-stitch legend takes no `?`: type each row as well as you can read it, and Decode corrects one mistyped row.

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

The example fingerprint belongs to a public test wallet; use your original wallet's reference for your own backup. Every date search needs a wallet reference: with MnemoCode Seedshift every wrong date gives a valid phrase; with the Original Seedshift, codes that MnemoCode writes give one or two valid phrases for most wrong dates unless the last word to remember is given, and codes of the original program, whose last word fails the checksum, still pass for one wrong date in 16 to 256. Searches estimated above 12 hours need confirmation, and no date search exceeds 2,147,483,648 attempts. See [date search details](docs/CLI.md#date-search-details).

### Damaged shares

Put `?` where a share element cannot be read. Separated color and Unicode codes also accept missing digits, such as `#B5?0??` or `4E?0`. Bytewords, word numbers and UR pairs accept whole-element marks only.

Restore uses checksums, set metadata and redundancy from extra shares to repair the shares together. Supply every share you have, including damaged copies. More than one surviving phrase is listed; none is selected automatically. A [wallet check](#exact-local-recovery-checks) helps distinguish them. `sskr-export` can return repaired shares without displaying the phrase.

Before searching, MnemoCode estimates the work and asks for confirmation above 12 hours. The maximum is about a trillion combinations. [Share repair patterns](docs/SSKR.md#damaged-shares) explain how keeping readable digits reduces the work.

### Exact local recovery checks

Candidates can be compared offline with an address, compressed public key, master/account extended public key, WIF from a file, or original master fingerprint. A fingerprint is only 32 bits and is a filter, not proof; prefer a known address or public key.

Searches default to account 0, receiving branch 0 and indexes 0–19. An address names its coin, type and network, so there is no coin to choose: where coins share a form, as `1…`, `3…` and `0x…` do, the paths of each are searched, and `--coin` narrows it to one. An xpub, a compressed public key or a WIF is looked for at BIP44, BIP49, BIP84 and BIP86, a ypub or zpub at its own. Keys and `--bitcoin-address` are looked for on mainnet unless `--network testnet` says otherwise. Narrow the location with `--account`, `--branch`, `--index` and `--scan-gap`. [Wallet check examples](docs/CLI.md#wallet-check-examples-and-address-forms) list references, supported coins and options.

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

In the menu, Enter after a lookup asks for another value of the same kind; Escape returns to the main menu. **Export word lists and guide** lets you choose one table or the full set. [Dictionary export options](docs/CLI.md#word-lists-and-manual-recovery) describe individual files. The [manual recovery guide](docs/MANUAL_RECOVERY.md) includes standalone Python helpers, for the phrase and for a cross-stitch legend; combining SSKR shares still requires a compatible implementation.

<a id="self-tests-and-public-vectors"></a>

## 0. Self-test

Run the full installation self-test, including PDF and QR rendering and a cross-stitch pattern read back from its PDF:

```bash
mnemocode self-test
```

Secret operations also run a quicker startup self-test, including SSKR engine checks against published answers. If startup checks fail, the menu offers only Self-test, Help and Quit. These checks cannot replace verifying a download or checking the backup you stored. See [check coverage](docs/CLI.md#installation-checks) and the [public vectors](vectors/mnemocode-v1.json).

## s. Help

Read the command list or the options for a particular task:

```bash
mnemocode --help
mnemocode encode --help
mnemocode sskr-combine --help
```

These are the actual commands, grouped in menu order:

| Command        | Purpose                                                          |
| -------------- | ---------------------------------------------------------------- |
| `encode`       | Write a backup, optionally with date masking or shares           |
| `stitch`       | Write a cross-stitch pattern that holds the phrase in its legend |
| `qr-hide`      | Put an existing record into a QR code with public text           |
| `qr-open`      | Read the record kept in such a QR code                           |
| `re-encode`    | Restore a backup and create its replacement                      |
| `decode`       | Read a backup and recover the phrase                             |
| `sskr-split`   | Make standard Shamir shares                                      |
| `sskr-combine` | Restore from shares                                              |
| `sskr-export`  | Repair or print existing shares                                  |
| `recover-word` | Search missing words                                             |
| `recover-date` | Search missing date digits                                       |
| `preview`      | Render sample card designs                                       |
| `table`        | Look up words or export dictionaries                             |
| `self-test`    | Check the installation                                           |

Damaged backup codes use `decode`; damaged share codes use `sskr-combine` or `sskr-export`. [The command-line reference](docs/CLI.md) covers file limits, detailed options and public examples.

## Quit

Choose Quit, press `q`, or press Escape at the main menu to leave MnemoCode. At a task's question, Shift+Tab goes back to the question before, keeping the answers before it, and Escape returns to the main menu; each question names these keys under it. At the seed phrase of Encode, Embroidery and Split, Shift+Tab goes back to the last question; the folder chosen then stays the folder for the files, because the other folders were closed to writing before the seed phrase was asked. An answer changed after going back replaces the old one. After a result, follow the prompt: it may offer Escape to quit, while a repeated word lookup returns to the menu. Ctrl+C cancels the current operation.

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

The `mnemocode` crate provides transformations, recovery, shares and wallet checks; `mnemocode-cards` draws the printable output, and `mnemocode-embroidery` makes cross-stitch patterns. Browser hosts use the feature-selected `mnemocode-wasm` binding. Hosts supply randomness and drive resumable searches; native file access and terminal questions stay in the CLI. The crates are built from this repository, not published to crates.io. [The library guide](docs/LIBRARY.md) covers examples, ownership and host contracts; [the module inventory](docs/ARCHITECTURE.md#modules-for-other-hosts) maps them to source.

<a id="continuous-integration"></a>

## Source layout and review

See the [architecture](docs/ARCHITECTURE.md), [audit index](docs/audits/README.md) and [release procedure](docs/RELEASING.md). CI checks source, tests and platform input handling; release workflows build and check the executables. The tests cover 81.07% of the source lines of MnemoCode's own crates on Linux x86-64 (2026-11-16, commit `74b03e9`, measured before the last changes of 0.2.0); [test coverage](docs/COVERAGE.md) gives each crate and what the figure leaves out.

## Provenance and license

MnemoCode is an independent Rust implementation, not an official fork of Seedshift or BIP39Colors. Its source is available under either the [MIT license](LICENSE-MIT) or the [Apache License, Version 2.0](LICENSE-APACHE), at your option. [NOTICE](NOTICE) attributes the compatible formats to [Seedshift](https://github.com/mifunetoshiro/Seedshift) (MIT) and [BIP39Colors](https://github.com/EnteroPositivo/bip39colors) (CC BY 4.0). The [third-party notices](THIRD_PARTY_NOTICES.md) list dependencies, word-list origins and card artwork.
