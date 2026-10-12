import {
  BundledAssetCache,
  createRasterImage,
  pixelOffset,
  RGBA_CHANNELS,
  type AssetSource,
  type PngCodec,
  type RasterImage,
} from "./platform.js";
import {
  businessDesigns,
  type BusinessTint,
  type PhysicalBusinessStyle,
} from "./business-designs.js";
import { hueAndSaturation, pixelHsv, rgbOfHsv } from "./color-math.js";
import { rgbReferenceDigits } from "../core/colors.js";
import { BUSINESS_CARD_MM } from "./card-settings.js";

/** Pixels per millimetre of the business artwork: 254 dpi, 900 x 500 on a business card. */
const ARTWORK_PIXELS_PER_MM = 10;

/**
 * How strongly a design's coloured parts take the reference's colour: the factor of their
 * saturation, from the reference's saturation, and of their value. The muted designs keep a
 * quieter, darker tint; the approved artwork was drawn with these numbers.
 */
const TINTS: Readonly<
  Record<BusinessTint, { readonly saturation: (target: number) => number; readonly value: number }>
> = Object.freeze({
  vivid: { saturation: (target) => Math.max(0.65, target), value: 1 },
  muted: { saturation: (target) => Math.max(0.35, Math.min(0.68, target * 0.75)), value: 0.86 },
});
/**
 * A pixel of the artwork less saturated than this, or darker than NEUTRAL_PIXEL_VALUE, keeps its
 * colour: the black paper, the white lettering and icons, and the highlights stay neutral.
 */
const NEUTRAL_PIXEL_SATURATION = 0.2;
const NEUTRAL_PIXEL_VALUE = 0.08;
/** Below this saturation a reference counts as grey: the artwork turns grey and darker. */
const GREY_REFERENCE_SATURATION = 0.08;
/** The factor of the value of a grey reference's artwork. */
const GREY_VALUE = 0.6;

/** The approved photograph of a design, decoded, as cards draw it: resampled to a card. */
function resampled(original: RasterImage): RasterImage {
  // 254 dpi on a business card; smooth sampling preserves the approved photo detail.
  const out = createRasterImage(
    BUSINESS_CARD_MM.width * ARTWORK_PIXELS_PER_MM,
    BUSINESS_CARD_MM.height * ARTWORK_PIXELS_PER_MM,
  );
  // Pixel-center bilinear sampling; retain this arithmetic order for identical output.
  for (let y = 0; y < out.height; y++)
    for (let x = 0; x < out.width; x++) {
      const sx = ((x + 0.5) * original.width) / out.width - 0.5;
      const sy = ((y + 0.5) * original.height) / out.height - 0.5;
      const x0 = Math.max(0, Math.floor(sx));
      const y0 = Math.max(0, Math.floor(sy));
      const x1 = Math.min(original.width - 1, x0 + 1);
      const y1 = Math.min(original.height - 1, y0 + 1);
      const dx = sx - x0;
      const dy = sy - y0;
      for (let c = 0; c < RGBA_CHANNELS; c++)
        out.data[pixelOffset(out, x, y) + c] = Math.round(
          original.data[pixelOffset(original, x0, y0) + c]! * (1 - dx) * (1 - dy) +
            original.data[pixelOffset(original, x1, y0) + c]! * dx * (1 - dy) +
            original.data[pixelOffset(original, x0, y1) + c]! * (1 - dx) * dy +
            original.data[pixelOffset(original, x1, y1) + c]! * dx * dy,
        );
    }
  return out;
}

/**
 * The business artwork of one host: the approved photograph of each design, read and decoded with
 * the host's platform and resampled once, then recoloured for each reference on request. A class,
 * because it owns the prepared photographs, which belong to the platform that decoded them
 * (BundledAssetCache): bundled images only, never a caller's recoloured references.
 */
export class BusinessArtwork {
  readonly #codec: PngCodec;
  readonly #photographs: BundledAssetCache<RasterImage>;

  constructor(platform: AssetSource & PngCodec) {
    this.#codec = platform;
    this.#photographs = new BundledAssetCache(platform, (bytes) =>
      resampled(platform.decodePng(bytes)),
    );
  }

  /**
   * The artwork of `style` for the reference `hex`, as PNG bytes. Decorative hue follows the
   * reference approximately. The printed HEX remains exact.
   */
  async recoloured(style: PhysicalBusinessStyle, hex: string): Promise<Uint8Array> {
    rgbReferenceDigits(hex);
    const base = await this.#photographs.get(`images/business-${style}-v1.png`);
    const { hueOrigin, tint } = businessDesigns[style];
    const [targetHue, targetSaturation] = hueAndSaturation(hex);
    const out = createRasterImage(base.width, base.height);
    out.data.set(base.data);
    for (let p = 0; p < out.data.length; p += RGBA_CHANNELS) {
      const [h, s, v] = pixelHsv(out.data, p);
      if (s < NEUTRAL_PIXEL_SATURATION || v < NEUTRAL_PIXEL_VALUE) continue;
      const hue = (((h + targetHue - hueOrigin) % 1) + 1) % 1;
      const grey = targetSaturation < GREY_REFERENCE_SATURATION;
      const sat = grey ? 0 : s * TINTS[tint].saturation(targetSaturation);
      const value = v * (grey ? GREY_VALUE : TINTS[tint].value);
      const [red, green, blue] = rgbOfHsv(hue, sat, value);
      out.data[p] = red;
      out.data[p + 1] = green;
      out.data[p + 2] = blue;
    }
    return this.#codec.encodePng(out, 6);
  }
}
