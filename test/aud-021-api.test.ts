// AUD-021-API001/API002 regression acceptance, unlike the baseline defect-presence harness.
// Public BIP39/MnemoCode vectors and synthetic malformed inputs only.
import { Buffer } from "node:buffer";
import { runInNewContext } from "node:vm";
import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import { BIP39_ENTROPY_BYTES } from "../src/core/bip39-sizes.js";
import {
  decodeCandidateList,
  encodeCandidateList,
  type CandidateList,
} from "../src/core/candidate-list.js";
import { parseDate } from "../src/core/dates.js";
import { EncodedBackup } from "../src/core/encoded-backup.js";
import { NOT_CONFIRMED, ReEncoding } from "../src/core/re-encoding.js";
import type { DecodedResult } from "../src/core/types.js";
import { FINGERPRINT_WARNING } from "../src/core/wallet-check.js";
import { holes } from "./helpers/holes.js";

const vectors = JSON.parse(
  readFileSync(new URL("../vectors/candidates-v1.json", import.meta.url), "utf8"),
) as {
  lists: {
    name: string;
    records: { entropy: string; phrase: string }[];
    bytes: string;
  }[];
};
const PUBLIC_LIST = vectors.lists.find((list) => list.name === "three phrases")!;
const ENTROPY_BYTES = BIP39_ENTROPY_BYTES[0]!;
const PHRASE = PUBLIC_LIST.records[0]!.phrase;
const OTHER_PHRASE = PUBLIC_LIST.records[1]!.phrase;
/** Published MnemoCode vector checksum-valid-seedshift-12, with 23-09-2026. */
const MASKED_WORDS = "wool abuse actual wool abuse actual wool abuse actual wool abuse congress";
/** BIP39 Chinese codes for abandon (U+7684) and about (U+5728), as the CLI writes them. */
const PUBLIC_UNICODE = `${"7684".repeat(11)}5728`;

function maskedBackup(): EncodedBackup {
  return EncodedBackup.read(MASKED_WORDS, "english", "seedshift");
}

/** Mutation attempts use Reflect so that refusal does not interrupt an awaited host callback. */
function refuseResultMutation(result: DecodedResult): void {
  expect(Reflect.set(result, "recoveredMnemonic", OTHER_PHRASE)).toBe(false);
  expect(Reflect.set(result, "checksumValid", false)).toBe(false);
  expect(Reflect.set(result, "recoveredIndexes", [])).toBe(false);
  expect(Reflect.set(result, "dates", [])).toBe(false);
  expect(Reflect.set(result, "shifts", [])).toBe(false);
  expect(Reflect.set(result.recoveredIndexes, 0, 1)).toBe(false);
  expect(Reflect.set(result.recoveredIndexes, "length", 0)).toBe(false);
  expect(Reflect.set(result.shifts, 0, 0)).toBe(false);
  expect(Reflect.set(result.shifts, "length", 0)).toBe(false);
  expect(Reflect.set(result.dates, 0, parseDate("24-09-2026"))).toBe(false);
  expect(Reflect.set(result.dates, "length", 0)).toBe(false);
  for (const part of ["year", "month", "day"])
    expect(Reflect.set(result.dates[0]!, part, 1)).toBe(false);
}

