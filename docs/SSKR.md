# Shamir secret sharing (SSKR)

MnemoCode splits a phrase into shares with Shamir secret sharing. You choose how many shares to make (M) and how many of them restore the phrase (N), for example any 2 of 3. Fewer than N shares reveal nothing about the phrase. N is at least 2, and M is at most 16.

With 2 of 3 you can lose one share and still restore the phrase, and a single share is useless to anyone who finds it.

The shares are written in SSKR (Sharded Secret Key Reconstruction), the open format from Blockchain Commons. Other programs that support this format can read them.

A BIP39 passphrase is not part of the phrase and is **not stored** in the shares.

## Creating shares

```bash
node dist/mnemocode.js encode --sskr --ask-secrets \
  --threshold 2 --shares 3 --output ./shares.txt
```

`--threshold` is N and `--shares` is M. Both need `--sskr`. The phrase is entered as in every `encode` command; see [Secret input styles](../README.md#secret-input-styles).

The shares are always shown in the terminal. `--output NEW_FILE` also saves them, one share per line. The file holds **all shares**, and an existing file is never replaced.

| Option                      | Selects                                             |
| --------------------------- | --------------------------------------------------- |
| `--format 1\|2\|3\|5\|6`    | How the phrase is shown, as in an ordinary `encode` |
| `--share-format ur\|colors` | How the shares are shown; the default is `ur`       |

`sskr-split` is an older name for `encode --sskr`. In `sskr-split` and `sskr-export`, `--format ur|colors` selects the share format.

### Date masking before splitting

```bash
node dist/mnemocode.js encode --sskr --mode seedshift --ask-secrets \
  --format 3 --threshold 2 --shares 3 \
  --template business-it --card-layout qr \
  --cards-dir ./property-shares --pdf ./property-shares.pdf
```

With `--mode seedshift`, the phrase is first masked with the dates and then split. Give the same `--mode seedshift` and dates to `sskr-combine` to get the original phrase. The mode and the dates are not stored in the shares and are not printed on share cards: keep them yourself. The legacy Seedshift modes cannot be used with shares.

## Share formats

| Format    | Text                                               |
| --------- | -------------------------------------------------- |
| `ur`      | The standard short form, `ur:sskr/...`             |
| `colors`  | Color codes in a fixed order                       |
| Bytewords | The standard long form in words; for recovery only |

Color codes may be separated by spaces or joined, with or without `#`. **Their order matters.** The colors of `--format 5` are a different format and are not share colors.

The color form is only another way to write a share. It is not encryption. For developers of compatible programs, version 1 is made from the `ur` form in four steps:

1. Turn the Bytewords text of the single-part UR into bytes and keep its four-byte CRC32.
2. Put the version byte `A1` and one byte with the length in front.
3. Add zero bytes until the length can be divided by three.
4. Write every three bytes as one `#RRGGBB` code, in order.

Reading checks the length and the zero bytes, removes the added bytes, checks the CRC32 and the CBOR structure, and builds the standard `ur` form again.

## Share cards

Shares can be printed as cards with every template. `sskr-export` prints existing shares and never makes new ones:

```bash
node dist/mnemocode.js sskr-export --share-file ./shares.txt \
  --cards-dir ./share-cards --card-layout collection --template business-it
```

`encode --sskr` accepts the same options, so one command can make and print the shares. The card options are described in [Cards and QR codes](../README.md#cards-and-qr-codes).

The page size decides what is printed, as for ordinary cards. `--card-layout` is needed only for a QR card.

| `--page-size`          | `--card-layout` | Printed for each share                           | What counts as one share                    |
| ---------------------- | --------------- | ------------------------------------------------ | ------------------------------------------- |
| `a6` (default) or `a4` | `collection`    | One collection sheet; `--card-qr` adds a QR code | All codes on the sheet, or its QR code      |
| `business`             | `individual`    | Numbered cards without a QR code                 | Every card of that share, in numbered order |
| any                    | `qr`            | One document with a QR code                      | The QR code                                 |

A QR code holds the color codes of its own share. No QR code holds several shares.

Each file or folder in `--cards-dir` holds one share: keep them in different places. A file written with `--pdf` and a folder written with `--images-dir` hold **all** shares. Existing files and folders are never replaced.

The reference printed on a share sheet shows the numbers of the set, the group and the share.

## Recovery

`sskr-combine` needs complete shares, not single cards of a share:

```bash
node dist/mnemocode.js sskr-combine --ask-secrets
# Enter complete shares separated by semicolons in the hidden prompt.

node dist/mnemocode.js sskr-combine \
  --share "ur:sskr/FIRST_COMPLETE_SHARE" \
  --share "ur:sskr/SECOND_COMPLETE_SHARE"

node dist/mnemocode.js sskr-combine --share-file ./selected-shares.txt
node dist/mnemocode.js sskr-combine --share-qr ./first.png --share-qr ./second.png
```

`--share`, `--share-file` and `--share-qr` may be repeated and used together. A text file holds one complete share per line. `--share-qr` reads a PNG image; it cannot read a PDF. The format of each share is found automatically, so formats can be mixed. Shares that another program made in several groups are accepted.

MnemoCode refuses a damaged share, the same share given twice, shares from different sets and too few shares. The share library also checks the restored secret against a hash stored in the shares. The 16-bit number of a set only tells sets apart. It does not prove that a share is genuine.

## Test data

`vectors/sskr-v1.json` holds the test shares published by Blockchain Commons in [BCR-2020-011](https://github.com/BlockchainCommons/Research/blob/master/papers/bcr-2020-011-sskr.md): the secret, all eight shares in the `ur` form, five of them, enough to restore the secret, also in Bytewords, the numbers of shares needed, and sets that do and do not restore the secret. The color codes of the first share were calculated separately from the published bytes with Python `zlib.crc32`.

Five more test sets cover phrases of 12, 15, 18, 21 and 24 words. MnemoCode made them itself with fixed public random numbers, so they only show that nothing has changed. They are **not an independent check of the cryptography**. Real shares always use the random numbers of the operating system.

The tests check all 30 smallest sets of the published shares that restore the secret, every pair of each 2-of-3 test set, 16 of 16 shares, and the refused inputs listed above.
