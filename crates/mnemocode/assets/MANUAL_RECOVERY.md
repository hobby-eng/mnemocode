# MnemoCode: recovery without MnemoCode

This guide explains how to recover a BIP39 seed phrase when MnemoCode is missing
or no longer runs. It also explains how to apply the same date masking yourself.
It needs no MnemoCode installation or internet connection. Arithmetic can be done
on paper or with an offline calculator. MnemoCode Seedshift also needs SHA-256 to
calculate the final BIP39 checksum; the optional Python helper below does this
using only Python's standard library.

## Prepare a recovery pack now

Choose **Full set** in the export options of MnemoCode's word lookup menu to save
all dictionaries and this guide in one folder. Print the **Full mapping**. It has
all 2,048 English words, their Traditional Chinese counterparts, Unicode codes
and word numbers. Keep this guide with it. The two lists are matched by position,
not by translation. Do not substitute the Simplified Chinese list or change the
order of either dictionary.

Keep a separate record of the mode used: `direct`, `seedshift`,
`seedshift-legacy` or `seedshift-legacy-valid`. Record the exact dates where the
intended owner can recover them; do not put them beside a disguised backup if
that would defeat its purpose. Keep the BIP39 passphrase too, if the wallet uses
one: dates and the BIP39 passphrase are different things.

A text record may start with `MNC1:MODE:FORMAT:`. The text after the third colon
is its payload. A plain list of codes or a share does not necessarily record the
mode or the dates. A valid checksum cannot tell you which dates were used.

For a backup on printed cards, keep the sheet for heirs, or a note of how many
words the seed phrase has, with the cards: that number tells where the backup ends
(see "Printed cards" below).

## Printed cards

Cards printed by MnemoCode end with codes that belong to nothing: exactly one on
separate cards, and on a sheet at least one, then as many as fill all its rows,
which can be a whole row of them.
They are not marked, and a color among them repeats the order tag of a real
color. The backup is the first cards by their printed card number: one card per
word for Word Unicode, and one per color for colors and Color Unicode, 8, 10, 12,
14 or 16 of them for a 12-, 15-, 18-, 21- or 24-word phrase. The sheet for heirs,
or the number of words you recorded, tells how many. Set aside every card after
them before any step below. Cards of a Shamir share end the same way, and the
sheet for heirs tells how many codes each share has.

## 1. Obtain the stored word numbers

The dictionary printed by MnemoCode numbers words **1 through 2048**. Mathematical
BIP39 indexes run **0 through 2047**. Always subtract 1 before the formulas below
and add 1 before looking a result up in the printed dictionary.

- English words: look up each word's number. Keep the word order.
- Traditional Chinese characters: look up each character's number in the full
  mapping. These are dictionary positions, not translations of the English words.
- Word Unicode: split the text into four hexadecimal digits per code, such as
  `7684`, and find each code in the mapping. Keep their order. On printed cards,
  keep only the first codes, one per word (see "Printed cards").
- Word numbers: use the decimal numbers directly; leading zeros change nothing.

The example `abandon` / `的` / `7684` has printed number 1 and mathematical index 0. The last word `zoo` / `歇` / `6B47` has printed number 2048 and index 2047.

### RGB colors

Use the printed hexadecimal codes, not the apparent colors of aged paper.
These instructions describe colors of a **complete phrase**, not SSKR share colors.

1. There must be 8, 10, 12, 14 or 16 colors for a 12-, 15-, 18-, 21- or 24-word
   phrase respectively. On printed cards, keep the first ones by printed card
   number and set aside the cards after them (see "Printed cards"); do not guess
   which other codes to discard.
2. Convert each six-digit `RRGGBB` hexadecimal code to a decimal integer. Write
   that integer with exactly eight decimal digits, adding leading zeros.
3. The first two decimal digits are an order tag; the remaining six are payload.
   Sort by tag. For 8 colors, consecutive tags differ by 2; for all other supported
   counts, they differ by 1. New records begin with tag 0. Older accepted records
   can have a common offset, but the spacing must still be correct. Among the
   colors kept, a duplicate or missing tag means the set is incomplete or wrong.