describe("AUD-021-API001: candidate entropy is byte data", () => {
  it("accepts genuine bytes from another realm and ignores a shadowed type tag", () => {
    const entropy = runInNewContext(`new Uint8Array(${ENTROPY_BYTES}).fill(1)`) as Uint8Array;
    expect(entropy instanceof Uint8Array).toBe(false);
    Object.defineProperty(entropy, Symbol.toStringTag, { value: "Uint16Array" });
    const encoded = encodeCandidateList({ records: [{ entropy }] });
    expect(decodeCandidateList(encoded).records[0]!.entropy).toEqual(
      new Uint8Array(ENTROPY_BYTES).fill(1),
    );
  });
  it("uses actual storage length when a genuine byte array shadows byteLength", () => {
    const invalid = new Uint8Array(ENTROPY_BYTES + 1);
    Object.defineProperty(invalid, "byteLength", { value: ENTROPY_BYTES });
    const passphrase = vi.fn(() => "");
    expect(() =>
      encodeCandidateList({
        records: [{ entropy: invalid }],
        get passphrase() {
          return passphrase();
        },
      }),
    ).toThrow(/one length/u);
    expect(passphrase).not.toHaveBeenCalled();
    const valid = Buffer.from(PUBLIC_LIST.records[0]!.entropy, "hex");
    Object.defineProperty(valid, "byteLength", { value: ENTROPY_BYTES + 1 });
    const encoded = encodeCandidateList({ records: [{ entropy: valid }] });
    expect(encoded[6]).toBe(ENTROPY_BYTES);
    expect(decodeCandidateList(encoded).records[0]!.entropy).toEqual(Uint8Array.from(valid));
  });
  it("reads a changing entropy getter once and owns bytes before reading passphrases", () => {
    const source = new Uint8Array(ENTROPY_BYTES).fill(1);
    let reads = 0;
    const record = {
      get entropy(): Uint8Array {
        reads += 1;
        return reads === 1
          ? source
          : (new Uint16Array(ENTROPY_BYTES).fill(256) as unknown as Uint8Array);
      },
      get passphrase(): string {
        source.fill(2);
        return "";
      },
    };
    const encoded = encodeCandidateList({ records: [record] });
    expect(reads).toBe(1);
    expect(decodeCandidateList(encoded).records[0]!.entropy).toEqual(
      new Uint8Array(ENTROPY_BYTES).fill(1),
    );
    expect(source.every((byte) => byte === 2)).toBe(true);
  });
  it.each([
    ["Uint8Array", (entropy: Uint8Array) => Uint8Array.from(entropy)],
    ["Buffer", (entropy: Uint8Array) => Buffer.from(entropy)],
    [
      "subarray",
      (entropy: Uint8Array) => {
        // Sentinel bytes outside the view must never become candidate entropy.
        const backing = new Uint8Array(entropy.length + 2).fill(0xa5);
        backing.set(entropy, 1);
        return backing.subarray(1, entropy.length + 1);
      },
    ],
  ] as const)("keeps the published list bytes with %s entropy", (_, bytesOf) => {
    const records = PUBLIC_LIST.records.map((record) => ({
      entropy: bytesOf(Buffer.from(record.entropy, "hex")),
    }));
    const before = records.map((record) => Uint8Array.from(record.entropy));
    const encoded = encodeCandidateList({ records });
    expect(Buffer.from(encoded).toString("hex")).toBe(PUBLIC_LIST.bytes);
    const decoded = decodeCandidateList(encoded);
    expect(decoded.records.map((record) => record.entropy)).toEqual(before);
    expect(records.map((record) => Uint8Array.from(record.entropy))).toEqual(before);
  });

  it.each(BIP39_ENTROPY_BYTES)("accepts genuine entropy of %i bytes", (length) => {
    const entropy = Uint8Array.from({ length }, (_, index) => index);
    const encoded = encodeCandidateList({ records: [{ entropy }] });
    expect(decodeCandidateList(encoded).records[0]!.entropy).toEqual(entropy);
  });
});

