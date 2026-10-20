import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { entropyToMnemonic } from "@scure/bip39";
import { wordlist } from "@scure/bip39/wordlists/english.js";
import { planJointRepair, searchOnce } from "../src/sskr/joint-repair.js";
import { nodeSharePlatform } from "../src/sskr/share-platform-node.js";
import { ShareSplit } from "../src/sskr/split.js";
import { splitSskrMnemonic } from "../src/sskr/shares.js";
import type { ShareFormat } from "../src/sskr/transport.js";
import { joinUnits, markUnits, shareUnits } from "./helpers/shares.js";

const vectors = JSON.parse(
  readFileSync(new URL("../vectors/sskr-v1.json", import.meta.url), "utf8"),
) as { deterministic: { name: string; entropy: string; shares: string[] }[] };
const publicMnemonic = "abandon ".repeat(11) + "about";

function mnemonicOf(vector: { entropy: string }): string {
  return entropyToMnemonic(Buffer.from(vector.entropy, "hex"), wordlist);
}

// Two phrases split with the same random bytes give shares of one set identifier: a share of the
// other phrase passes every check but the restore itself (S013).
async function twinSets(): Promise<[string[], string[]]> {
  const split = new ShareSplit(nodeSharePlatform, (bytes) => bytes.fill(7));
  const other = "zoo ".repeat(11) + "wrong";
  return [await split.split(publicMnemonic, 2, 3), await split.split(other, 2, 3)];
}

describe("Joint repair of the shares of one set", () => {
  it("restores 2-of-3 shares that each miss two elements, in every form", async () => {
    for (const vector of vectors.deterministic) {
      for (const format of ["ur", "words", "indexes", "unicode", "colors"] as const) {
        const typed = vector.shares.map((share, index) =>
          markUnits(share, format, [2 + index, 7 + index]),
        );
        const plan = await planJointRepair(typed, { platform: nodeSharePlatform });
        expect(plan.assessment.verdict, `${vector.name} ${format}`).toBe("determined");
        const found = (await plan.search()).sets;
        expect(found.map((set) => set.mnemonic)).toEqual([mnemonicOf(vector)]);
        expect(found[0]!.shares.map((share) => share.ur)).toEqual(vector.shares);
        expect(found[0]!.shares.every((share) => share.format === format)).toBe(true);
        expect(found[0]!.unsettled).toEqual([]);
      }
    }
  }, 120_000);

  it("settles six word numbers on each of three shares, which no share settles alone", async () => {
    const vector = vectors.deterministic[0]!;
    const typed = vector.shares.map((share, index) =>
      markUnits(
        share,
        "indexes",
        [1, 4, 6, 9, 12, 15].map((place) => place + index),
      ),
    );
    const plan = await planJointRepair(typed, { platform: nodeSharePlatform });
    expect(plan.assessment.shares.every((share) => share.openAlone > 0)).toBe(true);
    expect(plan.assessment.openBits).toBe(0);
    const [set] = (await plan.search()).sets;
    expect(set!.mnemonic).toBe(mnemonicOf(vector));
    expect(set!.shares.map((share) => share.ur)).toEqual(vector.shares);
  });

  it("gives the same phrase in any order of the shares", async () => {
    const vector = vectors.deterministic[2]!;
    const typed = vector.shares.map((share, index) => markUnits(share, "unicode", [3 + index, 10]));
    for (const order of [
      [0, 1, 2],
      [2, 0, 1],
      [1, 2, 0],
      [2, 1, 0],
    ]) {
      const found = (
        await (
          await planJointRepair(
            order.map((index) => typed[index]!),
            { platform: nodeSharePlatform },
          )
        ).search()
      ).sets;
      expect(found.map((set) => set.mnemonic)).toEqual([mnemonicOf(vector)]);
    }
  });

  it("rebuilds the secret part of a share from the other two", async () => {
    const vector = vectors.deterministic[1]!;
    const parts = shareUnits(vector.shares[2]!, "indexes");
    // Everything after the member number, which sits in the eleventh word number.
    const places = parts.map((_, place) => place).filter((place) => place > 10);
    const typed = [
      vector.shares[0]!,
      vector.shares[1]!,
      markUnits(vector.shares[2]!, "indexes", places),
    ];
    const plan = await planJointRepair(typed, { platform: nodeSharePlatform });
    expect(plan.assessment.verdict).toBe("determined");
    const [set] = (await plan.search()).sets;
    expect(set!.shares[2]!.ur).toBe(vector.shares[2]);
    expect(set!.unsettled).toEqual([]);
  });

  it("restores the phrase past a share that is wholly unreadable, and says what is a guess", async () => {
    const vector = vectors.deterministic[1]!;
    const parts = shareUnits(vector.shares[2]!, "indexes");
    const typed = [
      vector.shares[0]!,
      vector.shares[1]!,
      markUnits(
        vector.shares[2]!,
        "indexes",
        parts.map((_, place) => place),
      ),
    ];
    const found = (await (await planJointRepair(typed, { platform: nodeSharePlatform })).search())
      .sets;
    expect(found.map((set) => set.mnemonic)).toEqual([mnemonicOf(vector)]);
    // Its member number cannot be read, so the share itself is not settled.
    expect(found[0]!.unsettled.length).toBeGreaterThan(0);
    expect(found[0]!.unsettled.every((element) => element.share === 3)).toBe(true);
  });
});

