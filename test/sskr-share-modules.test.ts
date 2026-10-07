// The host-neutral share modules on their own, each built with the services it is given: a split
// with its platform and randomness (split.ts), a share set restored and checked (share-set.ts), the
// shares as typed (share-input.ts) and the report of a repair (repair-report.ts). Public test data
// only: the "abandon … about" phrase and vectors/sskr-v1.json, whose deterministic shares come
// from fixed test-only seeds.
import { readFileSync } from "node:fs";
import { inspect } from "node:util";
import { describe, expect, it } from "vitest";
import { entropyToMnemonic } from "@scure/bip39";
import { wordlist } from "@scure/bip39/wordlists/english.js";
import { crc32 } from "../src/sskr/checksum.js";
import { planJointRepair, type RepairedSet } from "../src/sskr/joint-repair.js";
import { AUTO_SECONDS, REPAIR_NOTES, RepairReport } from "../src/sskr/repair-report.js";
import { ShareInput, type TypedShare } from "../src/sskr/share-input.js";
import { nodeSharePlatform } from "../src/sskr/share-platform-node.js";
import type { SharePlatform } from "../src/sskr/share-platform.js";
import { SHARE_FORMAT_NAMES, ShareExport, ShareSet } from "../src/sskr/share-set.js";
import { ShareSplit } from "../src/sskr/split.js";
import { transportToUr, urToTransport, writeShare } from "../src/sskr/transport.js";

const TEST_PHRASE = `${"abandon ".repeat(11)}about`;
const vectors = JSON.parse(
  readFileSync(new URL("../vectors/sskr-v1.json", import.meta.url), "utf8"),
) as {
  deterministic: {
    entropy: string;
    testOnlySeed: string;
    groups: { threshold: number; count: number }[];
    shares: string[];
  }[];
};
const bytes = (hex: string) => Uint8Array.from(Buffer.from(hex, "hex"));
/** A 2-of-3 set of a 12-word phrase, and a share of a set of a 15-word one. */
const SHARES = vectors.deterministic[0]!.shares as [string, string, string];
const PHRASE = entropyToMnemonic(bytes(vectors.deterministic[0]!.entropy), wordlist);
const OTHER_SET_SHARE = vectors.deterministic[1]!.shares[0]!;
/** The host's reader of an encoded seed phrase, which a phrase typed as a share is sent to. */
const TEXTS = { decodeEntry: "The Decode tab" };
/** A byte of the share value: the header, identifier and member numbers come before it. */
const VALUE_BYTE = 10;
/** The CRC-32 at the end of a share's transport bytes. */
const CRC_BYTES = 4;

/** `share` with one value byte flipped and its CRC-32 written anew: valid, but wrong. */
function wrongValue(share: string): string {
  const transport = urToTransport(share);
  transport[VALUE_BYTE]! ^= 1;
  new DataView(transport.buffer, transport.byteOffset, transport.byteLength).setUint32(
    transport.length - CRC_BYTES,
    crc32(transport.slice(0, -CRC_BYTES)),
  );
  return transportToUr(transport);
}

/** The second share in colours with the elements at `marks` unreadable. */
function marked(marks: readonly number[]): string {
  const parts = writeShare(SHARES[1], "colors").split(" ");
  for (const place of marks) parts[place] = "?";
  return parts.join(" ");
}

/** The Node.js platform, counting what is asked of it. */
function countingPlatform(): SharePlatform & { combined: number; created: number } {
  const platform = {
    combined: 0,
    created: 0,
    hmacSha256: nodeSharePlatform.hmacSha256,
    combineShares: (records: readonly string[]) => {
      platform.combined += 1;
      return nodeSharePlatform.combineShares(records);
    },
    createShares: (secret: Uint8Array, threshold: number, count: number, seed: Uint8Array) => {
      platform.created += 1;
      return nodeSharePlatform.createShares(secret, threshold, count, seed);
    },
  };
  return platform;
}

