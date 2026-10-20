// The findings S100 to S148, G1-019, G1-023 and G1-025 of the DRY/OOP scan of 2026-10-09
// (test/scan-fixes.test.ts), each with a case that would fail without its fix. Public test data
// only: the BIP39 test phrase and the public SSKR vectors.

import {
  CANCELLED_EXIT_CODE,
  exitCodeOfSignal,
  signalNameOf,
  stoppedBySignal,
} from "../src/cli/exit-codes.js";
import {
  CardPreview as CardPreviewClass,
  ONE_DESIGN_FOR_SEPARATE_CARDS,
  SAMPLE_FILE_BASE,
} from "../src/export/card-preview.js";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { typedCommand, typedLine } from "../src/cli/shell-command.js";
import { describeError, refusalMessage } from "../src/core/refusal.js";
import { recoverLegacyValidLastWords } from "../src/core/words.js";
import { FIT_NO_FORM } from "../src/core/encoded-backup.js";
import { BackupReading } from "../src/core/backup-reading.js";
import { MM, POINTS_PER_INCH as PAGE_POINTS_PER_INCH } from "../src/export/page-units.js";
import { MM as LAYOUT_MM } from "../src/export/business-layout.js";
import { BITCOIN_P2PKH_VERSION, BITCOIN_P2SH_VERSION } from "../src/core/coins/bitcoin-versions.js";
import { bech32Groups } from "../src/core/coins/bech32.js";
import { MissingCodes, MAX_FOUND_CODES } from "../src/core/missing-codes.js";
import { CORRECT_WRITTEN_COPY } from "../src/core/search-plan.js";
import { MISSING_CODES_TEXTS, MissingCodesSearch } from "../src/core/missing-codes-search.js";
import { REPAIR_NOTES } from "../src/sskr/repair-report.js";
import { unshownCandidatesNotice } from "../src/core/candidates.js";
import {
  COLOR_UNICODE_PAIRS,
  colorsToUnicode,
  unicodeToColorCodes,
  unicodeToColors,
} from "../src/core/colors.js";
import { pathsOverlap } from "../src/cli/path-within.js";
import { afterPlace, capitalized, lowerFirst } from "../src/core/prose.js";
import { selfTestFeature } from "../src/core/self-test-check.js";
import {
  fingerprintMatch,
  fingerprintWalletCheck,
  FINGERPRINT_HEX_DIGITS,
  isFingerprintText,
  isMasterKeyPath,
  MASTER_KEY_PATH,
} from "../src/core/wallet-check.js";
import { fingerprintOfValidPhrase, zeroEntropyPhrase } from "../src/core/english-words.js";
import { MAX_GROUP_MEMBERS, MAX_GROUPS } from "../src/sskr/share-layout.js";
import { MAX_SHARES } from "../src/sskr/split.js";
import { assertShareCount, CHECKSUM_BYTES, UR_SSKR_PREFIX } from "../src/sskr/transport.js";
import { CRC32_BYTES } from "../src/sskr/checksum.js";
import { BITS_PER_BYTE, equalBytes } from "../src/core/bits.js";
import { BITS_PER_BYTE as SIZES_BITS_PER_BYTE } from "../src/core/bip39-sizes.js";
import { MAX_REPAIR_COMBINATIONS } from "../src/sskr/joint-repair.js";
import { serializeRecord } from "../src/record.js";
import { describe, expect, it, vi } from "vitest";
import { PHRASE_WORDS } from "../src/core/masking.js";
import { unrepairedShare } from "../src/sskr/repair.js";
import { isMarked } from "../src/sskr/repair-units.js";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { CARD_FORMAT_NUMBERS, noCardTemplateMessage } from "../src/cli/format-numbers.js";
import { DatesAnswer } from "../src/core/date-search.js";
import { ShareInput } from "../src/sskr/share-input.js";
import { formatEncoded, representMnemonic } from "../src/core.js";
import { resolveSskrLayout } from "../src/export/sskr-content.js";
import { writeRenderedDocument } from "../src/export/image-export.js";
import {
  parsePageSize,
  SHEET_PAGE_SIZE,
  SEPARATE_CARD_SIZE,
  resolvePageSize,
  assertSeparateCardSize,
  pageSizeLabel,
  pageDimensions,
  BUSINESS_CARD_MM,
  COPY_FIELDS,
  validateProfile,
} from "../src/export/card-settings.js";
import { parseRecord } from "../src/record.js";
import { CoinList } from "../src/core/coins/coin.js";
import { deriveShifts, NO_DATE } from "../src/core/dates.js";
import { startTimer } from "../src/core/search-turns.js";
import { COIN_OF_ID, COINS, coinById } from "../src/core/coins.js";
import { flagPair, HELP_FLAGS, isFlagOf, VERSION_FLAGS } from "../src/cli/command-options.js";
import { NoCardTemplateError } from "../src/export/template-catalog.js";
import {
  cardTemplates,
  selectTemplate,
  templateNumber,
  templatesOfKind,
} from "../src/export/templates.js";
import { colorCardTemplates } from "../src/color-export.js";
import { employers, sectorForStyle } from "../src/export/card-identities.js";
import { resolveCardPresentation } from "../src/export/card-copy.js";
import { ExportDetails } from "../src/export/export-details.js";
import { nodeCardRenderer, nodeRenderPlatform } from "../src/export/platform-node.js";
import { ShareCardSet } from "../src/export/sskr-render.js";
import { pageFileName, separateCardName } from "../src/export/card-codes.js";
import { validateCardOptions } from "../src/cli/card-options.js";
import { writeNewPrivateFile, makePrivateFolder } from "../src/export/private-file.js";
import {
  heirSheetSizeLabel,
  parseHeirSheetSize,
  HEIR_SHEET_FORMATS,
  DEFAULT_HEIR_SHEET_SIZE,
} from "../src/export/heir-sheet.js";
import { preparedForLine } from "../src/export/collection-sheet.js";
import { MAX_SHEET_CARDS } from "../src/export/collection-layout.js";
import { cardCopyOptions } from "../src/cli/business-options.js";
import { heirSheetText } from "../src/cli/heir-sheet.js";
import { shareKeepingNote } from "../src/export/sskr-keeping-text.js";
import { POINTS_PER_INCH } from "../src/export/document-formats.js";

