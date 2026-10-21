import { describe, expect, it, vi } from "vitest";
import {
  decodeIndexes,
  decodeIndexesLegacy,
  decodeIndexesLegacyValid,
  encodeMnemonic,
  encodeMnemonicLegacy,
  formatEncoded,
  legacyChecksumValidResult,
  parseDate,
  representMnemonic,
} from "../src/core.js";
import { BackupReading } from "../src/core/backup-reading.js";
import { capabilities } from "../src/core/backup-options.js";
import { DatesAnswer, DateSearch } from "../src/core/date-search.js";
import { EncodedBackup, MissingChecksumError } from "../src/core/encoded-backup.js";
import { Masking } from "../src/core/masking.js";
import { parseRecord, serializeRecord } from "../src/record.js";
import { Share, writeShare } from "../src/sskr/transport.js";
import {
  DATE,
  ENCODED_FINGERPRINT,
  MASKED,
  MASKED_INDEXES,
  MASKED_WORDS,
  TEST_PHRASE,
} from "./helpers/test-phrase.js";
import { publicShare } from "./helpers/vectors.js";

// The parts that read and write an encoded seed phrase, each on its own, as another host such as
// the Deriver uses them: the Seedshift modes (Masking), the codes in every form with their record
// (EncodedBackup), and how a backup as given is read (BackupReading). Public test data only.

/** DATE as the transformations take it. */
const MASKING_DATE = parseDate(DATE);
/** TEST_PHRASE masked with MnemoCode Seedshift and DATE, as encodeMnemonic gives it. */
const ENCODED = encodeMnemonic(TEST_PHRASE, [MASKING_DATE]);
const LEGACY = encodeMnemonicLegacy(TEST_PHRASE, [MASKING_DATE]);
/**
 * The first share of the first published SSKR vector, 2 of 3 in one group (vectors/sskr-v1.json).
 */
const SHARE = publicShare();