describe("ShareSplit", () => {
  it("splits with the randomness it is given, as the deterministic vectors were made", async () => {
    for (const vector of vectors.deterministic) {
      const { threshold, count } = vector.groups[0]!;
      let given: Uint8Array | undefined;
      const split = new ShareSplit(nodeSharePlatform, (seed) => {
        given = seed;
        seed.set(bytes(vector.testOnlySeed));
      });
      const shares = await split.split(
        entropyToMnemonic(bytes(vector.entropy), wordlist),
        threshold,
        count,
      );
      expect(shares).toEqual(vector.shares);
      // The seed is wiped once the split is made.
      expect(given?.every((byte) => byte === 0)).toBe(true);
    }
  });

  it("uses the platform it is given, and checks what it returns", async () => {
    const platform = countingPlatform();
    const shares = await new ShareSplit(platform, (seed) => seed.fill(7)).split(TEST_PHRASE, 2, 3);
    expect(shares).toHaveLength(3);
    expect(platform.created).toBe(1);
    expect(platform.combined).toBe(1);
    const short: SharePlatform = {
      ...nodeSharePlatform,
      createShares: async (...args) => (await nodeSharePlatform.createShares(...args)).slice(1),
    };
    await expect(
      new ShareSplit(short, (seed) => seed.fill(7)).split(TEST_PHRASE, 2, 3),
    ).rejects.toThrow("SSKR engine returned an unexpected share count.");
    const wrong: SharePlatform = {
      ...nodeSharePlatform,
      combineShares: async () => new Uint8Array(16).fill(1),
    };
    await expect(
      new ShareSplit(wrong, (seed) => seed.fill(7)).split(TEST_PHRASE, 2, 3),
    ).rejects.toThrow("SSKR generated shares did not reconstruct the source entropy.");
  });

  it("refuses thresholds that SSKR cannot split into, and phrases that are none", async () => {
    for (const [threshold, count] of [
      [1, 3],
      [3, 2],
      [2, 17],
      [2.5, 3],
    ] as const)
      expect(() => ShareSplit.validateThreshold(threshold, count)).toThrow(
        "SSKR requires 2 <= threshold <= shares <= 16.",
      );
    await expect(
      new ShareSplit(nodeSharePlatform, () => {}).split(`${TEST_PHRASE} abandon`, 2, 3),
    ).rejects.toThrow("Enter 12, 15, 18, 21, or 24 English BIP39 words.");
  });
});