describe("S100: the default page sizes are named once", () => {
  it("resolves a sheet's and a separate card's size and refuses a sheet size for separate cards", () => {
    expect(parsePageSize(undefined)).toBe(SHEET_PAGE_SIZE);
    expect(resolvePageSize(undefined, true)).toBe(SEPARATE_CARD_SIZE);
    expect(resolvePageSize("a4", true)).toBe("a4");
    const refusal = "Separate cards have the business size.";
    expect(() => assertSeparateCardSize("a4")).toThrow(refusal);
    expect(() => resolveSskrLayout("individual", "a4")).toThrow(refusal);
    expect(() => assertSeparateCardSize(undefined)).not.toThrow();
  });
});

describe("S101: the sizes of cards and paper are named once", () => {
  it("labels the paper from its dimensions and keeps the business card the drawing box", () => {
    expect([pageSizeLabel("a6"), pageSizeLabel("a4"), pageSizeLabel("business")]).toEqual([
      "148 x 105 mm",
      "210 x 297 mm",
      "90 x 50 mm",
    ]);
    expect(pageDimensions("business")).toEqual([BUSINESS_CARD_MM.width, BUSINESS_CARD_MM.height]);
    expect([heirSheetSizeLabel("a5"), heirSheetSizeLabel("a6")]).toEqual([
      "148 x 210 mm",
      "105 x 148 mm",
    ]);
  });
});

describe("S107 and S109: the sheet capacity and the separate cards have one owner each", () => {
  it("fits the cards of the longest share and its decoys on one sheet in every form with cards", async () => {
    const { deterministic } = JSON.parse(readFileSync("vectors/sskr-v1.json", "utf8")) as {
      deterministic: { shares: string[] }[];
    };
    const longest = deterministic.at(-1)!.shares;
    for (const shareFormat of ["unicode", "colors", "colors-unicode"] as const) {
      const cards = await ShareCardSet.create(nodeCardRenderer, longest, {
        style: "architect",
        layout: "individual",
        shareFormat,
      });
      for (const share of cards.shares)
        expect([shareFormat, share.documents <= MAX_SHEET_CARDS]).toEqual([shareFormat, true]);
    }
  });

  it("names a separate card by its place and first code", () => {
    expect(separateCardName({ colors: ["#a3f09c", "#000000"] }, 1)).toBe("02-000000");
    expect(separateCardName({ colors: ["#000000"], labels: ["12 345 6"] }, 0)).toBe("01-12-345-6");
  });
});

