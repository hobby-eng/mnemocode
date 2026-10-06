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

The shares are always shown in the terminal. `--output NEW_FILE` also saves them, one share per line. The file holds **all shares**. An existing file is never replaced: when the name is taken, the shares are saved under a numbered name such as `shares (1).txt`, and MnemoCode says so.

| Option                   | Selects                                                                                  |
| ------------------------ | ---------------------------------------------------------------------------------------- |
| `--share-format FORMAT`  | How the shares are shown and saved (see [Share formats](#share-formats)); default `ur`   |
| `--format 1\|2\|3\|4\|5` | Also shows the whole phrase beside the shares, in that form; without it, only the shares |

`sskr-split` is an older name for `encode --sskr`. In `sskr-split` and `sskr-export`, `--format` selects the share format. A text file saved with `--output` holds the shares in that format, one per line.

### Date masking before splitting

```bash
node dist/mnemocode.js encode --sskr --mode seedshift --ask-secrets \
  --format 3 --threshold 2 --shares 3 \
  --template business-it --card-layout qr \
  --cards-dir ./property-shares --pdf ./property-shares.pdf
```

With `--mode seedshift`, the phrase is first masked with the dates and then split. Give the same `--mode seedshift` and dates to `sskr-combine` to get the original phrase. The mode and the dates are not stored in the shares and are not printed on share cards: keep them yourself. The legacy Seedshift modes cannot be used with shares.

## Share formats

| Format           | Text                                                     | Read by            |
| ---------------- | -------------------------------------------------------- | ------------------ |
| `ur`             | The standard short form, `ur:sskr/...`                   | every SSKR program |
| `words`          | Bytewords, the standard long form in words               | every SSKR program |
| `indexes`        | BIP39 word numbers from 1 to 2048, like `--format 2`     | MnemoCode          |
| `unicode`        | Unicode codes of BIP39 words, like `--format 3`          | MnemoCode          |
| `colors`         | Color codes in a fixed order, like `--format 5`          | MnemoCode          |
| `colors-unicode` | The same color codes as Unicode codes, like `--format 4` | MnemoCode          |

The last four write a share with the same signs as the form of an encoded phrase, so that shares look like the form chosen in Encode, and `sskr-combine` shows the restored backup in that form again. They are only other ways to write the same share, not encryption, and other SSKR programs do not read them.

Color codes may be separated by spaces or joined, with or without `#`. **Their order matters.** A share in colors has its own colors: they are not the colors of the phrase itself.

The forms in colors, word numbers and Unicode codes are only other ways to write a share, not encryption. For developers of compatible programs, a share is written in colors in five steps:

1. Turn the Bytewords text of the single-part UR into bytes. The last four bytes are its CRC32 checksum; the bytes before them are the CBOR.
2. Write the checksum first. After it come the version byte `A1`, one byte with the length of the CBOR, and the CBOR.
3. Mix every byte after the checksum: XOR byte number `i` (counting from 0 at the version byte) with the low byte of the CRC32 of the four checksum bytes followed by `i` as two bytes, high byte first.
4. Add zero bytes until the length can be divided by three.
5. Write every three bytes as one `#RRGGBB` code, in order.

The mixing removes the constant prefix of the unmodified representation. Checksums and first codes can still coincide; distinct starts are not guaranteed. This is only a change of appearance, not concealment from someone who knows the format: anyone can undo the mixing and check whether the text is a share. Reading takes the checksum from the front, undoes the mixing, checks the version, the length and the zero bytes, and builds the standard `ur` form again, whose CRC32 and CBOR structure are then checked.

Word numbers and Unicode codes are made the same way with the version byte `A2`, but the bytes are cut into pieces of 11 bits instead of 3 bytes, the last piece filled with zero bits, and each piece is written as the word number (1 to 2048) or the Unicode code of that BIP39 word, as `--format 2` and `--format 3` write a phrase. `colors-unicode` writes the colors of a share as `--format 4` writes the colors of a phrase. Because every form carries a version, a length and a checksum, a share is read in whatever form it is written.

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

A QR code holds one share. For `indexes`, `unicode` and `colors-unicode`, it holds that representation; for the other formats, it holds the share's color codes. No QR code holds several shares.

Each file or folder in `--cards-dir` holds one share: keep them in different places. A file written with `--pdf` and a folder written with `--images-dir` hold **all** shares. Existing files and folders are never replaced; a taken name is numbered as `name (1)`.

The reference printed on a share sheet shows the numbers of the set, the group and the share.

## Recovery

`sskr-combine` needs complete shares, not single cards of a share:

```bash
node dist/mnemocode.js sskr-combine --ask-secrets
# Type the shares, separated by semicolons, on the private screen.

node dist/mnemocode.js sskr-combine \
  --share "ur:sskr/FIRST_COMPLETE_SHARE" \
  --share "ur:sskr/SECOND_COMPLETE_SHARE"

node dist/mnemocode.js sskr-combine --share-file ./selected-shares.txt
node dist/mnemocode.js sskr-combine --share-qr ./first.png --share-qr ./second.png
```

`--share`, `--share-file` and `--share-qr` may be repeated and used together. A text file holds one complete share per line. `--share-qr` reads a PNG image; it cannot read a PDF. The format of each share is found automatically, so formats can be mixed. Shares that another program made in several groups are accepted.

The restored backup is shown in the form of the first share: word numbers, Unicode codes or colors for shares written that way, words for shares in Bytewords or `ur`. With `--mode seedshift` and the dates, the seed phrase follows.

MnemoCode refuses a damaged share, the same share given twice, shares from different sets and too few shares. The share library also checks the restored secret against a hash stored in the shares. The 16-bit number of a set only tells sets apart. It does not prove that a share is genuine.

Every supplied member of a complete group is checked for consistency, including members and groups beyond the recovery threshold. Members of an incomplete group cannot be checked against its polynomial: the CLI names them as not checked. The written-backup check warns instead of reporting that the whole backup was checked.

For library callers, `combineSskrShares` returns a phrase only when no supplied shares or repaired elements remain unchecked. `combineSskrShareSet` returns the phrase together with `unchecked` (share numbers counted from 1) and `unsettled` repair elements; callers using this partial-recovery API must report those limits. Both functions, and `restoreShareSet` for complete input, are exported from `mnemocode/sskr`.

### Damaged shares

Replace each unreadable element of a share with `?`, keeping its place: a word number, a four-digit Unicode code, a color code, a color Unicode code or pair, a Bytewords word, or a two-letter pair inside `ur:sskr/...`. `sskr-combine`, `sskr-export` and the backup check fill them in. Spaces are needed around a missing word or number; fixed-width codes and UR pairs may stay joined. Do not remove the element, and do not mark each of its digits. Any of the shares may have marks, up to 64 on one share, and a share may be given twice when two damaged copies of it are kept.

All the shares are repaired together, as one system of linear equations over GF(2) in the bits of the marked elements (`src/sskr/joint-repair.ts`):

- every share has a CRC32 checksum, a version and a length, and the zero filling after it, which stay linear through the mixing;
- all shares of a set carry the same identifier and thresholds, and each has its member number;
- every share beyond the threshold lies on the polynomial of the others: each of its bytes is a fixed GF(256) combination of theirs, and multiplying by a fixed constant is linear over GF(2).

Elimination solves this without trying any value. What it leaves open is decided by the 32-bit digest that the SSKR library keeps with the secret: each combination is checked with HMAC-SHA256 in Gray code order, about 2.5 to 4.5 µs a try depending on the computer, and every one that passes is read as ordinary shares and restored by the SSKR library itself, which checks everything once more. Before the search, MnemoCode shows how many combinations are open, how long they take, which marked elements would close the most if read again, and how many more shares would likely settle the rest. A search expected to take up to a minute starts at once, about 2^24 combinations; a longer one needs `--max-tries` or a yes on the private screen, up to 2^40 combinations in all, about a month. Only sets of one group are repaired, which is all that MnemoCode writes.

These are the marks that each share of a 2-of-3 set may have, at random places in the secret part of each share, in at least 18 of 20 tries; marks in the identifier and the thresholds cost less, since the other shares carry the same. The search columns assume about 2.5 µs a try:

| Phrase   | Shares given | Form                           | Settled at once | Within a minute | Longer search |
| -------- | ------------ | ------------------------------ | --------------- | --------------- | ------------- |
| 12 words | 2            | Word numbers and Unicode codes | 2               | 4               | 4             |
| 12 words | 2            | Colors                         | 1               | 1               | 2             |
| 12 words | 2            | Bytewords and `ur`             | 3               | 5               | 6             |
| 12 words | 3            | Word numbers and Unicode codes | 4               | 6               | 6             |
| 12 words | 3            | Colors                         | 1               | 2               | 3             |
| 12 words | 3            | Bytewords and `ur`             | 6               | 8               | 9             |
| 24 words | 2            | Word numbers and Unicode codes | 2               | 4               | 4             |
| 24 words | 3            | Word numbers and Unicode codes | 5               | 8               | 9             |
| 24 words | 3            | Colors                         | 2               | 3               | 3             |
| 24 words | 3            | Bytewords and `ur`             | 8               | 11              | 12            |

Marks at the same places on every share are the worst case: three shares then settle about as many as two.

With only as many shares as the threshold, each checksum settles 32 bits of its own share and the digest the rest. Each share beyond the threshold adds as many equations as the secret has bits, 128 for 12 words and 256 for 24. A share that cannot be read at all is rebuilt from the others, except for its member number, which is then reported as a guess.

Every phrase that passes is listed with its fingerprint, and none is chosen. Each combination tried passes by chance with a probability of 2^-32, so a search of 2^32 combinations is expected to let about one wrong phrase through; the assessment says so when the expected number is not small. A wallet check (`--master-fingerprint`, `--bitcoin-address` and the other recovery checks) keeps only the matching phrase. `--candidates-file` saves the phrases as an encrypted [candidate list](CANDIDATES.md) for the Discovery Scanner of the multi-chain wallet tools. A `?` at a wrong place, or a misread element without `?`, usually leaves no solution, and the shares are refused; unmarked errors are never corrected.

After a repair, MnemoCode names each filled-in element, by share and place, so that the written copy can be corrected. A repair proves that the shares fit their checks and the secret digest; it does not prove that the wallet is the intended one, so check the wallet that comes back.

To write repaired shares down again without seeing the seed phrase, use entry 5 of the menu, or `mnemocode sskr-export --ask-secrets`, and enter the shares with their marks; each comes back in its own form, unless `--format` names another. With the threshold of shares, they are repaired together, and when more than one set of shares fits, each is shown with the fingerprint of the phrase it holds and none is saved; a wallet check keeps the right one. With fewer shares, each is repaired from its own checks alone: up to two word numbers or Unicode codes, one color, or three Bytewords or UR pairs (often four) on a share are repaired outright, and when several shares fit, each is shown and none is saved. A share that nothing settles, such as one that could not be read at all, is left out instead of being written down as a guess.

On paper, one share may span several lines. For `--share-file`, join those lines first: the file reader treats every non-empty line as a separate full share. Word numbers need separators; four-digit Unicode codes and six-digit RGB codes can be joined without spaces.

## Test data

`vectors/sskr-v1.json` holds the test shares published by Blockchain Commons in [BCR-2020-011](https://github.com/BlockchainCommons/Research/blob/master/papers/bcr-2020-011-sskr.md): the secret, all eight shares in the `ur` form, five of them, enough to restore the secret, also in Bytewords, the numbers of shares needed, and sets that do and do not restore the secret. The color codes of the first share were calculated separately from the published bytes with Python `zlib.crc32`.

Five more test sets cover phrases of 12, 15, 18, 21 and 24 words. MnemoCode made them itself with fixed public random numbers, so they only show that nothing has changed. They are **not an independent check of the cryptography**. Real shares always use the random numbers of the operating system.

The tests check all 30 smallest sets of the published shares that restore the secret, every pair of each 2-of-3 test set, 16 of 16 shares, and the refused inputs listed above.