4. Join the six-digit payloads, preserving their leading zeros. Split the joined
   decimal string into four-digit groups. Each group is one printed word number
   from 0001 through 2048. Reject 0000 or a number above 2048.

For example, `#000064` is decimal 100, written `00000100`: tag `00`, payload
`000100`. The next color `#1EAB91` is decimal 2010001, written `02010001`: tag
`02`, payload `010001`. Their joined payload `000100010001` gives numbers 1, 1, 1.

### Color Unicode

Color Unicode is different from Word Unicode. It stores each RGB color in two
Private Use code points. Split hexadecimal text into four-digit code points,
and take them in pairs. Older copies may show the actual Private Use characters;
read their numeric Unicode code points instead. Cards in Color Unicode print
each color as its six hexadecimal RGB digits: for those, use the RGB procedure
above directly.

For a pair with hexadecimal values `H` and `L`, convert to decimal and calculate:

    color = (H - 57344) * 6400 + (L - 57344)

Here 57344 is hexadecimal E000, and 6400 is hexadecimal 1900. Both code points
must be from E000 through F8FF. The result must be from 0 through 16777215.
Convert it to six hexadecimal digits and use the RGB procedure above. For
example, `E000 E064` gives color 100, or `#000064`.

### Shamir shares

SSKR shares must be combined to obtain the stored phrase **before** reversing
its date shifts. Share codes are not phrase word numbers; do not apply the
formulas below to individual shares. A 2-of-3 set accepts any two distinct
members of that set, including members 1 and 3. Grouped sets must meet their
recorded group and member thresholds. Two copies of the same member are one share.

Combining shares needs a compatible, offline SSKR implementation. This guide is
not a paper implementation of SSKR, its transport checksums or its repair search.
If software independence is required, retain the published SSKR format and an
independently tested implementation as part of the recovery pack. Keep the mode
and dates separately: shares do not store them. The combined phrase may be the
masked phrase, and must then go through the remaining steps of this guide.

### Cross-stitch pattern (SeedStitch)

A pattern made by MnemoCode keeps the phrase in its legend, the floss key: in the
symbol of each row and in the last digits of its stitch count. Read the rows from
the top of the key down and write each as its symbol's number from the table
below, a colon and its stitches: `28:1725 25:2163 57:3275 …`. A small pattern
also uses the order of the rows: there MnemoCode's line names each row's DMC
thread too, `15:407:38 23:703:169 …`; type every row that way, the DMC number from
the key between. MnemoCode's result screen and its `--output` file give this line
already, and the pattern's PDF keeps it, compressed where no viewer shows it: the
helper of section 7 reads it from the PDF.

