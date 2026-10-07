// Follow-up regression tests for AUD-008 (docs/audits/AUD-008-2026-10-06.md): the reference of a
// share set, which a digest must check and which must restore, sparse word searches, and the
// refusal of a share that cannot be read. Public test data and synthetic secrets only.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { entropyToMnemonic } from "@scure/bip39";
import { wordlist } from "@scure/bip39/wordlists/english.js";
import { searchCandidates, searchCombinations, type WordSearch } from "../src/core/candidates.js";
import { crc32 } from "../src/sskr/checksum.js";
import { planJointRepair } from "../src/sskr/joint-repair.js";
import { sskrEngine } from "../src/sskr/runtime.js";
import { combineSskrShares, restoreShareSet } from "../src/sskr/shares.js";
import { transportToUr, urToTransport, writeShare } from "../src/sskr/transport.js";
import "../src/sskr/share-platform-node.js";

/** Synthetic entropy and engine randomness, as the task of this follow-up names them. */
const SECRET_BYTE = 0x42;
const SEED_BYTE = 0x07;
const SECRET_BYTES = 16;
const SEED_BYTES = 32;
const PHRASE = entropyToMnemonic(new Uint8Array(SECRET_BYTES).fill(SECRET_BYTE), wordlist);
/** A byte of the share value: the header, identifier and member numbers come before it. */
const VALUE_BYTE = 10;
const CRC_BYTES = 4;

/** The shares of PHRASE in `groups`, each [member threshold, member count], from the engine. */
async function sharesOf(groupThreshold: number, groups: readonly number[][]): Promise<string[]> {
  const engine = await sskrEngine();
  const secret = new Uint8Array(SECRET_BYTES).fill(SECRET_BYTE);
  const seed = new Uint8Array(SEED_BYTES).fill(SEED_BYTE);
  try {
    return engine
      .create_sskr_shares(secret, groupThreshold, Uint8Array.from(groups.flat()), seed)
      .trim()
      .split("\n");
  } finally {
    secret.fill(0);
    seed.fill(0);
  }
}

/** `share` with one value byte flipped and its CRC-32 written anew: valid, but wrong. */
function wrongValue(share: string): string {
  const bytes = urToTransport(share);
  bytes[VALUE_BYTE]! ^= 1;
  new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).setUint32(
    bytes.length - CRC_BYTES,
    crc32(bytes.slice(0, -CRC_BYTES)),
  );
  return transportToUr(bytes);
}

function permutations<T>(items: readonly T[]): T[][] {
  if (items.length <= 1) return [[...items]];
  return items.flatMap((item, at) =>
    permutations([...items.slice(0, at), ...items.slice(at + 1)]).map((rest) => [item, ...rest]),
  );
}

/** Every order of every non-empty selection of `items`. */
function arrangements<T>(items: readonly T[]): T[][] {
  const subsets = items.reduce<T[][]>(
    (chosen, item) => [...chosen, ...chosen.map((subset) => [...subset, item])],
    [[]],
  );
  return subsets.filter((subset) => subset.length > 0).flatMap(permutations);
}

/** The shares, counted from 1, that a refusal tells to leave out. */
function namedShares(message: string): number[] {
  const match = /^Shares? ([\d, ]+) (?:of another group )?(?:does|do) not fit/u.exec(message);
  return match === null ? [] : match[1]!.split(", ").map(Number);
}

/**
 * Restores `given` as the menu does, and leaves out the shares that each refusal names, as a person
 * would: the phrase restored in the end, if any, and how many refusals were followed to reach it.
 */
async function followAdvice(
  given: readonly string[],
): Promise<{ readonly phrase?: string; readonly followed: number }> {
  let left = given;
  for (let followed = 0; ; followed += 1) {
    try {
      return { phrase: (await restoreShareSet(left)).mnemonic, followed };
    } catch (error) {
      const named = namedShares((error as Error).message);
      if (named.length === 0) return { followed };
      left = left.filter((_, at) => !named.includes(at + 1));
    }
  }
}

