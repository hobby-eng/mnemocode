# Card designs

Thirteen templates are included; `mnemocode preview --list` prints their numbers and names. The [README](../README.md#cards-and-qr-codes) describes the options. This document says what every template prints.

## Codes and colors

- Every card prints one code: a color code in formats 4 and 5, a Unicode code in format 3.
- In colors, a card shows its own color. In Unicode codes the colors only decorate the cards: one code always has one color, and different codes get colors that look as different as possible on every design.
- Business cards take the hue, the brightness and some of the saturation of their color, so that pale, deep and dark colors look apart.
- A sheet ends with random codes that belong to nothing, at least one, so that every row is full. Separate cards have exactly one extra code: a 24-word phrase in Unicode codes gives 25 cards. The QR code and the sheet for heirs know only the real codes.
- The number on a card is its place in the set; no card says how many cards there are.

## Collection sheets

- A sheet shows the studio name and the line `DESIGN STUDY / FOR SELECTION` centred at the top, numbered samples with their references, and one line at the bottom with the slogan and the series reference.
- Every row of samples is full. A sheet has at least three rows where they fit, rather than two long ones, with the largest samples the page allows, and of samples about as large the most of them, so that they fill the page in height and width. The rows share the height evenly, above, between and below them. Without `--orientation` the sheet is turned the way that gives such a sheet.
- Business cards lie on a dark page with a world map. Material samples lie on a backdrop of their own setting, whose panels, tiles or planks are laid out around the samples: their joints run between them, and each sample sits in the middle of a panel or tile of its own.
- The object of a material image, such as a tile or a switch plate, sits in the middle of its sample.
- Each Shamir share has its own sheet and its own series reference.
- Material sheets also show names of finishes, which are decoration. Two different codes never get the same sample on one sheet.
- A name that does not fit beside its sample at the sheet's size takes two lines rather than smaller letters. The line with the number and the code is never split.

## QR code

- The QR code of a collection is in the upper-right corner, beside the heading and outside every sample.
- Its dots are 0.30 mm wide, it is at least 12 mm wide, and it has a full empty border.
- If it does not fit, the export stops and asks for a larger page.

## Artwork

Images of cards and materials are stored in the program; the colour of a material sample is laid over its image. They were made for MnemoCode with OpenAI's image generation and are distributed under MnemoCode's MIT license; [their notice](../assets/images/NOTICE) says how they were made and lists each image with its SHA-256. Page backdrops, text, reference codes and the QR code are drawn as shapes, not as pixels, so they stay sharp in print.

## Example titles

`--title` takes one line of text that is not blank and has no control or format characters: at most 100 characters once spaces at either end are left out. For example:

- The Studio Edit
- The Psychology of Color
- Stunning Colors for Business Inspiration
- Travel-Inspired Shades
- Bold Tones for Bright Ideas
- Modern Shades for Meaningful Work
- Palette Notes for Creative Minds
- Thoughtful Tones for Modern Living