| Numbers | Symbols                                  |
| ------- | ---------------------------------------- |
| 1–10    | `■` `□` `▣` `⊞` `⊠` `◧` `◩` `▤` `▦` `●`  |
| 11–20   | `○` `⊙` `⊕` `⊗` `◐` `▲` `△` `▼` `◆` `◇`  |
| 21–30   | `◈` `◢` `◤` `+` `×` `★` `✱` `♥` `♡` `♠`  |
| 31–40   | `♣` `↑` `→` `↔` `\|` `—` `/` `\` `⬢` `⬡` |
| 41–50   | `A` `B` `C` `D` `E` `F` `G` `H` `J` `K`  |
| 51–60   | `L` `M` `N` `P` `R` `S` `T` `U` `V` `W`  |
| 61–70   | `Y` `Z` `3` `4` `7` `9` `a` `e` `h` `r`  |

Turning the line into word numbers takes arithmetic on numbers of about 90 digits
and SHA-256, so use the helper `manual_seedstitch.py` of section 7 on a trusted
offline computer. It prints the word numbers and says whether the phrase is
masked. A masked phrase is then reversed with its dates as mode `seedshift`
(sections 2 to 4, or `manual_seedshift.py`); an unmasked one is the phrase itself.
If the line does not read, a row was misread: check each symbol and count against
the key. MnemoCode itself corrects one misread row.

The legend of the format's own example, a public test phrase masked with
Seedshift, is

```text
28:1725 25:2163 57:3275 34:3917 9:480 54:1505 17:5063 63:372 46:328 7:2818 62:1114 53:1997
37:2496 40:1945 3:882 58:7130 41:180 59:336 22:1634 36:778 64:1147 10:3804 24:1214 69:479
56:931 30:2066 23:3224 29:797
```

and reads as the word numbers `1965 369 566 1734 263 1750 1979 852 1589 1366 357
425 1242 63 1549 1290 824 1667 1339 1784 639 1635 946 1898`, "void come effort …
involve unfold", marked as masked with Seedshift. The example was written for the
format, so no dates belong to it: it shows the reading only.

## 2. Build the date-shift sequence

Skip this step for `direct` mode: look up the stored numbers to get the original
phrase. Direct mode uses no dates.

1. Write every date as DD-MM-YYYY, with a four-digit year. Dates must be real
   Gregorian calendar dates, with years from 0001 through 9999.
2. Sort the complete dates from earliest to latest: compare year, then month,
   then day. Preserve repeated dates if they were entered more than once.
3. For each sorted date, write its **year, month, day**, in that order. Do not
   concatenate their digits into one integer and do not add the date parts.
4. Join those triples and repeat the entire resulting sequence until it supplies
   one shift for every word. Stop at the phrase's length.

Use all the original dates. Supported phrases have 12, 15, 18, 21 or 24 words,
and accept at most 4, 5, 6, 7 or 8 dates respectively. At least one date is
required in a Seedshift mode. With two dates, repeat all six parts in their
sorted order, not just the first triple.

Public example: date 23-09-2026 gives shifts

    2026, 9, 23, 2026, 9, 23, 2026, 9, 23, 2026, 9, 23

for 12 words. Years above 2048 are allowed; reduce a shift by the applicable
modulus when doing the arithmetic.

## 3. Understand modular arithmetic

`a mod m` means the remainder from 0 through m-1. Add or subtract multiples of
m until the value is in that range. Some calculators show a negative remainder;
if so, add m. A general formula is `((a % m) + m) % m`.

For a printed word number p and shift s, ordinary word shifting is:

    encode: q = ((p - 1 + s) mod 2048) + 1
    decode: p = ((q - 1 - s) mod 2048) + 1

For example, number 1 shifted by 2026 becomes 2027. Recovering number 10 with
shift 9 gives 1. Wraparound example: number 2048 shifted by 2 becomes 2;
decoding number 2 with shift 2 gives 2048.

The next sections say which words use that formula. **The last word in
MnemoCode Seedshift does not use modulus 2048.**

## 4. MnemoCode Seedshift: mode `seedshift`

Use the ordinary formula for the first n-1 words, where n is the word count.
The last word contains both entropy and a checksum. Handle it separately:

| Words n | Entropy bits | Checksum bits c | Last entropy bits r | Tail modulus M |
| ------- | ------------ | --------------- | ------------------- | -------------- |
| 12      | 128          | 4               | 7                   | 128            |
| 15      | 160          | 5               | 6                   | 64             |
| 18      | 192          | 6               | 5                   | 32             |
| 21      | 224          | 7               | 4                   | 16             |
| 24      | 256          | 8               | 3                   | 8              |

### Recover the original phrase

1. For the last stored number q, set j = q - 1.
2. Divide j by 2^c and discard the remainder: u = floor(j / 2^c). This removes
   the stored checksum bits. They belong to the masked phrase, not the wallet.
3. Recover the entropy tail: t = (u - s_last) mod M.
4. Take the recovered indexes of the first n-1 words, each written as exactly
   11 binary digits, most significant bit first. Append t as exactly r binary
   digits. Keep leading zeros. This is the complete original entropy.
5. Split that bit string into 8-bit bytes from left to right and calculate
   SHA-256 of those raw bytes. Do not hash a decimal string, a hex string or the
   written 0/1 characters. Take the first c bits of the digest as integer C.
6. The original last index is j_original = t * 2^c + C. Add 1 and look it up in
   the English dictionary. Together with the first n-1 recovered words, it is
   the original phrase.

### Apply the same masking yourself

Start from a valid original phrase. Shift its first n-1 indexes by addition
modulo 2048. From its last index remove c checksum bits, then set
u = (t + s_last) mod M. Assemble the masked entropy from the shifted indexes
and u. Hash those entropy bytes, take their first c checksum bits C_masked,
and set the masked last index to u * 2^c + C_masked. Add 1 to print it.

### Worked 12-word example: public test data

The original is eleven `abandon` words followed by `about`:

    original numbers: 1 1 1 1 1 1 1 1 1 1 1 4
    date:             23-09-2026
    masked numbers:  2027 10 24 2027 10 24 2027 10 24 2027 10 377

The masked words are `wool abuse actual wool abuse actual wool abuse actual
wool abuse congress`.

For the first eleven positions, subtract the repeating shifts modulo 2048:
2027 - 1 - 2026 = 0, 10 - 1 - 9 = 0 and 24 - 1 - 23 = 0, and so on.
All eleven recovered indexes are 0.

For the final position, j = 377 - 1 = 376; floor(376 / 16) = 23.
Recover t = (23 - 23) mod 128 = 0. Eleven zero 11-bit blocks and a zero 7-bit
tail give 128 zero bits, or sixteen zero bytes. Their SHA-256 is

    374708fff7719dd5979ec875d56cd2286f6d3cf7ec317a3b25632aab28ec37bb

Its first four bits are 0011, so C = 3. The last index is 0 * 16 + 3 = 3;
the printed number is 4, which is `about`. Subtracting 23 from the whole last
index modulo 2048 would instead give the wrong answer.

## 5. Original Seedshift: mode `seedshift-legacy`

Use the ordinary modulus-2048 formula on **every** word, including the last.
Add each shift to encode; subtract it to decode. Do not recompute or replace
the stored last word. The shifted phrase may fail the BIP39 checksum and still
be a correct legacy backup. A correctly recovered original must pass it.

Using the same public example, the legacy result ends in printed number 27,
because ((4 - 1 + 23) mod 2048) + 1 = 27. MnemoCode Seedshift instead ends in 377. These two modes are not interchangeable.

## 6. Replaced legacy last word: mode `seedshift-legacy-valid`

This historical mode replaced the last word of a legacy result to make its
checksum valid. Information was lost. Subtract shifts modulo 2048 from the
first n-1 words; the stored last word cannot uniquely recover the original.

List every last word that completes those recovered first words with a valid
BIP39 checksum. There are 128, 64, 32, 16 or 8 possibilities for 12, 15, 18,
21 or 24 words. An offline BIP39 implementation can enumerate them, or enumerate
all possible entropy tails and calculate the checksums as in section 4.
Do not choose one merely because its checksum is valid. Compare candidates
against a known wallet address, public key or other independently saved evidence.

## 7. Optional standalone Python helper

Save the following code as `manual_seedshift.py` and run it with Python 3 on a
trusted offline computer. It imports no MnemoCode code, uses no packages and
reads or writes no files. It takes word **numbers**, and prints word numbers;
use the printed dictionary to convert between words and numbers. Its output
contains recovery material, so clear it when finished.

The helper supports `direct`, `seedshift` and exact `seedshift-legacy`.
It does not combine shares, read color codes, search dates or resolve the lost
last word of `seedshift-legacy-valid`; use the preceding sections first.

```python
import datetime
import hashlib


