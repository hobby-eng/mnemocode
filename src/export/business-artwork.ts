import {
  BundledAssetCache,
  createRasterImage,
  pixelOffset,
  RGBA_CHANNELS,
  type AssetSource,
  type PngCodec,
  type RasterImage,
} from "./platform.js";
import { BUSINESS_DESIGNS, type PhysicalBusinessStyle } from "./business-designs.js";
import { pixelHsv, rgbOfHsv } from "./color-math.js";
import { ReferenceTint } from "./business-tint.js";
import { rgbReferenceDigits } from "../core/colors.js";
import { BUSINESS_CARD_MM } from "./card-settings.js";
import { defined } from "../core/defined.js";

/** Pixels per millimetre of the business artwork: 254 dpi, 900 x 500 on a business card. */
const ARTWORK_PIXELS_PER_MM = 10;
/**
 * The deflate level of the recoloured artwork's PNG: level 6, selected by zlib's default
 * (Z_DEFAULT_COMPRESSION is -1), balances size against time as recoloured encodes it for each
 * reference.
 */
const ARTWORK_DEFLATE_LEVEL = 6;

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
          defined(original.data[pixelOffset(original, x0, y0) + c]) * (1 - dx) * (1 - dy) +
            defined(original.data[pixelOffset(original, x1, y0) + c]) * dx * (1 - dy) +
            defined(original.data[pixelOffset(original, x0, y1) + c]) * (1 - dx) * dy +
            defined(original.data[pixelOffset(original, x1, y1) + c]) * dx * dy,
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

  /**
   * Artwork that reads and decodes each photograph with `platform` on its first use, and encodes
   * the recoloured PNG with it. It reads nothing yet.
   */
  constructor(platform: AssetSource & PngCodec) {
    this.#codec = platform;
    this.#photographs = new BundledAssetCache(platform, (bytes) =>
      resampled(platform.decodePng(bytes)),
    );
  }

  /**
   * The artwork of `style` for the reference `hex`, as PNG bytes. Decorative hue, saturation and
   * brightness follow the reference approximately. The printed HEX remains exact. Refuses a `hex`
   * that is no RGB reference (core.colors.invalid-rgb-reference), as rgbReferenceDigits does,
   * before any photograph is read; a photograph that cannot be read or decoded is refused
   * (export.platform.cannot-load-card-artwork), and a failure of the platform to encode the PNG
   * passes on.
   */
  async recoloured(style: PhysicalBusinessStyle, hex: string): Promise<Uint8Array> {
    rgbReferenceDigits(hex);
    const base = await this.#photographs.get(`images/business-${style}-v1.png`);
    const { hueOrigin, tint } = BUSINESS_DESIGNS[style];
    const reference = new ReferenceTint(hex);
    const out = createRasterImage(base.width, base.height);
    try {
      out.data.set(base.data);
      for (let p = 0; p < out.data.length; p += RGBA_CHANNELS) {
        const pixel = pixelHsv(out.data, p);
        if (ReferenceTint.keeps(pixel)) continue;
        const [red, green, blue] = rgbOfHsv(...reference.pixel(pixel, tint, hueOrigin));
        out.data[p] = red;
        out.data[p + 1] = green;
        out.data[p + 2] = blue;
      }
      const png = this.#codec.encodePng(out, ARTWORK_DEFLATE_LEVEL);
      // Detach an accidental host alias before retiring the borrowed recoloured pixels.
      return png.buffer === out.data.buffer ? Uint8Array.from(png) : png;
    } finally {
      out.data.fill(0);
    }
  }
}
