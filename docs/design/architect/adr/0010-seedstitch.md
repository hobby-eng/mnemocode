# SeedStitch: a phrase in the legend of a cross-stitch pattern

## Context

The owner asked on 2026-11-03 for a backup that looks like an ordinary embroidery kit: any picture
as a DMC cross-stitch chart, the phrase hidden in its legend, readable without the picture. Six
prototypes in Python (workspace `tmp/embroidery/`) and two reviews settled the format and the
pattern: the legend sorted by DMC number as shop kits print it; symbols chosen from a fixed list
without look-alike pairs; the last one or two digits of each stitch count; a pattern dithered as
photo kits are, since flat colours turned the moon's sky into blotches (owner: unacceptable);
residues modulo 128 or 256 saved one or two rows but moved two to three times more stitches, so
decimal digits stay.

## Decision

- Format 1 as `docs/SEEDSTITCH.md` defines it: 70 symbols, the digit limits 100 and 1000, the
  biggest row carrying nothing, the entropy and a 32-bit check in one mixed-radix number, every
  entropy length tried, one misread row corrected when only one change of it passes the check.
- A crate of its own, `mnemocode-embroidery`, library only: picture reading, the pattern, the
  legend, hiding, and the chart, which it draws through `mnemocode-cards`' scene and PDF writer.
  Its decoders and its colour work build only into the executable and into the WASM files of
  pages that offer embroidery; the rules of `mnemocode` never depend on it.
- The front ends mask the phrase with MnemoCode's Seedshift, whose checksum stays valid, since the
  format is public. The person may decline it, as Encode allows, for a phrase protected some other
  way; the check's domain says which, so Decode asks for dates only where they were used (owner,
  2026-11-04). The original Seedshift is not offered: its result usually fails the checksum, and a
  legend holds only a valid phrase.
- The DMC colours come from craft-color-codes by MakeBead under CC BY 4.0, converted unchanged
  into a table (THIRD_PARTY_NOTICES.md).

## Rejected alternatives

- Seedshift and BIP39Colors as crates of their own, or a `mnemocode-core` crate: they share the
  phrase, secret, refusal and text types of `mnemocode`, nothing else needs them alone, and the
  `code-rules` layers keep their modules apart (owner, 2026-11-03). ADR 0001's reasons stand.
- One thread in several rows with exact counts (the owner's idea): no stitch moves, but a thread
  listed twice tells a reader of kits that something is odd; kept as a possible later mode.
- A decorative border whose pattern carries the data, for flat logos with few colours: needs the
  chart as well as the legend; a possible later mode.
- A separate program or repository: it would need the CLI's protections of secrets again.

## Consequences

- The legend is a secret like any record: the PDF is held as secret bytes, the pattern's cells
  and the rows are wiped when dropped.
- A flat picture of a few colours cannot hold a phrase: the front end says so and names what to
  choose instead.
- The browser binding gets a module of its own (§9), and wallet-tools takes the feature.

## The owner's review of the pattern, 2026-11-04 and 05

The owner judged the patterns by eye on a photograph of a rabbit with a carrot, and compared them
with KXStitch and PontoCrz on the same grid. These choices followed.

- **Size decides the likeness.** At 78 or 105 stitches across no method, ours or another
  program's, shows a photograph well; at 200 the program's dithered pattern reads as the photo. The
  menu therefore selects the smallest sheet that gives 200 stitches across and says that more
  stitches give more detail.
- **Dithering stays.** Serpentine Floyd–Steinberg in CIELAB, error clamped to ±12, is kept. A
  method with a median per stitch, error passed on only where no thread fits and lone stitches
  removed looked cleaner at 78 stitches but turned fur and lawn into flat patches at 200 and 300;
  the moon's dark sky needs the dithering in any case.
- **The picture is brightened** by saturation ×1.2 and contrast ×1.1 before it is converted. The
  owner chose this middle between the program's own colours and ×1.4 and ×1.2, which made the fur
  livelier but the carrot garish. PontoCrz, with its small fixed palette, gave a bright carrot but
  lilac fur and a brown lawn; KXStitch gave grain and a greenish background like ours.
- **A small object keeps its colour.** At 78 stitches with a 24-word phrase the carrot came out
  khaki: hiding took the first number of threads that held the phrase, and at 43 the k-means had
  merged the carrot with its surroundings. The k-means now weights rare colours up, and hiding
  compares the first four numbers of threads that hold the phrase, by the mean seen difference plus
  a quarter of that of the worst 1% of stitches, preferring fewer threads within 5% of the nearest
  (the owner found 40 threads cleaner than 48 at 78 stitches).
- **At least one thread for every 1,000 stitches**, 12 to 40: 29 threads at 200 stitches left the
  fur poorer than 50.
- **Format 2** adds the order of the rows, typed `symbol:DMC:stitches`, with its own check domains.
  It lets a 24-word phrase into a pattern of 60 stitches across, where format 1 has no room. It is
  used only where format 1 cannot hold the phrase: a key listed by DMC number is what most charts
  print, and an unsorted one might look odd to someone who knows embroidery (owner: unlikely to
  matter, "how many thieves cross-stitch").
- **The PDF is camouflage, not a print**: a cover with the picture stitched on Aida, the floss key
  on one page however many threads, and the whole chart in full colour with symbols at half
  contrast, a bold line every ten stitches and arrows at the centre, on warm paper with a band in a
  colour of the picture. The chart is not drawn at actual size.
- **Recovery without MnemoCode**: the manual recovery guide reads both formats with a short Python
  script, then reverses Seedshift with the guide's own helper.
- **Linen 28 over one thread** joins Aida 11 to 18 among the fabrics: its stitches are half the
  size of Aida 14's, so a small piece keeps the detail of 200 stitches across. Only the cover's
  sizes and the skeins, for one strand, change; the legend does not depend on the fabric.

Rejected in that review:

- **Fractional stitches.** KXStitch's import preview with them looked sharpest, but the pattern it
  made left many quarter cells unstitched, which show the white fabric; more stitches or a finer
  fabric give the detail without that.
- **Format 2 for every pattern**: it would put an unsorted key on every chart.
- **A chart at actual size for water-soluble canvas**: the owner named the canvas as an example
  only; nobody prints the pattern.