describe("ShareSet", () => {
  it("restores complete shares with the platform it is given, and keeps its phrase inside", async () => {
    const platform = countingPlatform();
    const set = await ShareSet.restore([SHARES[0], writeShare(SHARES[2], "indexes")], platform);
    expect(set.mnemonic).toBe(PHRASE);
    expect(platform.combined).toBeGreaterThan(0);
    expect(set.checked).toBe(true);
    expect(set.unchecked).toEqual([]);
    expect(set.groupThreshold).toBe(1);
    expect(set.groupCount).toBe(1);
    expect(set.groups).toEqual([{ index: 0, threshold: 2, members: [1, 2] }]);
    expect(set.secretBytes).toBe(16);
    expect(set.wordCount).toBe(12);
    expect(set.shares.map((share) => share.format)).toEqual(["ur", "indexes"]);
    expect(set.backupForm).toBe("english");
    for (const shown of [String(set), JSON.stringify({ set }), inspect(set)])
      expect(shown).not.toContain(PHRASE.split(" ")[0]);
    expect(set.fingerprint((mnemonic) => `fingerprint of ${mnemonic.length} letters`)).toBe(
      `fingerprint of ${PHRASE.length} letters`,
    );
  });

  it("checks a surplus share, and names it by its place", async () => {
    await expect(
      ShareSet.restore([SHARES[0], SHARES[1], wrongValue(SHARES[2])], nodeSharePlatform),
    ).rejects.toThrow("Share 3 does not fit with the others");
  });

  it("restores nothing from a platform whose library refuses every set", async () => {
    const refusing: SharePlatform = {
      ...nodeSharePlatform,
      combineShares: async () => {
        throw new Error("No secret.");
      },
    };
    await expect(ShareSet.restore([SHARES[0], SHARES[1]], refusing)).rejects.toThrow(
      "These shares do not restore a secret: check them, and that all belong to one set.",
    );
  });

  it("names the shares that took no part by their places, and the words of a secret", () => {
    const read = (ur: string) => ({ ur, format: "ur" as const, repaired: false, filled: [] });
    const shares = [read(SHARES[0]), read(SHARES[1])];
    const set = ShareSet.of({ mnemonic: PHRASE, shares, unsettled: [], unchecked: [2] });
    expect(set.checked).toBe(false);
    expect(set.uncheckedNote([1, 4])).toBe(
      "Share 4: too few shares of its group to take part; not checked.",
    );
    expect(
      ShareSet.of({ mnemonic: PHRASE, shares, unsettled: [] }).uncheckedNote(),
    ).toBeUndefined();
    expect([16, 20, 24, 28, 32].map((bytes) => ShareSet.wordCountOf(bytes))).toEqual([
      12, 15, 18, 21, 24,
    ]);
  });

  it("says why no phrase restored is the wallet given", () => {
    expect(ShareSet.walletMismatch(1)).toBe(
      "The phrase that these shares restore does not match the wallet given.",
    );
    expect(ShareSet.walletMismatch(2)).toBe(
      "None of the 2 phrases that fit these shares matches the wallet given.",
    );
    expect(ShareSet.walletMismatch(1, 10)).toBe(
      "None of the 10 date combinations gives the wallet given.",
    );
    expect(ShareSet.walletMismatch(3, 1)).toBe(
      "None of the 1 date combination gives the wallet given, with any of the 3 phrases that fit these shares.",
    );
  });

  it("combines shares with marked elements, and takes a search's phrase as a set", async () => {
    const set = await ShareSet.combine([SHARES[0], marked([5])], nodeSharePlatform);
    expect(set.mnemonic).toBe(PHRASE);
    expect(set.shares[1]!.repaired).toBe(true);
    expect(set.backupForm).toBe("english");
    const plan = await planJointRepair([SHARES[0], marked([5])]);
    const [found] = await plan.search();
    const taken = ShareSet.of(found!);
    expect(taken.toRepairedSet()).toEqual(found);
    // What the set hands out cannot change it: it is a frozen copy.
    const handed = taken.toRepairedSet();
    expect(Object.isFrozen(handed) && Object.isFrozen(handed.shares)).toBe(true);
    expect(() => ((handed as { mnemonic: string }).mnemonic = TEST_PHRASE)).toThrow(TypeError);
    expect(() => (taken.shares as unknown[]).pop()).toThrow(TypeError);
    expect(() => (handed.shares[1]!.filled as unknown[]).pop()).toThrow(TypeError);
    expect(taken.mnemonic).toBe(PHRASE);
  });
});

describe("ShareExport", () => {
  const read = (ur: string, format: "ur" | "colors" = "ur") => ({
    ur,
    format,
    repaired: false,
    filled: [],
  });

  it("shows copies as typed and saves them once", () => {
    const set = {
      shares: [read(SHARES[0]), read(SHARES[0]), read(SHARES[1], "colors")],
      unsettled: [],
    };
    const written = ShareExport.of(set, [1, 2, 4]);
    expect(written.shown.map((share) => share.number)).toEqual([1, 2, 4]);
    expect(written.saved.map((share) => share.number)).toEqual([1, 4]);
    expect(written.forms).toEqual(["ur", "colors"]);
    expect(written.total).toBe(4);
    expect(written.copiesNote).toBe("Copies of one share are saved once.");
    const cards = written.inForm("indexes");
    expect(cards.forms).toEqual(["indexes"]);
    expect(cards.shown).toHaveLength(3);
  });

  it("leaves out a share with an element that nothing settles", () => {
    const set: Pick<RepairedSet, "shares" | "unsettled"> = {
      shares: [read(SHARES[0]), read(SHARES[1])],
      unsettled: [{ share: 2, position: 3 }],
    };
    const written = ShareExport.of(set, [1, 3], "indexes");
    expect(written.leftOut).toEqual([3]);
    expect(written.leftOutMessages()).toEqual([
      "Share 3 cannot be settled and is left out: read more of it, or use another copy.",
    ]);
    expect(written.shown).toEqual([{ ur: SHARES[0], format: "indexes", number: 1 }]);
    expect(written.members).toEqual([{ place: 1, ur: SHARES[0] }]);
    expect(written.copiesNote).toBeUndefined();
  });

  it("names every share form", () => {
    expect(SHARE_FORMAT_NAMES.colors).toBe("RGB hexadecimal codes (ordered)");
  });
});

