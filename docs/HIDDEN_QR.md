# QR codes with hidden records

A hidden QR carries two UTF-8 texts. Compatible ordinary scanners show the public text, such as a
contact card. They do not return the hidden backup. MnemoCode reads the backup codes stored after
the QR terminator. Some readers reject this nonstandard padding instead of showing the contact. The hidden record is the exact selected representation:
Unicode codes, RGB codes, a share, a complete backup record or a SeedStitch legend. Its spelling,
spaces and line endings are preserved by `qr-hide` and `qr-open`.

This is camouflage, not encryption. Protect the phrase with Seedshift or MHFE before exporting it.
A raw-codeword tool can detect the nonstandard padding, and the public format lets anyone extract
it. Never put masking dates or other private information in the public text. Never upload a real
backup QR to an online decoder.

## Use

The menu asks one question about the QR code: none, an ordinary one or one with hidden data, and
where it goes: on the cards only, on the cards and as a PNG file, or as a PNG file only. Any scanner
shows the backup codes of an ordinary QR code. Of a QR code with hidden data, regular scanners see
only a contact card: the one printed on the cards, or one that MnemoCode invents for a PNG made
without cards. MnemoCode reads the backup hidden in the same code. From the command line,
`--qr-text` gives a separate PNG another visible text. In a PDF, the public text is a vCard built
from the printed name, company, role, email and phone. It has no website field. Its hidden record contains the backup codes without
extra decoy cards. Each SSKR share keeps its own record and QR; shares are never combined here.

The card's `Details` choice controls the PDF's public contact: random details create a fictitious
contact; entered details use the supplied fields.

From the command line:

```sh
mnemocode encode --mode direct --mnemonic-file public-test-phrase.txt --format unicode \
  --qr public-test.png --qr-hidden --qr-text 'Material samples'
mnemocode encode --mode seedshift --mnemonic-file public-test-phrase.txt --dates-file public-dates.txt \
  --format colors --pdf public-cards.pdf --card-qr --qr-hidden
mnemocode qr-hide --input-file protected-record.txt --qr record.png --qr-text 'Design study'
mnemocode qr-open --qr-file record.png --output recovered-record.txt
```

`qr-hide` accepts up to 4096 UTF-8 bytes from a file; both texts must actually fit together in one
QR at correction level M, otherwise it refuses to save. More text requires a larger QR. PDF layout
checks use its real size and refuse a page where it cannot fit. `--qr-text` applies to a separate
PNG; PDF exports use the contact printed on their cards. A standalone PNG without `--qr-text` uses
a generic contact. `--qr-hidden` also works with share QR directories.

Decode, Re-encode and share recovery extract a hidden record automatically, from a QR image given to them or found in a folder.
Choose the same representation and masking mode as for the original codes. `qr-open` extracts any
supported UTF-8 record without interpreting it; its output file contains that record without encryption.
A SeedStitch record preserves the legend for phrase recovery, not the pattern picture.

Print the original QR at actual size. Rebuilding a QR from its visible contact or text discards the
hidden bytes. These QRs use nonstandard padding: rqrr and a local ZXing-family decoder were tested,
but acceptance by every scanner is not guaranteed. Physical print durability has not been measured.

## Capacity and SeedStitch legends

Both visible and hidden UTF-8 bytes consume the same QR budget. At the largest supported version,
40 with correction level M, the encoder has 2334 data bytes. Its visible byte-segment header and
terminator take three bytes, and the hidden envelope takes seven. The combined visible and hidden
texts can therefore use at most **2324 bytes**. Smaller versions have smaller budgets. A file being
below the 4096-byte import limit does not imply that it fits with its visible contact.

The capacity check used a public 24-word fixture serialized independently in both SeedStitch
legend formats, including DMC identifiers and row order where supported. The table gives serialized legend sizes without a trailing file newline;
`qr-hide` preserves that newline if present. Both the ordinary contact and the exact hidden legend
were recovered from each PNG, and the recovered legend restored the expected entropy.

| Legend rows | Legend format | Hidden UTF-8 bytes | QR modules with a 131-byte contact | QR modules with a 568-byte contact |
| ----------: | ------------: | -----------------: | ---------------------------------: | ---------------------------------: |
|          40 |             1 |                313 |                              85×85 |                            113×113 |
|          40 |             2 |                438 |                              93×93 |                            121×121 |
|          60 |             1 |                473 |                              93×93 |                            121×121 |
|          60 |             2 |                678 |                            109×109 |                            133×133 |
|          70 |             1 |                553 |                            101×101 |                            129×129 |
|          70 |             2 |                798 |                            117×117 |                            141×141 |