describe("AUD-008 follow-up: the reference is checked by a digest, and restores", () => {
  it("blames a wrong 1-of-1 share typed first, not the group that a digest checks", async () => {
    // Group threshold 1: group 1 is one share of 1, group 2 two of three.
    const shares = await sharesOf(1, [
      [1, 1],
      [2, 3],
    ]);
    expect(await combineSskrShares(shares)).toBe(PHRASE);
    const wrong = wrongValue(shares[0]!);
    const given = [wrong, shares[1]!, shares[2]!];
    await expect(combineSskrShares(given)).rejects.toThrow(
      "Share 1 of another group does not fit with the others: leave it out, or check it.",
    );
    expect(await followAdvice(given)).toEqual({ phrase: PHRASE, followed: 1 });
    for (const order of permutations([wrong, ...shares.slice(1)]))
      expect(await followAdvice(order)).toEqual({ phrase: PHRASE, followed: 1 });
  });

  it("blames a wrong group that a digest checks when another one restores", async () => {
    // Group threshold 1: one share of 1, then two groups of two of three.
    const shares = await sharesOf(1, [
      [1, 1],
      [2, 3],
      [2, 3],
    ]);
    const given = [shares[0]!, wrongValue(shares[1]!), shares[2]!, shares[4]!, shares[5]!];
    await expect(combineSskrShares(given)).rejects.toThrow(
      "Shares 2, 3 of another group do not fit with the others: leave them out, or check them.",
    );
    expect(await followAdvice(given)).toEqual({ phrase: PHRASE, followed: 1 });
  });

  it("refuses without naming a share when no group that a digest checks restores", async () => {
    const shares = await sharesOf(1, [
      [1, 1],
      [2, 3],
    ]);
    // The first group alone would restore, unchecked; no refusal may lead there.
    const refusal = combineSskrShares([shares[0]!, wrongValue(shares[1]!), shares[2]!]);
    await expect(refusal).rejects.toThrow(
      "These shares do not restore a secret: check them, and that all belong to one set.",
    );
  });

  it.each([
    [
      1,
      [
        [1, 1],
        [2, 3],
      ],
    ],
    [
      1,
      [
        [1, 2],
        [2, 3],
      ],
    ],
    [
      1,
      [
        [1, 1],
        [2, 2],
        [2, 2],
      ],
    ],
    [
      2,
      [
        [2, 2],
        [2, 2],
        [1, 1],
      ],
    ],
  ])(
    "group threshold %i, groups %j: following the refusals reaches the phrase, never another",
    async (groupThreshold, layout) => {
      const shares = await sharesOf(groupThreshold, layout);
      const groupOf = layout.flatMap(([, count], group) => Array<number>(count!).fill(group));
      for (const wrong of shares.keys()) {
        for (const order of arrangements([...shares.keys()])) {
          // The complete groups given without the wrong share that a digest checks: on their own,
          // or together when the group threshold is 2 or more.
          const intact = layout.filter(([memberThreshold], group) => {
            const members = order.filter((at) => groupOf[at] === group);
            return (
              members.length >= memberThreshold! &&
              !members.includes(wrong) &&
              (groupThreshold >= 2 || memberThreshold! >= 2)
            );
          });
          const given = order.map((at) => (at === wrong ? wrongValue(shares[at]!) : shares[at]!));
          const { phrase, followed } = await followAdvice(given);
          if (followed > 0 && phrase !== undefined) expect(phrase).toBe(PHRASE);
          if (intact.length >= groupThreshold) expect(phrase).toBe(PHRASE);
        }
      }
    },
  );

  it("tries other groups when the first ones that meet a group threshold of 2 fail", async () => {
    const shares = await sharesOf(2, [
      [2, 3],
      [2, 3],
      [2, 3],
    ]);
    const given = [
      wrongValue(shares[0]!),
      shares[1]!,
      shares[3]!,
      shares[4]!,
      shares[6]!,
      shares[7]!,
    ];
    await expect(combineSskrShares(given)).rejects.toThrow(
      "Shares 1, 2 of another group do not fit with the others: leave them out, or check them.",
    );
    expect(await followAdvice(given)).toEqual({ phrase: PHRASE, followed: 1 });
  });

  it("stops after a bounded number of combinations of groups", async () => {
    // Group threshold 7 of 14 groups of one share: 3432 combinations, of which only the last one,
    // the right groups 8 to 14, restores.
    const groups = Array.from({ length: 14 }, () => [1, 1]);
    const shares = await sharesOf(7, groups);
    const given = shares.map((share, at) => (at < 7 ? wrongValue(share) : share));
    const refusal = combineSskrShares(given);
    await expect(refusal).rejects.toThrow(
      "Too many combinations of these groups fail to restore a secret: leave out the groups you doubt, or check them.",
    );
    await expect(refusal.catch((error: Error) => namedShares(error.message))).resolves.toEqual([]);
    // With the right groups first, each wrong one is named in turn.
    expect(await followAdvice([...given.slice(7), ...given.slice(0, 7)])).toEqual({
      phrase: PHRASE,
      followed: 7,
    });
  });

  it("says that unchecked shares disagree, without naming one of them", async () => {
    const pair = await sharesOf(1, [[1, 2]]);
    expect(await combineSskrShares(pair)).toBe(PHRASE);
    const wrong = wrongValue(pair[0]!);
    const groups = await sharesOf(1, [
      [1, 1],
      [1, 2],
    ]);
    for (const given of [
      [wrong, pair[1]!],
      [pair[1]!, wrong],
      ...permutations([groups[0]!, wrongValue(groups[1]!), groups[2]!]),
      ...permutations([wrongValue(groups[0]!), groups[1]!]),
    ]) {
      const refusal = combineSskrShares(given);
      await expect(refusal).rejects.toThrow(/MnemoCode cannot tell which is wrong/u);
      await expect(refusal.catch((error: Error) => namedShares(error.message))).resolves.toEqual(
        [],
      );
    }
  });

  it("still restores a single share of a group of one, which nothing can check", async () => {
    const shares = await sharesOf(1, [
      [1, 1],
      [2, 3],
    ]);
    expect(await combineSskrShares([shares[0]!])).toBe(PHRASE);
    expect(await restoreShareSet([shares[0]!, shares[1]!])).toMatchObject({
      mnemonic: PHRASE,
      unchecked: [2],
    });
  });

  it("names the members of a wrong group with two or more members in the plural", async () => {
    const shares = await sharesOf(1, [
      [2, 3],
      [2, 3],
    ]);
    const given = [shares[0]!, shares[1]!, wrongValue(shares[3]!), shares[4]!];
    await expect(combineSskrShares(given)).rejects.toThrow(
      "Shares 3, 4 of another group do not fit with the others: leave them out, or check them.",
    );
    expect(await followAdvice(given)).toEqual({ phrase: PHRASE, followed: 1 });
  });

  it("keeps every published vector restoring", async () => {
    const vectors = JSON.parse(readFileSync("vectors/sskr-v1.json", "utf8")) as {
      deterministic: { entropy: string; shares: string[] }[];
      official: { entropy: string; shares: string[] };
    };
    for (const vector of [...vectors.deterministic, vectors.official])
      expect(await combineSskrShares(vector.shares)).toBe(
        entropyToMnemonic(Buffer.from(vector.entropy, "hex"), wordlist),
      );
  });
});

