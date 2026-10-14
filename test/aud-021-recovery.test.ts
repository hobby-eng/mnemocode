// AUD-021-FUN001/FUN002: public interoperability fixtures and synthetic card decoys only.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { entropyToMnemonic } from "@scure/bip39";
import { wordlist } from "@scure/bip39/wordlists/english.js";
import { serializeRecord } from "../src/record.js";
import { BackupReading } from "../src/core/backup-reading.js";
import { BIP39_WORD_COUNTS, type Bip39WordCount } from "../src/core/bip39-sizes.js";
import { bytesOfHex } from "../src/core/bits.js";
import { hexUnits, joinedHexUnits, UNICODE_CODE_DIGITS } from "../src/core/code-text.js";
import { colorsToUnicode, COLOR_UNICODE_POINTS_PER_COLOR } from "../src/core/colors.js";
import { EncodedForm } from "../src/core/encoded-form.js";
import { MissingCodes } from "../src/core/missing-codes.js";
import type { MaskingMode } from "../src/core/types.js";
import { wordIndexOfNumber } from "../src/core/words.js";
import { planJointRepair } from "../src/sskr/joint-repair.js";
import { sskrSetVector } from "../src/sskr/known-answers.js";
import { mixShare, SHARE_HEADER_BYTES } from "../src/sskr/mixed-layout.js";
import {
  AmbiguousMarksError,
  MarkedReading,
  MAX_MARKED_ELEMENTS,
  readRepairableShare,
  repairCandidates,
  ShareVariantsError,
  sharesOfReadings,
} from "../src/sskr/repair.js";
import { nodeSharePlatform } from "../src/sskr/share-platform-node.js";
import { GROUP_BYTE, NIBBLE_BITS, SHARE_METADATA_BYTES } from "../src/sskr/share-layout.js";
import { SHARE_UNITS } from "../src/sskr/share-units.js";
import { CHECKSUM_BYTES, Share, urToTransport, type ShareFormat } from "../src/sskr/transport.js";
import { joinUnits, shareUnits } from "./helpers/shares.js";
import { recheck } from "./helpers/share-transport.js";

const backupVectors = JSON.parse(
  readFileSync(new URL("../vectors/mnemocode-v1.json", import.meta.url), "utf8"),
) as {
  vectors: { mode: MaskingMode; english: string; indexes: string; colorsUnicode: string }[];
};
const shareVectors = JSON.parse(
  readFileSync(new URL("../vectors/sskr-v1.json", import.meta.url), "utf8"),
) as { deterministic: { name: string; entropy: string; shares: string[] }[] };

const COLOR_VIEWS = ["joined hex", "apart hex", "joined symbols", "apart symbols"] as const;
type ColorView = (typeof COLOR_VIEWS)[number];
const MIXED_FORMATS = Share.FORMATS.filter((format) => SHARE_UNITS[format].mixed !== undefined);
const COLOR_DECOY = hexUnits(colorsToUnicode(["#000000"]), UNICODE_CODE_DIGITS)!;
const MARKED_DECOY = new Array<string>(COLOR_UNICODE_POINTS_PER_COLOR).fill("?");

/** Color Unicode points in each supported spelling; ? always keeps its place. */
function colorText(points: readonly string[], view: ColorView): string {
  const written = view.endsWith("symbols")
    ? points.map((point) => (point === "?" ? point : String.fromCodePoint(parseInt(point, 16))))
    : points;
  return written.join(view.startsWith("apart") ? " " : "");
}

function backupReading(text: string, words?: Bip39WordCount): BackupReading {
  return BackupReading.of(text, { seedshiftOnly: false, shareReader: "Shares", words });
}

