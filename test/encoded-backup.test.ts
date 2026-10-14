import { inspect } from "node:util";
import { describe, expect, it, vi } from "vitest";
import { pbkdf2 } from "@noble/hashes/pbkdf2.js";
import { sha512 } from "@noble/hashes/sha2.js";
import {
  encodeMnemonic,
  encodeMnemonicLegacy,
  formatEncoded,
  legacyChecksumValidResult,
  parseDate,
} from "../src/core.js";
import {
  ENCODED_MODE_NAMES,
  EncodedBackup,
  MissingChecksumError,
  type EncodedFormat,
} from "../src/core/encoded-backup.js";
import { WalletEvidenceCheck } from "../src/core/wallet-evidence.js";
import { Masking } from "../src/core/masking.js";
import { BITCOIN } from "../src/core/coins/bitcoin-like.js";
import { TEST_PHRASE } from "./helpers/test-phrase.js";

// The host-neutral encoded backup on its own, as another host such as the Deriver uses it: the
// codes of an encoded seed phrase checked before its dates, the encoded fingerprint with the
// host's PBKDF2, and the decoding with complete dates. Public test phrase only.

const DATE = parseDate("23-09-2026");
const MASKED = encodeMnemonic(TEST_PHRASE, [DATE]);
const LEGACY = encodeMnemonicLegacy(TEST_PHRASE, [DATE]);
const LEGACY_VALID = legacyChecksumValidResult(LEGACY);
/**
 * The fingerprint of MASKED's codes read as a phrase, as encode shows it ("Encoded fingerprint").
 */
const ENCODED_FINGERPRINT = "0d05289e";
const FORMATS: readonly EncodedFormat[] = [
  "english",
  "indexes",
  "unicode",
  "colors",
  "colors-unicode",
];

/** The pure JavaScript PBKDF2 that @scure/bip39 uses, as a page passes it. */
const pageCheck = new WalletEvidenceCheck(
  (password, salt, rounds, bytes) => pbkdf2(sha512, password, salt, { c: rounds, dkLen: bytes }),
  [BITCOIN],
);

describe("EncodedBackup", () => {
  it("reads the codes in every format that encode writes", () => {
    for (const format of FORMATS) {
      const backup = EncodedBackup.read(formatEncoded(MASKED, format), format, "seedshift");
      expect(backup.indexes).toEqual(MASKED.shiftedIndexes);
      expect(backup.format).toBe(format);
      expect(backup.mode).toBe("seedshift");
    }
  });

  it("refuses codes that no seed phrase has, naming the count or the place only", () => {
    const indexes = formatEncoded(MASKED, "indexes").split(" ");
    expect(() => EncodedBackup.read(indexes.slice(1).join(" "), "indexes", "direct")).toThrow(
      "These are 11 word numbers; an encoded seed phrase has 12, 15, 18, 21 or 24.",
    );
    const words = MASKED.shiftedEnglish;
    expect(() =>
      EncodedBackup.of(MASKED.shiftedIndexes.slice(1), "english", "seedshift-legacy"),
    ).toThrow("These are 11 words;");
    expect(() => EncodedBackup.of(MASKED.shiftedIndexes.slice(1), "unicode", "direct")).toThrow(
      "These are 11 codes;",
    );
    expect(() =>
      EncodedBackup.of([...MASKED.shiftedIndexes.slice(1), 2048], "indexes", "direct"),
    ).toThrow("Every BIP39 index must be an integer from 0 through 2047.");
    expect(() =>
      EncodedBackup.of(MASKED.shiftedIndexes, "indexes", "shifted" as unknown as "direct"),
    ).toThrow("Unsupported Seedshift mode.");
    // An unknown word is named by its place.
    const typo = [...words.slice(0, 2), "notaword", ...words.slice(3)].join(" ");
    expect(() => EncodedBackup.read(typo, "english", "direct")).toThrow(
      "Unknown English BIP39 word at position 3.",
    );
  });

  it("refuses codes without the checksum that their mode keeps, and takes them as the original's", () => {
    const legacy = LEGACY.shiftedIndexes;
    for (const mode of ["seedshift", "seedshift-legacy-valid"] as const) {
      let refused: unknown;
      try {
        EncodedBackup.of(legacy, "indexes", mode);
      } catch (error) {
        refused = error;
      }
      expect(refused).toBeInstanceOf(MissingChecksumError);
      expect((refused as MissingChecksumError).mode).toBe(mode);
      expect((refused as MissingChecksumError).message).toBe(
        `These codes lack the BIP39 checksum that ${ENCODED_MODE_NAMES[mode]} gives them.`,
      );
    }
    const codes = EncodedBackup.of(legacy, "indexes", "direct");
    expect(() => codes.withMode("seedshift")).toThrow(MissingChecksumError);
    const original = codes.withMode("seedshift-legacy");
    expect(original.mode).toBe("seedshift-legacy");
    // withMode gives another backup; the first keeps its mode.
    expect(codes.mode).toBe("direct");
    expect(Masking.of("seedshift").keepsChecksum).toBe(true);
    expect(Masking.of("seedshift-legacy-valid").keepsChecksum).toBe(true);
    expect(Masking.of("seedshift-legacy").keepsChecksum).toBe(false);
    expect(Masking.of("direct").keepsChecksum).toBe(false);
  });

  it("gives the encoded fingerprint with the host's function when the codes are a valid phrase", () => {
    const backup = EncodedBackup.of(MASKED.shiftedIndexes, "indexes", "seedshift");
    const fingerprintOf = vi.fn((mnemonic: string) => pageCheck.fingerprint(mnemonic));
    expect(backup.fingerprint(fingerprintOf)).toBe(ENCODED_FINGERPRINT);
    expect(fingerprintOf).toHaveBeenCalledWith(MASKED.shiftedEnglish.join(" "));
    // The Original Seedshift's codes usually lack the checksum: no fingerprint, no derivation.
    const unseen = vi.fn(() => "never");
    expect(
      EncodedBackup.of(LEGACY.shiftedIndexes, "indexes", "seedshift-legacy").fingerprint(unseen),
    ).toBeUndefined();
    expect(unseen).not.toHaveBeenCalled();
  });
});

