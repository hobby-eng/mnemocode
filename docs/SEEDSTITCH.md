# SeedStitch, formats 1 and 2

SeedStitch hides the entropy of a BIP39 phrase in the legend of a cross-stitch pattern. The pattern
is an ordinary chart made from any picture: DMC threads, a symbol for each thread, a count of
stitches for each. The phrase lies in which symbol each row of the legend was given and in the
last digits of its stitch count. Format 2 adds the order of the rows. A legend is read back alone:
the picture, the chart and the finished embroidery are not needed.

The format is public, so anyone who knows it can read a legend. MnemoCode therefore masks the
phrase with [Seedshift](SEEDSHIFT_CONSTRUCTION.md) dates and asks for them when it reads the legend
back. Only where the person chooses, for a phrase protected some other way, does it hide the phrase
itself. The check tells a reader which, so dates are asked for only where they were used.

MnemoCode writes format 1 wherever it holds the phrase, since its legend lists the threads by DMC
number as most charts do. Format 2 is for patterns too small or too plain for format 1, such as 60
stitches across.

## The symbols

A row's symbol is a number from 1 to 70. A chart draws it; a person typing a legend back finds it
in this table and types its number. The table leaves out every symbol that could be taken for
another one in it: O and 0, I, l and 1, S and 5, B and 8, Z and 2, G and 6, X and ×, a dot and a
disc.

