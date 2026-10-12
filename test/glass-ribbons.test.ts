// The ribbons of the photographed glass card (glass-ribbons.ts): every ribbon is found up to the
// white rims, keeps its tone where the frost fades it, no ribbon spills into the next, and the map
// and the tones are the ones that the independent reference scripts/glass-ribbons-reference.py
// (numpy and colorsys) gives.

import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { pixelHsv } from "../src/export/color-math.js";
import { GlassRibbons, NO_RIBBON } from "../src/export/glass-ribbons.js";
import { nodeRenderPlatform } from "../src/export/platform-node.js";
import { pixelOffset } from "../src/export/platform.js";

const photograph = nodeRenderPlatform.decodePng(
  readFileSync(new URL("../assets/images/business-glass-4in1.png", import.meta.url)),
);
const { width, height } = photograph;
const glass = GlassRibbons.of(photograph);
const pixels = Array.from({ length: width * height }, (_, at) => at);
const ribbons = Int8Array.from(pixels, (at) => glass.ribbonAt(at));
const saturation = Float64Array.from(pixels, (at) => glass.toneAt(at)[0]);
const value = Float64Array.from(pixels, (at) => glass.toneAt(at)[1]);
const RIBBONS = [0, 1, 2, 3];

/**
 * The SHA-256 of the map (int8) followed by the saturation and the value of every pixel (float64,
 * little-endian), and the pixels of each ribbon, as scripts/glass-ribbons-reference.py prints them.
 */
const REFERENCE_SHA256 = "de49a90db01c0fd99a206c7da32fa91b246c415265c59a42cdf228bb8ca2e66b";
const REFERENCE_RIBBON_PIXELS = [18_320, 24_835, 27_388, 20_910];

/** The columns inside the photograph's white rims, which are columns 2–5 and 894–897. */
const INNER_COLUMNS = { first: 6, last: 893 };
/** The columns next to each rim where the frost fades the ribbons, and columns further in. */
const EDGES = [range(6, 16), range(884, 894)];
const FURTHER_IN = [range(56, 66), range(834, 844)];
/** How far the tone at the ends may differ from the tone further in; the fade was 0.15 to 0.3. */
const TONE_TOLERANCE = 0.04;

function range(from: number, to: number): number[] {
  return Array.from({ length: to - from }, (_, i) => from + i);
}

function median(values: number[]): number {
  const sorted = values.sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)]!;
}

/** The median saturation and value of `ribbon` over `columns`. */
function toneOf(ribbon: number, columns: readonly number[]): readonly [number, number] {
  const at = columns.flatMap((x) =>
    range(0, height)
      .map((y) => y * width + x)
      .filter((p) => ribbons[p] === ribbon),
  );
  return [median(at.map((p) => saturation[p]!)), median(at.map((p) => value[p]!))];
}

describe("the ribbons of the photographed glass card", () => {
  it("is the map and the tones that the independent reference gives", () => {
    const digest = createHash("sha256")
      .update(Buffer.from(ribbons.buffer))
      .update(Buffer.from(saturation.buffer))
      .update(Buffer.from(value.buffer))
      .digest("hex");
    expect(digest).toBe(REFERENCE_SHA256);
    const counts = RIBBONS.map((ribbon) => ribbons.filter((r) => r === ribbon).length);
    expect(counts).toEqual(REFERENCE_RIBBON_PIXELS);
  });

  it("keeps the ribbons in their order in every column: none spills into the next", () => {
    for (let x = 0; x < width; x++) {
      let previous = NO_RIBBON;
      for (let y = 0; y < height; y++) {
        const ribbon = ribbons[y * width + x]!;
        if (ribbon === NO_RIBBON) continue;
        expect(ribbon, `column ${x}, row ${y}`).toBeGreaterThanOrEqual(previous);
        previous = ribbon;
      }
    }
  });

  it("finds every ribbon in every column up to the white rims", () => {
    for (const x of range(INNER_COLUMNS.first, INNER_COLUMNS.last + 1))
      for (const ribbon of RIBBONS) {
        const rows = range(0, height).filter((y) => ribbons[y * width + x] === ribbon);
        expect(rows.length, `column ${x}, ribbon ${ribbon}`).toBeGreaterThanOrEqual(4);
      }
  });

  it("keeps the tone of every ribbon where the frost fades it at the rims", () => {
    for (const ribbon of RIBBONS)
      EDGES.forEach((edge, side) => {
        const [edgeSaturation, edgeValue] = toneOf(ribbon, edge);
        const [insideSaturation, insideValue] = toneOf(ribbon, FURTHER_IN[side]!);
        const where = `ribbon ${ribbon}, columns ${edge[0]}–${edge.at(-1)}`;
        expect(Math.abs(edgeSaturation - insideSaturation), where).toBeLessThanOrEqual(
          TONE_TOLERANCE,
        );
        expect(Math.abs(edgeValue - insideValue), where).toBeLessThanOrEqual(TONE_TOLERANCE);
      });
  });

  it("leaves no strongly gold pixel of a ribbon in its photographed colour", () => {
    let left = 0;
    for (let x = 0; x < width; x++) {
      const rows = range(0, height).filter((y) => ribbons[y * width + x] !== NO_RIBBON);
      if (rows.length === 0) continue;
      for (let y = Math.min(...rows); y <= Math.max(...rows); y++) {
        if (ribbons[y * width + x] !== NO_RIBBON) continue;
        const [h, s, v] = pixelHsv(photograph.data, pixelOffset(photograph, x, y));
        if (s > 0.16 && h > 0.04 && h < 0.19 && v <= 0.985) left += 1;
      }
    }
    expect(left).toBe(0);
  });
});
