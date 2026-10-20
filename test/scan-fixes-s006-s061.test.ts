// The findings S006 to S061 of the DRY/OOP scan of 2026-10-09 (test/scan-fixes.test.ts), each with
// a case that would fail without its fix. Public test data only: the BIP39 test phrase and the
// public SSKR vectors.

import { CardPreview as CardPreviewClass } from "../src/export/card-preview.js";
import { MissingChecksumError as EncodedBackupMissingChecksum } from "../src/core/encoded-backup.js";
import { readFileSync, readdirSync } from "node:fs";
import { STYLE_CODES } from "../src/cli/terminal-style.js";
import { describe, expect, it, vi } from "vitest";
import { choiceOption } from "../src/cli/arguments.js";
import { EncodedBackup } from "../src/core/encoded-backup.js";
import { Masking, MissingChecksumError } from "../src/core/masking.js";
import { wordTableRow, wordTableText, wordIndexOf, unicodeIndexesOf } from "../src/core/words.js";
import { runTable } from "../src/cli/table-command.js";
import {
  wordNumberOf,
  isBip39WordCount,
  WORD_COUNTS_TEXT,
  WORD_COUNTS_LESS_ONE_TEXT,
  assertPhraseIndexes,
  WORD_NUMBERS,
  WORD_NUMBERS_THROUGH,
} from "../src/core/bip39-sizes.js";
import {
  shareWordIndex,
  isColorShareFormat,
  Share,
  SHARE_FORMATS,
  parseShareFormat,
  writeShare,
} from "../src/sskr/transport.js";
import {
  jointMarkLimitProblem,
  MAX_JOINT_MARKED_ELEMENTS,
  planJointRepair,
} from "../src/sskr/joint-repair.js";
import {
  exceedsMarks,
  MAX_MARKED_ELEMENTS,
  repairCandidates,
  MarkedReading,
} from "../src/sskr/repair.js";
import { checkOutputName } from "../src/cli/output-saving.js";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { cardKindOf, writtenInColors, shareFormatOf } from "../src/core/backup-options.js";
import { CARD_FORMAT_NUMBERS, COLOR_FORMAT_NUMBERS } from "../src/cli/format-numbers.js";
import { ENCODED_FORMATS, isEncodedFormat, isMaskingMode } from "../src/core/types.js";
import { walletReason, DatesAnswer } from "../src/core/date-search.js";
import { ShareUnmasking } from "../src/sskr/share-unmasking.js";
import { Redacted } from "../src/core/redacted.js";
import { inspect } from "node:util";
import {
  nextFinding,
  type PartChecks,
  type BackupPart,
  KeptShares,
} from "../src/core/backup-check.js";
import { ShareInput } from "../src/sskr/share-input.js";
import { withoutCopies } from "../src/sskr/set-topology.js";
import { decodeIndexes, parseDate, encodeMnemonic } from "../src/core.js";
import { listInWords } from "../src/core/places.js";
import { parseSskrLayout } from "../src/export/sskr-content.js";
import { parseImageFormat } from "../src/export/image-export.js";
import { parsePageSize } from "../src/export/card-settings.js";
import { indexesOfWords } from "../src/core/english-words.js";
import {
  markedColorSymbols,
  colorSymbolsOf,
  isColorUnicodeSymbol,
  isRgbReference,
  rgbReferenceDigits,
} from "../src/core/colors.js";
import { hexCodePoint } from "../src/core/code-text.js";
import { parseRecord } from "../src/record.js";
import { invalidAddress, DAMAGED, AddressRefusalError } from "../src/core/coins/coin.js";
import { InputTooLargeError } from "../src/core/byte-units.js";
import { RESTORED_FORM } from "../src/sskr/share-set.js";
import { EncodedForm } from "../src/core/encoded-form.js";
import { SearchPlan, TELL_SECONDS } from "../src/core/search-plan.js";
import { allowedBy } from "../src/cli/search-consent.js";
import {
  DATE_FORMAT_TEXT,
  formatDate,
  parseDatePattern,
  sameKeyPredecessors,
} from "../src/core/dates.js";
import {
  assertSearchable,
  unknownPlacesOf,
  MAX_SEARCH_COMBINATIONS,
} from "../src/core/candidates.js";
import { keptCount } from "../src/core/search-turns.js";
import { rangeText, integerRefusal, typedWholeNumber } from "../src/core/typed-number.js";
import { bytesOfHex, hexOfBytes } from "../src/core/bits.js";
import { COINS, coinById } from "../src/core/coins.js";
import { BITCOIN } from "../src/core/coins/bitcoin-like.js";
import { bech32 } from "@scure/base";
import {
  withoutByteOrderMark,
  asciiLowercase,
  asciiUppercase,
  trimWhiteSpace,
} from "../src/core/white-space.js";
import { nodeSharePlatform } from "../src/sskr/share-platform-node.js";
import { nodeCardRenderer } from "../src/export/platform-node.js";
import { streamsAsTerminal } from "./helpers/terminal-streams.js";