describe("AUD-021-FUN001: declared Color Unicode prefix preserves recovery marks", () => {
  it.each(BIP39_WORD_COUNTS)("preserves first and last marks for %i words", (words) => {
    const vector = backupVectors.vectors.find((item) => item.english.split(" ").length === words)!;
    const points = hexUnits(vector.colorsUnicode, UNICODE_CODE_DIGITS)!;
    for (const at of [0, points.length - 1]) {
      const marked = points.map((point, index) => (index === at ? "?" : point));
      for (const view of COLOR_VIEWS) {
        const plain = colorText(marked, view);
        const withDecoys = colorText([...marked, ...COLOR_DECOY, ...MARKED_DECOY], view);
        const expected = MissingCodes.read(plain, "colors-unicode", "direct");
        for (const record of [false, true]) {
          const text = record
            ? serializeRecord(vector.mode, "colors-unicode", withDecoys)
            : withDecoys;
          const read = backupReading(text, words);
          expect(read.marked, `${words} ${view} record=${record} mark=${at}`).toBe(true);
          expect(read.markedFormats()).toContain("colors-unicode");
          // A record's form also wins over a conflicting form supplied by a host.
          expect(read.markedFormats(record ? "unicode" : "colors-unicode")).toEqual([
            "colors-unicode",
          ]);
          const missing = read.missingCodes("colors-unicode");
          expect(missing.wordCount).toBe(words);
          expect(missing.missingPlaces).toEqual(expected.missingPlaces);
          expect(missing.combinations).toBe(expected.combinations);
          const cropped = view.endsWith("symbols")
            ? colorText(marked, "joined symbols")
            : marked.join(" ");
          expect(EncodedForm.of("colors-unicode").leadingCodes(withDecoys, words)).toBe(cropped);
          const withoutDecoys = record
            ? serializeRecord(vector.mode, "colors-unicode", plain)
            : plain;
          expect(backupReading(withoutDecoys).marked).toBe(true);
        }
      }
    }
  });

  it.each(BIP39_WORD_COUNTS)("ignores marks only in decoys for %i words", (words) => {
    const vector = backupVectors.vectors.find((item) => item.english.split(" ").length === words)!;
    const points = hexUnits(vector.colorsUnicode, UNICODE_CODE_DIGITS)!;
    const expected = vector.indexes.split(" ").map(wordIndexOfNumber);
    for (const view of COLOR_VIEWS) {
      const text = colorText([...points, ...COLOR_DECOY, ...MARKED_DECOY], view);
      for (const record of [false, true]) {
        const read = backupReading(
          record ? serializeRecord(vector.mode, "colors-unicode", text) : text,
          words,
        );
        expect(read.marked, `${words} ${view} record=${record}`).toBe(false);
        expect(read.codes("colors-unicode").indexes).toEqual(expected);
        expect(() => read.missingCodes("colors-unicode")).toThrow(/No code is marked/u);
      }
    }
  });

  it("preserves digit marks written apart and refuses unsupported joined digit marks", () => {
    const vector = backupVectors.vectors[0]!;
    const points = hexUnits(vector.colorsUnicode, UNICODE_CODE_DIGITS)!;
    const last = points.at(-1)!;
    const marked = [...points.slice(0, -1), `${last.slice(0, -1)}?`];
    const prefix = marked.join(" ");
    const expected = MissingCodes.read(prefix, "colors-unicode", "direct");
    for (const record of [false, true]) {
      const text = [...marked, ...COLOR_DECOY].join(" ");
      const read = backupReading(
        record ? serializeRecord("direct", "colors-unicode", text) : text,
        BIP39_WORD_COUNTS[0],
      );
      expect(read.marked).toBe(true);
      expect(read.missingCodes("colors-unicode").missingPlaces).toEqual(expected.missingPlaces);
    }
    expect(() => MissingCodes.read(marked.join(""), "colors-unicode", "direct")).toThrow(
      /a \? stands for a whole code/u,
    );
  });
});

/** One mixed share's units, marked by their places, followed by a readable synthetic decoy. */
function shareText(ur: string, format: ShareFormat, marks: readonly number[]): string {
  const units = shareUnits(ur, format, "colors");
  const marked = units.map((unit, index) => (marks.includes(index) ? "?" : unit));
  return joinUnits([...marked, SHARE_UNITS[format].unitText(0)], format);
}