| Numbers | Symbols                                  |
| ------- | ---------------------------------------- |
| 1–10    | `■` `□` `▣` `⊞` `⊠` `◧` `◩` `▤` `▦` `●`  |
| 11–20   | `○` `⊙` `⊕` `⊗` `◐` `▲` `△` `▼` `◆` `◇`  |
| 21–30   | `◈` `◢` `◤` `+` `×` `★` `✱` `♥` `♡` `♠`  |
| 31–40   | `♣` `↑` `→` `↔` `\|` `—` `/` `\` `⬢` `⬡` |
| 41–50   | `A` `B` `C` `D` `E` `F` `G` `H` `J` `K`  |
| 51–60   | `L` `M` `N` `P` `R` `S` `T` `U` `V` `W`  |
| 61–70   | `Y` `Z` `3` `4` `7` `9` `a` `e` `h` `r`  |

The order of this table is part of the format and never changes.

## Reading a legend

Take the rows from the top of the legend down, in the order printed: row `i` (from 1) has symbol
number `s_i` and `c_i` stitches. A format 1 row is typed `symbol:stitches`, as `28:1725`; a
format 2 row names its DMC thread too, `symbol:DMC:stitches`, as `28:310:1725`. Every row of a
legend has the same form. Rows typed with DMC numbers are read as format 2 and also as format 1
without the numbers, since a format 1 key prints each row's thread too; a reading as typed is taken
before one that corrects a misread row.

1. The symbol numbers are all different, from 1 to 70.
2. The **biggest row** is the one with the most stitches. Two rows sharing the most stitches is no
   legend of either format.
3. Each row carries a **modulus** `m_i`: 1 for the biggest row and for a row of fewer than 100
   stitches; 10 for a row of 100 to 999 stitches; 100 for a row of 1000 stitches or more. The row
   carries the digit `d_i = c_i mod m_i`: its last two digits, its last digit, or nothing.
4. The row's **rank** `q_i` is the place of `s_i`, counted from 0, among the symbol numbers that no
   row above it took, in increasing order. The first row's rank is `s_1 - 1`.
5. In format 2 only, the row's **place** `p_i` is the place of its thread, counted from 0, among
   the threads that no row above it named, sorted as DMC's charts list them: numbers by their
   value (`06` and `6` are one thread), then B5200, Blanc and Ecru. Each thread appears once.
6. The number `N` is built from the last row up, starting from 0: for row `i`, first
   `N = N * m_i + d_i` where `m_i` is above 1, then `N = N * (71 - i) + q_i`, and in format 2 then
   `N = N * (n + 1 - i) + p_i`, `n` being the number of rows.
7. For each entropy length `L` of 16, 20, 24, 28 and 32 bytes, take `P = N mod 2^(8L + 32)`. Its
   upper `8L` bits, as `L` bytes most significant first, are the candidate entropy `E`; its lower 32
   bits, as 4 bytes most significant first, are the check `C`. The length is right when `C` equals
   the first 4 bytes of SHA-256 of a domain, then the one byte `L`, then `E`. The domain is the
   ASCII text `MnemoCode embroidery 1` for a phrase masked with Seedshift, and
   `MnemoCode embroidery 1 unmasked` for the phrase itself; in format 2 the `1` is a `2`.
8. Exactly one length, with one domain, must be right. `E` is the entropy of a BIP39 phrase of 12,
   15, 18, 21 or 24 words; its checksum word follows from it as BIP39 defines. The domain says
   whether the phrase is masked: only then are the Seedshift dates asked for.

### A row read wrong

When no length is right, a reader may try every change of one row: another symbol, one digit of
its count changed or two neighbouring digits of it swapped, its count taken on the other side of
the 100 or 1000 limit, or another row taken as the biggest. If exactly one entropy comes out, that
row was misread; if none or several do, the legend is read again from the paper. A DMC number is
not searched: one that names no thread is refused. In format 2 a thread counts only by its place in
DMC's order among the legend's threads: a number that names another thread makes the legend fail
to read where it changes that place, and reads as before where it keeps it, so a misread DMC number
is not always noticed. With one row misread in one of these ways the true phrase is always among the
results, so a wrong phrase cannot come out alone; the risk lies in mistakes the search does not
cover, such as two rows wrong or a row left out, which pass the check about once in 140,000: a
legend of 28 rows is tried some 15,000 ways, each against a check of 32 bits in two domains.

## Writing a legend

This part is MnemoCode's way; a reader does not need it.

1. The picture becomes a pattern. It is brightened as a pattern designer brightens a photograph:
   saturation ×1.2, then contrast ×1.1 about its mean grey. Its colours are found by median cut
   and k-means in CIELAB and matched to DMC threads. Each colour weighs one over the square root
   of how many colours share its cell of 8 CIELAB units, so that a small bright object, such as a
   carrot on a lawn, keeps a thread of its own. Each stitch takes the thread that a serpentine
   Floyd–Steinberg error diffusion in CIELAB gives it; the error passed on is clamped to ±12 per
   channel so that dark areas do not bloom.
2. The number of threads starts at one for every 1,000 stitches, no fewer than 12 and no more than
   40, and grows until the legend has room for the phrase, up to 60. Of the first four numbers that
   give room, each pattern is measured against the picture: both are blurred by about a stitch, as
   the embroidery is seen from a little distance, and the CIE76 distance of every stitch is taken;
   the measure is the mean plus a quarter of the mean of the worst 1% of stitches, where a small
   object that lost its colour shows. The pattern of fewest threads within 5% of the nearest is
   tried first, as fewer threads look cleaner, then the others from the nearest.
3. Format 1 is tried first. Only where no number of threads gives format 1 room, or no legend of it
   can be set, is format 2 tried the same way. In format 1 the rows are sorted by DMC number.
4. With `R` the product of `71 - i`, `m_i` and in format 2 `n + 1 - i` over all rows, the writer
   draws `F` at random below `R / 2^(8L + 32)` and takes `N = P + 2^(8L + 32) * F`, `P` being the
   entropy and its check as in step 7 of reading. Dividing `N` row after row from the first, in
   the reverse order of step 6 (in format 2 by `n + 1 - i` for the row's thread, then by `71 - i`
   for its symbol, then by its thread's `m_i` for its digit), gives each row's thread, symbol and
   digit. `F` makes every row's symbol, and in format 2 its place, look as chosen at random, and it
   lets the writer pick, among many legends of the same phrase, one that the stitches can reach
   with little change.
5. Each row's count is brought to end in its digit by moving a few stitches between two threads of
   nearly the same colour that touch, where the picture shows the change least. A row near a limit
   of 100 or 1000, or with too few stitches that may move, keeps its count, and only a legend whose
   digit fits it is taken. On a pattern of 200 stitches across, about 1% of the stitches move.
6. The legend is read back before the chart is written. The PDF keeps the legend line, as a person
   types it, compressed in the private data of the floss key's page (`PieceInfo`, under the name
   `FlossKey`), which no viewer shows; Decode and the manual recovery helper read it from there. It
   holds nothing the key page does not print.

## Examples

The legend of a pattern of 200 by 269 stitches in format 1, typed back as `symbol:stitches` from
the top row down, holds the entropy
`f585c11aec520db57dd353c69554b21a89b20fb0650966fa0a9d6f74fd989d8f` with the check of a masked
phrase. That masked phrase is the public BIP39 test phrase "void come effort suffer camp survey
warrior heavy shoot primary clutch crush open amazing screen patrol group space point ten exist
slush involve unfold". The example was written for the format, so no dates belong to it: it shows
how a legend reads. The format 2 example below comes with its date.

```text
28:1725 25:2163 57:3275 34:3917 9:480 54:1505 17:5063 63:372 46:328 7:2818 62:1114 53:1997
37:2496 40:1945 3:882 58:7130 41:180 59:336 22:1634 36:778 64:1147 10:3804 24:1214 69:479
56:931 30:2066 23:3224 29:797
```

Row 16, with 7130 stitches, is the biggest and carries nothing; row 5, with 480, carries its last
digit 0; row 1, with 1725, carries 25.

The legend of a pattern of 60 by 60 stitches in format 2, 30 threads, holds the public phrase
"abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon
abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon art"
masked with Seedshift and the date 01-01-2000:

```text
15:407:38 23:703:169 70:471:337 20:898:65 16:936:36 52:3772:73 48:368:113 10:523:87 12:3825:16
67:742:31 41:3787:25 57:469:67 17:3371:72 59:317:49 61:829:27 30:535:53 3:905:72 2:03:315
26:07:160 21:610:136 64:3021:58 58:3031:76 66:3072:433 44:06:291 9:3032:163 25:642:55 63:3864:60
19:3013:93 45:310:325 29:414:105
```

Its first row names thread 407, which comes 7th of the 30 threads in DMC's order (after 03, 06, 07,
310, 317 and 368), so its place `p_1` is 6.