describe("S112: the texts of a card and the person's details have one list each", () => {
  it("chooses the missing texts in their order and names each by its option", () => {
    const picks: number[] = [];
    const presentation = resolveCardPresentation(
      (limit) => {
        picks.push(limit);
        return 0;
      },
      { slogan: "Own" },
    );
    expect(Object.keys(presentation)).toEqual([...COPY_FIELDS]);
    // The studio, the subtitle and the footer are chosen, in that order; the label is fixed.
    expect(picks).toHaveLength(3);
    expect(presentation.slogan).toBe("Own");
    expect(presentation.referenceLabel).toBe("Ref.");
    expect(cardCopyOptions).toEqual([
      "studio-name",
      "card-slogan",
      "card-subtitle",
      "card-footer",
      "card-reference-label",
    ]);
    expect(() => resolveCardPresentation(nodeRenderPlatform.randomInt, { footer: " " })).toThrow(
      "Card footer must be non-empty text on one line; use - to hide it.",
    );
    expect(() => validateProfile({ role: " " })).toThrow(
      "Card role must be non-empty text on one line, without control characters.",
    );
  });
});

describe("S111: the invented details of an export have one owner", () => {
  it("draws the texts first, then the person, with the employer of the style", () => {
    const choose = vi.fn((_limit: number) => 0);
    const details = ExportDetails.drawn(choose, {}, {}, "it");
    // Studio, slogan, subtitle and footer; then company, name and role, the sector given by "it".
    expect(choose.mock.calls).toEqual([[37], [29], [5], [6], [5], [60], [16]]);
    expect(details.profile.company).toBe("Norvale Systems");
    expect(Object.isFrozen(details.profile) && Object.isFrozen(details.presentation)).toBe(true);
    choose.mockClear();
    // Without a style the sector is chosen too, before the company.
    ExportDetails.drawn(choose, { name: "John Smith" }, { slogan: "Own" });
    expect(choose.mock.calls).toEqual([[37], [5], [6], [4], [5], [16]]);
  });

  it("settles one export once, whatever the style, and copies what the caller gives", () => {
    const presentation = resolveCardPresentation(() => 0, { studioName: "Given Studio" });
    const settings = { presentation: { ...presentation }, profile: { name: "John Smith" } };
    const details = ExportDetails.of(nodeRenderPlatform.randomInt, settings, "it");
    expect(ExportDetails.of(nodeRenderPlatform.randomInt, settings, "architect")).toBe(details);
    expect(ExportDetails.ofPersonFirst(nodeRenderPlatform.randomInt, settings)).toBe(details);
    expect(details.presentation).toEqual(presentation);
    expect(details.presentation).not.toBe(settings.presentation);
    expect(details.profile.name).toBe("John Smith");
    expect(sectorForStyle("it")).toBe("it");
    expect(employers.it).toContain(details.profile.company);
    // A page of the export, which carries the settled details, prints them unchanged.
    const page = { ...settings, profile: details.profile, presentation: details.presentation };
    expect(ExportDetails.of(nodeRenderPlatform.randomInt, page, "mixed").profile).toEqual(
      details.profile,
    );
    expect(ExportDetails.of(nodeRenderPlatform.randomInt, page, "mixed").presentation).toEqual(
      details.presentation,
    );
    expect(() =>
      ExportDetails.of(nodeRenderPlatform.randomInt, { profile: { name: "1234" } }),
    ).toThrow("Latin letters");
  });

  it("chooses at an export in its order, and in a design drawn directly in the design's", () => {
    const limits: number[] = [];
    const choose = (limit: number): number => {
      limits.push(limit);
      return 0;
    };
    ExportDetails.of(choose, {}, "it");
    expect(limits).toEqual([37, 29, 5, 6, 5, 60, 16]);
    limits.length = 0;
    // The business designs choose the person first (ExportDetails.ofPersonFirst).
    ExportDetails.ofPersonFirst(choose, {}, "it");
    expect(limits).toEqual([5, 60, 16, 37, 29, 5, 6]);
  });
});

describe("S114: a kind of card without a design is refused by its kind", () => {
  it("names no form number in the library; the command line names the forms of cards", () => {
    expect(new NoCardTemplateError(undefined).message).toBe("No card template is installed.");
    expect(new NoCardTemplateError("colors").kind).toBe("colors");
    expect(new NoCardTemplateError("colors").message).not.toMatch(/\d/u);
    expect(noCardTemplateMessage(new NoCardTemplateError("colors"))).toContain(
      "use format 3, 4 or 5",
    );
    // Word numbers have no cards: their refusal names the forms that do.
    expect(() => validateCardOptions({ pdf: "cards.pdf" }, "indexes")).toThrow(
      `Card export requires format ${CARD_FORMAT_NUMBERS}.`,
    );
  });
});