describe("AUD-021-API001: candidate entropy is byte data", () => {
  it.each([ENTROPY_BYTES - 1, Math.max(...BIP39_ENTROPY_BYTES) + 1])(
    "refuses byte entropy of unsupported length %i",
    (length) => {
      expect(() => encodeCandidateList({ records: [{ entropy: new Uint8Array(length) }] })).toThrow(
        /one length/u,
      );
    },
  );

  it.each([
    ["wide elements that would narrow to zero", new Uint16Array(ENTROPY_BYTES).fill(256)],
    ["wide elements already in range", new Uint16Array(ENTROPY_BYTES).fill(1)],
    ["signed bytes", new Int8Array(ENTROPY_BYTES)],
    [
      "wide elements with a byte-array prototype",
      Object.setPrototypeOf(new Uint16Array(ENTROPY_BYTES).fill(256), Uint8Array.prototype),
    ],
    [
      "signed bytes with a byte-array prototype",
      Object.setPrototypeOf(new Int8Array(ENTROPY_BYTES).fill(-1), Uint8Array.prototype),
    ],
    [
      "clamped bytes with a byte-array prototype",
      Object.setPrototypeOf(new Uint8ClampedArray(ENTROPY_BYTES), Uint8Array.prototype),
    ],
    ["ordinary byte array", Array.from({ length: ENTROPY_BYTES }, () => 0)],
    ["negative array elements", Array.from({ length: ENTROPY_BYTES }, () => -1)],
    ["overflowing array elements", Array.from({ length: ENTROPY_BYTES }, () => 256)],
    ["fractional array elements", Array.from({ length: ENTROPY_BYTES }, () => 0.5)],
    ["non-finite array elements", Array.from({ length: ENTROPY_BYTES }, () => NaN)],
    ["text array elements", Array.from({ length: ENTROPY_BYTES }, () => "0")],
    ["sparse entropy", holes(ENTROPY_BYTES)],
    ["null entropy", null],
    ["missing entropy", undefined],
    ["an object imitating bytes", { length: ENTROPY_BYTES, byteLength: ENTROPY_BYTES }],
    [
      "an object with a byte-array prototype",
      Object.create(Uint8Array.prototype, {
        length: { value: ENTROPY_BYTES },
        byteLength: { value: ENTROPY_BYTES },
      }),
    ],
  ] as const)("refuses %s alone and after valid records", (_, entropy: unknown) => {
    const valid = new Uint8Array(ENTROPY_BYTES).fill(1);
    for (const records of [[{ entropy }], [{ entropy: valid }, { entropy }]]) {
      const list = {
        records,
        get passphrase(): string {
          throw new Error("Passphrase construction must follow entropy admission.");
        },
      };
      // A JavaScript caller is not restricted by the CandidateList TypeScript contract.
      expect(() => encodeCandidateList(list as unknown as CandidateList)).toThrow(/one length/u);
    }
    expect([...valid]).toEqual(Array.from({ length: ENTROPY_BYTES }, () => 1));
  });

  it.each([
    ["a record hole", holes(1)],
    ["a null record", [null]],
    ["a missing entropy field", [{}]],
    ["mixed null records", [{ entropy: new Uint8Array(ENTROPY_BYTES) }, null]],
    [
      "mixed byte lengths",
      [
        { entropy: new Uint8Array(ENTROPY_BYTES) },
        { entropy: new Uint8Array(BIP39_ENTROPY_BYTES[1]!) },
      ],
    ],
  ] as const)("refuses %s as a whole", (_, records) => {
    expect(() => encodeCandidateList({ records } as unknown as CandidateList)).toThrow(
      /one length/u,
    );
  });
});