describe("S006: the facts of a kind of wallet evidence follow from its level", () => {
  it("tells which kinds are scanned and which are placed", async () => {
    const { isPlacedKind, isScannedKind } = await import("../src/core/wallet-evidence.js");
    const kinds = [
      "master-fingerprint",
      "master-xpub",
      "account-xpub",
      "address",
      "compressed-public-key",
      "wif",
      "coin-address",
    ];
    expect(kinds.filter(isScannedKind)).toEqual([
      "address",
      "compressed-public-key",
      "wif",
      "coin-address",
    ]);
    expect(kinds.filter(isPlacedKind)).toEqual(kinds.slice(2));
    expect(isScannedKind("unknown")).toBe(false);
    expect(isPlacedKind("unknown")).toBe(false);
  });
});

describe("S009: one look-up in the word table", () => {
  it("finds a row by a word in any case, a number with zeros, or a code", () => {
    expect(wordTableRow("word", " Abandon ").index).toBe(1);
    expect(wordTableRow("index", "0002").english).toBe("ability");
    expect(wordTableRow("unicode", "7684").english).toBe("abandon");
    expect(() => wordTableRow("word", "abandon ability")).toThrow("not in the English BIP39 list");
    expect(() => wordTableRow("index", "2049")).toThrow("whole number from 1 through 2048");
    expect(() => wordTableRow("unicode", "0000")).toThrow("No BIP39 word has that code");
  });

  it("the command line takes a word in capitals as the menu does", async () => {
    const lines: string[] = [];
    const log = vi.spyOn(console, "log").mockImplementation((line: string) => lines.push(line));
    try {
      await runTable({ word: "Abandon" });
    } finally {
      log.mockRestore();
    }
    expect(lines).toContain("unicode hex: 7684");
  });

  it("with colour, a lookup's facts are grey labels under the result's heading", async () => {
    vi.stubEnv("CLICOLOR_FORCE", "1");
    streamsAsTerminal();
    vi.stubEnv("NO_COLOR", "");
    const lines: string[] = [];
    const log = vi.spyOn(console, "log").mockImplementation((line: string) => lines.push(line));
    try {
      await runTable({ word: "abandon" });
    } finally {
      log.mockRestore();
      vi.unstubAllEnvs();
    }
    const plain = lines.map((line) => line.replace(STYLE_CODES, ""));
    expect(plain).toContain("  Unicode hex 7684");
    expect(plain).not.toContain("unicode hex: 7684");
  });

  it("writes the whole table with its header", () => {
    const lines = wordTableText().split("\n");
    expect(lines[0]).toBe("index\tenglish\tunicode_hex");
    expect(lines[1]).toBe("1\tabandon\t7684");
    expect(lines).toHaveLength(2048 + 2);
  });
});

