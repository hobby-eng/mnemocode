// S105: bundled card artwork is read once, and a read that failed is tried again on the next
// render instead of failing every later one (the four-reference glass design kept its failure).
// S108: the artwork belongs to the platform that read it: each CardRenderer keeps its own.

import { describe, expect, it } from "vitest";
import { BundledAssetCache, type RenderPlatform } from "../src/export/platform.js";
import { nodeRenderPlatform } from "../src/export/platform-node.js";
import { GlassArtwork } from "../src/export/glass-artwork.js";
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
  it("names the file of a failed read, tries it again, then keeps it", async () => {
    const { platform, reads } = failingOnce();
    const cache = new BundledAssetCache(platform, (bytes) => bytes.length);
    const path = "images/business-glass-6in1.jpg";
    await expect(cache.get(path)).rejects.toThrow(
      `Cannot load card artwork ${path}: Error: not yet`,
    );
    const size = await cache.get(path);
    expect(size).toBeGreaterThan(0);
    expect(await cache.get(path)).toBe(size);
    expect(reads).toEqual([path, path]);
  });

  it("draws a glass card after its artwork failed to load once", async () => {
    const { platform } = failingOnce();
    const artwork = new GlassArtwork(platform);
    await expect(artwork.of(["#112233"], 8)).rejects.toThrow("Cannot load card artwork");
    expect((await artwork.of(["#112233"], 8)).length).toBeGreaterThan(0);
    // The photographed design kept a failed read for good before.
    await expect(artwork.of(["#112233"], 4)).rejects.toThrow("Cannot load card artwork");
    expect((await artwork.of(["#112233"], 4)).length).toBeGreaterThan(0);
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
    const path = "images/business-glass-8in1.jpg";
    await first!.glassArtwork.of(["#112233"], 8);
    await first!.glassArtwork.of(["#445566"], 8);
    expect(reads).toEqual([[path], []]);
    // The second renderer reads its own copy through its own platform, once.
    await second!.glassArtwork.of(["#112233"], 8);
    await second!.glassArtwork.of(["#112233"], 8);
    expect(reads).toEqual([[path], [path]]);
  });

  it("refuses a renderer without the host's platform", () => {
    expect(() => new CardRenderer(undefined as unknown as RenderPlatform)).toThrow(
      "Card rendering needs the host's RenderPlatform.",
    );
    const { qrModules: _left, ...partial } = nodeRenderPlatform;
    expect(() => new CardRenderer(partial as RenderPlatform)).toThrow(TypeError);
  });
});
