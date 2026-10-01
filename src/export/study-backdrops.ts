import { rgb, type PDFPage } from "pdf-lib";
import { MM } from "./business-layout.js";

/**
 * Pages behind a material's design study, each from the world the material belongs to: a car
 * showroom, an exposed concrete wall, a tiled bathroom wall and an oak floor. They are drawn
 * lightly, as a premium paper would carry them, so that the samples stay in front.
 */
export type MaterialBackdrop = "studio" | "concrete" | "tiled" | "parquet";

type Color = ReturnType<typeof rgb>;

const mix = (a: Color, b: Color, t: number): Color =>
  rgb(
    a.red + (b.red - a.red) * t,
    a.green + (b.green - a.green) * t,
    a.blue + (b.blue - a.blue) * t,
  );

/**
 * A fixed shade from -1 to 1 for the item in column i and row j of a pattern, so that panels,
 * tiles and planks vary a little, the same way on every page.
 */
function shade(i: number, j: number): number {
  const hash = (Math.imul(i + 101, 73856093) ^ Math.imul(j + 211, 19349663)) >>> 0;
  return (hash % 2001) / 1000 - 1;
}

/** A polygon given in millimetres from the top left corner of the page. */
function polygon(
  page: PDFPage,
  points: readonly (readonly [number, number])[],
  fill: Color,
  edge?: { readonly color: Color; readonly width: number; readonly opacity: number },
): void {
  const path =
    points.map(([x, y], i) => `${i === 0 ? "M" : "L"} ${x * MM} ${y * MM}`).join(" ") + " Z";
  page.drawSvgPath(path, {
    x: 0,
    y: page.getHeight(),
    color: fill,
    ...(edge === undefined
      ? {}
      : { borderColor: edge.color, borderWidth: edge.width, borderOpacity: edge.opacity }),
  });
}

/** A straight line in millimetres from the top left corner of the page. */
function line(
  page: PDFPage,
  from: readonly [number, number],
  to: readonly [number, number],
  color: Color,
  width: number,
  opacity: number,
): void {
  const height = page.getHeight();
  page.drawLine({
    start: { x: from[0] * MM, y: height - from[1] * MM },
    end: { x: to[0] * MM, y: height - to[1] * MM },
    color,
    thickness: width,
    opacity,
  });
}

// Horizontal bands that make up a smooth vertical gradient; each overlaps the next a little, so
// that no hairline of the page shows between them.
const GRADIENT_BANDS = 160;
const BAND_OVERLAP_MM = 0.2;

/** Fills the page from top to bottom through colour stops at shares of its height. */
function verticalGradient(
  page: PDFPage,
  width: number,
  height: number,
  stops: readonly (readonly [number, Color])[],
): void {
  const colourAt = (share: number): Color => {
    const next = stops.findIndex(([position]) => position >= share);
    if (next <= 0) return stops[Math.max(next, 0)]![1];
    const [from, start] = stops[next - 1]!;
    const [to, end] = stops[next]!;
    return mix(start, end, (share - from) / (to - from));
  };
  const band = height / GRADIENT_BANDS;
  for (let i = 0; i < GRADIENT_BANDS; i++) {
    page.drawRectangle({
      x: 0,
      y: page.getHeight() - ((i + 1) * band + BAND_OVERLAP_MM) * MM,
      width: width * MM,
      height: (band + BAND_OVERLAP_MM) * MM,
      color: colourAt((i + 0.5) / GRADIENT_BANDS),
    });
  }
}

/**
 * A showroom: a pale wall with a soft light on it, meeting a polished grey floor that reflects
 * the light in a band along the horizon.
 */
function drawStudio(page: PDFPage, width: number, height: number): void {
  // Where the wall meets the floor, as a share of the height from the top.
  const horizon = 0.62;
  verticalGradient(page, width, height, [
    [0, rgb(0.9, 0.905, 0.915)],
    [horizon - 0.02, rgb(0.8, 0.81, 0.825)],
    [horizon, rgb(0.66, 0.675, 0.695)],
    [horizon + 0.06, rgb(0.74, 0.75, 0.765)],
    [1, rgb(0.6, 0.615, 0.635)],
  ]);
  // The light on the wall behind the samples: rings of white, each a little stronger inside.
  const rings = 8;
  for (let k = 0; k < rings; k++) {
    const share = 1 - k / rings;
    page.drawEllipse({
      x: (width / 2) * MM,
      y: page.getHeight() - height * 0.3 * MM,
      xScale: width * 0.5 * share * MM,
      yScale: height * 0.28 * share * MM,
      color: rgb(1, 1, 1),
      opacity: 0.05,
    });
  }
  // The edge of the floor catches the light.
  line(page, [0, height * horizon], [width, height * horizon], rgb(1, 1, 1), 0.5, 0.55);
}