Thus the checked 40-row legend and extended contact need 1006 text bytes together. All twelve cases
fit; an oversized 2400-byte visible text was refused. These measurements describe the fixtures,
not a universal size for every possible legend or arbitrary contact. Independently of these
fixtures, the legend serializer reserves at most 17 bytes per row: 680 bytes for 40 rows and
1190 bytes for the parser's maximum of 70 rows. Both bounds fit alongside the checked 568-byte
contact within the 2324-byte budget; an optional trailing newline adds one byte. The writer chooses an initial
thread target between 12 and 40 from the pattern size, then searches up to 60; the legend parser
supports up to 70 rows. A 568-byte contact
was a QR-capacity stress case, not a promise that its long fields fit as printed card text.

To make a QR from an existing legend, use `qr-hide --input-file legend.txt --qr legend-qr.png`.
`stitch --qr legend.png --qr-hidden` saves one as it makes the pattern. The hidden legend
contains the recovery instructions, not an embedded copy of the pattern image.

## Size, layout and reading a printed QR

The separate PNG export targets a 720×720-pixel canvas. That pixel count does not determine the
printed QR's physical size. PDF cards use the actual matrix at 0.3 mm per module, with a four-module
quiet border. For example, a 93×93 matrix occupies 30.3 mm including that border. More content can
therefore require more space on the card even when separate PNG exports have the same pixel size.

Layout checks covered 468 combinations of 13 sheet designs, three page sizes, both orientations,
three representations and ordinary/hidden QR. The minimum measured distance from the QR's white
plate to visible artwork was 6 mm. A focused regression covers a hidden QR beside the heading on
A6 portrait Colors sheets. These checks use public fixtures; exceptionally long supplied text can
still be refused when it cannot fit legibly.

A further 26 public A6 Colors PDFs, one per design and orientation with hidden QR, were rendered at
300 DPI. An independent ordinary decoder recovered the expected contact, and MnemoCode recovered
the exact hidden record from every rendered QR. This checks composed PDF output, not just a QR
matrix in isolation. It does not establish physical print durability or compatibility with every
phone scanner. Preserve the quiet border, avoid resampling artifacts and keep the original QR
rather than regenerating it from the contact.

## Format 1

QR Model 2, level M. The public part is one byte-mode segment: mode `0100`, an 8-bit count for
versions 1–9 or a 16-bit count for 10–40, followed by UTF-8 bytes and the four-bit terminator
`0000`. This puts the next item on a byte boundary.

The hidden envelope starts immediately after that terminator:

| Field  | Bytes  | Meaning                                                                 |
| ------ | ------ | ----------------------------------------------------------------------- |
| Format | 1      | `01`                                                                    |
| Length | 2      | Big-endian UTF-8 byte length, nonzero                                   |
| Record | Length | Exact UTF-8 backup or share record                                      |
| Check  | 4      | First four bytes of SHA-256 of the domain and preceding envelope fields |

The check domain is the ASCII bytes `MnemoCode QR hidden record 1`, without a separator or NUL.
The envelope, including its check, is XORed with a public stream. Chunk `i` of that stream is:

```text
SHA-256(ASCII("MnemoCode QR hidden record 1 pattern") || version:u8 || i:u32-big-endian)
```

Counter `i` starts at zero. Truncate the last chunk to the envelope length. Fill the remaining data
codewords with alternating `EC 11`, beginning with `EC`. The QR encoder calculates standard block
parity, interleaving, masking and format information over all data, including the envelope.
The check detects reading errors; it neither authenticates the record nor verifies a password.

A reader obtains the QR version and mask, excludes its function modules, reads the zigzag data
modules and removes the QR mask. Deinterleave the level-M blocks and correct their Reed–Solomon
errors over GF(256), primitive polynomial `0x11D`, generator roots alpha^0 through alpha^(parity−1).
Concatenate the corrected data parts. Parse the public byte segment and terminator, undo the public
XOR stream, check the version, length, UTF-8 and SHA-256 check. The standalone `qr-open` command and
host-neutral `qr::hidden` library implement this procedure.

The startup format vector was computed independently with Python hashlib. Correction tests compare
all 40 QR versions with qrcodegen's encoder, including the exact per-block correction limit.

## Library and browser

Rust: `mnemocode::qr::hidden::{matrix, png, png_behind, read_png}`; `png_behind` draws a record behind a
contact, or as an ordinary QR code where none is given. Matrix and image exports verify both layers
before returning them. `qr::read_png` deliberately keeps its ordinary-scanner behavior.

Browser bindings: `hiddenQrPng(visible, record)`, `readHiddenQrPng(bytes)`,
`CardExport.setHiddenQr(enabled)` and `CardExport.hiddenQrPng(record)`, a PNG of a record behind
the contact the export's cards print; `CardPlan.qrPng()` and `ShareCards.qrPng(at)` give a sheet's
QR code as printed, hidden or ordinary. With hidden mode selected, call `readHiddenQrPng` to obtain the
record; do not reconstruct the image from `readQrPng`, which returns only its public text.
