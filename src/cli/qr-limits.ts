// The limits of a QR code image that a command reads (qr-input.ts). Apart from the reader, so that
// the menu's check of a file and the help name them without depending on how a QR code is read.

import { MEBIBYTE } from "./bounded-read.js";

/** The largest QR code image that a command reads; the menu checks a file's size against it. */
export const MAX_PNG_BYTES = 16 * MEBIBYTE;
/** The widest and tallest QR code image that a command reads, in pixels. */
export const MAX_PNG_DIMENSION = 4096;
/** A megapixel as the limit names it: 2^20 pixels, counted as a mebibyte is. */
export const MEGAPIXEL = MEBIBYTE;
/** The most pixels of a QR code image that a command reads. */
export const MAX_PNG_PIXELS = 16 * MEGAPIXEL;