describe("AUD-021-API002: confirmation owns the decoded phrase", () => {
  it("owns a decoded snapshot without freezing or retaining the decoder's mutable fields", () => {
    const dates = [parseDate("23-09-2026")];
    const backup = maskedBackup();
    const decoded = backup.decode(dates);
    const expected = structuredClone(decoded);
    vi.spyOn(backup, "decode").mockReturnValue(decoded);
    const reEncoding = ReEncoding.of(backup, dates);
    expect(reEncoding.result).not.toBe(decoded);
    expect(reEncoding.result.recoveredIndexes).not.toBe(decoded.recoveredIndexes);
    expect(reEncoding.result.shifts).not.toBe(decoded.shifts);
    expect(reEncoding.result.dates).not.toBe(decoded.dates);
    expect(reEncoding.result.dates[0]).not.toBe(decoded.dates[0]);

    expect(Reflect.set(decoded, "recoveredMnemonic", OTHER_PHRASE)).toBe(true);
    expect(Reflect.set(decoded, "checksumValid", false)).toBe(true);
    expect(Reflect.set(decoded.recoveredIndexes, 0, 1)).toBe(true);
    expect(Reflect.set(decoded.shifts, 0, 0)).toBe(true);
    expect(Reflect.set(dates[0]!, "day", 24)).toBe(true);
    expect(reEncoding.result).toEqual(expected);
    reEncoding.confirmByPerson();
    expect(reEncoding.confirmedPhrase()).toBe(PHRASE);
  });

  it("refuses mutations before, inside, during and after an awaited wallet confirmation", async () => {
    const reEncoding = ReEncoding.of(maskedBackup(), [parseDate("23-09-2026")]);
    const expected = structuredClone(reEncoding.result);
    const result = reEncoding.result;
    refuseResultMutation(result);
    expect(() => reEncoding.confirmedPhrase()).toThrow(NOT_CONFIRMED);

    let release!: () => void;
    const waiting = new Promise<void>((resolve) => {
      release = resolve;
    });
    let checkedPhrase: string | undefined;
    const confirming = reEncoding.confirmByWallet(async (phrase) => {
      checkedPhrase = phrase;
      refuseResultMutation(result);
      await waiting;
      refuseResultMutation(result);
      return { matched: phrase === PHRASE, path: "m", warning: FINGERPRINT_WARNING };
    });
    expect(checkedPhrase).toBe(PHRASE);
    refuseResultMutation(reEncoding.result);
    expect(() => reEncoding.confirmedPhrase()).toThrow(NOT_CONFIRMED);
    release();
    expect((await confirming).matched).toBe(true);
    refuseResultMutation(result);
    expect(reEncoding.result).toEqual(expected);
    expect(reEncoding.confirmedPhrase()).toBe(checkedPhrase);
    expect(reEncoding.confirmation).toEqual({
      by: "wallet",
      path: "m",
      warning: FINGERPRINT_WARNING,
    });
    expect(Reflect.set(reEncoding.confirmation!, "by", "person")).toBe(false);
  });

  it("refuses mutations before and after personal confirmation and keeps the encoded output", () => {
    const reEncoding = ReEncoding.of(maskedBackup(), [parseDate("23-09-2026")]);
    const expected = structuredClone(reEncoding.result);
    refuseResultMutation(reEncoding.result);
    reEncoding.confirmByPerson();
    refuseResultMutation(reEncoding.result);
    expect(reEncoding.result).toEqual(expected);
    expect(reEncoding.confirmation).toEqual({ by: "person" });
    expect(Reflect.set(reEncoding.confirmation!, "by", "wallet")).toBe(false);
    expect(reEncoding.confirmedPhrase()).toBe(PHRASE);
    const encoded = EncodedBackup.encode(reEncoding.confirmedPhrase(), [], "unicode", "direct");
    expect(encoded.backup.text()).toBe(PUBLIC_UNICODE);
  });
});

describe("AUD-021-API002: confirmation owns the decoded phrase", () => {
  it("never confirms a different wallet after mutation attempts", async () => {
    const reEncoding = ReEncoding.of(maskedBackup(), [parseDate("23-09-2026")]);
    const match = await reEncoding.confirmByWallet(async (phrase) => {
      refuseResultMutation(reEncoding.result);
      await Promise.resolve();
      refuseResultMutation(reEncoding.result);
      return { matched: phrase === OTHER_PHRASE };
    });
    expect(match.matched).toBe(false);
    expect(reEncoding.confirmation).toBeUndefined();
    expect(() => reEncoding.confirmedPhrase()).toThrow(NOT_CONFIRMED);
    expect(reEncoding.phrase).toBe(PHRASE);
  });

  it("keeps personal confirmation while an awaited wallet check refuses the same phrase", async () => {
    const reEncoding = ReEncoding.of(maskedBackup(), [parseDate("23-09-2026")]);
    let release!: () => void;
    const waiting = new Promise<void>((resolve) => {
      release = resolve;
    });
    const confirming = reEncoding.confirmByWallet(async (phrase) => {
      await waiting;
      refuseResultMutation(reEncoding.result);
      return { matched: phrase === OTHER_PHRASE };
    });
    reEncoding.confirmByPerson();
    refuseResultMutation(reEncoding.result);
    release();
    expect((await confirming).matched).toBe(false);
    expect(reEncoding.confirmation).toEqual({ by: "person" });
    expect(reEncoding.confirmedPhrase()).toBe(PHRASE);
  });

  it("owns the selected last-word candidate with the same immutable views", () => {
    const dates = [parseDate("23-09-2026")];
    const backup = EncodedBackup.encode(PHRASE, dates, "indexes", "seedshift-legacy", {
      validLastWord: true,
    }).backup;
    const reEncoding = ReEncoding.of(backup, dates, "about");
    const expected = structuredClone(reEncoding.result);
    expect(Reflect.set(dates[0]!, "day", 24)).toBe(true);
    refuseResultMutation(reEncoding.result);
    reEncoding.confirmByPerson();
    expect(reEncoding.result).toEqual(expected);
    expect(reEncoding.confirmedPhrase()).toBe(PHRASE);
  });
});