describe("Masking", () => {
  it("is one value per mode, with every rule that tells the modes apart", () => {
    expect(Masking.MODES).toEqual([
      "direct",
      "seedshift",
      "seedshift-legacy",
      "seedshift-legacy-valid",
    ]);
    const rules = Masking.MODES.map((mode) => {
      const masking = Masking.of(mode);
      return [mode, masking.name, masking.masked, masking.keepsChecksum, masking.givesSeveral];
    });
    expect(rules).toEqual([
      ["direct", "no Seedshift", false, false, false],
      ["seedshift", "MnemoCode Seedshift", true, true, false],
      ["seedshift-legacy", "the Original Seedshift", true, false, false],
      ["seedshift-legacy-valid", "the Original Seedshift with a valid last word", true, true, true],
    ]);
    // The same value each time, which the capabilities of the backup options are taken from.
    expect(Masking.of("seedshift")).toBe(Masking.of("seedshift"));
    for (const mode of Masking.MODES)
      expect(capabilities(mode)).toBe(Masking.of(mode).capabilities);
    expect(Object.isFrozen(Masking.of("direct").capabilities)).toBe(true);
  });

  it("names the same modes as the MNC1 record, whose format has its own list of them", () => {
    for (const mode of Masking.MODES)
      expect(parseRecord(serializeRecord(mode, "indexes", "1 2"))?.mode).toBe(mode);
    // A mode that no type allows, fed on purpose as a JavaScript host could.
    expect(() => serializeRecord("shifted" as never, "indexes", "1 2")).toThrow(
      "Unsupported MnemoCode record mode.",
    );
  });

  it("refuses a value that names no mode", () => {
    for (const value of ["shifted", "toString", "", undefined, 1])
      expect(Masking.isMode(value)).toBe(false);
    // A mode that no type allows, fed on purpose as a JavaScript host could.
    expect(() => Masking.of("toString" as never)).toThrow("Unsupported Seedshift mode.");
  });

  it("writes and undoes each mode as the transformations do", () => {
    expect(Masking.of("direct").encode(TEST_PHRASE, [])).toEqual(representMnemonic(TEST_PHRASE));
    expect(Masking.of("seedshift").encode(TEST_PHRASE, [MASKING_DATE])).toEqual(ENCODED);
    expect(Masking.of("seedshift-legacy").encode(TEST_PHRASE, [MASKING_DATE])).toEqual(LEGACY);
    const valid = legacyChecksumValidResult(LEGACY);
    expect(Masking.of("seedshift-legacy-valid").encode(TEST_PHRASE, [MASKING_DATE])).toEqual(valid);

    expect(Masking.of("seedshift").undo(MASKED_INDEXES, [MASKING_DATE])).toEqual([
      decodeIndexes(MASKED_INDEXES, [MASKING_DATE]),
    ]);
    expect(Masking.of("seedshift-legacy").undo(LEGACY.shiftedIndexes, [MASKING_DATE])).toEqual([
      decodeIndexesLegacy(LEGACY.shiftedIndexes, [MASKING_DATE]),
    ]);
    expect(Masking.of("seedshift-legacy-valid").undo(valid.shiftedIndexes, [MASKING_DATE])).toEqual(
      decodeIndexesLegacyValid(valid.shiftedIndexes, [MASKING_DATE]),
    );
    const [direct] = Masking.of("direct").undo(MASKED_INDEXES, []);
    expect(direct!.recoveredMnemonic).toBe(MASKED_WORDS);
    // Without Seedshift the codes must still be a phrase's, and each a BIP39 index.
    expect(() => Masking.of("direct").undo([1, 2, 3], [])).toThrow("Expected 12, 15, 18, 21");
    expect(() => Masking.of("direct").undo([...MASKED_INDEXES.slice(1), 2048], [])).toThrow(
      "Every BIP39 index must be an integer from 0 through 2047.",
    );
  });

  it("tells the wallet checks of one date combination, which the date search counts", () => {
    // 12 words keep 4 checksum bits, 24 words 8.
    expect(Masking.of("seedshift").checksPerCombination(12)).toBe(1);
    expect(Masking.of("seedshift-legacy").checksPerCombination(12)).toBe(1 / 16);
    expect(Masking.of("seedshift-legacy").checksPerCombination(24)).toBe(1 / 256);
    expect(Masking.of("seedshift-legacy-valid").checksPerCombination(12)).toBe(128);
    expect(Masking.of("seedshift-legacy-valid").checksPerCombination(24)).toBe(8);
    expect(() => Masking.of("seedshift").checksPerCombination(13)).toThrow("Expected 12, 15");
    const search = new DateSearch({
      indexes: LEGACY.shiftedIndexes,
      dates: DatesAnswer.parse("2?-09-2026", { wordCount: 12, patterns: true }),
      mode: "seedshift-legacy-valid",
    });
    expect(search.checks()).toBe(128);
  });
});

describe("EncodedBackup writes its codes back", () => {
  it("writes them in every form that encode writes and as an MNC1 record, in no other", () => {
    for (const format of ["english", "indexes", "unicode", "colors", "colors-unicode"] as const) {
      const backup = EncodedBackup.of(MASKED_INDEXES, format, "seedshift");
      expect(backup.text()).toBe(formatEncoded(ENCODED, format));
      expect(parseRecord(backup.record())).toEqual({
        version: 1,
        mode: "seedshift",
        format,
        payload: formatEncoded(ENCODED, format),
      });
    }
    // A form that no type allows, fed on purpose as a JavaScript host could.
    expect(() => EncodedBackup.of(MASKED_INDEXES, "json" as never, "direct")).toThrow(
      expect.objectContaining({
        code: "core.encoded-form.unsupported-encoded-format",
        message: "Unsupported encoded format.",
      }),
    );
  });

  it("gives the encoded fingerprint from a host that answers later, as a promise", async () => {
    const backup = EncodedBackup.of(MASKED_INDEXES, "indexes", "seedshift");
    const later = vi.fn(async () => ENCODED_FINGERPRINT);
    await expect(backup.fingerprint(later)).resolves.toBe(ENCODED_FINGERPRINT);
    expect(later).toHaveBeenCalledWith(MASKED_WORDS);
  });
});

