import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { entropyToMnemonic } from "@scure/bip39";
import { wordlist } from "@scure/bip39/wordlists/english.js";
import { planJointRepair } from "../src/sskr/joint-repair.js";
import "../src/sskr/share-platform-node.js";
import { splitSskrMnemonic } from "../src/sskr/shares.js";
import { writeShare, type ShareFormat } from "../src/sskr/transport.js";

const vectors = JSON.parse(
  readFileSync(new URL("../vectors/sskr-v1.json", import.meta.url), "utf8"),
) as { deterministic: { name: string; entropy: string; shares: string[] }[] };
const publicMnemonic = "abandon ".repeat(11) + "about";

function units(share: string, format: ShareFormat): string[] {
  const text = writeShare(share, format);
  if (format === "ur") return text.slice("ur:sskr/".length).match(/../gu)!;
  if (format === "colors-unicode") return text.match(/.{4}/gu)!;
  return text.split(" ");
}

function join(parts: readonly string[], format: ShareFormat): string {
  if (format === "ur") return "ur:sskr/" + parts.join("");
  if (format === "colors-unicode") return parts.join("");
  return parts.join(" ");
}

/** The share in `format` with the elements at `places` marked with ?. */
function mark(share: string, format: ShareFormat, places: readonly number[]): string {
  const parts = units(share, format);
  for (const place of places) parts[place] = "?";
  return join(parts, format);
}

function mnemonicOf(vector: { entropy: string }): string {
  return entropyToMnemonic(Buffer.from(vector.entropy, "hex"), wordlist);
}

