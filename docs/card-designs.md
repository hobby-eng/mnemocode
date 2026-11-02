# Card designs

MnemoCode includes thirteen designs. Run `mnemocode preview --list` to see their names and numbers, or [preview them](../README.md#7-preview-cards) before entering your own phrase. This page describes the printed layout; the [CLI reference](CLI.md#card-options) lists customization options.

## Codes and colors

Each card prints one code: an RGB color code for formats 4 and 5, or a four-digit Unicode code for format 3. In color formats, the printed color belongs to the backup. With Unicode codes, colors are decorative; recover from the printed codes, not from the artwork's color.

Business-card artwork uses the selected color's hue, brightness and part of its saturation to distinguish pale, deep and dark samples.

Collections include random decoy codes. A sheet has at least one and enough to fill every row; separate cards have exactly one. For example, a 24-word Unicode backup has 25 separate cards. The QR contains only real codes, and the sheet for heirs records the information needed to exclude decoys.

A card's number gives its position in the set. No card states the total count.

## Collection sheets

The studio name and `DESIGN STUDY / FOR SELECTION` heading appear above numbered samples. A footer carries the slogan and series reference. Each Shamir share has a separate sheet and series reference.

The layout fills every row and uses at least three rows where space allows. It chooses large, similarly sized samples and distributes vertical space above, between and below rows. Without `--orientation`, MnemoCode chooses the page direction that best fits that layout.

Business cards sit on a dark page with a world map. Material designs use a matching backdrop: joints between panels, tiles or planks fall between samples, with each sample centered in its own panel or tile. The object in a material image, such as a switch plate, is centered within the sample.

Finish names are decorative. On one sheet, different codes use different material samples. A long finish name can wrap to two lines; its letters are not reduced. The card number and code stay on one line.

## QR code

A collection QR sits in the upper-right corner beside the heading, outside the samples. Its modules are 0.30 mm wide, the symbol is at least 12 mm wide, and it has a full quiet border. If it cannot fit, the export asks for a larger page.

Individual code cards never contain a collection QR. See [share layouts](SSKR.md#share-cards) for the separate QR-card option for Shamir shares.

## Artwork

Card and material images are bundled with the program. Material colors are laid over their images. The artwork was made for MnemoCode with OpenAI image generation and is distributed under MIT or Apache-2.0, at your option. Its [notice](../crates/mnemocode-cards/assets/images/NOTICE) records the provenance and each image's SHA-256.

Page backdrops, text, reference codes and QR modules are drawn as vector shapes and remain sharp in print.

## Example titles

`--title` accepts a nonblank line of at most 100 characters after trimming, with no control or format characters. For example:

- Finish options
- Material samples
- Color study
