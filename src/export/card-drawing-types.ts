/** PDF transformation: x' = a*x + c*y + e and y' = b*x + d*y + f. */
export type Matrix = readonly [a: number, b: number, c: number, d: number, e: number, f: number];

/**
 * A move, line, cubic or quadratic curve, or closure of a drawing path. Its points are in the space
 * of the step that holds it, with y upwards as in PDF: for a path, the current transformation's,
 * in PDF points until a transform step changes it; for a text, the text's own, which its matrix
 * places.
 */
export type PathSegment =
  | {
      /** Starts a new part of the path at the point (x, y), or draws a straight line to it. */
      readonly to: "move" | "line";
      /** The horizontal position of the point. */
      readonly x: number;
      /** The vertical position of the point. */
      readonly y: number;
    }
  | {
      /** Draws a cubic Bezier curve to the point (x, y), bent by two control points. */
      readonly to: "curve";
      /** The horizontal position of the first control point. */
      readonly x1: number;
      /** The vertical position of the first control point. */
      readonly y1: number;
      /** The horizontal position of the second control point. */
      readonly x2: number;
      /** The vertical position of the second control point. */
      readonly y2: number;
      /** The horizontal position of the end point. */
      readonly x: number;
      /** The vertical position of the end point. */
      readonly y: number;
    }
  // Quadratic curves occur only in letter outlines.
  | {
      /** Draws a quadratic Bezier curve to the point (x, y), bent by one control point. */
      readonly to: "quadratic";
      /** The horizontal position of the control point. */
      readonly x1: number;
      /** The vertical position of the control point. */
      readonly y1: number;
      /** The horizontal position of the end point. */
      readonly x: number;
      /** The vertical position of the end point. */
      readonly y: number;
    }
  | {
      /** Closes the current part of the path with a straight line back to where it started. */
      readonly to: "close";
    };

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
  | {
      /**
       * Saves the graphics state (the transformation, the colours, the line settings, the opacities
       * and the clip), or restores the one saved last.
       */
      readonly do: "save" | "restore";
    }
  | {
      /** Changes the current transformation, as PDF's cm command does. */
      readonly do: "transform";
      /** What a point goes through first, before the transformation that was current. */
      readonly matrix: Matrix;
    }
  | {
      /** Sets the colour of fills and text, or the colour of strokes. */
      readonly do: "fillColor" | "strokeColor";
      /** The red channel, from 0 to 1. */
      readonly red: number;
      /** The green channel, from 0 to 1. */
      readonly green: number;
      /** The blue channel, from 0 to 1. */
      readonly blue: number;
    }
  | ({
      /** Sets the settings of GraphicsSettings that it gives; one it leaves out keeps its value. */
      readonly do: "graphicsState";
    } & GraphicsSettings)
  | {
      /** Sets the width of the lines that strokes draw. */
      readonly do: "lineWidth";
      /** The width, in the units of the current transformation. */
      readonly width: number;
    }
  | {
      /** Sets the dashes of the lines that strokes draw; an empty pattern draws them solid. */
      readonly do: "dash";
      /** The lengths of the dashes and the gaps in turn, in the current transformation's units. */
      readonly pattern: readonly number[];
      /** How far into the pattern every line starts, in the same units. */
      readonly phase: number;
    }
  | {
      /** Paints a path: fills it, strokes it, both or neither, and may clip to it. */
      readonly do: "path";
      /** The path, in the space of the current transformation. */
      readonly segments: readonly PathSegment[];
      /** Whether the inside of the path is filled with the fill colour, by the nonzero rule. */
      readonly fill: boolean;
      /** Whether the path is drawn as lines with the stroke colour, width and dashes. */
      readonly stroke: boolean;
      /** Also limits subsequent drawing until its matching restore. */
      readonly clip: boolean;
      /** Which points are inside the path for the clip; "nonzero" where `clip` is false. */
      readonly clipRule: ClipRule;
    }
  /** Placed outlines of one piece of text. */
  | {
      /** Fills the outlines of the letters of a piece of text with the fill colour. */
      readonly do: "text";
      /** The text matrix, which places the outlines in the space of the current transformation. */
      readonly matrix: Matrix;
      /** The outlines of the letters, one after another from 0, at the size of the font. */
      readonly segments: readonly PathSegment[];
    }
  /** Drawn into the current transformation's square from (0, 0) to (1, 1). */
  | {
      /** Draws an image. */
      readonly do: "image";
      /** The pixels, which the reader operation lends or hands over (CardImage). */
      readonly image: CardImage;
    };

/** Drawing steps of one page, replayed by the host on its canvas. */
export interface CardPageDrawing {
  /** Page width in PDF points, 72 to an inch. */
  readonly width: number;
  /** Page height in PDF points, 72 to an inch. */
  readonly height: number;
  /** Ordered operations, with image ownership defined by the reader operation. */
  readonly steps: readonly DrawingStep[];
}