describe("S115: the sizes of the sheet for heirs are the library's", () => {
  it("reads a size, gives the default and refuses another with the list", () => {
    expect(parseHeirSheetSize(undefined)).toBe(HEIR_SHEET_FORMATS[DEFAULT_HEIR_SHEET_SIZE]);
    expect(parseHeirSheetSize("a6")).toBe(HEIR_SHEET_FORMATS.a6);
    expect(() => parseHeirSheetSize("a4")).toThrow(
      "The size of the instructions for heirs must be a5 or a6.",
    );
  });
});

describe("S116: every printed heading of the sheet for heirs is in its text", () => {
  it("names the headings in the text and points the front to the back's titles", () => {
    const text = heirSheetText({
      backup: { kind: "encoded", format: "indexes", words: 12 },
      mode: "seedshift",
      dates: 1,
    });
    expect([text.needsHeading, text.hintHeading, text.stepsTitle, text.troubleHeading]).toEqual([
      "What you need",
      "Hint from the owner",
      "Steps",
      "If something goes wrong",
    ]);
    expect(text.newcomer).toBe(
      'The steps are on the back. New to wallets? Read "The basics" there first.',
    );
    expect(text.basicsTitle).toBe("The basics");
  });
});

describe("S117: one writer of private files and folders", () => {
  it.skipIf(process.platform === "win32")(
    "writes a document and a folder that only the owner may open, never over a file",
    async () => {
      const root = await mkdtemp(join(tmpdir(), "mnemocode-s117-"));
      try {
        const base = join(root, "card");
        expect(await writeRenderedDocument(new Uint8Array([37, 80, 68, 70]), base, "pdf")).toBe(1);
        expect(statSync(`${base}.pdf`).mode & 0o777).toBe(0o600);
        await expect(writeNewPrivateFile(`${base}.pdf`, new Uint8Array())).rejects.toThrow(
          "EEXIST",
        );
        await makePrivateFolder(join(root, "share"));
        expect(statSync(join(root, "share")).mode & 0o777).toBe(0o700);
      } finally {
        await rm(root, { recursive: true, force: true });
      }
    },
  );
});

describe("S118: one note on how saved shares are kept", () => {
  const { deterministic } = JSON.parse(readFileSync("vectors/sskr-v1.json", "utf8")) as {
    deterministic: { shares: string[] }[];
  };
  const set = deterministic[0]!.shares;

  it("says how many shares restore what, read from the shares, and where each one is", () => {
    expect(shareKeepingNote(set, "file", false)).toBe(
      "Any 2 of the 3 shares are enough for recovery; the file holds every share. Store the shares apart.",
    );
    expect(shareKeepingNote(set.slice(0, 2), "folders", false)).toBe(
      "All 2 shares are needed for recovery; each folder is one share and needs all its cards. Store the shares apart.",
    );
    expect(shareKeepingNote(set.slice(0, 1), "files", false)).toBe(
      "These shares are fewer than the 2 needed for recovery; each file is one share. Store the shares apart.",
    );
    expect(shareKeepingNote(set, "pages", true)).toBe(
      `Any 2 of the 3 shares are enough to restore ${PHRASE_WORDS.masked}, which the owner's dates turn back into ${PHRASE_WORDS.original}; the numbered pages of each share belong together. Store the shares apart.`,
    );
    expect(() => shareKeepingNote([], "folder", false)).toThrow("There are no shares to keep.");
  });
});

describe("S121: one builder of an unrepaired share and one test of a mark", () => {
  it("reads a complete share as a repair gives it back and tells a marked one", () => {
    const { deterministic } = JSON.parse(readFileSync("vectors/sskr-v1.json", "utf8")) as {
      deterministic: { shares: string[] }[];
    };
    const share = deterministic[0]!.shares[0]!;
    expect(unrepairedShare(share)).toMatchObject({ ur: share, repaired: false, filled: [] });
    expect([isMarked(share), isMarked("1 ? 3")]).toEqual([false, true]);
  });
});