def entropy_and_checksum(indexes):
    count = len(indexes)
    checksum_bits = count // 3
    bits = "".join(f"{index:011b}" for index in indexes)
    entropy = int(bits[:-checksum_bits], 2).to_bytes(count * 4 // 3, "big")
    checksum = hashlib.sha256(entropy).digest()[0] >> (8 - checksum_bits)
    return entropy, int(bits[-checksum_bits:], 2) == checksum


mode = input("Mode (direct, seedshift, seedshift-legacy): ").strip()
operation = input("Operation (encode or decode): ").strip()
date_text = input("Dates DD-MM-YYYY, separated by commas; blank for direct: ").strip()
numbers = [int(part) for part in input("Word numbers 1..2048, separated by spaces: ").split()]
if mode not in ("direct", "seedshift", "seedshift-legacy"):
    raise ValueError("Unknown mode; legacy-valid needs candidate recovery.")
if operation not in ("encode", "decode"):
    raise ValueError("Choose encode or decode.")
n = len(numbers)
if n not in (12, 15, 18, 21, 24) or any(not 1 <= value <= 2048 for value in numbers):
    raise ValueError("Give 12, 15, 18, 21 or 24 word numbers from 1 through 2048.")
dates = sorted(datetime.datetime.strptime(value.strip(), "%d-%m-%Y").date()
               for value in date_text.split(",")) if date_text else []
if (mode == "direct" and dates) or (mode != "direct" and not 1 <= len(dates) <= n // 3):
    raise ValueError("Direct takes no dates; Seedshift takes 1 through n/3 dates.")
x = [value - 1 for value in numbers]
if mode != "seedshift-legacy" or operation == "encode":
    if not entropy_and_checksum(x)[1]:
        raise ValueError("Input phrase fails its BIP39 checksum.")
y = x[:]
if mode != "direct":
    parts = [part for date in dates for part in (date.year, date.month, date.day)]
    shifts = [parts[position % len(parts)] for position in range(n)]
    sign = 1 if operation == "encode" else -1
    y = [(value + sign * shift) % 2048 for value, shift in zip(x, shifts)]
    if mode == "seedshift":
        c = n // 3
        r = 11 - c
        tail = ((x[-1] >> c) + sign * shifts[-1]) % (1 << r)
        bits = "".join(f"{value:011b}" for value in y[:-1]) + f"{tail:0{r}b}"
        entropy = int(bits, 2).to_bytes(n * 4 // 3, "big")
        checksum = hashlib.sha256(entropy).digest()[0] >> (8 - c)
        y[-1] = (tail << c) | checksum
print("Word numbers:", " ".join(str(value + 1) for value in y))
print("BIP39 checksum:", "valid" if entropy_and_checksum(y)[1] else "INVALID")
```

For the worked example, choose `seedshift`, `decode`, date `23-09-2026` and the
masked numbers above. The output is eleven 1s followed by 4 and `valid`.

### Cross-stitch legend helper

Save the following code as `manual_seedstitch.py` and run it the same way. It
takes the legend line, each row as `symbol:stitches` or `symbol:DMC:stitches` from
the top of the key down, on one line or several, ended by an empty line; or the
path of the pattern's PDF, which keeps the line. It prints the word numbers and
whether they are masked with Seedshift. It does
not correct a misread row; check the rows instead. Its output is recovery
material, so clear it when finished.

```python
import hashlib
import os
import re
import zlib

LENGTHS = {16: 12, 20: 15, 24: 18, 28: 21, 32: 24}


def line_of_pdf(path):
    """The legend line that MnemoCode keeps in its pattern's PDF (the key page's FlossKey data)."""
    pdf = open(path, "rb").read()
    entry = pdf.index(b"/FlossKey")
    ref = int(re.search(rb"/Private\s+(\d+)\s+0\s+R", pdf[entry:]).group(1))
    obj = pdf.index(b"\n%d 0 obj" % ref)
    length = int(re.search(rb"/Length\s+(\d+)", pdf[obj:]).group(1))
    start = pdf.index(b"stream", obj) + 6
    start += 2 if pdf[start:start + 2] == b"\r\n" else 1
    return zlib.decompress(pdf[start:start + length]).decode()


print("Legend rows from the top down (symbol:stitches or symbol:DMC:stitches), "
      "or the path of the pattern's PDF; then an empty line:")
lines = []
while True:
    try:
        typed = input()
    except EOFError:
        break
    if not typed.strip():
        break
    lines.append(typed)
line = " ".join(lines).strip()
# A path dropped into a terminal: in quotes, as 'My pattern.pdf' or 'Sam'\''s pattern.pdf', or
# with its spaces and brackets escaped, as My\ pattern\ \(1\).pdf.
if len(line) >= 2 and line[0] in "'\"" and line[-1] == line[0]:
    path = line[1:-1]
    if line[0] == "'" and os.sep == "/":
        path = path.replace("'\\''", "'")
elif os.sep == "/":
    path = re.sub(r"\\(.)", r"\1", line)
else:
    path = line
path = os.path.expanduser(path)
if path.lower().endswith(".pdf"):
    line = line_of_pdf(path)
rows = [word.split(":") for word in re.split(r"[\s,;]+", line) if word]
ordered = len(rows[0]) == 3
if any(len(row) != len(rows[0]) or len(row) not in (2, 3) for row in rows):
    raise ValueError("Every row is symbol:stitches, or every row symbol:DMC:stitches.")
symbols = [int(row[0]) for row in rows]
counts = [int(row[-1]) for row in rows]
if len(set(symbols)) != len(symbols) or not all(1 <= s <= 70 for s in symbols):
    raise ValueError("Each symbol number appears once, from 1 through 70.")
biggest = max(counts)
if counts.count(biggest) != 1:
    raise ValueError("Two rows share the most stitches: check the counts.")
moduli = [1 if c == biggest or c < 100 else 10 if c < 1000 else 100 for c in counts]
left = list(range(1, 71))
ranks = []
for symbol in symbols:
    ranks.append(left.index(symbol))
    left.remove(symbol)
places = []
if ordered:
    # DMC numbers by their value, then the named threads: B5200, Blanc, Ecru.
    keys = [(0, int(row[1]), "") if row[1].isdigit() else (1, 0, row[1].upper()) for row in rows]
    if len(set(keys)) != len(keys):
        raise ValueError("Each DMC thread appears once.")
    remaining = sorted(keys)
    for key in keys:
        places.append(remaining.index(key))
        remaining.remove(key)
n = 0
for i in reversed(range(len(rows))):
    if moduli[i] > 1:
        n = n * moduli[i] + counts[i] % moduli[i]
    n = n * (70 - i) + ranks[i]
    if ordered:
        n = n * (len(rows) - i) + places[i]
version = b"2" if ordered else b"1"
domains = {
    b"MnemoCode embroidery " + version: "masked with Seedshift: undo it with the dates",
    b"MnemoCode embroidery " + version + b" unmasked": "not masked: these are the phrase's own words",
}
found = []
for length, words in LENGTHS.items():
    payload = n % (1 << (8 * length + 32))
    entropy = (payload >> 32).to_bytes(length, "big")
    check = (payload & 0xFFFFFFFF).to_bytes(4, "big")
    for domain, meaning in domains.items():
        if hashlib.sha256(domain + bytes([length]) + entropy).digest()[:4] == check:
            found.append((entropy, words, meaning))
if len(found) != 1:
    raise ValueError("The legend does not read: check each row's symbol, thread and stitches.")
entropy, words, meaning = found[0]
checksum_bits = words // 3
bits = f"{int.from_bytes(entropy, 'big'):0{len(entropy) * 8}b}"
bits += f"{hashlib.sha256(entropy).digest()[0] >> (8 - checksum_bits):0{checksum_bits}b}"
numbers = [int(bits[k:k + 11], 2) + 1 for k in range(0, len(bits), 11)]
print("Word numbers:", " ".join(str(number) for number in numbers))
print("The phrase is", meaning)
```

For the example of section 1, it prints the numbers above and says that the phrase
is masked with Seedshift.

## 8. Confirm the wallet

A checksum checks the spelling and structure, not ownership. Every date produces
a valid output in MnemoCode Seedshift, including wrong dates. Compare the recovered
wallet against a known address using its original coin, derivation path and BIP39
passphrase. A 32-bit fingerprint is only a short filter, not proof of identity.

Date masking is not encryption. This guide restores the reversible date shift;
it cannot recover missing dates, missing Shamir quorum, an unknown BIP39 passphrase
or information discarded by a legacy last-word replacement on its own.
