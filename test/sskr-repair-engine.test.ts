// The repair engine after the DRY/OOP scan of 2026-10-09 (S038, S039, S041, S048, S119, S120):
// one codec of units for every share form, one mixed layout for the reader and the repair, the
// classes of the repair, one progress and one way to turn for every search, the Share class as
// the library's own entry, and shares named by the place they were typed at. Public SSKR vectors
// and public test phrases only.

import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it, vi } from "vitest";
import { entropyToMnemonic } from "@scure/bip39";
import { wordlist } from "@scure/bip39/wordlists/english.js";
import { encodeMnemonic, parseDate } from "../src/core.js";
import { hexUnits } from "../src/core/code-text.js";
import { DatesAnswer, DateSearch, type DateSearchProgress } from "../src/core/date-search.js";
import { placeOf } from "../src/core/places.js";
import { SearchTurns } from "../src/core/search-turns.js";
import { checksumAt } from "../src/sskr/checksum.js";
import { misfitMessage } from "../src/sskr/complete-shares.js";
import { planJointRepair, searchOnce, type RepairProgress } from "../src/sskr/joint-repair.js";
import {
  COLOR_FORM,
  mixedTransport,
  mixShare,
  ownUnitCount,
  WORD_FORM,
} from "../src/sskr/mixed-layout.js";
import { markCount, MarkedReading, ReadingSpace, readRepairableShare } from "../src/sskr/repair.js";
import { NO_PHRASE_FITS, RepairReport, REPAIR_NOTES } from "../src/sskr/repair-report.js";
import { SET_CONFLICT_TEXTS } from "../src/sskr/set-topology.js";
import { ShareInput } from "../src/sskr/share-input.js";
import { ShareRestore } from "../src/sskr/share-restore.js";
import { GROUP_BYTE, storedCount } from "../src/sskr/share-layout.js";
import { nodeSharePlatform } from "../src/sskr/share-platform-node.js";
import { ShareSet } from "../src/sskr/share-set.js";
import { SHARE_UNITS } from "../src/sskr/share-units.js";
import { ShareSplit } from "../src/sskr/split.js";
import {
  readShare,
  Share,
  SHARE_FORMATS,
  shareInfo,
  urToTransport,
  validateShareSet,
  writeShare,
  type ShareFormat,
} from "../src/sskr/transport.js";
import { markUnits, shareUnits } from "./helpers/shares.js";

const vectors = JSON.parse(readFileSync("vectors/sskr-v1.json", "utf8")) as {
  deterministic: { entropy: string; shares: string[] }[];
};
const VECTOR = vectors.deterministic[0]!;
const SHARES = VECTOR.shares;
const SHARE = SHARES[0]!;
const PUBLIC_PHRASE = `${"abandon ".repeat(11)}about`;
const OTHER_PHRASE = `${"zoo ".repeat(11)}wrong`;

afterEach(() => {
  vi.restoreAllMocks();
});

/** The units of `share` in `format`, as their values (SHARE_UNITS.valueOf reads whole colors). */
function unitValues(share: string, format: ShareFormat): number[] {
  return shareUnits(share, format, "colors").map((unit) => SHARE_UNITS[format].valueOf(unit)!);
}

/** Two sets of 2 of `count` shares of different phrases with the same identifier (S013). */
async function twinSets(count: number): Promise<[string[], string[]]> {
  const split = new ShareSplit(nodeSharePlatform, (bytes) => bytes.fill(7));
  return [await split.split(PUBLIC_PHRASE, 2, count), await split.split(OTHER_PHRASE, 2, count)];
}

