// Which of the four ink ribbons of the photographed frosted-glass card each pixel belongs to and
// its tone: the gold ribbon above, the teal and the blue ones in the middle and the gold one below,
// which glass-artwork.ts recolours with a card's references. The thin white lines between the
// ribbons are traced column by column from the middle of the card to its white rims, and every
// pixel between two lines belongs to the ribbon there. Towards the rims the frost fades the
// ribbons; their tone there is brought back to the tone a little further in. So a ribbon keeps its
// colour up to the rims, without white specks or a strip of photographed gold (owner, 2026-10-09).
//
// The hue, saturation and position bounds below belong to the approved 4-in-1 photograph, not to
// any data format.
//
// Host-neutral: it imports only color-math.ts and platform.ts (test/portable-modules.test.ts).

import { pixelHsv } from "./color-math.js";
import { pixelOffset, type RasterImage } from "./platform.js";

/** No ribbon: the background, the white lines and rims and the highlights keep the photograph. */
export const NO_RIBBON = -1;

/** The ribbons from the top: gold, teal, blue, gold; a card's references take them in order. */
const GOLD_ABOVE = 0;
const GOLD_BELOW = 3;

/** The rows searched for the middle ribbons and the rims, as parts of the photograph's height. */
const SEARCH_TOP = 0.22;
const SEARCH_BOTTOM = 0.69;
/** Rows of photographic highlight bridged inside a middle ribbon, and inside a gold one. */
const RIBBON_GAP = 6;
const GOLD_GAP = 3;
/** The rows a middle ribbon must show in the middle column, where the lines are first found. */
const MIN_RIBBON_ROWS = 12;
/**
 * Where each white line lies from the boundaries measured in the middle column: above the gold
 * ribbon and above the teal one, between the teal and the blue one, below the blue ribbon and
 * below the gold one.
 */
const LINE_OFFSETS = [-1, -1, 0, 1, 1] as const;
/** Rows searched for a line around its measured row, and around the row its slope leads to. */
const SEED_SEARCH_ROWS = 3;
const TRACE_SEARCH_ROWS = 2;
/** The traced columns whose slope carries a line on to the next column. */
const SLOPE_COLUMNS = 8;
/** A white rim of the card: a column brighter than this and less saturated than that, in median. */
const RIM_VALUE = 0.97;
const RIM_SATURATION = 0.04;
/** The columns next to a rim whose line carries each white line on straight beyond the rim. */
const CONTINUE_COLUMNS = 10;
/** Half a white line: the rows from its middle in which a pixel is the line itself. */
const HALF_LINE_ROWS = 0.5;
/** Rows by which the glass edge shifts a gold ribbon past the lines beyond a rim, at most. */
const BEYOND_RIM_GOLD_ROWS = 8;
/** Rows from every line at which a pixel shows the tone of its ribbon alone. */
const CORE_ROWS = 2;
/** Columns on each side over which the tone of a ribbon is taken. */
const SMOOTH_COLUMNS = 7;
/** Columns from a rim, inside the card, where the frost no longer fades the ribbons. */
const FADE_COLUMNS = 55;

/** The hue, saturation and value of every pixel, from 0 to 1, row by row. */
interface Channels {
  readonly hue: Float64Array;
  readonly saturation: Float64Array;
  readonly value: Float64Array;
}

function channelsOf(image: RasterImage): Channels {
  const count = image.width * image.height;
  const hue = new Float64Array(count);
  const saturation = new Float64Array(count);
  const value = new Float64Array(count);
  for (let y = 0; y < image.height; y++)
    for (let x = 0; x < image.width; x++) {
      const [h, s, v] = pixelHsv(image.data, pixelOffset(image, x, y));
      const at = y * image.width + x;
      hue[at] = h;
      saturation[at] = s;
      value[at] = v;
    }
  return { hue, saturation, value };
}

const isTeal = (h: number, s: number) => s > 0.22 && h > 0.43 && h < 0.56;
const isBlue = (h: number, s: number) => s > 0.15 && h >= 0.56 && h < 0.68;
const isStrongGold = (h: number, s: number) => s > 0.16 && h > 0.04 && h < 0.19;
/** A white line, a rim or a highlight, which keeps the photograph. */
const isHighlight = (s: number, v: number) => s < 0.07 || v > 0.985;

/** The median of the `values` that are numbers, or NaN if none is. */
function median(values: readonly number[]): number {
  const sorted = values.filter((value) => !Number.isNaN(value)).sort((a, b) => a - b);
  if (sorted.length === 0) return Number.NaN;
  const half = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[half]! : (sorted[half - 1]! + sorted[half]!) / 2;
}