describe("Joint repair of the shares of one set", () => {
  it("combines two damaged copies of one share", async () => {
    const vector = vectors.deterministic[0]!;
    const typed = [
      markUnits(vector.shares[0]!, "colors", [2, 3, 4]),
      markUnits(vector.shares[0]!, "colors", [5, 6, 7]),
      markUnits(vector.shares[1]!, "colors", [8]),
    ];
    const found = (await (await planJointRepair(typed, { platform: nodeSharePlatform })).search())
      .sets;
    expect(found.map((set) => set.mnemonic)).toEqual([mnemonicOf(vector)]);
    expect(found[0]!.shares[0]!.ur).toBe(vector.shares[0]);
    expect(found[0]!.shares[1]!.ur).toBe(vector.shares[0]);
  });

  it("refuses a repaired set whose surplus share is of another phrase (S013)", async () => {
    const [mine, other] = await twinSets();
    const typed = [
      markUnits(mine[0]!, "colors", [3]),
      markUnits(mine[1]!, "colors", [5]),
      other[2]!,
    ];
    const plan = await planJointRepair(typed, { platform: nodeSharePlatform });
    expect(plan.assessment.verdict).toBe("no-fit");
    await expect(searchOnce(plan)).rejects.toMatchObject({
      code: "sskr.joint-repair.plan-not-searchable",
    });
    // Without that share the same marks restore the phrase.
    const kept = (
      await searchOnce(await planJointRepair(typed.slice(0, 2), { platform: nodeSharePlatform }))
    ).sets;
    expect(kept.map((set) => set.mnemonic)).toEqual([publicMnemonic]);
  });

  it("refuses two copies of one member that read as different shares (S013)", async () => {
    const [mine, other] = await twinSets();
    const typed = [
      markUnits(mine[0]!, "colors", [3]),
      other[0]!,
      markUnits(mine[1]!, "colors", [5]),
    ];
    // A plan that refused is not searched as empty: its search says why (AUD-037-API003).
    await expect(
      searchOnce(await planJointRepair(typed, { platform: nodeSharePlatform })),
    ).rejects.toMatchObject({ code: "sskr.joint-repair.plan-not-searchable" });
  });

  it("works for a 3-of-5 set and says how many more shares would settle it", async () => {
    const shares = await splitSskrMnemonic(publicMnemonic, 3, 5);
    const all = shares.map((share, index) => markUnits(share, "indexes", [2 + index, 9 + index]));
    const plan = await planJointRepair(all, { platform: nodeSharePlatform });
    expect(plan.assessment.threshold).toBe(3);
    expect(plan.assessment.verdict).toBe("determined");
    expect((await plan.search()).sets.map((set) => set.mnemonic)).toEqual([publicMnemonic]);
    // Three shares, one of them with many marks: the digest has to decide, and help is named.
    const three = [
      shares[0]!,
      shares[1]!,
      // The secret's own elements, after the checksum and the metadata.
      markUnits(shares[2]!, "indexes", [10, 13, 16, 19]),
    ];
    const open = await planJointRepair(three, { platform: nodeSharePlatform });
    expect(open.assessment.openBits).toBeGreaterThan(0);
    expect(open.assessment.verdict).toBe("search");
    expect(open.assessment.moreShares).toBe(1);
    expect(open.assessment.helps.length).toBeGreaterThan(0);
    const found = (await open.search()).sets;
    expect(found.map((set) => set.mnemonic)).toContain(publicMnemonic);
  });

  it("refuses marks at wrong places instead of giving a wrong phrase", async () => {
    const vector = vectors.deterministic[0]!;
    const parts = shareUnits(vector.shares[0]!, "indexes");
    // The mark sits beside the element that is actually wrong.
    parts[5] = "?";
    parts[6] = parts[6] === "1" ? "2" : "1";
    const typed = [
      joinUnits(parts, "indexes"),
      markUnits(vector.shares[1]!, "indexes", [3]),
      markUnits(vector.shares[2]!, "indexes", [8]),
    ];
    const plan = await planJointRepair(typed, { platform: nodeSharePlatform });
    expect(plan.assessment.verdict).toBe("no-fit");
    await expect(searchOnce(plan)).rejects.toMatchObject({
      code: "sskr.joint-repair.plan-not-searchable",
    });
  });
});