describe("S038: one codec of units for every share form", () => {
  it("writes each form's units as writeShare writes the share", () => {
    for (const format of SHARE_FORMATS)
      expect(SHARE_UNITS[format].text(unitValues(SHARE, format)), format).toBe(
        writeShare(SHARE, format),
      );
  });

  it("reads back every unit it writes, and refuses a color that is none", () => {
    for (const format of SHARE_FORMATS) {
      const units = SHARE_UNITS[format];
      for (const value of [0, 1, 2 ** units.unitBits - 1])
        expect(units.valueOf(units.unitText(value)), `${format} ${value}`).toBe(value);
    }
    // A color is read with or without its #, since the element tokenizer removes it.
    expect(SHARE_UNITS.colors.valueOf("FF0000")).toBe(0xff0000);
    expect(SHARE_UNITS.colors.valueOf("#FF00")).toBeUndefined();
    expect(SHARE_UNITS.colors.valueOf("##FF0000")).toBeUndefined();
  });

  it("names the mixed layout of MnemoCode's own forms, and none for the standard ones", () => {
    expect(SHARE_UNITS.ur.mixed).toBeUndefined();
    expect(SHARE_UNITS.words.mixed).toBeUndefined();
    expect(SHARE_UNITS.indexes.mixed).toBe(WORD_FORM);
    expect(SHARE_UNITS.unicode.mixed).toBe(WORD_FORM);
    expect(SHARE_UNITS.colors.mixed).toBe(COLOR_FORM);
    expect(SHARE_UNITS["colors-unicode"].mixed).toBe(COLOR_FORM);
  });

  it("repairs a share written with every separator that its reader takes", () => {
    const separators: Partial<Record<ShareFormat, readonly string[]>> = {
      indexes: [" ", ",", ";", ", ", "\n"],
      unicode: [" ", ",", ";", ", ", "\n"],
      colors: [" ", ",", ";", ", ", "\n"],
      words: [" ", "-", "\n"],
    };
    for (const [format, list] of Object.entries(separators) as [ShareFormat, string[]][])
      for (const separator of list) {
        const units = shareUnits(SHARE, format);
        expect(readShare(units.join(separator)).ur, `${format} ${separator}`).toBe(SHARE);
        units[3] = "?";
        expect(readRepairableShare(units.join(separator)).ur, `${format} ${separator}`).toBe(SHARE);
      }
  });

  it("reads, unmarked, every share text that the repair takes, with every separator", () => {
    // The reverse of the case before (final review R1): the look of each form splits elements
    // as code-text does, so that a text the repair takes is not turned away by a look.
    const separators: Partial<Record<ShareFormat, readonly string[]>> = {
      indexes: [" ", ",", ";", "#", " # ", "\n"],
      unicode: [" ", ",", ";", "#", " # ", "\n"],
      colors: [" ", ",", ";", "#", ", ", "\n"],
      "colors-unicode": ["", " ", ",", ";", "#"],
    };
    for (const [format, list] of Object.entries(separators) as [ShareFormat, string[]][])
      for (const separator of list) {
        const units = shareUnits(SHARE, format, "colors");
        const marks = [...units];
        marks[3] = "?";
        expect(readRepairableShare(marks.join(separator)).ur, `${format} ${separator}`).toBe(SHARE);
        expect(readShare(units.join(separator)), `${format} ${separator}`).toEqual({
          ur: SHARE,
          format,
        });
      }
  });

  it("reads a code apart all of whose digits are ? as the whole code, and counts it once", () => {
    // Final review R2 and R8: the repair reads codes through code-text's hexUnits, which gives
    // such a code as a lone ?, and markCount counts it as the one element it is.
    expect(hexUnits("4E00 ???? 4E01", 4, { foldWholeMarks: true })).toEqual(["4E00", "?", "4E01"]);
    expect(hexUnits("4E00 ???? 4E01", 4)).toEqual(["4E00", "????", "4E01"]);
    for (const format of ["unicode", "colors"] as const) {
      const units = shareUnits(SHARE, format);
      units[3] = format === "colors" ? "??????" : "????";
      expect(markCount(units.join(" ")), format).toBe(1);
      expect(readRepairableShare(units.join(" ")).ur, format).toBe(SHARE);
    }
    // Two whole colors leave too many bits open, which is the reason given, not the mark limit.
    const colors = shareUnits(SHARE, "colors");
    colors[2] = "??????";
    colors[5] = "?";
    expect(markCount(colors.join(" "))).toBe(2);
    expect(() => readRepairableShare(colors.join(" "))).toThrow(/Too many elements are marked/u);
  });

  it("gives the value of one Color Unicode unit only, never of the first of several colors", () => {
    // Final review R6: a text of two colors is no one unit.
    const units = SHARE_UNITS["colors-unicode"];
    const [first, second] = unitValues(SHARE, "colors-unicode");
    expect(units.valueOf(units.unitText(first!))).toBe(first);
    expect(units.valueOf(units.unitText(first!) + units.unitText(second!))).toBeUndefined();
  });

  it("repairs a UR whose prefix is written in any case that its reader takes", () => {
    const body = markUnits(SHARE, "ur", [0]).slice("ur:sskr/".length);
    // The long s (U+017F) and the Kelvin sign (U+212A) fold to s and k, as the reader folds them.
    for (const prefix of ["UR:SSKR/", "Ur:sSkR/", "ur:\u017Fskr/", "ur:ss\u212Ar/"]) {
      const written = SHARE.replace("ur:sskr/", prefix);
      expect(readShare(written).ur, prefix).toBe(SHARE);
      expect(readRepairableShare(`${prefix}${body}`).ur, prefix).toBe(SHARE);
    }
  });
});

