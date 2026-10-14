// AUD-014 remediation of the repair group: a Color Unicode share whose marks stand some for one
// code and some for a whole color (AUD-014-FUN002), and the bound of everyPick checked before it
// expands (AUD-014 recommendation 16). Public vectors only (vectors/sskr-v1.json).

import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { entropyToMnemonic } from "@scure/bip39";
import { wordlist } from "@scure/bip39/wordlists/english.js";
import { everyPick, MarkedReading, readRepairableShare } from "../src/sskr/repair.js";
import { AMBIGUOUS_MARK_WIDTHS, AmbiguousMarksError } from "../src/sskr/repair-models.js";
import { planJointRepair, searchOnce } from "../src/sskr/joint-repair.js";
import { nodeSharePlatform } from "../src/sskr/share-platform-node.js";
import { shareUnits } from "./helpers/shares.js";

const vectors = JSON.parse(
  readFileSync(new URL("../vectors/sskr-v1.json", import.meta.url), "utf8"),
) as { deterministic: { entropy: string; shares: string[] }[] };
const vector = vectors.deterministic[0]!;
const [first, second, third] = vector.shares as [string, string, string];
const mnemonic = entropyToMnemonic(Buffer.from(vector.entropy, "hex"), wordlist);

/**
 * The third share in Color Unicode codes run together, with a ? for each code at `codes` and a
 * lone ? for each whole color at `colors` (counted in colors).
 */
function marked(codes: readonly number[], colors: readonly number[]): string {
  const units = shareUnits(third, "colors-unicode");
  for (const code of codes) units[code] = "?";
  // From the last color back, so that the places of the colors before it stay as they are.
  for (const color of [...colors].sort((a, b) => b - a)) units.splice(2 * color, 2, "?");
  return units.join("");
}

/** The phrases that a joint repair of the two intact shares and `damaged` finds. */
async function jointPhrases(damaged: string): Promise<string[]> {
  const plan = await planJointRepair([first, second, damaged], { platform: nodeSharePlatform });
  expect(plan.assessment.verdict).not.toBe("no-fit");
  return (await searchOnce(plan)).sets.map((set) => set.mnemonic);
}

describe("AUD-014-FUN002: Color Unicode marks of one code and of a whole color together", () => {
  // The audit's case: code 4, the first of color 2, and the whole of color 6.
  const mixed = marked([4], [6]);

  it("repairs the audit's mixed share with the other shares", async () => {
    expect(await jointPhrases(mixed)).toEqual([mnemonic]);
    // Alone, its reading is found too, but two unknown colors are more than the checksum settles.
    expect(() => readRepairableShare(mixed)).toThrow(/^Too many elements are marked/u);
  });

  it("repairs a whole color before a single code, and the share as symbols", async () => {
    expect(await jointPhrases(marked([13], [1]))).toEqual([mnemonic]);
    const symbols = Array.from(mixed.match(/\?|.{4}/gu)!, (code) =>
      code === "?" ? code : String.fromCodePoint(parseInt(code, 16)),
    );
    expect(await jointPhrases(symbols.join(""))).toEqual([mnemonic]);
  });

  it("still repairs marks that are all single codes, or all whole colors", async () => {
    expect(readRepairableShare(marked([4], [])).ur).toBe(third);
    expect(readRepairableShare(marked([], [6])).ur).toBe(third);
    for (const homogeneous of [marked([4, 13], []), marked([], [2, 6])])
      expect(await jointPhrases(homogeneous)).toEqual([mnemonic]);
  });

  it("repairs whole colors written as two marks, one for each code", async () => {
    const units = shareUnits(third, "colors-unicode");
    for (const code of [4, 5, 12, 13]) units[code] = "?";
    expect(await jointPhrases(units.join(""))).toEqual([mnemonic]);
  });

  it("refuses marks whose widths fit too many ways, before solving any of them", async () => {
    // Synthetic codes, not a share: E000 is a color's first code and its second alike, so each
    // pair of marks between them may be two codes, a color and a code, or two colors, which fit
    // 577 ways in all.
    const ambiguous = "??E000".repeat(8);
    await expect(
      planJointRepair([first, second, ambiguous], { platform: nodeSharePlatform }),
    ).rejects.toThrow(`Share 3: ${AMBIGUOUS_MARK_WIDTHS.charAt(0).toLowerCase()}`);
    expect(() => MarkedReading.of(ambiguous)).toThrow(AmbiguousMarksError);
  });
});

describe("AUD-014 recommendation 16: everyPick checks its bound before it expands", () => {
  it("refuses an expansion over the bound without building it", () => {
    let expanded = 0;
    // A list that counts the prefixes it is asked to extend.
    class CountingList extends Array<number> {
      override map<U>(make: (value: number, index: number, array: number[]) => U): U[] {
        expanded += 1;
        return Array.prototype.map.call(this, make as never) as U[];
      }
    }
    const last = CountingList.from([7, 8, 9]);
    expect(everyPick([[1, 2], last], 5)).toBeUndefined();
    expect(expanded).toBe(0);
  });

  it("keeps the order, the limit itself, an empty list and no lists", () => {
    expect(everyPick([[1, 2], [3]], 2)).toEqual([
      [1, 3],
      [2, 3],
    ]);
    expect(
      everyPick(
        [
          [1, 2],
          [3, 4],
        ],
        3,
      ),
    ).toBeUndefined();
    expect(everyPick([[1, 2], [], [3, 4]], 2)).toEqual([]);
    expect(everyPick([], 0)).toEqual([[]]);
  });
});
