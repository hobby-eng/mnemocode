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
- The front ends hide only a phrase masked with MnemoCode's Seedshift, whose checksum stays valid,
  since the format is public.
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