describe("S039: one mixed layout for the reader and the repair", () => {
  it("packs colors red first and words 11 bits each, the last unit filled with zero bits", () => {
    expect(COLOR_FORM.pack([0x010203, 0xfffefd])).toEqual({
      bytes: [1, 2, 3, 0xff, 0xfe, 0xfd],
      leftover: [0, 0],
    });
    expect(COLOR_FORM.unpack([1, 2, 3, 4])).toEqual([0x010203, 0x040000]);
    expect(WORD_FORM.pack([2047, 1])).toEqual({ bytes: [0xff, 0xe0], leftover: [1, 6] });
    expect(WORD_FORM.unpack([0xff, 0xe0])).toEqual([2047, 0]);
    expect(COLOR_FORM.unitCount(40)).toBe(14);
    expect(WORD_FORM.unitCount(40)).toBe(30);
  });

  it("reads a share's own units back and refuses one more unit, or a filling that is not zero", () => {
    const transport = urToTransport(SHARE);
    const colors = COLOR_FORM.unpack(mixShare(transport, COLOR_FORM.version));
    const packed = COLOR_FORM.pack(colors);
    expect(mixedTransport(COLOR_FORM, packed, colors.length)).toEqual(transport);
    expect(mixedTransport(COLOR_FORM, COLOR_FORM.pack([...colors, 0]), colors.length + 1)).toBe(
      undefined,
    );
    const filled = [...colors];
    filled[filled.length - 1]! |= 1;
    expect(mixedTransport(COLOR_FORM, COLOR_FORM.pack(filled), colors.length)).toBe(undefined);
    // The version of the words is not that of the colors.
    expect(mixedTransport(WORD_FORM, packed, WORD_FORM.unitCount(packed.bytes.length))).toBe(
      undefined,
    );
    // The reader stops at the share's own length, which its header gives: a color after it, such
    // as a decoy of its cards, is left out (owner, 2026-10-13), while the layout above refuses it.
    expect(readShare(writeShare(SHARE, "colors") + " #000000").ur).toBe(SHARE);
    expect(ownUnitCount(COLOR_FORM, [...colors, 0])).toBe(colors.length);
  });

  it("reads a checksum big-endian, as an unsigned number", () => {
    expect(checksumAt([0, 0, 1, 2, 3, 4], 2)).toBe(0x01020304);
    expect(checksumAt([0xff, 0xff, 0xff, 0xff], 0)).toBe(0xffffffff);
  });

  it("reads a threshold or a count stored less one", () => {
    expect(storedCount(0)).toBe(1);
    expect(shareInfo(urToTransport(SHARE))).toMatchObject({ memberThreshold: 2, groupCount: 1 });
  });
});

describe("S041: a reading and its space are classes", () => {
  const text = markUnits(SHARE, "indexes", [2, 7]);

  it("makes another reading for chosen values and leaves the first as it was", () => {
    const reading = MarkedReading.of(text).find((each) => each.format === "indexes")!;
    expect(reading.holes).toEqual([2, 7]);
    expect(Object.isFrozen(reading.holes)).toBe(true);
    const chosen = reading.withValues(new Map([[2, 5]]));
    expect(chosen).not.toBe(reading);
    expect(chosen.readBits?.[2]).toEqual({ value: 5, mask: 2047 });
    expect(reading.readBits).toBeUndefined();
    expect(reading.unitMask(1)).toBe(2047n << 11n);
  });

  it("hands out a payload only as a new array, and wipes its own", () => {
    const reading = MarkedReading.of(text).find((each) => each.format === "indexes")!;
    const space = reading.space()!;
    const first = space.payloadAt(0n);
    first.fill(0xff);
    expect(space.payloadAt(0n)).not.toEqual(first);
    // One group: its byte is zero in every solution.
    expect(space.fixedPayloadByte(GROUP_BYTE)).toBe(0);
    space.wipe();
    expect(space.secretArrays().every((array) => array.every((byte) => byte === 0))).toBe(true);
    let used: ReadingSpace | undefined;
    expect(reading.withSpace((solved) => (used = solved)?.basis.length)).toBe(0);
    expect(used!.secretArrays().every((array) => array.every((byte) => byte === 0))).toBe(true);
  });

  it("gives the share that values at its marks make, read as an ordinary share", () => {
    const reading = MarkedReading.of(text).find((each) => each.format === "indexes")!;
    const values = unitValues(SHARE, "indexes");
    expect(reading.solvedShare(values)).toEqual({
      ur: SHARE,
      format: "indexes",
      repaired: true,
      filled: [
        { position: 3, value: shareUnits(SHARE, "indexes")[2] },
        { position: 8, value: shareUnits(SHARE, "indexes")[7] },
      ],
    });
    expect(reading.solvedShare(values.map((value) => value ^ 1))).toBeUndefined();
  });
});

