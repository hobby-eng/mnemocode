import { afterEach, describe, expect, it, vi } from "vitest";
import { EncodedBackupCheck, KeptShares, WrittenCodes } from "../src/core/backup-check.js";
import { TEST_PHRASE } from "./helpers/test-phrase.js";

// Public vectors: BIP39 zero entropy, checksum-valid-seedshift-12 in mnemocode-v1.json,
// and the first two shares of bip39-128-2-of-3 in sskr-v1.json.
const DIRECT_INDEXES = [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 3];
const MASKED_INDEXES = [2026, 9, 23, 2026, 9, 23, 2026, 9, 23, 2026, 9, 376];
const MASKED_PHRASE = "wool abuse actual wool abuse actual wool abuse actual wool abuse congress";
const DATE_LINE = "23-09-2026";
const FIRST_SHARE = "ur:sskr/goemjzaeadaejoinoyvotkwlptsskispvwbkbwjnamstlubnampf";
const SECOND_SHARE = "ur:sskr/goemjzaeadadflihpkmhspcheycndschfhcmkelyvaveiesolrls";

// Optional only for the pre-fix run: a missing lifetime method must not mask the assertion
// that a disposed owner still publishes its secret. Production cleanup must be unconditional.
function hasLifetime(value: object): value is Disposable & { wipe(): void } {
  return (
    "wipe" in value &&
    typeof value.wipe === "function" &&
    Symbol.dispose in value &&
    typeof value[Symbol.dispose] === "function"
  );
}

function wipeIfPresent(value: object): void {
  if (hasLifetime(value)) value.wipe();
}

function disposeIfPresent(value: object): void {
  if (hasLifetime(value)) value[Symbol.dispose]();
}

function maskedCheck(): EncodedBackupCheck {
  return new EncodedBackupCheck({
    mnemonic: TEST_PHRASE,
    format: "english",
    mode: "seedshift",
    codes: MASKED_INDEXES,
    dates: [{ year: 2026, month: 9, day: 23 }],
  });
}

afterEach(() => vi.restoreAllMocks());

describe("The lifetime of written codes", () => {
  it("refuses secret reads after disposal without changing an earlier caller view", () => {
    const codes = WrittenCodes.read(TEST_PHRASE, "english", "direct");
    const indexes = codes.indexes;
    try {
      expect(codes.restores(TEST_PHRASE, [])).toBe(true);
      wipeIfPresent(codes);
      disposeIfPresent(codes);
      expect(() => codes.indexes).toThrow("has been wiped");
      expect(() => codes.restores(TEST_PHRASE, [])).toThrow("has been wiped");
      expect(indexes).toEqual(DIRECT_INDEXES);
    } finally {
      disposeIfPresent(codes);
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
      disposeIfPresent(check);
      expect(allocations.every((bytes) => bytes.every((byte) => byte === 0))).toBe(true);
    } finally {
      disposeIfPresent(check);
    }
  });

  it("snapshots borrowed codes and dates and leaves an independently read child live", () => {
    const indexes = [...MASKED_INDEXES];
    const dates = [{ year: 2026, month: 9, day: 23 }];
    const check = new EncodedBackupCheck({
      mnemonic: TEST_PHRASE,
      format: "english",
      mode: "seedshift",
      codes: indexes,
      dates,
    });
    const child = check.readCodes(MASKED_PHRASE);
    try {
      indexes[0] = 0;
      dates[0]!.day = 24;
      expect(check.checkNow({ backup: MASKED_PHRASE, dates: DATE_LINE }).verdict).toBe("restores");
      wipeIfPresent(check);
      disposeIfPresent(check);
      expect(() => check.checkNow({ backup: MASKED_PHRASE, dates: DATE_LINE })).toThrow(
        "has been wiped",
      );
      expect(() => check.readCodes(MASKED_PHRASE)).toThrow("has been wiped");
      expect(child.restores(TEST_PHRASE, [{ year: 2026, month: 9, day: 23 }])).toBe(true);
      expect(indexes[0]).toBe(0);
      expect(dates[0]!.day).toBe(24);
    } finally {
      disposeIfPresent(child);
      disposeIfPresent(check);
    }
  });

  it.each([
    [MASKED_PHRASE, DATE_LINE, "restores"],
    [
      "wool abuse wool wool abuse actual wool abuse actual wool abuse congress",
      DATE_LINE,
      "differs",
    ],
    [MASKED_PHRASE, "32-09-2026", "unreadable"],
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
            disposeIfPresent(temporary.value);
          }
        }
      } finally {
        disposeIfPresent(check);
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
      wipeIfPresent(kept);
      disposeIfPresent(kept);
      expect(() => kept.texts).toThrow("has been wiped");
      expect(() => kept.setProblem).toThrow("has been wiped");
      expect(earlier).toEqual([FIRST_SHARE, SECOND_SHARE]);
      expect(texts).toEqual([SECOND_SHARE, FIRST_SHARE, SECOND_SHARE]);
    } finally {
      disposeIfPresent(kept);
    }
  });
});
