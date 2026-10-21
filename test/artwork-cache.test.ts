// S105: bundled card artwork is read once, and a read that failed is tried again on the next
// render instead of failing every later one.
// S108: the artwork belongs to the platform that read it: each CardRenderer keeps its own.

import { describe, expect, it } from "vitest";
import { BundledAssetCache, type RenderPlatform } from "../src/export/platform.js";
import { nodeRenderPlatform } from "../src/export/platform-node.js";
import { BusinessArtwork } from "../src/export/business-artwork.js";
import { CardRenderer } from "../src/export/card-renderer.js";

/** The Node.js platform whose first read of each file fails. */
function failingOnce(): { platform: RenderPlatform; reads: string[] } {
  const reads: string[] = [];
  const platform: RenderPlatform = {
    ...nodeRenderPlatform,
    readAsset: async (path) => {
      reads.push(path);
      if (reads.filter((read) => read === path).length === 1) throw new Error("not yet");
      return nodeRenderPlatform.readAsset(path);
    },
  };
  return { platform, reads };
}

describe("bundled artwork", () => {
  it.each(["normal", "refused", "aliased"] as const)(
    "wipes derived artwork scratch after a %s PNG encoding",
    async (mode) => {
      let scratch: Uint8Array | undefined;
      const fault = new Error("Synthetic PNG encoder failure.");
      const artwork = new BusinessArtwork({
        ...nodeRenderPlatform,
        encodePng(image, level) {
          scratch = image.data;
          expect(scratch.some((byte) => byte !== 0)).toBe(true);
          if (mode === "refused") throw fault;
          const png = nodeRenderPlatform.encodePng(image, level);
          if (mode !== "aliased") return png;
          // An external encoder can accidentally return a view into its borrowed work buffer.
          image.data.set(png);
          const alias = image.data.subarray(0, png.length);
          png.fill(0);
          return alias;
        },
      });
      try {
        const pending = artwork.recoloured("it", "8B0C06");
        if (mode === "refused") await expect(pending).rejects.toBe(fault);
        else {
          const png = await pending;
          try {
            expect([...png.subarray(0, 8)]).toEqual([137, 80, 78, 71, 13, 10, 26, 10]);
            const decoded = nodeRenderPlatform.decodePng(png);
            try {
              expect([decoded.width, decoded.height]).toEqual([900, 500]);
            } finally {
              decoded.data.fill(0);
            }
          } finally {
            png.fill(0);
          }
        }
        expect(scratch).toBeInstanceOf(Uint8Array);
        expect(scratch?.every((byte) => byte === 0)).toBe(true);
      } finally {
        scratch?.fill(0);
      }
    },
  );

  it("names the file of a failed read, tries it again, then keeps it", async () => {
    const { platform, reads } = failingOnce();
    const cache = new BundledAssetCache(platform, (bytes) => bytes.length);
    const path = "images/material-tile.jpg";
    await expect(cache.get(path)).rejects.toThrow(
      `Cannot load card artwork ${path}: Error: not yet`,
    );
    const size = await cache.get(path);
    expect(size).toBeGreaterThan(0);
    expect(await cache.get(path)).toBe(size);
    expect(reads).toEqual([path, path]);
  });

  it("recolours a business design's artwork after it failed to load once", async () => {
    const { platform } = failingOnce();
    const artwork = new BusinessArtwork(platform);
    await expect(artwork.recoloured("it", "#112233")).rejects.toThrow("Cannot load card artwork");
    expect((await artwork.recoloured("it", "#112233")).length).toBeGreaterThan(0);
  });

  it("keeps the artwork of each renderer apart, read through its own platform only", async () => {
    const reads: string[][] = [[], []];
    const counting = (log: string[]): RenderPlatform => ({
      ...nodeRenderPlatform,
      readAsset: (path) => {
        log.push(path);
        return nodeRenderPlatform.readAsset(path);
      },
    });
    const [first, second] = reads.map((log) => new CardRenderer(counting(log)));
    const path = "images/business-it-v1.png";
    await first!.businessArtwork.recoloured("it", "#112233");
    await first!.businessArtwork.recoloured("it", "#445566");
    expect(reads).toEqual([[path], []]);
    // The second renderer reads its own copy through its own platform, once.
    await second!.businessArtwork.recoloured("it", "#112233");
    await second!.businessArtwork.recoloured("it", "#112233");
    expect(reads).toEqual([[path], [path]]);
  });

  it("refuses a renderer without the host's platform", () => {
    // No platform, then one without its QR modules: wrong types fed on purpose, as a JavaScript
    // host could.
    expect(() => new CardRenderer(undefined as unknown as RenderPlatform)).toThrow(
      "Card rendering needs the host's RenderPlatform.",
    );
    const { qrModules: _left, ...partial } = nodeRenderPlatform;
    // A platform without its QR modules, a wrong type on purpose: refused as a TypeError.
    expect(() => new CardRenderer(partial as RenderPlatform)).toThrow(TypeError);
  });
});