describe("Joint repair of the shares of one set", () => {
  it("says when shares are missing or repeated", async () => {
    const vector = vectors.deterministic[0]!;
    const one = await planJointRepair([markUnits(vector.shares[0]!, "indexes", [4])], {
      platform: nodeSharePlatform,
    });
    expect(one.assessment.verdict).toBe("not-enough");
    expect(one.assessment.reason).toMatch(/threshold/u);
    // Its search says why, and the plan searches no more after it (AUD-037-API003).
    await expect(searchOnce(one)).rejects.toMatchObject({
      code: "sskr.joint-repair.plan-not-searchable",
      message: expect.stringMatching(/threshold/u) as unknown,
    });
    await expect(one.search()).rejects.toMatchObject({ code: "sskr.joint-repair.plan-wiped" });
    const twice = await planJointRepair(
      [markUnits(vector.shares[0]!, "indexes", [4]), vector.shares[0]!],
      { platform: nodeSharePlatform },
    );
    expect(twice.assessment.verdict).toBe("not-enough");
    expect(twice.assessment.reason).toMatch(/more than once/u);
    const foreign = vectors.deterministic[1]!;
    const mixed = await planJointRepair(
      [markUnits(vector.shares[0]!, "indexes", [4]), foreign.shares[1]!],
      { platform: nodeSharePlatform },
    );
    expect(mixed.assessment.verdict).toBe("no-fit");
  });

  it("refuses shares of another set as not fitting, not as too few", async () => {
    // Two splits of one phrase have different identifiers; the vectors all share one.
    const first = await splitSskrMnemonic(publicMnemonic, 2, 3);
    const second = await splitSskrMnemonic(publicMnemonic, 2, 3);
    const plan = await planJointRepair([markUnits(first[0]!, "ur", [12]), first[1]!, second[2]!], {
      platform: nodeSharePlatform,
    });
    expect(plan.assessment.verdict).toBe("no-fit");
    expect(plan.assessment.reason).toMatch(/one set/u);
  });

  it("counts the search over all ways to read the shares against its limit", async () => {
    const vector = vectors.deterministic[0]!;
    const plan = await planJointRepair(
      [
        markUnits(vector.shares[0]!, "indexes", [5, 6, 7, 8, 9, 10, 11, 12]),
        markUnits(vector.shares[1]!, "indexes", [6, 7, 8, 9, 10, 11, 12, 13]),
      ],
      { platform: nodeSharePlatform },
    );
    expect(plan.assessment.combinations).toBeGreaterThan(2 ** 40);
    expect(plan.assessment.verdict).toBe("too-uncertain");
    await expect(searchOnce(plan)).rejects.toMatchObject({
      code: "sskr.joint-repair.plan-not-searchable",
    });
  });

  it("stops when the host asks", async () => {
    const vector = vectors.deterministic[0]!;
    const plan = await planJointRepair(
      [vector.shares[0]!, markUnits(vector.shares[1]!, "colors", [5, 7])],
      { platform: nodeSharePlatform },
    );
    expect(plan.assessment.verdict).toBe("search");
    const stop = new AbortController();
    const found = await plan.search({
      onProgress: () => stop.abort(new Error("stopped")),
      signal: stop.signal,
    });
    // A stop is a result, not an error (CORE-22).
    expect(found.stopped).toBe(true);
  });
});

const vector = vectors.deterministic[0]!;

/** `share` in `format` with ? at the digits `digits` of each element at `places`. */
function markDigits(
  share: string,
  format: ShareFormat,
  places: readonly number[],
  digits: readonly number[],
): string {
  const parts = shareUnits(share, format);
  for (const place of places) {
    const part = parts[place]!;
    const prefix = part.startsWith("#") ? "#" : "";
    const symbols = Array.from(part.slice(prefix.length));
    for (const digit of digits) symbols[digit] = "?";
    parts[place] = prefix + symbols.join("");
  }
  return joinUnits(parts, format);
}

