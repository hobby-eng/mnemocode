import { afterEach, describe, expect, it, vi } from "vitest";
import { EncodedBackupCheck, KeptShares, WrittenCodes } from "../src/core/backup-check.js";
import { parseDate } from "../src/core/dates.js";
import { endLifetimeIfPresent } from "./helpers/owner-lifetime.js";
import {
  DATE,
  MASKED_INDEXES,
  MASKED_WORDS,
  replacedAt,
  TEST_INDEXES,
  TEST_PHRASE,
} from "./helpers/test-phrase.js";
import { publicShare, sskrVectors } from "./helpers/vectors.js";

// Public vectors: BIP39 zero entropy, and the first two shares of bip39-128-2-of-3 in
// sskr-v1.json.
const FIRST_SHARE = publicShare();
const SECOND_SHARE = sskrVectors().deterministic[0]!.shares[1]!;

function maskedCheck(): EncodedBackupCheck {
  return new EncodedBackupCheck({
    mnemonic: TEST_PHRASE,
    format: "english",
    mode: "seedshift",
    codes: MASKED_INDEXES,
    dates: [parseDate(DATE)],
  });
}

afterEach(() => vi.restoreAllMocks());

describe("The lifetime of written codes", () => {
  it("refuses secret reads after disposal without changing an earlier caller view", () => {
    const codes = WrittenCodes.read(TEST_PHRASE, "english", "direct");
    const indexes = codes.indexes;
    try {
      expect(codes.restores(TEST_PHRASE, [])).toBe(true);
      endLifetimeIfPresent(codes, "wipe");
      endLifetimeIfPresent(codes, "dispose");
      expect(() => codes.indexes).toThrow("has been wiped");
      expect(() => codes.restores(TEST_PHRASE, [])).toThrow("has been wiped");
      expect(indexes).toEqual(TEST_INDEXES);
    } finally {
      endLifetimeIfPresent(codes, "dispose");
    }
  });
});

describe("The lifetime of an encoded backup check", () => {
  it("overwrites its retained mnemonic allocation when disposed", () => {
    const encode = new TextEncoder().encode.bind(new TextEncoder());
    const allocations: Uint8Array[] = [];
    vi.spyOn(TextEncoder.prototype, "encode").mockImplementation((text) => {
      const bytes = encode(text);
      if (text === TEST_PHRASE) allocations.push(bytes);
      return bytes;
    });
    const check = maskedCheck();
    try {
      expect(allocations.length).toBeGreaterThan(0);
      expect(allocations.some((bytes) => bytes.some((byte) => byte !== 0))).toBe(true);
      endLifetimeIfPresent(check, "dispose");
      expect(allocations.every((bytes) => bytes.every((byte) => byte === 0))).toBe(true);
    } finally {
      endLifetimeIfPresent(check, "dispose");
    }
  });

  it("snapshots borrowed codes and dates and leaves an independently read child live", () => {
    const indexes = [...MASKED_INDEXES];
    const dates = [{ ...parseDate(DATE) }];
    const check = new EncodedBackupCheck({
      mnemonic: TEST_PHRASE,
      format: "english",
      mode: "seedshift",
      codes: indexes,
      dates,
    });
    const child = check.readCodes(MASKED_WORDS);
    try {
      indexes[0] = 0;
      dates[0]!.day = 24;
      expect(check.checkNow({ backup: MASKED_WORDS, dates: DATE }).verdict).toBe("restores");
      endLifetimeIfPresent(check, "wipe");
      endLifetimeIfPresent(check, "dispose");
      expect(() => check.checkNow({ backup: MASKED_WORDS, dates: DATE })).toThrow("has been wiped");
      expect(() => check.readCodes(MASKED_WORDS)).toThrow("has been wiped");
      expect(child.restores(TEST_PHRASE, [parseDate(DATE)])).toBe(true);
      expect(indexes[0]).toBe(0);
      expect(dates[0]!.day).toBe(24);
    } finally {
      endLifetimeIfPresent(child, "dispose");
      endLifetimeIfPresent(check, "dispose");
    }
  });

  it.each([
    [MASKED_WORDS, DATE, "restores"],
    [replacedAt(MASKED_WORDS, { 3: "wool" }), DATE, "differs"],
    [MASKED_WORDS, "32-09-2026", "unreadable"],
  ] as const)(
    "closes temporary written codes after a %s / %s check returns %s",
    (backup, dates, verdict) => {
      const check = maskedCheck();
      // Observe the real public reader without replacing its implementation or its dependencies.
      const read = vi.spyOn(check, "readCodes");
      try {
        expect(check.checkNow({ backup, dates }).verdict).toBe(verdict);
        const temporary = read.mock.results[0]!;
        expect(temporary.type).toBe("return");
        if (temporary.type === "return") {
          try {
            expect(() => temporary.value.indexes).toThrow("has been wiped");
          } finally {
            endLifetimeIfPresent(temporary.value, "dispose");
          }
        }
      } finally {
        endLifetimeIfPresent(check, "dispose");
      }
    },
  );
});

describe("The lifetime of kept shares", () => {
  it("owns its admitted shares and refuses new secret views after disposal", () => {
    const texts = [FIRST_SHARE, FIRST_SHARE, SECOND_SHARE];
    const kept = KeptShares.of(texts);
    try {
      texts[0] = SECOND_SHARE;
      const earlier = kept.texts;
      expect(earlier).toEqual([FIRST_SHARE, SECOND_SHARE]);
      expect(kept.places).toEqual([1, 3]);
      expect(kept.notes).toEqual(["Share 2 is a copy of share 1: it is used once."]);
      expect(kept.setProblem).toBeUndefined();
      endLifetimeIfPresent(kept, "wipe");
      endLifetimeIfPresent(kept, "dispose");
      expect(() => kept.texts).toThrow("has been wiped");
      expect(() => kept.setProblem).toThrow("has been wiped");
      expect(earlier).toEqual([FIRST_SHARE, SECOND_SHARE]);
      expect(texts).toEqual([SECOND_SHARE, FIRST_SHARE, SECOND_SHARE]);
    } finally {
      endLifetimeIfPresent(kept, "dispose");
    }
  });
});