describe("AUD-008 follow-up: a sparse word search is refused", () => {
  const known = (count: number) => Array.from({ length: count }, () => [0] as number[]);
  /** `values` with the elements at `holes` deleted, so that the array keeps its length. */
  function withHoles<T>(values: T[], ...holes: number[]): T[] {
    for (const hole of holes) delete values[hole];
    return values;
  }
  /** A place of one word whose length counts a hole after its last element. */
  const trailingHole = () => {
    const place = [5];
    place.length = 2;
    return place;
  };

  it.each([
    [
      "written words with a hole",
      { kind: "missing-word", written: withHoles(Array(11).fill(0), 4) },
    ],
    ["written words that are all holes", { kind: "missing-word", written: new Array(11) }],
    [
      "a place with a hole after its last index",
      { kind: "unknown-words", places: [...known(11), trailingHole()] },
    ],
    [
      "a place with a hole between its indexes",
      { kind: "unknown-words", places: [...known(11), withHoles([1, 2, 3], 1)] },
    ],
    ["places with a hole", { kind: "unknown-words", places: withHoles([...known(11), [0, 1]], 3) }],
  ])("%s", (_, search) => {
    expect(() => searchCombinations(search as WordSearch)).toThrow();
    expect(() => searchCandidates(search as WordSearch).next()).toThrow();
  });

  it("keeps a dense search", () => {
    const search: WordSearch = { kind: "unknown-words", places: [...known(11), [0, 3, 7]] };
    expect(searchCombinations(search)).toBe(3);
    const written: WordSearch = { kind: "missing-word", written: Array(11).fill(0) };
    expect(searchCombinations(written)).toBe(12 * 2048);
  });
});

describe("AUD-008 follow-up: the refusal of a share that cannot be read", () => {
  it("says what is wrong and what to check, without repeating the share", async () => {
    const vectors = JSON.parse(readFileSync("vectors/sskr-v1.json", "utf8")) as {
      deterministic: { shares: string[] }[];
    };
    const [first, second] = vectors.deterministic[0]!.shares as [string, string];
    const words = writeShare(first, "indexes").split(" ");
    // One element marked, and the one after it changed: no value of the mark fits the checksum.
    words[5] = "?";
    words[6] = words[6] === "1" ? "2" : "1";
    const typed = words.join(" ");
    const plan = await planJointRepair([typed, second]);
    expect(plan.assessment.verdict).toBe("no-fit");
    expect(plan.assessment.reason).toBe(
      "Share 1 cannot be read as a share: check the elements marked with ?, and the others.",
    );
    // The elements are numbers: the only number in the refusal is the share's own.
    expect(plan.assessment.reason!.match(/\d+/gu)).toEqual(["1"]);
  });

  it("names no marks for a share that has none", async () => {
    const vectors = JSON.parse(readFileSync("vectors/sskr-v1.json", "utf8")) as {
      deterministic: { shares: string[] }[];
    };
    const [first, second] = vectors.deterministic[0]!.shares as [string, string];
    const words = writeShare(first, "indexes").split(" ");
    // A typing error that the checksum finds, beside a share with one element marked.
    words[6] = words[6] === "1" ? "2" : "1";
    const marked = writeShare(second, "indexes").split(" ");
    marked[5] = "?";
    for (const typed of [words.join(" "), "not a share at all"]) {
      const plan = await planJointRepair([typed, marked.join(" ")]);
      expect(plan.assessment.verdict).toBe("no-fit");
      expect(plan.assessment.reason).toBe(
        "Share 1 cannot be read as a share: check each of its elements.",
      );
      await expect(combineSskrShares([typed, marked.join(" ")])).rejects.toThrow(
        "Share 1 cannot be read as a share: check each of its elements.",
      );
    }
  });
});
