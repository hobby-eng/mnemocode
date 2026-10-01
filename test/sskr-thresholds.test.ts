import { describe, expect, it } from "vitest";
import { splitSskrMnemonic, combineSskrShares } from "../src/sskr/shares.js";

const publicMnemonic = "abandon ".repeat(11) + "about";
const thresholdCases = Array.from({ length: 15 }, (_, index) => index + 2).flatMap((shares) =>
  Array.from({ length: shares - 1 }, (_, index) => [index + 2, shares] as const),
);

describe("Every supported single-group SSKR threshold", () => {
  // Exercise the production CSPRNG path, not only the deterministic fixture API.
  // This samples two quorums per policy; it does not enumerate every subset.
  it.each(thresholdCases)(
    "%i-of-%i requires a quorum and recovers either end of the set",
    async (threshold, count) => {
      const shares = await splitSskrMnemonic(publicMnemonic, threshold, count);
      expect(shares).toHaveLength(count);
      expect(new Set(shares).size).toBe(count);
      expect(await combineSskrShares(shares.slice(0, threshold))).toBe(publicMnemonic);
      expect(await combineSskrShares(shares.slice(-threshold).reverse())).toBe(publicMnemonic);
      await expect(combineSskrShares(shares.slice(0, threshold - 1))).rejects.toThrow(/threshold/u);
    },
  );
});