describe("S125: one rule quotes the command lines that are shown", () => {
  it("quotes alike for the menu and the release script, as a leaf the script loads", () => {
    expect(typedLine(["gh", "release", "edit", "v1.0.0", "--draft=false"], "linux")).toBe(
      "gh release edit v1.0.0 --draft=false",
    );
    // The release script's own rule took these as they were; the menu's quotes them.
    expect(typedLine(["x", "50%", "a,b", "=name", "@name"], "linux")).toBe(
      "x '50%' 'a,b' '=name' '@name'",
    );
    expect(typedCommand(["decode", "it's"], "linux")).toBe(
      typedLine(["mnemocode", "decode", "it's"], "linux"),
    );
    const leaf = readFileSync("src/cli/shell-command.ts", "utf8");
    expect(leaf).not.toMatch(/^\s*(?:import|export\s.*\sfrom)\s/mu);
    expect(readFileSync("scripts/sign-release.mjs", "utf8")).toContain(
      'import { typedLine } from "../src/cli/shell-command.ts";',
    );
  });
});

describe("S126: one module names the files of a release", () => {
  /** The part of scripts/executable-files.mjs that this test uses; the script has no types. */
  interface ExecutableFiles {
    readonly CHECKSUM_LINE: RegExp;
    readonly checksumLine: (sha256: string, file: string) => string;
    readonly checksumsName: (executable: string) => string;
    readonly executableName: (version: string) => string;
    readonly noticesName: (executable: string) => string;
    readonly releaseFilePrefix: (version: string) => string;
  }

  it("writes the checksum lines that the signing script reads, under one prefix", async () => {
    const script = new URL("../scripts/executable-files.mjs", import.meta.url).href;
    const {
      CHECKSUM_LINE,
      checksumLine,
      checksumsName,
      executableName,
      noticesName,
      releaseFilePrefix,
    } = (await import(script)) as ExecutableFiles;
    const name = executableName("1.2.3");
    expect(name.startsWith(releaseFilePrefix("1.2.3"))).toBe(true);
    expect(checksumsName(name)).toBe(`${name}.sha256`);
    const line = checksumLine("ab".repeat(32), noticesName(name));
    expect(CHECKSUM_LINE.exec(line)?.[1]).toBe(noticesName(name));
    expect(CHECKSUM_LINE.test(checksumLine("ab".repeat(32), "-option"))).toBe(false);
    const signing = readFileSync("scripts/sign-release.mjs", "utf8");
    expect(signing).toContain('from "./executable-files.mjs"');
    expect(signing).not.toMatch(/mnemocode-\$\{/u);
    expect(readFileSync(".github/workflows/executable.yml", "utf8")).toContain(
      "node scripts/verify-executable.mjs --print-path",
    );
  });
});

describe("S128: one reading of what a thrown value says, and rules in the library", () => {
  it("tells a refusal from a fault, and says what any thrown value is", () => {
    expect(refusalMessage(new Error("No."))).toBe("No.");
    // The fault passes through as it was thrown: the string itself, not an Error that wraps it.
    expect(() => refusalMessage("fault")).toThrow(expect.stringMatching(/^fault$/u));
    expect(describeError(new Error("No."))).toBe("No.");
    expect(describeError(42)).toBe("42");
  });

  it("refuses a ? for the old exact last word in the library", () => {
    expect(() => recoverLegacyValidLastWords(`${"abandon ".repeat(11)}?`)).toThrow(
      "This mode needs the exact old final word: ? stands for no word here.",
    );
  });

  it("refuses a color that is not #RRGGBB in capitals in one place", () => {
    expect(() => colorsToUnicode(["#a3f09c"])).toThrow("uppercase #RRGGBB");
  });

  it("refuses complete and marked codes that fit no form with one wording", () => {
    const reading = BackupReading.of("not codes at all", {
      seedshiftOnly: false,
      shareReader: "the share reader",
    });
    expect(() => reading.markedFormats()).toThrow(`${FIT_NO_FORM}: mark each code`);
    expect(reading.markedFormats("colors")).toEqual(["colors"]);
  });
});

describe("S129: limits derived from their sources", () => {
  it("keeps the derived values equal to those they replaced", () => {
    expect(MAX_SHARES).toBe(16);
    expect(MAX_GROUPS * MAX_GROUP_MEMBERS).toBe(256);
    expect(() => assertShareCount(256)).not.toThrow();
    expect(() => assertShareCount(257)).toThrow("Provide between 1 and 256 SSKR shares.");
    expect(CHECKSUM_BYTES).toBe(CRC32_BYTES);
    expect(CRC32_BYTES).toBe(4);
    expect(BITS_PER_BYTE).toBe(SIZES_BITS_PER_BYTE);
    expect(MAX_REPAIR_COMBINATIONS).toBe(2 ** 40);
    expect(UR_SSKR_PREFIX).toBe("ur:sskr/");
    const record = serializeRecord("seedshift", "indexes", "1 2");
    expect(record).toBe("MNC1:seedshift:indexes:1 2");
    expect(parseRecord(record)?.payload).toBe("1 2");
  });
});

describe("S130: one list of the designs of a kind", () => {
  it("gives the designs of each kind from the installed list", () => {
    expect(templatesOfKind("colors")).toEqual(
      cardTemplates.filter((template) => template.kind === "colors"),
    );
    expect(colorCardTemplates).toEqual(templatesOfKind("colors"));
  });
});

describe("S131: one refusal of a list without dates", () => {
  it("is the same for the shifts, typed dates and given dates", () => {
    expect(NO_DATE).toBe("Type at least one date.");
    expect(() => deriveShifts([], 12)).toThrow(NO_DATE);
    expect(() => DatesAnswer.of([])).toThrow(NO_DATE);
    expect(() => DatesAnswer.parse(" ", { wordCount: 12, patterns: false })).toThrow(NO_DATE);
  });
});

describe("S132: the scaffolding of the self-tests in one place each", () => {
  it("builds a feature's checks with one factory", async () => {
    const ran: string[] = [];
    const feature = selfTestFeature({
      name: "Example",
      detail: "one check",
      startup: () => ran.push("startup"),
      run: () => {
        ran.push("run");
      },
    });
    feature.startup();
    await feature.check.run();
    expect(feature.check.name).toBe("Example");
    expect(ran).toEqual(["startup", "run"]);
    expect(Object.isFrozen(feature) && Object.isFrozen(feature.check)).toBe(true);
  });

  it("checks a wallet by its fingerprint", async () => {
    const check = fingerprintWalletCheck(() => "73c5da0a", "73c5da0a");
    expect((await check("any phrase")).matched).toBe(true);
    const other = fingerprintWalletCheck(async () => "00000000", "73c5da0a");
    expect((await other("any phrase")).matched).toBe(false);
  });

  it("gives the public phrase of all-zero entropy of every length", () => {
    expect(zeroEntropyPhrase(12)).toBe(
      "abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about",
    );
    expect(zeroEntropyPhrase(24).split(" ")).toHaveLength(24);
    expect(zeroEntropyPhrase(24).endsWith(" art")).toBe(true);
  });
});

describe("S134: one comparison of bytes", () => {
  it("compares lengths, every byte and empty arrays", () => {
    expect(equalBytes(Uint8Array.of(1, 2, 3), Uint8Array.of(1, 2, 3))).toBe(true);
    expect(equalBytes(Uint8Array.of(1, 2, 3), Uint8Array.of(1, 2, 4))).toBe(false);
    expect(equalBytes(Uint8Array.of(1, 2), Uint8Array.of(1, 2, 3))).toBe(false);
    expect(equalBytes(new Uint8Array(0), [])).toBe(true);
    // A prefix through a subarray: one shorter than the prefix differs in length.
    expect(equalBytes(Uint8Array.of(0x89, 0x50).subarray(0, 3), [0x89, 0x50, 0x4e])).toBe(false);
  });
});

describe("S135: the English word list has one way in", () => {
  it("is imported from the package only by english-words.ts and two independent self-tests", () => {
    const importers = readdirSync("src", { recursive: true, encoding: "utf8" })
      .filter((file) => file.endsWith(".ts"))
      .filter((file) =>
        readFileSync(`src/${file}`, "utf8").includes('"@scure/bip39/wordlists/english.js"'),
      )
      .map((file) => file.replaceAll("\\", "/"))
      .sort();
    expect(importers).toEqual([
      "core/english-words.ts",
      "core/self-test.ts",
      "sskr/share-unmasking-self-test.ts",
    ]);
  });
});

describe("S137: one rule for the exit code of a signal", () => {
  it("encodes and reads exit codes by the shell's rule", () => {
    expect(CANCELLED_EXIT_CODE).toBe(130);
    expect(exitCodeOfSignal("SIGINT")).toBe(CANCELLED_EXIT_CODE);
    expect(exitCodeOfSignal("SIGKILL")).toBe(137);
    expect(signalNameOf(137)).toBe("SIGKILL");
    expect(stoppedBySignal(1)).toBe(false);
    expect(stoppedBySignal(128)).toBe(false);
    expect(stoppedBySignal(137)).toBe(true);
  });
});

describe("S138: one rule for the case of a first letter", () => {
  it("keeps an abbreviation and puts a message after its place", () => {
    expect(lowerFirst("Invalid share.")).toBe("invalid share.");
    expect(lowerFirst("SSKR shares differ.")).toBe("SSKR shares differ.");
    // A name with a capital inside it keeps its case as an abbreviation does (AUD-024).
    expect(lowerFirst("MnemoCode expected a value.")).toBe("MnemoCode expected a value.");
    expect(capitalized("glass")).toBe("Glass");
    expect(afterPlace("Date", 2, "The day is wrong.")).toBe("Date 2: the day is wrong.");
    // Before, a date's message lost the case of an abbreviation: "bIP39".
    expect(afterPlace("Date", 1, "BIP39 says no.")).toBe("Date 1: BIP39 says no.");
    expect(ShareInput.aboutShare(3, " cannot be read: ", "Unknown word.")).toBe(
      "Share 3 cannot be read: unknown word.",
    );
  });
});

describe("S139: one test of paths that overlap", () => {
  it("finds the same path and either one inside the other", () => {
    expect(pathsOverlap("out", "out")).toBe(true);
    expect(pathsOverlap("out", "out/cards.pdf")).toBe(true);
    expect(pathsOverlap("out/cards.pdf", "out")).toBe(true);
    expect(pathsOverlap("out", "output")).toBe(false);
  });
});

describe("S140: the master key's path and the fingerprint's form in one place", () => {
  it("names the master key and reads fingerprints of eight digits", () => {
    expect(MASTER_KEY_PATH).toBe("m");
    expect(isMasterKeyPath("m")).toBe(true);
    expect(isMasterKeyPath("m/84'/0'/0'/0/0")).toBe(false);
    expect(fingerprintMatch("73c5da0a", "73c5da0a").path).toBe(MASTER_KEY_PATH);
    expect(isFingerprintText("73c5da0a")).toBe(true);
    expect(isFingerprintText("73c5da0")).toBe(false);
    expect(FINGERPRINT_HEX_DIGITS).toBe(8);
  });
});

describe("S141: each message has one owner", () => {
  it("shares the advice after a search and the notices of candidates not shown", () => {
    expect(MISSING_CODES_TEXTS.correct).toBe(CORRECT_WRITTEN_COPY);
    expect(REPAIR_NOTES.correct).toBe(CORRECT_WRITTEN_COPY);
    expect(unshownCandidatesNotice(100)).toBe(
      "100 candidates do not fit on this screen: check them against the wallet's fingerprint or an address, or give a few letters of the words.",
    );
    expect(unshownCandidatesNotice(3_000, "save them")).toBe(
      "3,000 candidates are too many to show: save them, or check them against the wallet's fingerprint or an address.",
    );
    expect(unshownCandidatesNotice(3_000)).toContain("too many to show or to save");
    expect(() => unicodeToColorCodes("E000")).toThrow(COLOR_UNICODE_PAIRS);
    expect(() => unicodeToColors("E000")).toThrow(
      "Color Unicode needs two four-digit codes for every color: 16, 20, 24, 28 or 32 codes in all.",
    );
  });
});

describe("S142: a phrase is fingerprinted only when it is valid, by one rule", () => {
  it("gives the fingerprint of a valid phrase and none of another", () => {
    const valid = zeroEntropyPhrase(12);
    expect(fingerprintOfValidPhrase(valid, () => "73c5da0a")).toBe("73c5da0a");
    expect(fingerprintOfValidPhrase(valid.replace(/about$/u, "abandon"), () => "x")).toBe(
      undefined,
    );
  });
});

describe("S144: the searches count what passed and time with one clock", () => {
  it("counts several sets of codes by all that passed, not by those kept", async () => {
    const codes = formatEncoded(representMnemonic(zeroEntropyPhrase(12)), "indexes").split(" ");
    codes[2] = "?";
    const search = new MissingCodesSearch(
      MissingCodes.read(codes.join(" "), "indexes", "direct"),
      () => "00000000",
    );
    const result = await search.byWallet(async () => ({ matched: true })).run();
    // One unreadable word of twelve: 2,048 words, about one in 16 with a valid checksum, more
    // than a search keeps; before, the count stopped at those kept.
    expect(result.kind).toBe("several");
    expect(result.kind === "several" && result.count).toBe(122);
    expect(122).toBeGreaterThan(MAX_FOUND_CODES);
  });

  it("times with a clock that only moves on", () => {
    // The monotonic clock moves on by 2.5 s while the system's time is set back by an hour: the
    // time measured is the monotonic one. With Date.now it would come out negative.
    const monotonic = vi.spyOn(performance, "now").mockReturnValueOnce(1_000);
    const wall = vi.spyOn(Date, "now").mockReturnValueOnce(10_000_000);
    try {
      const elapsed = startTimer();
      monotonic.mockReturnValueOnce(3_500);
      wall.mockReturnValueOnce(10_000_000 - 3_600_000);
      expect(elapsed()).toBe(2.5);
    } finally {
      monotonic.mockRestore();
      wall.mockRestore();
    }
  });
});

describe("S145: the coin families share their rules", () => {
  it("lists every coin once, by a record of identifiers, in the order of the names", () => {
    for (const [id, coin] of Object.entries(COIN_OF_ID)) expect(coin.id).toBe(id);
    expect(COINS.map((coin) => coin.id)).toEqual([
      "bitcoin",
      "bitcoin-cash",
      "cosmos",
      "dash",
      "dogecoin",
      "ethereum",
      "ethereum-classic",
      "injective",
      "litecoin",
      "tron",
      "xrp",
      "zcash",
    ]);
    expect(() => new CoinList([COINS[0]!, COINS[0]!])).toThrow("each be given once");
    expect(new CoinList(COINS).byId(" Dash ").id).toBe("dash");
  });

  it("names the network once, for every family", () => {
    expect(coinById("dash").describe("dash-platform")).toBe("Platform payment (DIP17)");
    expect(
      coinById("bitcoin").parse("tb1qw508d6qejxtdg4y5r3zarvary0c5xw7kxpjzsx").description,
    ).toBe("testnet, native SegWit (BIP84)");
    expect(BITCOIN_P2PKH_VERSION).toBe(0x00);
    expect(BITCOIN_P2SH_VERSION).toBe(0x05);
    expect(bech32Groups(20)).toBe(32);
    expect(bech32Groups(21)).toBe(34);
  });
});

describe("S146: the units of a page and the person's line have one source", () => {
  it("keeps the values the renderers used", () => {
    expect(MM).toBe(72 / 25.4);
    expect(LAYOUT_MM).toBe(MM);
    expect(POINTS_PER_INCH).toBe(PAGE_POINTS_PER_INCH);
    expect(preparedForLine("Ada")).toBe("Prepared for Ada");
  });
});

describe("S147: the command line's small rules have one place", () => {
  it("knows the help and version flags once and numbers designs as --template does", () => {
    expect(flagPair(HELP_FLAGS)).toBe("-h, --help");
    expect(flagPair(VERSION_FLAGS)).toBe("-V, --version");
    expect(isFlagOf(HELP_FLAGS, "-h")).toBe(true);
    expect(isFlagOf(HELP_FLAGS, "--version")).toBe(false);
    for (const template of cardTemplates)
      expect(selectTemplate(String(templateNumber(template)), template.kind)).toBe(template);
  });
});

describe("S148: the release key has one source", () => {
  it("is the one the signing script uses and the documents show", async () => {
    const script = new URL("../scripts/release-key.mjs", import.meta.url).href;
    const { SIGNING_KEY, KEY_DOCUMENTS } = (await import(script)) as {
      readonly SIGNING_KEY: string;
      readonly KEY_DOCUMENTS: readonly string[];
    };
    for (const path of KEY_DOCUMENTS) expect(readFileSync(path, "utf8")).toContain(SIGNING_KEY);
    const signing = readFileSync("scripts/sign-release.mjs", "utf8");
    expect(signing).toContain('import { SIGNING_KEY } from "./release-key.mjs";');
    expect(signing).not.toContain(SIGNING_KEY);
  });
});

describe("G1-019, G1-023 and G1-025: the names and the designs of exports have one owner", () => {
  it("names the pages of an export as every front end does", () => {
    expect(pageFileName("cards", 0, 1, "pdf")).toBe("cards.pdf");
    expect(pageFileName("cards", 0, 2, "png")).toBe("cards-01.png");
    expect(pageFileName("cards", 1, 2, "png")).toBe("cards-02.png");
    expect(SAMPLE_FILE_BASE).toBe("mnemocode-preview");
  });

  it("refuses separate sample cards of every design in the library", () => {
    expect(() => CardPreviewClass.assertOneDesign({ every: true })).toThrow(
      ONE_DESIGN_FOR_SEPARATE_CARDS,
    );
    expect(ONE_DESIGN_FOR_SEPARATE_CARDS.startsWith("Separate sample cards show one design")).toBe(
      true,
    );
    expect(() => CardPreviewClass.assertOneDesign({ template: "1" })).not.toThrow();
  });
});