/** A line through the points `xs`, `ys`: its slope and its intercept. */
function lineThrough(xs: readonly number[], ys: readonly number[]): readonly [number, number] {
  const meanX = xs.reduce((sum, x) => sum + x, 0) / xs.length;
  const meanY = ys.reduce((sum, y) => sum + y, 0) / ys.length;
  let covariance = 0;
  let variance = 0;
  xs.forEach((x, index) => {
    covariance += (x - meanX) * (ys[index]! - meanY);
    variance += (x - meanX) ** 2;
  });
  const slope = covariance / variance;
  return [slope, meanY - slope * meanX];
}

/**
 * The longest run of the ascending `rows`, bridging gaps of up to RIBBON_GAP rows; the first if
 * tied.
 */
function longestRun(rows: readonly number[]): readonly [number, number] | undefined {
  const runs: [number, number][] = [];
  for (const y of rows) {
    const last = runs.at(-1);
    if (last && y - last[1] <= RIBBON_GAP) last[1] = y;
    else runs.push([y, y]);
  }
  let best: [number, number] | undefined;
  for (const run of runs) if (best === undefined || run[1] - run[0] > best[1] - best[0]) best = run;
  return best;
}

/** The photograph of the card with its colour channels, read column by column. */
class Photograph {
  readonly width: number;
  readonly height: number;
  private readonly colour: Channels;
  /** The rows searched for the middle ribbons and the rims. */
  private readonly searched: readonly number[];

  constructor(image: RasterImage) {
    this.width = image.width;
    this.height = image.height;
    this.colour = channelsOf(image);
    const searched: number[] = [];
    for (let y = Math.floor(image.height * SEARCH_TOP); y < image.height * SEARCH_BOTTOM; y++)
      searched.push(y);
    this.searched = searched;
  }

  index(x: number, y: number): number {
    return y * this.width + x;
  }

  saturation(at: number): number {
    return this.colour.saturation[at]!;
  }

  value(at: number): number {
    return this.colour.value[at]!;
  }

  isStrongGold(at: number): boolean {
    return isStrongGold(this.colour.hue[at]!, this.colour.saturation[at]!);
  }

  isHighlight(at: number): boolean {
    return isHighlight(this.saturation(at), this.value(at));
  }

  /** Whether column `x` is a white rim of the card. */
  isRim(x: number): boolean {
    const column = (channel: Float64Array) => this.searched.map((y) => channel[this.index(x, y)]!);
    return (
      median(column(this.colour.value)) > RIM_VALUE &&
      median(column(this.colour.saturation)) < RIM_SATURATION
    );
  }

  /**
   * The rows of column `x` where its gold ribbon above begins, its teal ribbon begins, the teal
   * and the blue ribbon meet, its blue ribbon ends and its gold ribbon below ends.
   */
  boundaries(x: number): readonly number[] {
    const teal: number[] = [];
    const blue: number[] = [];
    for (const y of this.searched) {
      const at = this.index(x, y);
      if (isTeal(this.colour.hue[at]!, this.saturation(at))) teal.push(y);
      if (isBlue(this.colour.hue[at]!, this.saturation(at))) blue.push(y);
    }
    const t = longestRun(teal);
    const b = longestRun(blue);
    if (!t || !b || t[1] - t[0] < MIN_RIBBON_ROWS || b[1] - b[0] < MIN_RIBBON_ROWS)
      throw new Error("The glass photograph shows no ribbons in its middle.");
    // The last strongly gold row from `start` on in direction `step`, highlight gaps bridged.
    const goldEdge = (start: number, step: number): number => {
      let last: number | undefined;
      for (let y = start, gap = 0; y >= 0 && y < this.height && gap <= GOLD_GAP; y += step) {
        const at = this.index(x, y);
        // The white line beyond the gold ends it, never bridged into the background; the line
        // between the gold and a middle ribbon comes before any gold and is passed.
        if (last !== undefined && this.isHighlight(at)) break;
        if (this.isStrongGold(at)) {
          last = y;
          gap = 0;
        } else gap += 1;
      }
      if (last === undefined) throw new Error("The glass photograph shows no gold ribbon.");
      return last;
    };
    return [goldEdge(t[0] - 1, -1), t[0], (t[1] + b[0]) / 2, b[1], goldEdge(b[1] + 1, 1)];
  }
}

/**
 * The middle row of each white line in every column: traced from the middle column to the rims,
 * where the frost leaves the ribbons pale but the lines still stand out, and carried on straight
 * beyond the rims. The traced columns run from `inner[0]` to `inner[1]`.
 */
class WhiteLines {
  readonly rows: readonly Float64Array[];
  readonly inner: readonly [number, number];
  private readonly whiteness: Float64Array;