describe("ShareInput", () => {
  it("joins a share that a paste wrapped over lines, and names a phrase as no share", () => {
    const input = new ShareInput({ decodeEntry: "The Decode tab" });
    const cut = Math.floor(SHARES[0].length / 2);
    expect(
      input.sharesOfAnswer(`${SHARES[0].slice(0, cut)};${SHARES[0].slice(cut)};${SHARES[1]}`),
    ).toEqual([SHARES[0], SHARES[1]]);
    expect(() => input.sharesOfAnswer(TEST_PHRASE)).toThrow(
      "This is a seed phrase in words, not a Shamir share: The Decode tab reads a masked one.",
    );
    expect(() => input.sharesOfAnswer(" ; ")).toThrow("Type at least one share.");
    expect(input.readProblem(2, "1 1 1 1 1 1 1 1 1 1 1 4")).toBe(
      "Share 2 is an encoded seed phrase, not a Shamir share: The Decode tab reads it.",
    );
    // A share per line, as a page's field holds them.
    expect(input.sharesOfAnswer(`${SHARES[0]}\n${SHARES[1]}\r\n${SHARES[2]}`)).toEqual([
      SHARES[0],
      SHARES[1],
      SHARES[2],
    ]);
    // The host names its own reader; there is no command-line name by default.
    expect(() => new ShareInput(undefined as never)).toThrow(TypeError);
    expect(() => new ShareInput({ decodeEntry: " " })).toThrow(TypeError);
  });

  it("keeps each share at its place while shares are left out, replaced or added", () => {
    const input = new ShareInput(TEXTS);
    input.add([SHARES[0], OTHER_SET_SHARE, SHARES[1]]);
    input.leaveOut(2);
    input.replace(3, SHARES[2]);
    input.add([SHARES[1]]);
    expect(input.list).toEqual([
      { place: 1, text: SHARES[0] },
      { place: 3, text: SHARES[2] },
      { place: 4, text: SHARES[1] },
    ]);
    expect(() => input.replace(2, SHARES[1])).toThrow("No share was typed at place 2.");
    // The list handed out is a copy that nothing changes: the places stay the object's own.
    const list = input.list;
    expect(() => (list as TypedShare[]).push({ place: 9, text: SHARES[0] })).toThrow(TypeError);
    expect(() => ((list[0] as { text: string }).text = SHARES[1])).toThrow(TypeError);
    expect(input.texts()).toEqual([SHARES[0], SHARES[2], SHARES[1]]);
    input.replaceAll([SHARES[1]]);
    expect(input.places()).toEqual([1]);
    expect(list).toHaveLength(3);
  });

  it("restores complete shares, leaving out copies with a note", async () => {
    const input = new ShareInput(TEXTS);
    input.add([SHARES[0], SHARES[0], SHARES[2]]);
    const { outcome, copies } = await input.restoreComplete(nodeSharePlatform);
    expect(copies).toEqual([
      { place: 2, of: 1, message: "Share 2 is a copy of share 1: it is used once." },
    ]);
    expect(input.places()).toEqual([1, 3]);
    expect(outcome.kind === "complete" && outcome.set.mnemonic).toBe(PHRASE);
    expect(outcome.kind === "complete" && outcome.secretBytes).toBe(16);
  });

  it("names the share without which the others restore a phrase", async () => {
    const input = new ShareInput(TEXTS);
    input.add([SHARES[0], SHARES[1], wrongValue(SHARES[2])]);
    const { outcome } = await input.restoreComplete(nodeSharePlatform);
    expect(outcome).toEqual({
      kind: "trouble",
      trouble: {
        kind: "odd",
        place: 3,
        message: "Share 3 does not fit with the others: with it they give another phrase or none.",
      },
    });
  });

  it("names the set troubles by place, before anything is restored", async () => {
    const platform = countingPlatform();
    const input = new ShareInput(TEXTS);
    input.add([OTHER_SET_SHARE, SHARES[0]]);
    const { outcome } = await input.restoreComplete(platform);
    expect(outcome).toEqual({
      kind: "trouble",
      trouble: {
        kind: "refused",
        message: "Shares 1 and 2 are of different sets, and nothing tells which is right.",
      },
    });
    expect(platform.combined).toBe(0);
    input.leaveOut(1);
    expect((await input.restoreComplete(platform)).outcome).toEqual({
      kind: "trouble",
      trouble: { kind: "few", message: "One share is not enough: this set needs 2." },
    });
    expect(
      ShareInput.looseSetTrouble([
        { place: 1, ur: SHARES[0] },
        { place: 2, ur: SHARES[0] },
        { place: 3, ur: OTHER_SET_SHARE },
        { place: 4, ur: SHARES[1] },
      ]),
    ).toEqual({ kind: "odd", place: 3, message: "Share 3 is of another set than share 1." });
  });

  it("repairs each share alone, and names the first that cannot be, or fits several ways", () => {
    const input = new ShareInput(TEXTS);
    input.add([marked([5]), SHARES[0]]);
    const repaired = input.repairEach();
    expect(repaired.kind === "repaired" && repaired.shares.map((share) => share.ur)).toEqual([
      SHARES[1],
      SHARES[0],
    ]);
    // The first share as word numbers with the words at 5, 9 and 13 unreadable: 4 shares fit.
    const words = writeShare(SHARES[0], "indexes").split(" ");
    for (const place of [5, 9, 13]) words[place] = "?";
    input.replace(2, words.join(" "));
    const variants = input.repairEach();
    expect(variants).toMatchObject({
      kind: "variants",
      place: 2,
      message: "Share 2 fits 4 ways, so nothing is saved: use another copy of it, or more shares.",
    });
    expect(variants.kind === "variants" && variants.variants).toHaveLength(4);
    input.replace(1, "? nothing");
    expect(input.repairEach()).toMatchObject({ kind: "unreadable", place: 1 });
  });

  it("names the trouble of marked shares by place", async () => {
    const input = new ShareInput(TEXTS);
    input.add([marked([5]), "?".repeat(3)]);
    expect(input.firstUnreadable()).toBeUndefined();
    input.leaveOut(2);
    const plan = await planJointRepair(input.texts());
    expect(input.assessmentTrouble(plan.assessment)).toEqual({
      kind: "few",
      message: "Too few shares: the threshold of this set needs more of them.",
    });
    input.add([Array.from({ length: 65 }, () => "?").join(" ")]);
    expect(input.firstUnreadable()).toEqual({
      kind: "unreadable",
      place: 3,
      message: "Share 3: mark at most 64 unreadable elements with ?.",
    });
  });
});