/** Exposed concrete: formwork panels with their joints and the holes of the form ties. */
function drawConcrete(page: PDFPage, width: number, height: number): void {
  const columns = 4;
  // Formwork panels are twice as wide as they are high.
  const panelWidth = width / columns;
  const panelHeight = panelWidth / 2;
  const rows = Math.ceil(height / panelHeight);
  const base = rgb(0.8, 0.79, 0.765);
  const joint = rgb(0.6, 0.59, 0.57);
  const light = rgb(0.9, 0.89, 0.87);
  const hole = rgb(0.6, 0.59, 0.57);
  const radius = panelWidth * 0.022;
  for (let row = 0; row < rows; row++) {
    for (let column = 0; column < columns; column++) {
      const x = column * panelWidth;
      const y = row * panelHeight;
      const tone = mix(
        base,
        shade(column, row) > 0 ? light : joint,
        Math.abs(shade(column, row)) * 0.08,
      );
      page.drawRectangle({
        x: x * MM,
        y: page.getHeight() - (y + panelHeight) * MM,
        width: panelWidth * MM,
        height: panelHeight * MM,
        color: tone,
      });
      // Six ties per panel, in two rows of three.
      for (const across of [1 / 6, 1 / 2, 5 / 6]) {
        for (const down of [1 / 4, 3 / 4]) {
          const centre = {
            x: (x + across * panelWidth) * MM,
            y: page.getHeight() - (y + down * panelHeight) * MM,
          };
          page.drawCircle({ ...centre, size: radius * 1.35 * MM, color: light, opacity: 0.4 });
          page.drawCircle({ ...centre, size: radius * MM, color: hole, opacity: 0.4 });
        }
      }
    }
  }
  // The joints: a dark line with a light one beside it, as an edge that catches the light.
  for (let column = 1; column < columns; column++) {
    const x = column * panelWidth;
    line(page, [x, 0], [x, height], joint, 0.5, 0.45);
    line(page, [x + 0.35, 0], [x + 0.35, height], light, 0.4, 0.6);
  }
  for (let row = 1; row < rows; row++) {
    const y = row * panelHeight;
    line(page, [0, y], [width, y], joint, 0.5, 0.45);
    line(page, [0, y + 0.35], [width, y + 0.35], light, 0.4, 0.6);
  }
}

/** A wall of large limestone-coloured tiles in a running bond, with light grout. */
function drawTiles(page: PDFPage, width: number, height: number): void {
  const tileWidth = width / 4.5;
  const tileHeight = tileWidth / 2;
  const grout = tileWidth * 0.012;
  const base = rgb(0.85, 0.83, 0.8);
  const light = rgb(0.92, 0.905, 0.88);
  const dark = rgb(0.74, 0.72, 0.69);
  const rows = Math.ceil(height / tileHeight);
  for (let row = 0; row < rows; row++) {
    // Every other row moves by half a tile.
    const offset = row % 2 === 0 ? 0 : -tileWidth / 2;
    for (let column = 0; offset + column * tileWidth < width; column++) {
      const x = offset + column * tileWidth + grout / 2;
      const y = row * tileHeight + grout / 2;
      const w = tileWidth - grout;
      const h = tileHeight - grout;
      const s = shade(column, row);
      page.drawRectangle({
        x: x * MM,
        y: page.getHeight() - (y + h) * MM,
        width: w * MM,
        height: h * MM,
        color: mix(base, s > 0 ? light : dark, Math.abs(s) * 0.12),
      });
      // A glaze catches the light along the top edge and darkens along the bottom one.
      line(page, [x, y + 0.2], [x + w, y + 0.2], rgb(1, 1, 1), 0.45, 0.55);
      line(page, [x, y + h - 0.2], [x + w, y + h - 0.2], dark, 0.45, 0.35);
    }
  }
}

/** A light oak floor laid in chevron: planks cut at an angle and meeting along straight seams. */
function drawParquet(page: PDFPage, width: number, height: number): void {
  const columnWidth = width / 6;
  const half = columnWidth / 2;
  // Planks meet at 45 degrees, so each half column rises by its own width.
  const rise = half;
  const plank = columnWidth * 0.2;
  const base = rgb(0.86, 0.8, 0.71);
  const light = rgb(0.9, 0.85, 0.77);
  const dark = rgb(0.78, 0.71, 0.61);
  const edge = { color: rgb(0.62, 0.55, 0.45), width: 0.3, opacity: 0.45 };
  const rows = Math.ceil((height + rise) / plank) + 1;
  for (let column = 0; column * columnWidth < width; column++) {
    const left = column * columnWidth;
    const middle = left + half;
    const right = left + columnWidth;
    for (let row = -1; row < rows; row++) {
      const top = row * plank - rise;
      const tone = (i: number) => {
        const s = shade(2 * column + i, row);
        return mix(base, s > 0 ? light : dark, Math.abs(s) * 0.5);
      };
      polygon(
        page,
        [
          [left, top + rise],
          [middle, top],
          [middle, top + plank],
          [left, top + rise + plank],
        ],
        tone(0),
        edge,
      );
      polygon(
        page,
        [
          [middle, top],
          [right, top + rise],
          [right, top + rise + plank],
          [middle, top + plank],
        ],
        tone(1),
        edge,
      );
    }
  }
}

const PAINTERS: Readonly<
  Record<MaterialBackdrop, (page: PDFPage, width: number, height: number) => void>
> = {
  studio: drawStudio,
  concrete: drawConcrete,
  tiled: drawTiles,
  parquet: drawParquet,
};

/** Draws a material's backdrop over the whole page; width and height are in millimetres. */
export function drawMaterialBackdrop(
  page: PDFPage,
  backdrop: MaterialBackdrop,
  width: number,
  height: number,
): void {
  PAINTERS[backdrop](page, width, height);
}