  constructor(
    private readonly photograph: Photograph,
    rim: readonly boolean[],
  ) {
    this.whiteness = WhiteLines.whitenessOf(photograph);
    const seed = Math.floor(photograph.width / 2);
    const boundaries = photograph.boundaries(seed);
    this.rows = boundaries.map((row, line) => this.traced(seed, row + LINE_OFFSETS[line]!, rim));
    const traced = [...this.rows[0]!.keys()].filter((x) => !Number.isNaN(this.rows[0]![x]!));
    this.inner = [Math.min(...traced), Math.max(...traced)];
    for (const line of this.rows) this.carryOn(line);
  }

  /** How white each pixel is, averaged with its left and right neighbours against the noise. */
  private static whitenessOf(photograph: Photograph): Float64Array {
    const { width, height } = photograph;
    const own = (at: number) => photograph.value(at) * (1 - photograph.saturation(at));
    const whiteness = new Float64Array(width * height);
    for (let y = 0; y < height; y++)
      for (let x = 0; x < width; x++) {
        const at = photograph.index(x, y);
        whiteness[at] =
          x === 0 || x === width - 1 ? own(at) : (own(at - 1) + own(at) + own(at + 1)) / 3;
      }
    return whiteness;
  }

  /** The whitest row of column `x` within `reach` rows of `centre`, refined by a parabola. */
  private whitestRow(x: number, centre: number, reach: number): number {
    const whiteness = (y: number) => this.whiteness[this.photograph.index(x, y)]!;
    const first = Math.floor(centre + 0.5) - reach;
    let best = first;
    for (let y = first + 1; y <= first + 2 * reach; y++)
      if (whiteness(y) > whiteness(best)) best = y;
    const above = whiteness(best - 1);
    const below = whiteness(best + 1);
    const curvature = above - 2 * whiteness(best) + below;
    return curvature < 0 ? best + (0.5 * (above - below)) / curvature : best;
  }

  /** One line from `seedRow` in the middle column `seed` out to the rims; NaN beyond them. */
  private traced(seed: number, seedRow: number, rim: readonly boolean[]): Float64Array {
    const line = new Float64Array(this.photograph.width).fill(Number.NaN);
    line[seed] = this.whitestRow(seed, seedRow, SEED_SEARCH_ROWS);
    for (const step of [1, -1])
      for (
        let x = seed + step, travelled = 1;
        x >= 0 && x < this.photograph.width && !rim[x];
        x += step, travelled++
      ) {
        const back = Math.min(SLOPE_COLUMNS, travelled);
        const last = line[x - step]!;
        const slope = back > 1 ? (last - line[x - step * back]!) / (back - 1) : 0;
        line[x] = this.whitestRow(x, last + slope, TRACE_SEARCH_ROWS);
      }
    return line;
  }

  /** Carries `line` on straight beyond the traced columns, as the columns next to them lead. */
  private carryOn(line: Float64Array): void {
    const [left, right] = this.inner;
    const straight = (from: number, columns: readonly number[]) => {
      const xs = Array.from({ length: CONTINUE_COLUMNS }, (_, i) => from + i);
      const [slope, intercept] = lineThrough(
        xs,
        xs.map((x) => line[x]!),
      );
      for (const x of columns) line[x] = slope * x + intercept;
    };
    straight(
      left,
      Array.from({ length: left }, (_, x) => x),
    );
    straight(
      right - CONTINUE_COLUMNS + 1,
      Array.from({ length: line.length - right - 1 }, (_, i) => right + 1 + i),
    );
  }

  /** The rows from pixel row `y` of column `x` to the nearest line. */
  distance(x: number, y: number): number {
    return Math.min(...this.rows.map((line) => Math.abs(y - line[x]!)));
  }
}

/**
 * The ribbons of the photographed glass card and the tone of each of their pixels, which
 * glass-artwork.ts recolours with a card's references.
 */
export class GlassRibbons {
  private constructor(
    private readonly ribbons: Int8Array,
    private readonly saturation: Float64Array,
    private readonly value: Float64Array,
  ) {}

