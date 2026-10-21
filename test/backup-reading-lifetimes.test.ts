import { afterEach, describe, expect, it, vi } from "vitest";
import { BackupReading } from "../src/core/backup-reading.js";
import { LAST_WORD_FORGOTTEN, TEST_PHRASE } from "./helpers/test-phrase.js";

const RULES = { seedshiftOnly: false, shareReader: "Shares" };

afterEach(() => vi.restoreAllMocks());

describe("The lifetime of a retained backup reading", () => {
  it("refuses payload operations after disposal and leaves independent child codes live", () => {
    const reading = BackupReading.of(`MNC1:direct:english:${TEST_PHRASE}`, RULES);
    using codes = reading.codes("english");
    reading.wipe();
    reading[Symbol.dispose]();
    expect(() => reading.codes("english")).toThrow("has been wiped");
    expect(() => reading.missingCodes("english")).toThrow("has been wiped");
    expect(() => reading.marked).toThrow("has been wiped");
    expect(codes.decode([]).recoveredMnemonic).toBe(TEST_PHRASE);
    expect(reading.hasRecord).toBe(true);
    expect(reading.mode()).toBe("direct");
    expect(reading.formats()).toEqual(["english"]);
  });

  it("does not erase the caller's input or an independent marked-code child", () => {
    const text = LAST_WORD_FORGOTTEN;
    const reading = BackupReading.of(text, RULES);
    const codes = reading.missingCodes("english");
    reading.wipe();
    expect(codes.combinations).toBe(2048);
    expect(codes.missingPlaces).toEqual([12]);
    expect(text).toBe(LAST_WORD_FORGOTTEN);
  });

  it("overwrites the retained payload allocation rather than retaining its record payload", () => {
    const encode = new TextEncoder().encode.bind(new TextEncoder());
    const allocated: Uint8Array[] = [];
    vi.spyOn(TextEncoder.prototype, "encode").mockImplementation((text) => {
      const bytes = encode(text);
      if (text === TEST_PHRASE) allocated.push(bytes);
      return bytes;
    });
    const reading = BackupReading.of(`MNC1:direct:english:${TEST_PHRASE}`, RULES);
    expect(allocated).toHaveLength(1);
    expect(allocated[0]!.some((byte) => byte !== 0)).toBe(true);
    reading.wipe();
    expect(allocated[0]!.every((byte) => byte === 0)).toBe(true);
  });
});
