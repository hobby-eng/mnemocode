// What the card renderers draw with (CardDrawing): a type of its own module, so that the families
// of cards (business-cards.ts, material-cards.ts) and the catalog that runs them (templates.ts)
// take it without importing each other.

import type { BusinessArtwork } from "./business-artwork.js";
import type { AssetSource, QrSource, RandomSource } from "./platform.js";

/**
 * What the card renderers draw with: the host's platform, through the parts each family uses (its
 * bundled files, random choices and QR matrices), and the artwork prepared with it. A CardRenderer
 * (card-renderer.ts) is one; every render is given it, and each family asks only for the parts it
 * uses. The renderers pass `randomInt` on alone, so a host's own CardDrawing gives one that is
 * called detached (RandomSource).
 */
export interface CardDrawing extends AssetSource, RandomSource, QrSource {
  readonly businessArtwork: BusinessArtwork;
}