describe("AUD-021-FUN002: marked SSKR prefixes with card decoys", () => {
  it("refuses an unresolved capped reading beside a solved reading in either order", () => {
    const marked = `${sskrSetVector.colors[0].replace("#1F9121", "?")} #000000`;
    const share = readRepairableShare(marked);
    expect(share.ur).toBe(sskrSetVector.shares[0]);
    // The dispatcher's rule: a reading of the whole text that stopped at the cap does not let a
    // solved reading claim to be the only share, since its remaining filters were not applied.
    const solved = { withDecoys: false, tooMany: false, shares: [share] };
    const capped = { withDecoys: false, tooMany: true, shares: [] };
    for (const order of [
      [solved, capped],
      [capped, solved],
    ])
      expect(() => sharesOfReadings(order, marked)).toThrow(/Too many elements/u);
    // A capped reading with decoys after a prefix is one hypothesis more, which leaves it standing.
    const cappedDecoys = { withDecoys: true, tooMany: true, shares: [] };
    expect(sharesOfReadings([cappedDecoys, solved], marked)).toEqual([share]);
    expect(() => sharesOfReadings([cappedDecoys], marked)).toThrow(/Too many elements/u);
    expect(() => sharesOfReadings([], marked)).toThrow(/No valid share/u);
  });
  it("repairs the audit's public color fixture and reports only its genuine mark", () => {
    const complete = sskrSetVector.colors[0];
    const marked = complete.replace("#1F9121", "?");
    const expected = {
      ur: sskrSetVector.shares[0],
      format: "colors",
      repaired: true,
      filled: [{ position: 6, value: "#1F9121" }],
    };
    expect(readRepairableShare(marked)).toEqual(expected);
    expect(Share.read(`${complete} #000000`).ur).toBe(expected.ur);
    expect(readRepairableShare(`${marked} #000000`)).toEqual(expected);
  });

  for (const vector of shareVectors.deterministic) {
    it.each(MIXED_FORMATS)(`${vector.name}: repairs known and marked headers in %s`, (format) => {
      const ur = vector.shares[0]!;
      const units = shareUnits(ur, format, "colors");
      const form = SHARE_UNITS[format].mixed!;
      const headerUnits = form.unitCount(CHECKSUM_BYTES + SHARE_HEADER_BYTES);
      const completeWithDecoy = shareText(ur, format, []);
      expect(Share.read(completeWithDecoy).ur).toBe(ur);
      expect(readRepairableShare(completeWithDecoy)).toMatchObject({ ur, repaired: false });
      // First: checksum unknown; last header unit: recorded length unknown; middle: known length;
      // last: the share's padding, which remains checked before any decoy is excluded.
      for (const at of [0, headerUnits - 1, Math.floor(units.length / 2), units.length - 1]) {
        const markedOnly = joinUnits(
          units.map((unit, index) => (index === at ? "?" : unit)),
          format,
        );
        const expected = readRepairableShare(markedOnly);
        expect(expected.ur).toBe(ur);
        expect(readRepairableShare(shareText(ur, format, [at]))).toEqual(expected);
      }
      if (format !== "colors-unicode") {
        const knownLength = MarkedReading.of(shareText(ur, format, [units.length - 1]))
          .filter((reading) => reading.format === format)
          .map((reading) => reading.values.length);
        expect([...new Set(knownLength)]).toEqual([units.length]);
      }
    });
  }

  it("repairs joined RGB and word Unicode and every Color Unicode spelling", () => {
    const ur = sskrSetVector.shares[0];
    for (const format of ["colors", "unicode"] as const)
      expect(readRepairableShare(shareText(ur, format, [5]).replaceAll(" ", "")).ur).toBe(ur);
    const text = shareText(ur, "colors-unicode", [5]);
    const points = joinedHexUnits(text, UNICODE_CODE_DIGITS)!;
    for (const view of COLOR_VIEWS) {
      expect(readRepairableShare(colorText(points, view)).ur, view).toBe(ur);
      const complete = joinedHexUnits(shareText(ur, "colors-unicode", []), UNICODE_CODE_DIGITS)!;
      expect(Share.read(colorText(complete, view)).ur, view).toBe(ur);
    }
  });

  it("keeps partial digit constraints when cropping a share prefix", () => {
    const ur = sskrSetVector.shares[0];
    for (const format of ["colors", "unicode", "colors-unicode"] as const) {
      const units = shareUnits(ur, format);
      const at = Math.floor(units.length / 2);
      const unit = units[at]!;
      units[at] = `${unit.slice(0, -1)}?`;
      const expected = readRepairableShare(units.join(" "));
      expect(expected.ur).toBe(ur);
      const decoy = format === "colors-unicode" ? COLOR_DECOY : [SHARE_UNITS[format].unitText(0)];
      expect(readRepairableShare([...units, ...decoy].join(" "))).toEqual(expected);
    }
  });

  it.each(MIXED_FORMATS)(
    "restores %s with another intact share and a trailing decoy",
    async (format) => {
      const plan = await planJointRepair(
        [shareText(sskrSetVector.shares[0], format, [5]), sskrSetVector.shares[1]],
        { platform: nodeSharePlatform },
      );
      try {
        expect(plan.assessment.verdict).toBe("determined");
        const found = await plan.search();
        expect(found.map((set) => set.mnemonic)).toEqual([sskrSetVector.phrase]);
        expect(found[0]!.shares.map((share) => share.ur)).toEqual(sskrSetVector.shares.slice(0, 2));
        expect(found[0]!.shares[0]!.filled).toHaveLength(1);
      } finally {
        plan.wipe();
      }
    },
  );

  it("preserves checksum and padding refusal and rejects malformed decoy text", () => {
    const ur = sskrSetVector.shares[0];
    for (const format of MIXED_FORMATS) {
      const marked = shareText(ur, format, [5]);
      for (const bad of ["not-a-code", "ZZZZ", "#12345"])
        expect(() => readRepairableShare(`${marked} ${bad}`), `${format} ${bad}`).toThrow(
          /No valid share/u,
        );
    }
    const colors = shareUnits(ur, "colors");
    colors[5] = "?";
    // Nonzero padding in the final color cannot be reclassified as a trailing decoy.
    colors[colors.length - 1] = "#750001";
    expect(() => readRepairableShare([...colors, "#000000"].join(" "))).toThrow(/No valid share/u);
    colors[colors.length - 1] = "#750000";
    colors[6] = "#DB206D";
    expect(() => readRepairableShare([...colors, "#000000"].join(" "))).toThrow(/No valid share/u);
    const points = joinedHexUnits(shareText(ur, "colors-unicode", [5]), UNICODE_CODE_DIGITS)!;
    // Every code is in range, but this high/low pair is outside RGB: it is not a card decoy.
    const invalidPair = SHARE_UNITS["colors-unicode"].unitText(
      2 ** SHARE_UNITS.colors.unitBits - 1,
    );
    const high = hexUnits(invalidPair, UNICODE_CODE_DIGITS)![0]!;
    expect(() => readRepairableShare([...points, high, "F8FF"].join(""))).toThrow(
      /No valid share/u,
    );
  });

  it("keeps the mark bound and ambiguous width refusal", () => {
    const units = shareUnits(sskrSetVector.shares[0], "colors");
    const tooMany = units.map((unit, index) => (index <= MAX_MARKED_ELEMENTS ? "?" : unit));
    expect(() => readRepairableShare([...tooMany, "#000000"].join(" "))).toThrow(
      new RegExp(`at most ${MAX_MARKED_ELEMENTS}`, "u"),
    );
    expect(() => MarkedReading.of(`${"??E000".repeat(8)}E000E000`)).toThrow(AmbiguousMarksError);
  });

  it("lists multiple valid shares instead of silently choosing a prefix repair", () => {
    const ur = sskrSetVector.shares[0];
    // One whole color and three hex digits: 36 unknown bits leave four beyond the CRC-32.
    const marked = shareText(ur, "colors", [4]).replace("#1F9121", "#1F9???");
    const candidates = repairCandidates(marked);
    expect(candidates.length).toBeGreaterThan(1);
    expect(candidates.map((candidate) => candidate.ur)).toContain(ur);
    expect(() => readRepairableShare(marked)).toThrow(ShareVariantsError);
  });

  it("rejects invalid metadata even when its transport checksum was recomputed", () => {
    const ur = sskrSetVector.shares[0];
    const transport = urToTransport(ur);
    const payloadStart =
      transport.length - CHECKSUM_BYTES - SHARE_METADATA_BYTES - Share.read(ur).info.secretLength;
    // Two groups required, but only one declared: CRC validity does not validate metadata.
    transport[payloadStart + GROUP_BYTE] = 1 << NIBBLE_BITS;
    const invalid = recheck(transport.subarray(0, -CHECKSUM_BYTES));
    const form = SHARE_UNITS.colors.mixed!;
    const values = form.unpack(mixShare(invalid, form.version));
    try {
      const units = values.map(SHARE_UNITS.colors.unitText);
      units[5] = "?";
      expect(() => readRepairableShare([...units, "#000000"].join(" "))).toThrow(/No valid share/u);
    } finally {
      values.fill(0);
      transport.fill(0);
      invalid.fill(0);
    }
  });

  it("rejects invalid standard-form suffixes without card cropping", () => {
    const ur = sskrSetVector.shares[0];
    const words = shareUnits(ur, "words");
    words[5] = "?";
    expect(() => readRepairableShare([...words, "zzzz"].join(" "))).toThrow(/No valid share/u);
    const pairs = shareUnits(ur, "ur");
    pairs[5] = "?";
    expect(() => readRepairableShare(joinUnits([...pairs, "zz"], "ur"))).toThrow(/No valid share/u);
  });

  it("restores a longer public fixture through joint repair of a marked header", async () => {
    const vector = shareVectors.deterministic.at(-1)!;
    const plan = await planJointRepair(
      [shareText(vector.shares[0]!, "colors", [0]), vector.shares[1]!],
      { platform: nodeSharePlatform },
    );
    try {
      const expected = entropyToMnemonic(bytesOfHex(vector.entropy), wordlist);
      expect((await plan.search()).map((set) => set.mnemonic)).toEqual([expected]);
    } finally {
      plan.wipe();
    }
  });
});
