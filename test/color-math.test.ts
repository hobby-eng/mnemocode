// The color readers of the card exports (color-math.ts), and the tints and looks read through them
// (business-tint.ts, material-artwork.ts tintedLook): each reads a color written #RRGGBB or RRGGBB
// and refuses any other text with the code of an RGB reference, rather than read part of it or
// call the refusal a fault of MnemoCode.

import { describe, expect, it } from "vitest";
import {
  hueAndSaturation,
  peakRelativeLuma,
  rgbBytes,
  rgbChannels,
} from "../src/export/color-math.js";
import { artworkBrightness, ReferenceTint } from "../src/export/business-tint.js";
import { tintedLook } from "../src/export/material-artwork.js";

/** Texts that are no color: a letter out of hex, five, four and ten digits, none, and spaces. */
const NOT_COLORS = ["#zz0000", "#12345", "#1234", "#1122334455", "", "#", "12 34 56", "#1EAB91\n"];

/** Every reader of a color, each given the text as its color. */
const READERS: readonly (readonly [string, (color: string) => unknown])[] = [
  ["rgbBytes", rgbBytes],
  ["rgbChannels", rgbChannels],
  ["hueAndSaturation", hueAndSaturation],
  ["peakRelativeLuma", peakRelativeLuma],
  ["artworkBrightness", artworkBrightness],
  ["ReferenceTint", (color) => new ReferenceTint(color)],
  ["tintedLook of its base", (color) => tintedLook(color, "#000000")],
  ["tintedLook of its tint", (color) => tintedLook("#000000", color)],
];

describe("color readers of the card exports", () => {
  it.each(READERS)("refuses every text that is no color as an RGB reference in %s", (_, read) => {
    for (const text of NOT_COLORS)
      expect(() => read(text)).toThrow(
        expect.objectContaining({ code: "core.colors.invalid-rgb-reference" }),
      );
  });

  it("reads six hexadecimal digits in either case, with or without #", () => {
    for (const color of ["#1EAB91", "1eab91", "#1eAB91"])
      expect(rgbBytes(color)).toEqual([0x1e, 0xab, 0x91]);
  });
});