describe("EncodedBackup", () => {
  it("decodes with complete dates in every mode, and gives the candidates of a valid last word", () => {
    const decoded = (indexes: readonly number[], mode: "seedshift" | "seedshift-legacy") =>
      EncodedBackup.of(indexes, "indexes", mode).decode([DATE]);
    expect(decoded(MASKED.shiftedIndexes, "seedshift")).toMatchObject({
      recoveredMnemonic: TEST_PHRASE,
      checksumValid: true,
    });
    expect(decoded(LEGACY.shiftedIndexes, "seedshift-legacy").recoveredMnemonic).toBe(TEST_PHRASE);
    // A wrong date gives the Original Seedshift's phrase an invalid checksum.
    expect(
      EncodedBackup.of(LEGACY.shiftedIndexes, "indexes", "seedshift-legacy").decode([
        parseDate("24-09-2026"),
      ]).checksumValid,
    ).toBe(false);
    // Without Seedshift the codes are the words themselves.
    const direct = EncodedBackup.of(MASKED.shiftedIndexes, "indexes", "direct");
    expect(direct.givesSeveral).toBe(false);
    expect(direct.decode([])).toEqual({
      recoveredMnemonic: MASKED.shiftedEnglish.join(" "),
      recoveredIndexes: MASKED.shiftedIndexes,
      dates: [],
      shifts: MASKED.shiftedIndexes.map(() => 0),
      checksumValid: true,
    });
    expect(direct.candidates([])).toEqual([direct.decode([])]);

    const valid = EncodedBackup.of(
      LEGACY_VALID.shiftedIndexes,
      "indexes",
      "seedshift-legacy-valid",
    );
    expect(valid.givesSeveral).toBe(true);
    expect(() => valid.decode([DATE])).toThrow("gives several phrases");
    const candidates = valid.candidates([DATE]);
    // Every last word whose checksum fits: 2^(11 - 4) for 12 words.
    expect(candidates).toHaveLength(128);
    expect(candidates.map((candidate) => candidate.recoveredMnemonic)).toContain(TEST_PHRASE);
  });

  it("tells why codes that fit no format cannot be read, by the format they most likely are", () => {
    expect(EncodedBackup.whyUnreadable("1 2 3")).toBe(
      "These are 3 word numbers; an encoded seed phrase has 12, 15, 18, 21 or 24.",
    );
    expect(EncodedBackup.whyUnreadable("1 2 3 4 5 6 7 8 9 10 11 2049")).toBe(
      "Indexes use Seedshift-compatible numbering from 1 through 2048.",
    );
    expect(EncodedBackup.whyUnreadable("abandon abandon")).toBe(
      "Enter 12, 15, 18, 21 or 24 English BIP39 words.",
    );
  });

  it("guesses the form of unreadable codes by the separators that their readers take", () => {
    // Final review CC-02: word numbers or Unicode codes apart by ; or , are not taken for words.
    // A # is taken for colors first, the most telling sign (EncodedForm.likely).
    const numbers = Array.from({ length: 13 }, (_, index) => index + 1);
    for (const separator of [";", ","])
      expect(EncodedBackup.whyUnreadable(numbers.join(separator)), separator).toBe(
        "These are 13 word numbers; an encoded seed phrase has 12, 15, 18, 21 or 24.",
      );
    const codes = formatEncoded(MASKED, "unicode").match(/.{4}/gu)!;
    expect(EncodedBackup.whyUnreadable(codes.slice(1).join(";"))).toMatch(/^These are 11 codes;/u);
  });

  it("refuses a # out of place among colors, as it did before the shared tokenizer", () => {
    // Final review CC-08: each # starts the six digits of one color, or no color has one.
    const colors = formatEncoded(MASKED, "colors").split(" ");
    const digits = colors.map((color) => color.slice(1)).join("");
    for (const written of [colors.join(" "), colors.join(""), colors.join(", "), digits])
      expect(EncodedBackup.read(written, "colors", "seedshift").indexes).toEqual(
        MASKED.shiftedIndexes,
      );
    for (const written of [
      `#${digits.slice(0, 8)} #${digits.slice(8)}`,
      `${digits.slice(0, 6)}#${digits.slice(6)}`,
      `${colors[0]} ${digits.slice(6)}`,
    ])
      expect(() => EncodedBackup.read(written, "colors", "seedshift"), written).toThrow(
        "Colors must use #RRGGBB codes, separated or concatenated.",
      );
  });

  it("never changes, and keeps its codes out of text, JSON and a printed object", () => {
    const backup = EncodedBackup.of(MASKED.shiftedIndexes, "indexes", "direct");
    expect(Object.isFrozen(backup.indexes)).toBe(true);
    expect(String(backup)).toBe("[EncodedBackup: redacted]");
    expect(JSON.stringify({ backup })).toBe('{"backup":"[EncodedBackup: redacted]"}');
    expect(inspect(backup)).toBe("[EncodedBackup: redacted]");
  });
});