describe("S011: one reader of word numbers and Unicode codes", () => {
  it("reads a word number of a phrase and of a share by one rule, a share's in four digits", () => {
    expect(wordIndexOf("0007")).toBe(6);
    expect(wordIndexOf("2049")).toBeUndefined();
    expect(shareWordIndex("2048")).toBe(2047);
    expect(shareWordIndex("00012")).toBeUndefined();
    expect(wordNumberOf(0)).toBe(1);
  });

  it("reads Unicode codes of a phrase and of a share with one message", () => {
    expect(unicodeIndexesOf("7684 7684")).toEqual([0, 0]);
    expect(() => unicodeIndexesOf("768")).toThrow("four hexadecimal digits each");
    expect(() => unicodeIndexesOf("7684 0000")).toThrow("Unicode code 2 is not a BIP39 word.");
  });
});

describe("S012: one bound of the marks of a share", () => {
  it("refuses too many marks with the same words early and in the joint repair", async () => {
    const text = Array.from({ length: MAX_JOINT_MARKED_ELEMENTS + 1 }, () => "?").join(" ");
    const early = jointMarkLimitProblem(2, text);
    expect(early).toBe(
      `Share 2: mark at most ${MAX_JOINT_MARKED_ELEMENTS} unreadable elements with ?.`,
    );
    await expect(
      planJointRepair(["ur:sskr/x", text], { platform: nodeSharePlatform }),
    ).rejects.toThrow(early!);
    expect(jointMarkLimitProblem(2, text.split(" ").slice(1).join(" "))).toBeUndefined();
  });

  it("bounds one share's repair by its own number", () => {
    const text = Array.from({ length: MAX_MARKED_ELEMENTS + 1 }, () => "?").join(" ");
    expect(exceedsMarks(text, MAX_MARKED_ELEMENTS)).toBe(true);
    expect(() => repairCandidates(text)).toThrow(
      `Mark at most ${MAX_MARKED_ELEMENTS} unreadable elements with ?, each at its place.`,
    );
  });
});

