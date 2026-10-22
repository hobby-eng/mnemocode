import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  printEncodedBackup,
  printMaskedWords,
  printOriginalCopy,
} from "../src/cli/encode-report.js";
import { inForm, printShareBlock, printShares } from "../src/cli/sskr-output.js";
import { STYLE_CODES } from "../src/cli/terminal-style.js";
import { EncodedBackup } from "../src/core/encoded-backup.js";
import { ENCODED_FORMATS } from "../src/core/types.js";
import { SSKR_SET_VECTOR } from "../src/sskr/known-answers.js";
import { SHARE_FORMATS, writeShare } from "../src/sskr/transport.js";
import { streamsAsTerminal } from "./helpers/terminal-streams.js";
import { mnemocodeVectors } from "./helpers/vectors.js";

const vector = mnemocodeVectors().vectors.find(
  (item) => item.name === "checksum-valid-seedshift-12",
)!;
const texts = {
  english: vector.english,
  indexes: vector.indexes,
  unicode: vector.unicode,
  colors: vector.colors,
  "colors-unicode": vector.colorsUnicode,
};
let output: string[];

beforeEach(() => {
  output = [];
  vi.spyOn(console, "log").mockImplementation((line: unknown) => output.push(String(line)));
  vi.spyOn(console, "error").mockImplementation(() => undefined);
});
afterEach(() => vi.restoreAllMocks());

describe("the backup a person must save", () => {
  it.each(ENCODED_FORMATS)("marks the exact %s backup separately from explanations", (form) => {
    streamsAsTerminal();
    vi.stubEnv("NO_COLOR", "1");
    using backup = EncodedBackup.read(texts[form], form, "seedshift");
    printEncodedBackup(backup);
    const shown = output.join("\n");
    expect(shown).toContain("SAVE THIS BACKUP\nCopy the entire block below in this exact order.");
    const block = shown.split("SAVE THIS BACKUP\n")[1]!.split("End of backup.")[0]!;
    expect(block.replace(/\s+/gu, "")).toContain(texts[form].replace(/\s+/gu, ""));
    expect(shown).not.toContain("\x1b");
  });

  it("emphasizes the color codes themselves, rather than relying on color alone", () => {
    streamsAsTerminal();
    vi.stubEnv("NO_COLOR", "");
    vi.stubEnv("CLICOLOR_FORCE", "1");
    using backup = EncodedBackup.read(vector.colors, "colors", "seedshift");
    printEncodedBackup(backup);
    expect(output).toContain(`\x1b[1m${vector.colors}\x1b[0m`);
    expect(output.join("\n").replace(STYLE_CODES, "")).toContain("SAVE THIS BACKUP");
  });

  it.each(["unicode", "colors-unicode"] as const)(
    "keeps the alternate joined %s copy outside the block to transcribe",
    (form) => {
      streamsAsTerminal();
      vi.stubEnv("NO_COLOR", "1");
      using backup = EncodedBackup.read(texts[form], form, "seedshift");
      printEncodedBackup(backup);
      const shown = output.join("\n");
      const block = shown.split("SAVE THIS BACKUP\n")[1]!.split("End of backup.")[0]!;
      expect(block).not.toContain("Joined, for copying:");
      expect(shown.indexOf("Joined, for copying:")).toBeGreaterThan(
        shown.indexOf("End of backup."),
      );
      expect(shown).toContain(texts[form]);
    },
  );

  it.each(SHARE_FORMATS)("marks each %s share as its own block to save", (form) => {
    streamsAsTerminal();
    vi.stubEnv("NO_COLOR", "1");
    printShares(inForm(SSKR_SET_VECTOR.shares, form), undefined, undefined, "backup");
    const blocks = output.join("\n").split("SAVE THIS SHARE\n");
    expect(blocks).toHaveLength(SSKR_SET_VECTOR.shares.length + 1);
    for (const [index, share] of SSKR_SET_VECTOR.shares.entries()) {
      const block = blocks[index + 1]!.split("End of share.")[0]!;
      expect(block).toContain("Copy the entire block below in this exact order.");
      expect(block.replace(/\s+/gu, "")).toContain(writeShare(share, form).replace(/\s+/gu, ""));
    }
  });

  it("keeps optional phrase copies separate from the primary block to save", () => {
    streamsAsTerminal();
    vi.stubEnv("NO_COLOR", "1");
    printOriginalCopy(vector.sourceMnemonic);
    printMaskedWords(vector.english, "seedshift");
    const shown = output.join("\n");
    expect(shown).toContain("Original seed phrase");
    expect(shown).toContain("Seedshift phrase");
    expect(shown).not.toContain("SAVE THIS");
  });

  it.each(SHARE_FORMATS)("does not recommend saving an unconfirmed %s repair variant", (form) => {
    streamsAsTerminal();
    vi.stubEnv("NO_COLOR", "1");
    printShareBlock("Share 1, variant 1 of 2", SSKR_SET_VECTOR.shares[0]!, form);
    printShares(inForm(SSKR_SET_VECTOR.shares, form));
    expect(output.join("\n")).not.toContain("SAVE THIS SHARE");
  });

  it("keeps every redirected share exactly as written without the display block", () => {
    streamsAsTerminal();
    Object.defineProperty(process.stdout, "isTTY", { value: false, configurable: true });
    for (const form of SHARE_FORMATS) {
      output = [];
      printShares(inForm(SSKR_SET_VECTOR.shares, form), undefined, undefined, "backup");
      expect(output).toEqual(SSKR_SET_VECTOR.shares.map((share) => writeShare(share, form)));
    }
  });

  it.each(ENCODED_FORMATS)(
    "keeps redirected %s data free of display instructions and styling",
    (form) => {
      streamsAsTerminal();
      Object.defineProperty(process.stdout, "isTTY", { value: false, configurable: true });
      vi.stubEnv("CLICOLOR_FORCE", "1");
      using backup = EncodedBackup.read(texts[form], form, "seedshift");
      printEncodedBackup(backup);
      expect(output.at(-1)).toBe(texts[form]);
      expect(output.join("\n")).not.toMatch(/SAVE THIS|Copy the entire|End of backup/u);
      expect(output.join("\n")).not.toContain("\x1b");
    },
  );
});
