/** PDF transformation: x' = a*x + c*y + e and y' = b*x + d*y + f. */
export type Matrix = readonly [a: number, b: number, c: number, d: number, e: number, f: number];

/** A move, line, cubic or quadratic curve, or closure of a drawing path. */
export type PathSegment =
  | { readonly to: "move" | "line"; readonly x: number; readonly y: number }
  | {
      readonly to: "curve";
      readonly x1: number;
      readonly y1: number;
      readonly x2: number;
      readonly y2: number;
      readonly x: number;
      readonly y: number;
    }
  // Quadratic curves occur only in letter outlines.
  | {
      readonly to: "quadratic";
      readonly x1: number;
      readonly y1: number;
      readonly x: number;
      readonly y: number;
    }
  | { readonly to: "close" };

/**
 * Image bytes: borrowed until reader disposal from pages(), transferred to the caller from
 * takePages()/readCardPages(). A receiving caller wipes transferred data and alpha after use.
 */
export interface CardImage {
  /** Image width in pixels. */
  readonly width: number;
  /** Image height in pixels. */
  readonly height: number;
  /** Three RGB bytes per pixel, or a complete encoded JPEG file. */
  readonly format: "rgb" | "jpeg";
  /** Row-major RGB pixels or encoded JPEG bytes, according to format. */
  readonly data: Uint8Array;
  /** One opacity byte per pixel; absent for an opaque image. */
  readonly alpha?: Uint8Array;
}

/** Plain painting or the hue and colourfulness of a tint. */
export type BlendMode = "normal" | "color";

/** Nonzero or even-odd path clipping. */
export type ClipRule = "nonzero" | "evenodd";

/** The supported settings of one PDF graphics state. */
export interface GraphicsSettings {
  /** Opacity of fills and text, from 0 to 1. */
  readonly fill?: number;
  /** Opacity of strokes, from 0 to 1. */
  readonly stroke?: number;
  /** The supported compositing mode. */
  readonly blend?: BlendMode;
}

/** Replayable operations; positions use PDF points and colour/opacity channels use 0 to 1. */
export type DrawingStep =
  | { readonly do: "save" | "restore" }
  | { readonly do: "transform"; readonly matrix: Matrix }
  | {
      readonly do: "fillColor" | "strokeColor";
      readonly red: number;
      readonly green: number;
      readonly blue: number;
    }
  | ({ readonly do: "graphicsState" } & GraphicsSettings)
  | { readonly do: "lineWidth"; readonly width: number }
  | { readonly do: "dash"; readonly pattern: readonly number[]; readonly phase: number }
  | {
      readonly do: "path";
      readonly segments: readonly PathSegment[];
      readonly fill: boolean;
      readonly stroke: boolean;
      /** Also limits subsequent drawing until its matching restore. */
      readonly clip: boolean;
      readonly clipRule: ClipRule;
    }
  /** Placed outlines of one piece of text. */
  | { readonly do: "text"; readonly matrix: Matrix; readonly segments: readonly PathSegment[] }
  /** Drawn into the current transformation's square from (0, 0) to (1, 1). */
  | { readonly do: "image"; readonly image: CardImage };

/** Drawing steps of one page, replayed by the host on its canvas. */
export interface CardPageDrawing {
  /** Page width in PDF points, 72 to an inch. */
  readonly width: number;
  /** Page height in PDF points, 72 to an inch. */
  readonly height: number;
  /** Ordered operations, with image ownership defined by the reader operation. */
  readonly steps: readonly DrawingStep[];
}