describe("BackupReading", () => {
  const rules = { seedshiftOnly: false, shareReader: "The Shares tab" };

  it("reads a record header, which names the mode and the form", () => {
    const record = EncodedBackup.of(MASKED_INDEXES, "indexes", "seedshift").record();
    const reading = BackupReading.of(record, rules);
    expect(reading.hasRecord).toBe(true);
    expect(reading.mode()).toBe("seedshift");
    expect(reading.mode("direct")).toBe("seedshift");
    expect(reading.formats()).toEqual(["indexes"]);
    expect(reading.formats("english")).toEqual(["indexes"]);
    expect(reading.codes("indexes").indexes).toEqual(MASKED_INDEXES);
    // What differs from what the host was given is said, and the host offers the record's.
    expect(reading.modeConflict("seedshift")).toBeUndefined();
    expect(reading.modeConflict("seedshift-legacy")).toBe(
      "The record was made with MnemoCode Seedshift, not with the Original Seedshift.",
    );
    expect(reading.formatConflict("colors")).toBe("The record holds indexes codes, not colors.");
    expect(() => BackupReading.of("MNC2:seedshift:indexes:1 2", rules)).toThrow(
      "Unsupported MnemoCode record version. A newer MnemoCode reads it.",
    );
    expect(() => BackupReading.of("MNC1:shifted:indexes:1 2", rules)).toThrow(
      "Malformed MnemoCode record header.",
    );
  });

  it("leaves the mode to the host for codes without a header, and tells the forms that fit", () => {
    const reading = BackupReading.of(MASKED, rules);
    expect(reading.hasRecord).toBe(false);
    expect(reading.mode()).toBeUndefined();
    expect(reading.mode("seedshift-legacy")).toBe("seedshift-legacy");
    expect(reading.modeConflict("seedshift")).toBeUndefined();
    expect(reading.formats()).toEqual(["indexes"]);
    // Codes read as not masked, which the host then gives their mode.
    const codes = reading.codes("indexes");
    expect(codes.mode).toBe("direct");
    expect(() => codes.withMode("seedshift")).not.toThrow();
    const legacy = BackupReading.of(formatEncoded(LEGACY, "indexes"), rules).codes("indexes");
    expect(() => legacy.withMode("seedshift")).toThrow(MissingChecksumError);
    expect(() => BackupReading.of("1 2 3", rules).formats()).toThrow(
      "These are 3 word numbers; an encoded seed phrase has 12, 15, 18, 21 or 24.",
    );
  });

  it("refuses at once what no later answer mends: a share, or a record without Seedshift", () => {
    for (const form of ["ur", "words", "indexes"] as const)
      expect(() => BackupReading.of(writeShare(SHARE, form), rules)).toThrow(
        "This is a Shamir share, not an encoded seed phrase: The Shares tab reads it.",
      );
    const direct = EncodedBackup.of(MASKED_INDEXES, "indexes", "direct").record();
    expect(BackupReading.of(direct, rules).mode()).toBe("direct");
    expect(() => BackupReading.of(direct, { ...rules, seedshiftOnly: true })).toThrow(
      "Date recovery is available only for records created with Seedshift.",
    );
  });
});

describe("Share", () => {
  it("is one share as read from any form, written in any other, and never shown", () => {
    for (const form of Share.FORMATS) {
      const share = Share.read(writeShare(SHARE, form));
      expect(share.ur).toBe(SHARE);
      expect(share.format).toBe(form);
      expect(share.write()).toBe(writeShare(SHARE, form));
      expect(share.write("ur")).toBe(SHARE);
      for (const other of Share.FORMATS) expect(share.write(other)).toBe(writeShare(SHARE, other));
      expect(String(share)).toBe("[Share: redacted]");
      expect(JSON.stringify({ share })).toBe('{"share":"[Share: redacted]"}');
    }
    expect(Share.read(SHARE).info).toMatchObject({ groupThreshold: 1, memberThreshold: 2 });
    expect(Share.reads(SHARE)).toBe(true);
    expect(Share.reads(TEST_PHRASE)).toBe(false);
    expect(() => Share.read("ur:sskr/notashare")).toThrow(
      expect.objectContaining({ code: "sskr.transport.expected-single-part-ur-sskr-record" }),
    );
  });
});