  /** The ribbons of `image`, the photographed 4-in-1 glass card. */
  static of(image: RasterImage): GlassRibbons {
    const photograph = new Photograph(image);
    const { width, height } = photograph;
    const rim = Array.from({ length: width }, (_, x) => photograph.isRim(x));
    const lines = new WhiteLines(photograph, rim);
    const [innerLeft, innerRight] = lines.inner;
    const ribbons = new Int8Array(width * height).fill(NO_RIBBON);
    const distance = new Float64Array(width * height).fill(Number.POSITIVE_INFINITY);
    for (let x = 0; x < width; x++) {
      if (rim[x]) continue;
      const top = lines.rows[0]![x]! - HALF_LINE_ROWS;
      const bottom = lines.rows[4]![x]! + HALF_LINE_ROWS;
      for (let y = 0; y < height; y++) {
        const at = photograph.index(x, y);
        if (y >= top && y <= bottom)
          ribbons[at] = [1, 2, 3].filter((line) => y > lines.rows[line]![x]!).length;
        distance[at] = lines.distance(x, y);
      }
      if (x >= innerLeft && x <= innerRight) continue;
      // Beyond a rim the glass edge shifts the gold ribbons past the lines carried on.
      const grow = (start: number, step: number, ribbon: number) => {
        for (
          let y = start, rows = 0;
          y >= 0 && y < height && rows < BEYOND_RIM_GOLD_ROWS;
          y += step
        ) {
          const at = photograph.index(x, y);
          if (!photograph.isStrongGold(at) || photograph.isHighlight(at)) break;
          ribbons[at] = ribbon;
          rows++;
        }
      };
      grow(Math.ceil(top) - 1, -1, GOLD_ABOVE);
      grow(Math.floor(bottom) + 1, 1, GOLD_BELOW);
    }
    const fades = GlassRibbons.fades(photograph, ribbons, distance, lines.inner);
    const saturation = new Float64Array(width * height);
    const value = new Float64Array(width * height);
    for (let at = 0; at < width * height; at++) {
      saturation[at] = photograph.saturation(at);
      value[at] = photograph.value(at);
      const ribbon = ribbons[at]!;
      if (ribbon === NO_RIBBON) continue;
      // The white lines keep their own tone; a pixel a row away from them takes the whole fade.
      const weight = Math.min(1, Math.max(0, distance[at]! - HALF_LINE_ROWS));
      const fade = fades[ribbon]![at % width]!;
      const s = Math.min(1, photograph.saturation(at) + weight * fade.saturation);
      const v = Math.max(0, photograph.value(at) - weight * fade.value);
      if (isHighlight(s, v)) ribbons[at] = NO_RIBBON;
      else {
        saturation[at] = s;
        value[at] = v;
      }
    }
    return new GlassRibbons(ribbons, saturation, value);
  }

  /**
   * For each ribbon and column, the saturation the frost took from the ribbon there and the value
   * it added, against the column FADE_COLUMNS inside the nearer rim; nothing elsewhere.
   */
  private static fades(
    photograph: Photograph,
    ribbons: Int8Array,
    distance: Float64Array,
    [innerLeft, innerRight]: readonly [number, number],
  ): { readonly saturation: number; readonly value: number }[][] {
    const { width, height } = photograph;
    const columns = Array.from({ length: width }, (_, x) => x);
    return [0, 1, 2, 3].map((ribbon) => {
      // The tone of the ribbon in each column, away from the lines, smoothed over the columns.
      const tone = (channel: (at: number) => number) => {
        const raw = columns.map((x) => {
          const core: number[] = [];
          for (let y = 0; y < height; y++) {
            const at = photograph.index(x, y);
            if (ribbons[at] === ribbon && distance[at]! >= CORE_ROWS) core.push(channel(at));
          }
          return median(core);
        });
        return columns.map((x) =>
          x >= innerLeft && x <= innerRight
            ? median(
                raw.slice(
                  Math.max(innerLeft, x - SMOOTH_COLUMNS),
                  Math.min(innerRight, x + SMOOTH_COLUMNS) + 1,
                ),
              )
            : Number.NaN,
        );
      };
      const saturation = tone((at) => photograph.saturation(at));
      const value = tone((at) => photograph.value(at));
      const leftReference = innerLeft + FADE_COLUMNS;
      const rightReference = innerRight - FADE_COLUMNS;
      // A difference that is not positive, or not known, is no fade.
      const fade = (difference: number) => (difference > 0 ? difference : 0);
      return columns.map((x) => {
        const reference =
          x < leftReference ? leftReference : x > rightReference ? rightReference : undefined;
        if (reference === undefined) return { saturation: 0, value: 0 };
        const here = Math.min(Math.max(x, innerLeft), innerRight);
        return {
          saturation: fade(saturation[reference]! - saturation[here]!),
          value: fade(value[here]! - value[reference]!),
        };
      });
    });
  }

  /** The ribbon of pixel `at`, row by row: 0 to 3 from the top, or NO_RIBBON. */
  ribbonAt(at: number): number {
    return this.ribbons[at]!;
  }

  /** The saturation and the value of pixel `at`, from 0 to 1, with the frost's fade taken out. */
  toneAt(at: number): readonly [saturation: number, value: number] {
    return [this.saturation[at]!, this.value[at]!];
  }
}