describe("Joint repair of the shares of one set", () => {
  it("restores 2-of-3 shares that each miss two elements, in every form", async () => {
    for (const vector of vectors.deterministic) {
      for (const format of ["ur", "words", "indexes", "unicode", "colors"] as const) {
        const typed = vector.shares.map((share, index) =>
          mark(share, format, [2 + index, 7 + index]),
        );
        const plan = await planJointRepair(typed);
        expect(plan.assessment.verdict, `${vector.name} ${format}`).toBe("determined");
        const found = await plan.search();
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
      mark(
        share,
        "indexes",
        [1, 4, 6, 9, 12, 15].map((place) => place + index),
      ),
    );
    const plan = await planJointRepair(typed);
    expect(plan.assessment.shares.every((share) => share.openAlone > 0)).toBe(true);
    expect(plan.assessment.openBits).toBe(0);
    const [set] = await plan.search();
    expect(set!.mnemonic).toBe(mnemonicOf(vector));
    expect(set!.shares.map((share) => share.ur)).toEqual(vector.shares);
  });

  it("gives the same phrase in any order of the shares", async () => {
    const vector = vectors.deterministic[2]!;
    const typed = vector.shares.map((share, index) => mark(share, "unicode", [3 + index, 10]));
    for (const order of [
      [0, 1, 2],
      [2, 0, 1],
      [1, 2, 0],
      [2, 1, 0],
    ]) {
      const found = await (await planJointRepair(order.map((index) => typed[index]!))).search();
      expect(found.map((set) => set.mnemonic)).toEqual([mnemonicOf(vector)]);
    }
  });

  it("rebuilds the secret part of a share from the other two", async () => {
    const vector = vectors.deterministic[1]!;
    const parts = units(vector.shares[2]!, "indexes");
    // Everything after the member number, which sits in the eleventh word number.
    const places = parts.map((_, place) => place).filter((place) => place > 10);
    const typed = [
      vector.shares[0]!,
      vector.shares[1]!,
      mark(vector.shares[2]!, "indexes", places),
    ];
    const plan = await planJointRepair(typed);
    expect(plan.assessment.verdict).toBe("determined");
    const [set] = await plan.search();
    expect(set!.shares[2]!.ur).toBe(vector.shares[2]);
    expect(set!.unsettled).toEqual([]);
  });

  it("restores the phrase past a share that is wholly unreadable, and says what is a guess", async () => {
    const vector = vectors.deterministic[1]!;
    const parts = units(vector.shares[2]!, "indexes");
    const typed = [
      vector.shares[0]!,
      vector.shares[1]!,
      mark(
        vector.shares[2]!,
        "indexes",
        parts.map((_, place) => place),
      ),
    ];
    const found = await (await planJointRepair(typed)).search();
    expect(found.map((set) => set.mnemonic)).toEqual([mnemonicOf(vector)]);
    // Its member number cannot be read, so the share itself is not settled.
    expect(found[0]!.unsettled.length).toBeGreaterThan(0);
    expect(found[0]!.unsettled.every((element) => element.share === 3)).toBe(true);
  });

  it("combines two damaged copies of one share", async () => {
    const vector = vectors.deterministic[0]!;
    const typed = [
      mark(vector.shares[0]!, "colors", [2, 3, 4]),
      mark(vector.shares[0]!, "colors", [5, 6, 7]),
      mark(vector.shares[1]!, "colors", [8]),
    ];
    const found = await (await planJointRepair(typed)).search();
    expect(found.map((set) => set.mnemonic)).toEqual([mnemonicOf(vector)]);
    expect(found[0]!.shares[0]!.ur).toBe(vector.shares[0]);
    expect(found[0]!.shares[1]!.ur).toBe(vector.shares[0]);
  });

  it("works for a 3-of-5 set and says how many more shares would settle it", async () => {
    const shares = await splitSskrMnemonic(publicMnemonic, 3, 5);
    const all = shares.map((share, index) => mark(share, "indexes", [2 + index, 9 + index]));
    const plan = await planJointRepair(all);
    expect(plan.assessment.threshold).toBe(3);
    expect(plan.assessment.verdict).toBe("determined");
    expect((await plan.search()).map((set) => set.mnemonic)).toEqual([publicMnemonic]);
    // Three shares, one of them with many marks: the digest has to decide, and help is named.
    const three = [
      shares[0]!,
      shares[1]!,
      // The secret's own elements, after the checksum and the metadata.
      mark(shares[2]!, "indexes", [10, 13, 16, 19]),
    ];
    const open = await planJointRepair(three);
    expect(open.assessment.openBits).toBeGreaterThan(0);
    expect(open.assessment.verdict).toBe("search");
    expect(open.assessment.moreShares).toBe(1);
    expect(open.assessment.helps.length).toBeGreaterThan(0);
    const found = await open.search();
    expect(found.map((set) => set.mnemonic)).toContain(publicMnemonic);
  }, 60_000);

  it("refuses marks at wrong places instead of giving a wrong phrase", async () => {
    const vector = vectors.deterministic[0]!;
    const parts = units(vector.shares[0]!, "indexes");
    // The mark sits beside the element that is actually wrong.
    parts[5] = "?";
    parts[6] = parts[6] === "1" ? "2" : "1";
    const typed = [
      join(parts, "indexes"),
      mark(vector.shares[1]!, "indexes", [3]),
      mark(vector.shares[2]!, "indexes", [8]),
    ];
    const plan = await planJointRepair(typed);
    const found = await plan.search();
    expect(found).toEqual([]);
    expect(plan.assessment.verdict).toMatch(/no-fit|determined|search/u);
  });

  it("says when shares are missing or repeated", async () => {
    const vector = vectors.deterministic[0]!;
    const one = await planJointRepair([mark(vector.shares[0]!, "indexes", [4])]);
    expect(one.assessment.verdict).toBe("not-enough");
    expect(one.assessment.reason).toMatch(/threshold/u);
    const twice = await planJointRepair([
      mark(vector.shares[0]!, "indexes", [4]),
      vector.shares[0]!,
    ]);
    expect(twice.assessment.verdict).toBe("not-enough");
    expect(twice.assessment.reason).toMatch(/more than once/u);
    const foreign = vectors.deterministic[1]!;
    const mixed = await planJointRepair([
      mark(vector.shares[0]!, "indexes", [4]),
      foreign.shares[1]!,
    ]);
    expect(mixed.assessment.verdict).toBe("no-fit");
  });

  it("refuses shares of another set as not fitting, not as too few", async () => {
    // Two splits of one phrase have different identifiers; the vectors all share one.
    const first = await splitSskrMnemonic(publicMnemonic, 2, 3);
    const second = await splitSskrMnemonic(publicMnemonic, 2, 3);
    const plan = await planJointRepair([mark(first[0]!, "ur", [12]), first[1]!, second[2]!]);
    expect(plan.assessment.verdict).toBe("no-fit");
    expect(plan.assessment.reason).toMatch(/one set/u);
  });

  it("counts the search over all ways to read the shares against its limit", async () => {
    const vector = vectors.deterministic[0]!;
    const plan = await planJointRepair([
      mark(vector.shares[0]!, "indexes", [5, 6, 7, 8, 9, 10, 11, 12]),
      mark(vector.shares[1]!, "indexes", [6, 7, 8, 9, 10, 11, 12, 13]),
    ]);
    expect(plan.assessment.combinations).toBeGreaterThan(2 ** 40);
    expect(plan.assessment.verdict).toBe("too-uncertain");
    expect(await plan.search()).toEqual([]);
  });

  it("stops when the host asks", async () => {
    const vector = vectors.deterministic[0]!;
    const plan = await planJointRepair([
      vector.shares[0]!,
      mark(vector.shares[1]!, "colors", [5, 7]),
    ]);
    expect(plan.assessment.verdict).toBe("search");
    const stop = new AbortController();
    const search = plan.search({
      onProgress: () => stop.abort(new Error("stopped")),
      signal: stop.signal,
    });
    await expect(search).rejects.toThrow("stopped");
  });
});