describe("S014: one check of another output name", () => {
  it("checks a folder by its own kind and against the folder just saved", async () => {
    const root = await mkdtemp(join(tmpdir(), "mnemocode-s014-"));
    try {
      const cards = join(root, "cards");
      await mkdir(cards);
      const args = { "cards-dir": cards, "images-dir": join(root, "images") };
      await expect(checkOutputName(args, "images-dir", cards)).rejects.toThrow(
        "The image folder already exists.",
      );
      await expect(checkOutputName(args, "pdf", join(cards, "shares.pdf"))).rejects.toThrow(
        "separate, non-overlapping paths",
      );
      await expect(checkOutputName(args, "cards-dir", " ")).rejects.toThrow(
        "The folder for individual card files needs a path",
      );
      await expect(checkOutputName(args, "pdf", join(root, "shares.pdf"))).resolves.toBeUndefined();
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});

describe("S016: which forms print on cards, in one place", () => {
  it("says every form's card kind and derives the numbers from it", () => {
    expect(ENCODED_FORMATS.map((format) => cardKindOf(format))).toEqual([
      undefined,
      undefined,
      // Unicode codes have cards, whose colors decorate them (owner, 2026-10-13).
      "colors",
      "colors",
      "colors",
    ]);
    expect(ENCODED_FORMATS.filter(writtenInColors)).toEqual(["colors-unicode", "colors"]);
    expect(COLOR_FORMAT_NUMBERS).toBe("4 and 5");
    expect(CARD_FORMAT_NUMBERS).toBe("3, 4 or 5");
    expect(isColorShareFormat("colors-unicode")).toBe(true);
    expect(isColorShareFormat("unicode")).toBe(false);
  });
});

describe("S018: one guard of a mode with dates", () => {
  it("refuses a mode without dates and a value that names none, with one message", () => {
    expect(() => Masking.assertMaskedMode("seedshift-legacy")).not.toThrow();
    expect(() => Masking.assertMaskedMode("direct")).toThrow("Unsupported Seedshift mode.");
    expect(() => Masking.assertMaskedMode("toString")).toThrow("Unsupported Seedshift mode.");
  });
});

describe("S021: one reason why the wallet is asked for", () => {
  it("says every date gives a phrase only where the mode keeps the checksum", () => {
    expect(walletReason("seedshift")).toBe(
      "Each guessed date gives a valid phrase; the wallet tells which is yours.",
    );
    expect(walletReason("seedshift-legacy")).toMatch(/^Several guessed dates may give/u);
    expect(walletReason(undefined)).toBe(walletReason("seedshift-legacy"));
  });

  it("a share unmasking needs the wallet only for a search", () => {
    const searched = DatesAnswer.parse("1?-07-1963", { wordCount: 12, patterns: true });
    const known = DatesAnswer.parse("10-07-1963", { wordCount: 12, patterns: false });
    expect(new ShareUnmasking({ mode: "seedshift", dates: searched }).needsWallet).toBe(true);
    expect(new ShareUnmasking({ mode: "seedshift", dates: known }).needsWallet).toBe(false);
    expect(new ShareUnmasking({ mode: "direct" }).needsWallet).toBe(false);
  });
});

describe("S022: every class that holds a secret shows only its kind", () => {
  it("is listed here whenever it extends Redacted, so that none is left untested", () => {
    // The labels that the classes pass to Redacted, found in the source.
    const labels = readdirSync("src", { recursive: true, encoding: "utf8" })
      .filter((file) => file.endsWith(".ts"))
      .flatMap((file) => {
        const source = readFileSync(join("src", file), "utf8");
        if (!/\bextends Redacted\b/u.test(source)) return [];
        return [...source.matchAll(/super\("([A-Za-z]+)"\)/gu)].map((match) => match[1]!);
      })
      .sort();
    expect(labels).toEqual(
      [
        "BackupReading",
        "CandidateListWriter",
        "CardValues",
        "DateSearch",
        "DatesAnswer",
        "EncodeCardExport",
        "EncodedBackup",
        "InputBytes",
        "KeptShares",
        "MarkedReading",
        "MissingCodes",
        "OpenedCandidateList",
        "PageRecord",
        "PassphraseProtection",
        "PlannedCards",
        "PreparedWalletEvidence",
        "ReEncoding",
        "ReadingSpace",
        "RestoredShares",
        "SecretValue",
        "Share",
        "ShareCardSet",
        "ShareExport",
        "ShareSet",
        "ShareUnmasking",
        "ShareValues",
        "WordCandidate",
        "WordCandidateSearch",
        "WrittenCodes",
      ].sort(),
    );
  });

  it("gives the label through String, JSON and inspect, and nothing of its fields", () => {
    class Holder extends Redacted {
      readonly #secret = "abandon ability";
      constructor() {
        super("Holder");
      }
      get secret(): string {
        return this.#secret;
      }
    }
    const value = new Holder();
    expect(String(value)).toBe("[Holder: redacted]");
    expect(JSON.stringify({ value })).toBe('{"value":"[Holder: redacted]"}');
    expect(inspect(value, { showHidden: true, getters: true })).toBe("[Holder: redacted]");
  });
});

describe("S024: one order of the steps of a backup check", () => {
  /** Steps that record which comparison ran, each giving `found` for one part. */
  function steps(dated: boolean, found: Partial<Record<"compare" | "dates" | "restored", true>>) {
    const ran: string[] = [];
    const finding = (part: BackupPart) =>
      ({ part, kind: "places", places: [], message: part }) as const;
    const checks: PartChecks<string> = {
      dated,
      wordCount: 12,
      readDates: () => [],
      compare: () => (ran.push("compare"), found.compare ? finding("codes") : undefined),
      compareDates: () => (ran.push("dates"), found.dates ? finding("dates") : undefined),
      compareRestored: () => (ran.push("restored"), found.restored ? finding("codes") : undefined),
    };
    return { checks, ran };
  }

  it("asks for the dates only where the backup is dated and what was written fits", () => {
    const undated = steps(false, {});
    expect(nextFinding(undated.checks, "w")).toBeUndefined();
    expect(undated.ran).toEqual(["compare", "restored"]);
    const dated = steps(true, {});
    expect(nextFinding(dated.checks, "w")).toBe("dates");
    expect(nextFinding(dated.checks, "w", [])).toBeUndefined();
    expect(dated.ran).toEqual(["compare", "compare", "dates", "restored"]);
    const wrong = steps(true, { compare: true });
    expect(nextFinding(wrong.checks, "w")).toMatchObject({ part: "codes" });
    const wrongDates = steps(true, { dates: true });
    expect(nextFinding(wrongDates.checks, "w", [])).toMatchObject({ part: "dates" });
    expect(wrongDates.ran).toEqual(["compare", "dates"]);
  });
});

describe("S025: the share check names set problems as the restore does", () => {
  it("refuses a share of another set with ShareInput's words", async () => {
    // Published fixed sets have distinct protocol identifiers; no random collision precondition.
    const { sskrVector, sskrSetVector } = await import("../src/sskr/known-answers.js");
    const [first, second] = [sskrVector.shares, sskrSetVector.shares];
    expect(Share.read(first[0]!).info.identifier).not.toBe(Share.read(second[0]!).info.identifier);
    const texts = [first[0]!, second[1]!];
    const kept = KeptShares.of(texts);
    expect(kept.setProblem).toBe(
      ShareInput.completeSetProblem(texts.map((ur, index) => ({ place: index + 1, ur }))),
    );
    expect(kept.setProblem).toMatch(/different sets/u);
    expect(
      withoutCopies([
        { place: 1, ur: "a" },
        { place: 2, ur: "a" },
        { place: 3, ur: "b" },
      ]),
    ).toEqual([
      { place: 1, ur: "a" },
      { place: 3, ur: "b" },
    ]);
  });
});

describe("S026: one refusal of codes without the checksum their mode keeps", () => {
  it("is Masking's, through the low-level decoders and EncodedBackup alike", () => {
    const codes = Array.from({ length: 12 }, () => 0);
    const message = "These codes lack the BIP39 checksum that MnemoCode Seedshift gives them.";
    expect(() => decodeIndexes(codes, [parseDate("01-01-2000")])).toThrow(message);
    expect(() => EncodedBackup.of(codes, "indexes", "seedshift")).toThrow(MissingChecksumError);
    expect(EncodedBackupMissingChecksum).toBe(MissingChecksumError);
    expect(() => Masking.of("seedshift-legacy").assertCodes(codes)).not.toThrow();
  });
});

describe("S029: the BIP39 lengths from one list", () => {
  it("checks, names and derives them from BIP39_WORD_COUNTS", () => {
    expect([11, 12, 24, 25].map(isBip39WordCount)).toEqual([false, true, true, false]);
    expect(WORD_COUNTS_TEXT).toBe("12, 15, 18, 21 or 24");
    expect(WORD_COUNTS_LESS_ONE_TEXT).toBe("11, 14, 17, 20 or 23");
    expect(listInWords([1, 2, 3])).toBe("1, 2 and 3");
    expect(() => new CardPreviewClass(nodeCardRenderer, { words: 13 })).toThrow(
      "The preview mnemonic must contain 12, 15, 18, 21 or 24 words.",
    );
  });
});

describe("S030: each list of values has one source", () => {
  it("reads layouts, image formats and option choices by their lists", () => {
    expect(parseSskrLayout("qr")).toBe("qr");
    expect(() => parseSskrLayout("grid")).toThrow(
      "The card layout must be one of: qr, collection, individual.",
    );
    expect(parseImageFormat("jpeg")).toBe("jpg");
    expect(parseImageFormat(undefined)).toBe("png");
    expect(() => parseImageFormat("gif")).toThrow("one of: png, jpg; jpeg is accepted");
    expect(() => parsePageSize("letter")).toThrow("Page size must be a6, a5, a4 or business.");
    expect(choiceOption({ "input-kind": "share" }, "input-kind", ["codes", "share"])).toBe("share");
    expect(() => choiceOption({ "backup-check": "maybe" }, "backup-check", ["yes", "no"])).toThrow(
      "--backup-check must be yes or no.",
    );
  });
});

describe("S031: one check and one conversion of a phrase's indexes", () => {
  it("checks the count before the indexes, and refuses a word that is not in the list", () => {
    expect(() => assertPhraseIndexes([2048])).toThrow(
      "Expected 12, 15, 18, 21 or 24 word indexes.",
    );
    expect(() => assertPhraseIndexes([2048, ...Array.from({ length: 11 }, () => 0)])).toThrow(
      "Every BIP39 index must be an integer from 0 through 2047.",
    );
    expect(indexesOfWords(["abandon", "ability"])).toEqual([0, 1]);
    expect(() => indexesOfWords(["abandon", "bitcoin"])).toThrow("not in the English BIP39 list");
  });
});

describe("S032: one range of the Color Unicode characters", () => {
  it("takes U+E000 to U+F8FF everywhere, and nothing past it", () => {
    expect(markedColorSymbols("\u{E000}\u{F8FF}")).toEqual(["E000", "F8FF"]);
    expect(colorSymbolsOf("\u{E000} ?\u{F8FF}")).toEqual(["\u{E000}", "?", "\u{F8FF}"]);
    expect(colorSymbolsOf("E000 F8FF")).toBeUndefined();
    expect(markedColorSymbols("\u{F900}")).toBeUndefined();
    expect(isColorUnicodeSymbol("\u{F0000}")).toBe(false);
    // A supplementary Private Use character is no colour code, so the reason is not about colors.
    expect(EncodedBackup.whyUnreadable("\u{F0000}")).not.toMatch(/color/iu);
  });
});

describe("S033: one check of a color and of a code point's digits", () => {
  it("takes a color in any case, with or without #, as every card export does", () => {
    for (const color of ["#A3F09C", "#a3f09c", "a3f09c"]) {
      expect(isRgbReference(color)).toBe(true);
      expect(rgbReferenceDigits(color)).toBe("A3F09C");
    }
    expect(isRgbReference("#A3F09")).toBe(false);
    expect(() => rgbReferenceDigits("#GGGGGG")).toThrow("Invalid RGB reference.");
    expect(hexCodePoint(0x7684)).toBe("7684");
    expect(hexCodePoint(0xe0)).toBe("00E0");
  });
});

describe("S035: refusals told apart by their kind, not their words", () => {
  it("names forms and modes by one guard each", () => {
    expect(isEncodedFormat("colors")).toBe(true);
    expect(isEncodedFormat("json")).toBe(false);
    expect(isMaskingMode("seedshift-legacy-valid")).toBe(true);
    expect(isMaskingMode("toString")).toBe(false);
  });

  it("says that a newer MnemoCode reads a record of a newer version", () => {
    expect(() => parseRecord("MNC2:direct:english:abandon")).toThrow(
      "Unsupported MnemoCode record version: 2. A newer MnemoCode reads it.",
    );
  });

  it("gives an address refusal its reason, and too large input its own class", () => {
    const refusal = invalidAddress(DAMAGED);
    expect(refusal).toBeInstanceOf(AddressRefusalError);
    expect(refusal.reason).toBe(DAMAGED);
    expect(refusal.message).toBe(
      "The address cannot be used for the check: its checksum or format is wrong.",
    );
    expect(new InputTooLargeError("Text input", 1024 * 1024).message).toBe(
      "Text input exceeds the 1 MiB safety limit.",
    );
  });
});

describe("S037: one list of share forms and one pairing with the forms of a phrase", () => {
  it("pairs every form of a phrase with the share form that looks like it, both ways", () => {
    for (const form of ENCODED_FORMATS) {
      const shareForm = shareFormatOf(form);
      expect(RESTORED_FORM[shareForm]).toBe(form);
    }
    expect(shareFormatOf("english")).toBe("words");
    expect(RESTORED_FORM.ur).toBe("english");
    expect(Share.FORMATS).toBe(SHARE_FORMATS);
    expect(() => parseShareFormat("english")).toThrow(
      "The share format must be one of: ur, words, indexes, unicode, colors, colors-unicode.",
    );
  });
});

describe("S036: each form of codes knows its own facts", () => {
  it("reads back what it writes, and is guessed from its characters", () => {
    const result = encodeMnemonic("abandon ".repeat(11) + "about", [parseDate("01-01-2000")]);
    for (const format of ENCODED_FORMATS) {
      const form = EncodedForm.of(format);
      expect(form.read(form.write(result))).toEqual(result.shiftedIndexes);
      // Colors as text are written in hexadecimal digits, which look like Unicode codes; only the
      // symbols themselves tell them.
      if (format !== "colors-unicode") expect(EncodedForm.likely(form.write(result))).toBe(format);
    }
    expect(EncodedForm.likely("\u{E000}\u{E001}")).toBe("colors-unicode");
    expect(EncodedForm.of("indexes").unit).toBe("word numbers");
    expect(EncodedForm.of("unicode").cardKind).toBe("colors");
    expect(EncodedForm.of("unicode").writtenInColors).toBe(false);
    expect(EncodedForm.of("indexes").cardKind).toBeUndefined();
    expect(EncodedForm.of("english").alwaysMasked).toBe(true);
    expect(() => EncodedForm.of("json" as never)).toThrow(
      expect.objectContaining({ code: "core.encoded-form.unsupported-encoded-format" }),
    );
  });
});

describe("S040: a reading owns the layout of its unknown bits", () => {
  it("names the one hole that a unit's bits change, and changes only that value", () => {
    const vectors = JSON.parse(readFileSync("vectors/sskr-v1.json", "utf8")) as {
      deterministic: { shares: string[] }[];
    };
    const numbers = writeShare(vectors.deterministic[0]!.shares[0]!, "indexes").split(" ");
    numbers[2] = "?";
    numbers[7] = "?";
    const reading = MarkedReading.of(numbers.join(" ")).find(
      (candidate) => candidate.format === "indexes",
    )!;
    const space = reading.space()!;
    expect(space.holes).toEqual([2, 7]);
    for (const [order, place] of space.holes.entries()) {
      expect(space.holesChangedBy(space.unitMask(order))).toEqual([place]);
      const before = space.valuesAt(0n);
      const after = space.valuesAt(space.unitMask(order));
      expect(after.flatMap((value, at) => (value === before[at] ? [] : [at]))).toEqual([place]);
    }
  });
});

describe("S042: one plan of a search", () => {
  it("asks, tells and refuses from the same size and time", () => {
    const long = SearchPlan.of("10 date combinations", 10, 50_400);
    expect(long.ask).toBe(true);
    expect(long.question()).toBe("Search 10 date combinations, about 14 hours?");
    expect(allowedBy(long.extent(), [["max-candidates", long.count]])).toBe(
      "The search tries 10 date combinations, about 14 hours. Allow it with --max-candidates 10.",
    );
    const minute = SearchPlan.of("128 candidates", 128, TELL_SECONDS);
    expect([minute.ask, minute.tell]).toEqual([false, true]);
    expect(minute.notice()).toBe(
      "The search tries 128 candidates, about 1 minute; progress is shown.",
    );
    const quick = SearchPlan.of("3 candidates", 3, 0.2, 2);
    expect([quick.ask, quick.question()]).toEqual([true, "Search 3 candidates?"]);
  });
});

describe("S043-S045: one table of the parts of a date", () => {
  it("reads, writes and names dates from the same parts and orders", () => {
    expect(DATE_FORMAT_TEXT).toBe("DD-MM-YYYY");
    expect(parseDate("2026-09-23")).toEqual(parseDate("23-09-2026"));
    expect(formatDate({ year: 26, month: 9, day: 3 })).toBe("03-09-0026");
    expect(() => parseDate("23-09-26")).toThrow("Use DD-MM-YYYY with a four-digit year");
    expect(parseDatePattern("?").key).toBe(parseDatePattern("??-??-????").key);
    expect(() => parseDatePattern("2?-09-26")).toThrow(
      "Use DD-MM-YYYY with ? for each forgotten digit",
    );
    expect(() => parseDatePattern("3?-02-2026")).toThrow("real calendar date");
    expect(Object.isFrozen(parseDatePattern("2?-09-2026"))).toBe(true);
  });

  it("finds the earlier pattern of each key once, for the count and the search alike", () => {
    const one = parseDatePattern("2?-09-2026");
    const other = parseDatePattern("1?-09-2026");
    expect(sameKeyPredecessors([one, other, one, one])).toEqual([undefined, undefined, 0, 2]);
  });
});

describe("S046: the search of marked codes counts and bounds its places as the word search", () => {
  it("refuses too many combinations in one sentence shape, with its own hint", () => {
    expect(() => assertSearchable(MAX_SEARCH_COMBINATIONS + 1, "mark fewer")).toThrow(
      "This search has more than 16,777,216 combinations: mark fewer.",
    );
    expect(unknownPlacesOf([[1], [2, 3], [4], [5, 6]])).toEqual([1, 3]);
    expect(keptCount(undefined, 100, "maxFound", 1)).toBe(100);
    expect(() => keptCount(0, 100, "maxFound", 1)).toThrow(
      "maxFound must be a whole number of 1 or more.",
    );
  });
});

describe("S047: one way to name a range and refuse a number outside it", () => {
  it("says ranges as questions and refusals say them", () => {
    expect(rangeText({ min: 1, max: 2048 }, "to")).toBe(WORD_NUMBERS);
    expect(rangeText({ min: 1, max: 2048 })).toBe(WORD_NUMBERS_THROUGH);
    expect(integerRefusal("account", { min: 0, max: 7 })).toBe(
      "account must be an integer from 0 through 7.",
    );
    expect(() => typedWholeNumber("9", { min: 0, max: 7 })).toThrow(
      "Type a number from 0 through 7.",
    );
    expect(() => formatDate({ year: 0, month: 1, day: 1 })).toThrow(
      "A date year must be an integer from 0001 through 9999.",
    );
    expect(() => formatDate({ year: 2000, month: 13, day: 1 })).toThrow(
      "A date month must be an integer from 1 through 12.",
    );
  });
});

describe("S053: one reader of hexadecimal bytes", () => {
  it("reads both cases back to what hexOfBytes wrote, and refuses what is no bytes", () => {
    const bytes = Uint8Array.from([0, 1, 0xab, 0xff]);
    expect(bytesOfHex(hexOfBytes(bytes))).toEqual(bytes);
    expect(bytesOfHex("00AbFf")).toEqual(Uint8Array.from([0, 0xab, 0xff]));
    expect(() => bytesOfHex("abc")).toThrow("two digits");
    expect(() => bytesOfHex("zz")).toThrow("two digits");
  });
});

describe("S055: one rule of the coin types and paths on each network", () => {
  it("gives every coin type of a coin, and coin type 1 on a test network", () => {
    const location = { account: 0, branch: 0, index: 0 };
    expect(BITCOIN.branchPathsOf("p2wpkh", false, location)).toEqual(["m/84'/0'/0'/0"]);
    expect(BITCOIN.branchPathsOf("p2wpkh", true, location)).toEqual(["m/84'/1'/0'/0"]);
    expect(BITCOIN.accountPathsOf("p2tr", true, 2)).toEqual(["m/86'/1'/2'"]);
    const classic = COINS.find((coin) => coin.id === "ethereum-classic")!;
    expect(classic.coinTypesOn(false)).toEqual([61, 60]);
    expect(classic.coinTypesOn(true)).toEqual([1]);
  });
});

describe("S061: one refusal of an address of no single key, with each coin's own forms", () => {
  it("names Litecoin's forms for a Litecoin script, not Bitcoin's", () => {
    const script = bech32.encode("ltc", [0, ...bech32.toWords(new Uint8Array(32).fill(7))]);
    expect(() => coinById("litecoin").parse(script)).toThrow(
      "it is not the address of a single key; only ltc1q with 43 characters can be checked",
    );
  });
});

describe("S060: the rules of typed text in one leaf module", () => {
  it("drops a file's byte order mark and changes only ASCII case", () => {
    expect(withoutByteOrderMark("﻿key")).toBe("key");
    expect(withoutByteOrderMark("key﻿")).toBe("key﻿");
    expect(asciiLowercase("BC1Q ÄÖ")).toBe("bc1q ÄÖ");
    expect(asciiUppercase("bc1q äö")).toBe("BC1Q äö");
    expect(trimWhiteSpace("\u0085bc1q\u0085")).toBe("bc1q");
  });
});
