# SeedStitch, format 1

SeedStitch hides the entropy of a BIP39 phrase in the legend of a cross-stitch pattern. The pattern
is an ordinary chart made from any picture: DMC threads, a symbol for each thread, a count of
stitches for each. The phrase lies in which symbol each row of the legend was given and in the
last digits of its stitch count. It is read back from the legend alone: the picture, the chart and
the finished embroidery are not needed.

The format is public, so anyone who knows it can read a legend. MnemoCode therefore hides only a
phrase masked with [Seedshift](SEEDSHIFT_CONSTRUCTION.md) dates, never the phrase itself, and asks
for the dates when it reads the legend back.

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

Take the rows from the top of the legend down: row `i` (from 1) has symbol number `s_i` and
`c_i` stitches. MnemoCode prints the rows by DMC number; a reader takes them in the order printed.

1. The symbol numbers are all different, from 1 to 70.
2. The **biggest row** is the one with the most stitches. Two rows sharing the most stitches is no
   legend of this format.
3. Each row carries a **modulus** `m_i`: 1 for the biggest row and for a row of fewer than 100
   stitches; 10 for a row of 100 to 999 stitches; 100 for a row of 1000 stitches or more. The row
   carries the digit `d_i = c_i mod m_i`: its last two digits, its last digit, or nothing.
4. The row's **rank** `q_i` is the place of `s_i`, counted from 0, among the symbol numbers that no
   row above it took, in increasing order. The first row's rank is `s_1 - 1`.
5. The number `N` is built from the last row up, starting from 0: for row `i`, first
   `N = N * m_i + d_i` where `m_i` is above 1, then `N = N * (71 - i) + q_i`.
6. For each entropy length `L` of 16, 20, 24, 28 and 32 bytes, take `P = N mod 2^(8L + 32)`. Its
   upper `8L` bits, as `L` bytes most significant first, are the candidate entropy `E`; its lower 32
   bits, as 4 bytes most significant first, are the check `C`. The length is right when `C` equals
   the first 4 bytes of SHA-256 of the ASCII text `MnemoCode embroidery 1`, then the one byte `L`,
   then `E`.
7. Exactly one length must be right. `E` is the entropy of a BIP39 phrase of 12, 15, 18, 21 or 24
   words; its checksum word follows from it as BIP39 defines.

### A row read wrong

When no length is right, a reader may try every change of one row: another symbol, one digit of
its count changed or two neighbouring digits of it swapped, its count taken on the other side of the 100 or 1000 limit, or another row
taken as the biggest. If exactly one entropy comes out, that row was misread; if none or several do,
the legend is read again from the paper. With one row misread in one of these ways the true phrase
is always among the results, so a wrong phrase cannot come out alone; the risk lies in mistakes the
search does not cover, such as two rows wrong or a row left out, which pass the check about once in
a few hundred thousand: a legend of 28 rows is tried some 15,000 ways against a check of 32 bits.

## Writing a legend

This part is MnemoCode's way; a reader does not need it.

1. The picture becomes a pattern: about as many DMC threads as the legend needs, each stitch the
   thread a dithering of the picture gives it, rows sorted by DMC number.
2. With `R` the product of `71 - i` and `m_i` over all rows, the writer draws `F` at random below
   `R / 2^(8L + 32)` and takes `N = P + 2^(8L + 32) * F`, `P` being the entropy and its check as in
   step 6. Dividing `N` by `71 - i` and then by `m_i`, row after row from the first, gives each row's
   rank and digit. `F` makes every row's symbol look as chosen at random, and it lets the writer
   pick, among many legends of the same phrase, one that the stitches can reach with little change.
3. Each row's count is brought to end in its digit by moving a few stitches between two threads of
   nearly the same colour that touch, where the picture shows the change least. A row near a limit
   of 100 or 1000, or with too few stitches that may move, keeps its count, and only a legend whose
   digit fits it is taken.
4. The legend is read back before the chart is written.

## Example

The legend of a pattern of 200 by 269 stitches, typed back as `symbol:stitches` from the top row
down, holds the entropy `f585c11aec520db57dd353c69554b21a89b20fb0650966fa0a9d6f74fd989d8f`: the
public BIP39 test phrase "void come effort suffer camp survey warrior heavy shoot primary clutch
crush open amazing screen patrol group space point ten exist slush involve unfold".

```text
28:1725 25:2163 57:3275 34:3917 9:480 54:1505 17:5063 63:372 46:328 7:2818 62:1114 53:1997
37:2496 40:1945 3:882 58:7130 41:180 59:336 22:1634 36:778 64:1147 10:3804 24:1214 69:479
56:931 30:2066 23:3224 29:797
```

Row 16, with 7130 stitches, is the biggest and carries nothing; row 5, with 480, carries its last
digit 0; row 1, with 1725, carries 25.