describe("RepairReport", () => {
  it("says a time and a count in words", () => {
    expect(RepairReport.duration(0.5)).toBe("under a second");
    expect(RepairReport.duration(1)).toBe("about 1 second");
    expect(RepairReport.duration(90)).toBe("about 2 minutes");
    expect(RepairReport.duration(3 * 86_400)).toBe("about 3 days");
    expect(RepairReport.counted(1, "share combination")).toBe("1 share combination");
    expect(RepairReport.counted(65_536, "date combination")).toBe("65,536 date combinations");
  });

  it("gives the lines of an assessment, and when to ask before the search", async () => {
    const settled = await planJointRepair([SHARES[0], marked([5])]);
    expect(new RepairReport(settled.assessment, 1).lines()).toEqual([
      {
        kind: "status",
        label: "Marked elements:",
        value: "settled by the shares together",
        good: true,
      },
    ]);
    const open = await planJointRepair([SHARES[0], marked([5, 7])]);
    const report = new RepairReport(open.assessment, 65_536, [1, 4]);
    const lines = report.lines();
    expect(lines[0]).toEqual({
      kind: "status",
      label: "Open combinations:",
      value: "65,536 (2^16), about 1 second",
      good: false,
    });
    expect(lines).toContainEqual({
      kind: "hint",
      text: "1 more share without marks would settle everything.",
    });
    expect(lines.filter((line) => line.kind === "hint").length).toBeGreaterThan(1);
    expect(lines.at(-1)).toEqual({ kind: "more", anchor: "damaged-shares" });
    expect(report.needsQuestion()).toBe(false);
    expect(report.needsQuestion(1)).toBe(true);
    // --max-candidates limits the date search of each phrase found: beyond it, it is asked for.
    const tenDates = { combinations: 10, secondsEach: 6 };
    expect(report.needsQuestion(undefined, tenDates, 9)).toBe(true);
    expect(report.needsQuestion(undefined, tenDates, 10)).toBe(false);
    expect(report.needsQuestion(65_536, tenDates, 9)).toBe(true);
    expect(report.needsQuestion(65_535, tenDates, 10)).toBe(true);
    // A date search of complete shares asks by the same twelve hours, for all its phrases.
    const work = { combinations: 3_600, secondsEach: 6 };
    expect(RepairReport.dateSearchNeedsQuestion(work, 2)).toBe(false);
    expect(RepairReport.dateSearchNeedsQuestion(work, 3)).toBe(true);
    expect(RepairReport.dateSearchQuestion(work, 3)).toBe(
      "Search 3,600 date combinations for each of the 3 phrases, about 18 hours?",
    );
    // Asked for first only when it takes longer than twelve hours at this pace.
    expect(AUTO_SECONDS).toBe(43_200);
    expect(new RepairReport(open.assessment, 65_536 / AUTO_SECONDS).needsQuestion()).toBe(false);
    expect(new RepairReport(open.assessment, 65_536 / (AUTO_SECONDS + 1)).needsQuestion()).toBe(
      true,
    );
    const dates = { combinations: 10, secondsEach: 6 };
    // The dates for the right phrase and for those expected by chance, a hundred-thousandth here.
    expect(report.seconds(dates)).toBeCloseTo(61, 2);
    expect(report.searchSize(dates)).toBe(
      "65,536 share combinations, then 10 date combinations for each phrase found",
    );
    expect(report.searchQuestion()).toBe("Search 65,536 combinations, about 1 second?");
    expect(report.searchNotice(dates)).toBe(
      "The search tries 65,536 share combinations, then 10 date combinations for each phrase found: about 1 minute.",
    );
    expect(() => new RepairReport(open.assessment, 0)).toThrow(
      "A repair report needs a positive pace.",
    );
  });

  it("says what a repair filled in, by the place of each share", async () => {
    const plan = await planJointRepair([SHARES[0], marked([5])]);
    const [set] = await plan.search();
    const lines = RepairReport.repairLines(set!, [1, 3]);
    expect(lines[0]).toMatchObject({ kind: "warning" });
    expect(lines[0]!.kind === "warning" && lines[0]!.text).toMatch(
      /^Share 3: element 6 is #[0-9A-F]{6}\.$/u,
    );
    expect(lines.at(-1)).toEqual({
      kind: "notice",
      text: "Correct the written copy; then check the wallet that comes back.",
    });
    // The same as data, for a host that lays the elements out itself, with the same notes.
    const repairs = RepairReport.repairs(set!, [1, 3]);
    expect(repairs).toEqual([
      {
        share: 3,
        elements: [{ position: 6, value: expect.stringMatching(/^#[0-9A-F]{6}$/u), guess: false }],
      },
    ]);
    expect(lines.at(-1)).toEqual({ kind: "notice", text: REPAIR_NOTES.correct });
    expect(Object.isFrozen(REPAIR_NOTES)).toBe(true);
  });
});