describe("S048: one progress and one way to turn for every search", () => {
  it("hears a stop between two turns, before a turn is due", async () => {
    const stop = new AbortController();
    const turns = new SearchTurns(stop.signal);
    expect(await turns.due()).toBe(false);
    stop.abort(new Error("Stopped between turns."));
    await expect(turns.due()).rejects.toThrow("Stopped between turns.");
  });

  it("takes a turn when asked, however soon, and hears a stop typed during it", async () => {
    const stop = new AbortController();
    let turns = 0;
    const searchTurns = new SearchTurns(stop.signal, async () => {
      turns += 1;
      stop.abort(new Error("Stopped during the turn."));
    });
    await expect(searchTurns.take()).rejects.toThrow("Stopped during the turn.");
    expect(turns).toBe(1);
  });

  it("tells the progress of a share search as one object", async () => {
    const plan = await planJointRepair([SHARES[0]!, markUnits(SHARES[1]!, "colors", [5])], {
      platform: nodeSharePlatform,
    });
    const progress: RepairProgress[] = [];
    const found = await searchOnce(plan, { onProgress: (step) => progress.push(step) });
    expect(found.map((set) => set.mnemonic)).toEqual([
      entropyToMnemonic(Buffer.from(VECTOR.entropy, "hex"), wordlist),
    ]);
    const total = plan.assessment.combinations;
    expect(progress.at(-1)).toEqual({ checked: total, total, found: 1 });
  });

  it("tells a date search's progress at its turns when no step is given", async () => {
    const search = new DateSearch({
      indexes: encodeMnemonic(PUBLIC_PHRASE, [parseDate("23-09-2026")]).shiftedIndexes,
      dates: DatesAnswer.parse("2?-09-2026", { wordCount: 12, patterns: true }),
      mode: "seedshift",
    });
    // Every look at the clock is a second later: a turn is due before each combination.
    let now = 0;
    vi.spyOn(performance, "now").mockImplementation(() => (now += 1000));
    const progress: DateSearchProgress[] = [];
    await search.run({ onProgress: (step) => progress.push(step), turn: async () => undefined });
    expect(progress.length).toBeGreaterThan(1);
    expect(progress.at(-1)).toEqual({ checked: 10, total: 10, found: 10, matched: 10 });
  });

  it("lets the host's own turn run during the assessment of marked shares", async () => {
    const input = new ShareInput({ decodeEntry: "The Decode tab" });
    input.add([SHARES[0]!, markUnits(SHARES[1]!, "colors", [5])]);
    let turns = 0;
    const read = await new ShareRestore(nodeSharePlatform).read(input, undefined, async () => {
      turns += 1;
    });
    expect(read.kind).toBe("marked");
    expect(turns).toBeGreaterThan(0);
  });

  it("gives a restore's own turn to its assessment too", async () => {
    const input = new ShareInput({ decodeEntry: "The Decode tab" });
    input.add([SHARES[0]!, markUnits(SHARES[1]!, "colors", [5])]);
    const read = vi.spyOn(ShareRestore.prototype, "read");
    const turn = async () => undefined;
    const restored = await new ShareRestore(nodeSharePlatform).restore({
      input,
      mode: "direct",
      confirmed: true,
      turn,
    });
    expect(restored.kind).toBe("phrases");
    expect(read).toHaveBeenCalledWith(input, expect.any(Function), turn);
  });
});