describe("Joint repair with digits read in part", () => {
  it("settles colors missing digits on both shares, where whole colors need a long search", async () => {
    const typed = [
      markDigits(vector.shares[0]!, "colors", [4, 5, 6], [4, 5]),
      markDigits(vector.shares[1]!, "colors", [6, 7], [3, 4, 5]),
    ];
    const plan = await planJointRepair(typed, { platform: nodeSharePlatform });
    expect(plan.assessment.openBits).toBe(0);
    const found = (await plan.search()).sets;
    expect(found.map((set) => set.mnemonic)).toEqual([mnemonicOf(vector)]);
    expect(found[0]!.shares.map((share) => share.ur)).toEqual(vector.shares.slice(0, 2));
    const whole = await planJointRepair(
      [
        markUnits(vector.shares[0]!, "colors", [4, 5, 6]),
        markUnits(vector.shares[1]!, "colors", [6, 7]),
      ],
      { platform: nodeSharePlatform },
    );
    expect(whole.assessment.openBits).toBeGreaterThan(32);
  });

  it("settles Unicode codes missing a digit each by the words that fit them", async () => {
    const typed = [
      markDigits(vector.shares[0]!, "unicode", [4, 7, 9, 12, 15], [3]),
      markDigits(vector.shares[1]!, "unicode", [5, 8, 10, 13], [2]),
    ];
    const plan = await planJointRepair(typed, { platform: nodeSharePlatform });
    expect(plan.assessment.verdict).toBe("determined");
    const found = (await plan.search()).sets;
    expect(found.map((set) => set.mnemonic)).toEqual([mnemonicOf(vector)]);
    expect(found[0]!.shares[0]!.filled.map((element) => element.position)).toEqual([
      5, 8, 10, 13, 16,
    ]);
  });

  it("tries words only within a bound, so that even many partly read codes are assessed in seconds", async () => {
    // Three missing digits of six codes on each share: about 200 words fit each code.
    const typed = vector.shares
      .slice(0, 2)
      .map((share) => markDigits(share, "unicode", [3, 5, 7, 9, 11, 13], [1, 2, 3]));
    const plan = await planJointRepair(typed, { platform: nodeSharePlatform });
    expect(plan.assessment.verdict).not.toBe("no-fit");
    // The first sixteen codes of all three shares of a 24-word set, each missing its last digit,
    // took minutes when every word was tried (AUD review of the digit marks).
    const long = vectors.deterministic[4]!;
    // Measured as the processor time of this process, which the load of the machine leaves as it
    // is, where the time on the clock grows with every other test that runs beside it.
    const started = process.cpuUsage();
    const many = await planJointRepair(
      long.shares.map((share) =>
        markDigits(
          share,
          "unicode",
          Array.from({ length: 16 }, (_, i) => i + 1),
          [3],
        ),
      ),
      { platform: nodeSharePlatform },
    );
    const used = process.cpuUsage(started);
    expect((used.user + used.system) / 1000).toBeLessThan(15_000);
    expect(many.assessment.verdict).not.toBe("no-fit");
  }, 120_000);

  it("says that shares are too few, not that they do not fit, with partly read codes", async () => {
    const shares = await splitSskrMnemonic(mnemonicOf(vector), 3, 6);
    const typed = shares
      .slice(0, 2)
      .map((share) => markDigits(share, "unicode", [12, 14, 16, 18], [3]));
    const plan = await planJointRepair(typed, { platform: nodeSharePlatform });
    expect(plan.assessment.verdict).toBe("not-enough");
    expect(plan.assessment.reason).toBe(
      "Too few shares: the threshold of this set needs more of them.",
    );
  });

  it("hears a stop between the shares and between the choices of member numbers", async () => {
    const stop = new AbortController();
    const typed = vector.shares.map((share) =>
      markDigits(
        share,
        "unicode",
        Array.from({ length: 12 }, (_, i) => i + 1),
        [3],
      ),
    );
    const planned = planJointRepair(typed, { platform: nodeSharePlatform, signal: stop.signal });
    stop.abort(new Error("stopped"));
    // A stop is a result, not an error (CORE-22): the assessment plans nothing, and its search is
    // a stopped one (AUD-037-API003).
    const plan = await planned;
    expect(plan.assessment.verdict).toBe("stopped");
    expect(await searchOnce(plan)).toEqual({ sets: [], stopped: true });
  });
});
