import {
  BundledAssetCache,
  createRasterImage,
  pixelOffset,
  type AssetSource,
  type PngCodec,
  type RasterImage,
} from "./platform.js";
import { hsv, rgbChannels, rgbOfHsv } from "./color-math.js";
import { isRgbReference } from "../core/colors.js";
import { PHOTOGRAPHED_GLASS_REFERENCES, type GlassReferencesPerCard } from "./template-catalog.js";
import { GlassRibbons, NO_RIBBON } from "./glass-ribbons.js";

/** The photographed design decoded, with the ribbon and the tone of each of its pixels. */
interface Photograph {
  readonly image: RasterImage;
  readonly ribbons: GlassRibbons;
}

/**
 * The glass artwork of one host. A class, because it owns the bundled artwork that it read and
 * prepared with the host's platform: the photographed four-reference design, decoded to be
 * recoloured, with the ribbon and the tone of each of its pixels, which depend on the photograph
 * alone and so are worked out once; and the compact designs' JPEG palettes, drawn as they are.
 * Only bundled public artwork is kept; the colors of an export's references never are.
 */
export class GlassArtwork {
  readonly #codec: PngCodec;
  readonly #photographed: BundledAssetCache<Photograph>;
  readonly #compact: BundledAssetCache<Uint8Array>;

  constructor(platform: AssetSource & PngCodec) {
    this.#codec = platform;
    this.#photographed = new BundledAssetCache(platform, (bytes) => {
      const image = platform.decodePng(bytes);
      return { image, ribbons: GlassRibbons.of(image) };
    });
    this.#compact = new BundledAssetCache(platform, (bytes) => bytes);
  }

  /** The approved 4-in-1 recolors ink ribbons; compact 6/8 use fixed decorative JPEG palettes. */
  async of(
    references: readonly string[],
    referencesPerCard: GlassReferencesPerCard = PHOTOGRAPHED_GLASS_REFERENCES,
  ): Promise<Uint8Array> {
    if (
      references.length < 1 ||
      references.length > referencesPerCard ||
      !references.every(isRgbReference)
    )
      throw new Error(`Glass cards require one through ${referencesPerCard} RGB references.`);
    if (referencesPerCard !== PHOTOGRAPHED_GLASS_REFERENCES)
      return this.#compact.get(`images/business-glass-${referencesPerCard}in1.jpg`);
    const { image: base, ribbons } = await this.#photographed.get("images/business-glass-4in1.png");
    const out = createRasterImage(base.width, base.height);
    out.data.set(base.data);
    const targets = references.map((ref) => hsv(...rgbChannels(ref)));
    // Each ribbon takes one reference, in order from the top (glass-ribbons.ts).
    for (let y = 0; y < base.height; y++)
      for (let x = 0; x < base.width; x++) {
        const at = y * base.width + x;
        const ribbon = ribbons.ribbonAt(at);
        if (ribbon === NO_RIBBON) continue;
        const p = pixelOffset(base, x, y);
        const [s, v] = ribbons.toneAt(at);
        const target = targets[ribbon];
        // An unfilled last group has neutral unused ribbons, never fabricated reference values.
        const channels = target
          ? rgbOfHsv(
              target[0],
              Math.min(0.5, target[1] * 0.55) * Math.min(1, s / 0.15),
              Math.min(0.96, v * (0.72 + target[2] * 0.24)),
            )
          : rgbOfHsv(0, 0, Math.min(0.96, v * 0.25 + 0.7));
        for (let c = 0; c < 3; c++) out.data[p + c] = channels[c]!;
      }
    return this.#codec.encodePng(out, 9);
  }
}