describe("S119: the Share class is the library's own entry", () => {
  it("reads its metadata once, and never changes it", () => {
    const share = Share.read(writeShare(SHARE, "colors"));
    expect(share.info).toEqual(shareInfo(urToTransport(SHARE)));
    expect(Object.isFrozen(share.info)).toBe(true);
    expect(share.info).toBe(share.info);
  });

  it("checks a set as validateShareSet does, which gives its URs", () => {
    const typed = SHARES.map((share, index) =>
      writeShare(share, index === 0 ? "indexes" : "words"),
    );
    expect(Share.readSet(typed).map((share) => share.ur)).toEqual(SHARES);
    expect(validateShareSet(typed)).toEqual(SHARES);
    expect(() => Share.readSet([SHARE, SHARE])).toThrow(SET_CONFLICT_TEXTS.member.refusal);
    expect(() => Share.readSet([SHARE, vectors.deterministic[1]!.shares[1]!])).toThrow(
      SET_CONFLICT_TEXTS.set.refusal,
    );
    expect(() => Share.readSet([SHARE])).toThrow(
      "Not enough SSKR shares to meet the recorded threshold.",
    );
    expect(Share.readSet([SHARE], false)).toHaveLength(1);
  });
});

describe("S120: one wording for each refusal, and shares named by their places", () => {
  it("names a surplus share that does not fit by its place", async () => {
    const [mine, other] = await twinSets(3);
    const typed = [mine[0]!, mine[1]!, other[2]!];
    await expect(ShareSet.restore(typed, nodeSharePlatform, [2, 5, 7])).rejects.toThrow(
      misfitMessage(7),
    );
    await expect(ShareSet.restore(typed, nodeSharePlatform)).rejects.toThrow(misfitMessage(3));
    expect(misfitMessage(3)).toBe(
      "Share 3 does not fit with the others: with it they give another phrase or none. Leave it out, or check it.",
    );
  });

  it("refuses marked shares that no phrase fits with the one text for it", async () => {
    const [mine, other] = await twinSets(3);
    // A share of each phrase: they fit every equation, and the digest refuses every candidate.
    const typed = [markUnits(mine[0]!, "colors", [3]), other[1]!];
    const plan = await planJointRepair(typed, { platform: nodeSharePlatform });
    expect(plan.assessment.reason).toBeUndefined();
    expect(await searchOnce(plan)).toEqual([]);
    await expect(ShareSet.combine(typed, nodeSharePlatform)).rejects.toThrow(NO_PHRASE_FITS);
  });

  it("names a share that no reading fits by its place, and tells which it is", async () => {
    const plan = await planJointRepair([markUnits(SHARE, "indexes", [3]), "zzzz ? qqqq"], {
      platform: nodeSharePlatform,
      places: [3, 6],
    });
    expect(plan.assessment.unfit).toBe(2);
    expect(plan.assessment.reason).toBe(
      "Share 6 cannot be read as a share: check the elements marked with ?, and the others.",
    );
    expect(placeOf([3, 6], 2)).toBe(6);
    expect(placeOf(undefined, 2)).toBe(2);
  });

  it("names the shares of a refused set by their places after a copy was left out", async () => {
    const [mine, other] = await twinSets(5);
    const input = new ShareInput({ decodeEntry: "The Decode tab" });
    input.add([mine[0]!, mine[0]!, mine[1]!, other[2]!, other[3]!]);
    const { outcome, copies } = await input.restoreComplete(nodeSharePlatform);
    expect(copies.map((copy) => copy.place)).toEqual([2]);
    // No share left out mends the others, so the set's own refusal is given, by place.
    expect(outcome).toEqual({
      kind: "trouble",
      trouble: { kind: "refused", message: misfitMessage(4) },
    });
  });

  it("words a conflict of shares named by place from the same table as the refusal", () => {
    const trouble = ShareInput.looseSetTrouble([
      { place: 1, ur: SHARE },
      { place: 2, ur: vectors.deterministic[1]!.shares[1]! },
    ]);
    expect(trouble).toEqual({
      kind: "refused",
      message: `Shares 1 and 2 ${SET_CONFLICT_TEXTS.set.between}, and nothing tells which is right.`,
    });
  });

  it("gives the notes after the repairs to a host that lays the repairs out itself", () => {
    const repaired = readRepairableShare(markUnits(SHARE, "indexes", [3]));
    const set = { shares: [repaired], unsettled: [{ share: 1, position: 4 }] };
    expect(RepairReport.notes(set)).toEqual([
      { kind: "warning", text: REPAIR_NOTES.guesses },
      { kind: "notice", text: REPAIR_NOTES.correct },
    ]);
    expect(RepairReport.repairLines(set).slice(-2)).toEqual(RepairReport.notes(set));
    const unrepaired = { ...repaired, repaired: false, filled: [] };
    expect(RepairReport.notes({ shares: [unrepaired], unsettled: [] })).toEqual([]);
  });
});
