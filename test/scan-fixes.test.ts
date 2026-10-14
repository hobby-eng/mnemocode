// The findings of the DRY/OOP scan of 2026-10-09, each with a case that would fail without its fix.
// Public test data only: the BIP39 test phrase and the public SSKR vectors.

import {
  headingLine,
  factLine,
  markedLines as styledMarkedLinesForTest,
  noticeLines as styledNoticeLines,
} from "../src/cli/terminal-style.js";
import {
  CANCELLED_EXIT_CODE,
  CANCELLED_MESSAGE,
  exitCodeOfSignal,
  signalNameOf,
  stoppedBySignal,
} from "../src/cli/exit-codes.js";
import {
  CardPreview as CardPreviewClass,
  LONGEST_SAMPLE_WORDS,
  ONE_DESIGN_FOR_SEPARATE_CARDS,
  SAMPLE_FILE_BASE,
  SAMPLE_WORD_COUNTS,
} from "../src/export/card-preview.js";
import { MissingChecksumError as EncodedBackupMissingChecksum } from "../src/core/encoded-backup.js";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { typedCommand, typedLine } from "../src/cli/shell-command.js";
import { describeError, refusalMessage } from "../src/core/refusal.js";
import { recoverLegacyValidLastWords } from "../src/core/words.js";
import { FIT_NO_FORM } from "../src/core/encoded-backup.js";
import { BackupReading } from "../src/core/backup-reading.js";
import { createRasterImage, pixelOffset, RGBA_CHANNELS } from "../src/export/platform.js";
import { listPieces, textPieces } from "../src/core/pieces.js";
import { MM, POINTS_PER_INCH as PAGE_POINTS_PER_INCH } from "../src/export/page-units.js";
import { MM as LAYOUT_MM, centredRunStart, runCellSize } from "../src/export/business-layout.js";
import {
  channelsHex,
  hsv,
  hueAndSaturation,
  peakRelativeLuma,
  pixelHsv,
  rgbChannels,
} from "../src/export/color-math.js";
import {
  centredText,
  drawClippedArtwork,
  pdfPoint,
  pdfRect,
} from "../src/export/business-render-primitives.js";
import { referencePlacement } from "../src/export/business-cards.js";
import {
  PDFDocument as ScanPdfDocument,
  StandardFonts,
  type PDFImage,
  type PDFPage,
} from "pdf-lib";
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
import { afterEach, describe, expect, it, vi } from "vitest";
import { parseArguments, choiceOption, assertAskedNotGiven, flagOf } from "../src/cli/arguments.js";
import { runDecode } from "../src/cli/decode-command.js";
import { runRecoverDate } from "../src/cli/recover-date-command.js";
import { EncodedBackup } from "../src/core/encoded-backup.js";
import {
  Masking,
  SPLIT_MODES_ONLY,
  MissingChecksumError,
  PHRASE_WORDS,
} from "../src/core/masking.js";
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
  shareToColors,
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
  unrepairedShare,
  isMarked,
} from "../src/sskr/repair.js";
import { checkOutputName } from "../src/cli/output-saving.js";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  cardKindOf,
  writtenInColors,
  shareFormatOf,
  ShareSetChoice,
} from "../src/core/backup-options.js";
import {
  CARD_FORMAT_NUMBERS,
  COLOR_FORMAT_NUMBERS,
  noCardTemplateMessage,
} from "../src/cli/format-numbers.js";
import { ENCODED_FORMATS, isEncodedFormat, isMaskingMode } from "../src/core/types.js";
import { walletReason, DatesAnswer, MAX_SHOWN_MATCHES } from "../src/core/date-search.js";
import { ShareUnmasking } from "../src/sskr/share-unmasking.js";
import { Redacted } from "../src/core/redacted.js";
import { inspect } from "node:util";
import {
  nextFinding,
  type PartChecks,
  type BackupPart,
  KeptShares,
} from "../src/core/backup-check.js";
import { ShareInput, SHARE_SEPARATOR } from "../src/sskr/share-input.js";
import { withoutCopies } from "../src/sskr/set-topology.js";
import {
  decodeIndexes,
  parseDate,
  encodeMnemonic,
  formatEncoded,
  representMnemonic,
} from "../src/core.js";
import { listInWords } from "../src/core/places.js";
import { parseSskrLayout, resolveSskrLayout } from "../src/export/sskr-content.js";
import {
  parseImageFormat,
  DEFAULT_DOCUMENT_FORMAT,
  writeRenderedDocument,
  assertImageRenderer,
  exportPageImages,
  IMAGE_FOLDER_TAKEN,
  claimImageFolder,
} from "../src/export/image-export.js";
import {
  parsePageSize,
  assertSheetQr,
  SHEET_PAGE_SIZE,
  SEPARATE_CARD_SIZE,
  resolvePageSize,
  assertSeparateCardSize,
  pageSizeLabel,
  pageDimensions,
  BUSINESS_CARD_MM,
  COPY_FIELDS,
  validateProfile,
  CARD_PAGE_SIZES,
  CARD_ORIENTATIONS,
  isCardPageSize,
  profileFieldLabel,
  profileFields,
} from "../src/export/card-settings.js";
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
import { invalidAddress, DAMAGED, AddressRefusalError, CoinList } from "../src/core/coins/coin.js";
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
  datePatternCandidates,
  datePatternCandidateCount,
  expandDatePattern,
  daysInMonth,
  deriveShifts,
  NO_DATE,
} from "../src/core/dates.js";
import {
  assertSearchable,
  unknownPlacesOf,
  MAX_SEARCH_COMBINATIONS,
  MatchTally,
} from "../src/core/candidates.js";
import { keptCount, startTimer } from "../src/core/search-turns.js";
import { rangeText, integerRefusal, typedWholeNumber } from "../src/core/typed-number.js";
import { bytesOfHex, hexOfBytes } from "../src/core/bits.js";
import { COIN_OF_ID, COINS, coinById } from "../src/core/coins.js";
import { BITCOIN } from "../src/core/coins/bitcoin-like.js";
import { bech32, bech32m } from "@scure/base";
import {
  withoutByteOrderMark,
  asciiLowercase,
  asciiUppercase,
  trimWhiteSpace,
} from "../src/core/white-space.js";
import {
  FIRST_RECEIVING_LOCATION,
  bitcoinProfiles,
  type WalletEvidence,
} from "../src/core/wallet-evidence.js";
import {
  walletEvidence,
  walletEvidenceArguments,
  givenWallet,
  WALLET_EVIDENCE_OPTIONS,
} from "../src/cli/bitcoin-options.js";
import { Bech32Prefixes } from "../src/core/coins/bech32.js";
import { maxResultsOf } from "../src/cli/date-search.js";
import { changeWalletAnswer, checkWalletAnswer, WHAT_NOW } from "../src/cli/ask.js";
import { FILE_INPUTS, FILE_OUTPUTS, FOLDER_OUTPUTS } from "../src/cli/output-options.js";
import {
  commandOptions,
  COMMAND_FACTS,
  flagPair,
  HELP_FLAGS,
  isFlagOf,
  PRIVATE_SCREEN_COMMANDS,
  VERSION_FLAGS,
} from "../src/cli/command-options.js";
import { optionLabel } from "../src/cli/option-copy.js";
import { givenShares } from "../src/cli/sskr-restore-command.js";
import { SHARE_ANSWER_HINT, addMoreShares } from "../src/cli/share-repair.js";
import { ShareSplit } from "../src/sskr/split.js";
import { nodeSharePlatform, nodeFillRandom } from "../src/sskr/share-platform-node.js";
import { combineSskrShares } from "../src/sskr/shares.js";
import { runSskrSplit } from "../src/cli/sskr-split-command.js";
import {
  TEMPLATE_CATALOG,
  resolveTemplateId,
  findTemplate,
  DEFAULT_TEMPLATE_ID,
  BUSINESS_STYLES,
  designOfStyle,
  NoCardTemplateError,
} from "../src/export/template-catalog.js";
import {
  cardTemplates,
  selectTemplate,
  templateNumber,
  templatesOfKind,
} from "../src/export/templates.js";
import { colorCardTemplates } from "../src/color-export.js";
import { employers, sectorForStyle } from "../src/export/card-identities.js";
import {
  businessDesigns,
  businessFields,
  businessStyles,
  REFERENCE_MARGIN,
  studyThemeOf,
} from "../src/export/business-designs.js";
import { designTexts, resolveCardPresentation } from "../src/export/card-copy.js";
import { ExportDetails } from "../src/export/export-details.js";
import { nodeCardRenderer, nodeRenderPlatform } from "../src/export/platform-node.js";
import { ShareCardSet } from "../src/export/sskr-render.js";
import { assertCardIndex, pageFileName, separateCardName } from "../src/export/card-codes.js";
import { validateCardOptions, cardOutputs } from "../src/cli/card-options.js";
import { exportOptions } from "../src/cli/sskr-output.js";
import { cardFileFormat } from "../src/cli/image-options.js";
import {
  ENCODE_SHARED_OPTIONS,
  ENCODE_PLAIN_ONLY_OPTIONS,
  ENCODE_SSKR_ONLY_OPTIONS,
} from "../src/cli/encode-option-groups.js";
import { plainFingerprintLine, FINGERPRINT_HINT } from "../src/cli/fingerprint-report.js";
import { listQuestionRows, rowsOf, enteredAnswer, typeHint } from "../src/cli/terminal-choice.js";
import { closingRows } from "../src/cli/private-screen.js";
import {
  resultHeaderLines,
  noticeLines,
  markedLines,
  cursorUp,
  cursorRight,
} from "../src/cli/terminal.js";
import { NOT_UTF8, InputCancelledError } from "../src/cli/terminal-input.js";
import {
  isUnusableOutputPath,
  validateOutputPaths,
  preflightFileDestination,
  preflightFolderDestination,
} from "../src/cli/output-paths.js";
import {
  entryAt,
  absentPath,
  writeNewPrivateFile,
  makePrivateFolder,
  NewFolder,
} from "../src/export/private-file.js";
import { validCharacters, characterLength, isContinuation } from "../src/cli/utf8.js";
import { characterSize } from "../src/cli/terminal-geometry.js";
import { assertColorCards } from "../src/export/card-content.js";
import {
  heirSheetSizeLabel,
  parseHeirSheetSize,
  HEIR_SHEET_FORMATS,
  DEFAULT_HEIR_SHEET_SIZE,
} from "../src/export/heir-sheet.js";
import {
  collectionSheetLayout,
  drawCollectionStudy,
  drawStudyCaption,
  MAX_SHEET_CARDS,
  preparedForLine,
  separateCardIndex,
  studyCaptionWidth,
  type StudyBox,
  type StudyLayout,
} from "../src/export/collection-sheet.js";
import * as cardQrModule from "../src/export/card-qr.js";
import { renderBusinessCards } from "../src/export/business-cards.js";
import { MAX_DECOYS } from "../src/export/card-decoys.js";
import { separateCardPage } from "../src/export/business-layout.js";
import { renderMaterialCard } from "../src/export/material-cards.js";
import { materialArtwork } from "../src/export/material-artwork.js";
import { CARD_FOLDER_TAKEN, claimCardFolder } from "../src/export/individual-cards.js";
import { cardCopyOptions } from "../src/cli/business-options.js";
import { heirSheetText } from "../src/cli/heir-sheet.js";
import { shareKeepingNote } from "../src/export/sskr-keeping-text.js";
import {
  POINTS_PER_INCH,
  coveredPixels,
  JPEG_QUALITY,
  DOCUMENT_FORMAT_FACTS,
  parseDocumentFormat,
  DEFAULT_IMAGE_FORMAT,
} from "../src/export/document-formats.js";
import {
  listFileLock,
  protectionFor,
  createSessionIdentity,
  encryptCandidates,
  encryptCandidatesWithPassphrase,
  NoProtection,
  CandidateFileRefusedError,
  decryptCandidates,
} from "../src/core/candidate-encryption.js";
import { OpenedCandidateList } from "../src/core/candidate-list.js";
import { SSKR_ENGINE_FOLDER, SSKR_BRIDGE } from "../src/bundled-file-paths.js";
import { CardRenderer } from "../src/export/card-renderer.js";
import { A6, renderHeirSheet } from "../src/export/heir-sheet.js";
import type { RenderAsset, RenderPlatform } from "../src/export/platform.js";
import { sskrVectors } from "./helpers/vectors.js";

// The BIP39 library as it is, with the turning of a phrase into entropy watched: S005's case keeps
// the entropy of each phrase to see that it is wiped. Every other call works as without the spy.
vi.mock("@scure/bip39", async (importOriginal) => {
  const library = await importOriginal<typeof import("@scure/bip39")>();
  return { ...library, mnemonicToEntropy: vi.fn(library.mnemonicToEntropy) };
});

/** The first share of the public SSKR vectors (vectors/sskr-v1.json). */
const PUBLIC_SHARE: string = sskrVectors().deterministic[0]!.shares[0]!;

describe("S001, S019: the modes of shares, sheets for heirs and replaced last words are Masking's", () => {
  it("derives which modes split and which take a sheet from the variants", () => {
    expect(Masking.MODES.filter((mode) => Masking.isSplitMode(mode))).toEqual([
      "direct",
      "seedshift",
    ]);
    expect(Masking.MODES.filter((mode) => Masking.isHeirSheetMode(mode))).toEqual([
      "direct",
      "seedshift",
      "seedshift-legacy",
    ]);
    expect(() => Masking.assertSplitMode("seedshift-legacy")).toThrow(SPLIT_MODES_ONLY);
    expect(() => Masking.assertHeirSheetMode("seedshift-legacy-valid")).toThrow(
      "A sheet for heirs cannot be made for the Original Seedshift with a valid last word",
    );
    expect(Masking.MODES.filter((mode) => Masking.isMaskedMode(mode))).toEqual([
      "seedshift",
      "seedshift-legacy",
      "seedshift-legacy-valid",
    ]);
  });

  it("knows which mode a replaced last word gives, and that it is not encoded directly", () => {
    expect(Masking.of("seedshift-legacy").withValidLastWord?.mode).toBe("seedshift-legacy-valid");
    expect(Masking.of("seedshift").withValidLastWord).toBeUndefined();
    expect(Masking.of("seedshift-legacy-valid").encodable).toBe(false);
    expect(() => EncodedBackup.assertEncodable("seedshift-legacy-valid")).toThrow(
      "select legacy Seedshift",
    );
    expect(() => EncodedBackup.assertEncodable("seedshift", { validLastWord: true })).toThrow(
      "available only in legacy Seedshift mode",
    );
  });
});

describe("S003: codes given with the options are read as typed ones are", () => {
  it("refuses a Shamir share in decode and recover-date, naming the share reader", async () => {
    await expect(runDecode(parseArguments(["--input", PUBLIC_SHARE]))).rejects.toThrow(
      "This is a Shamir share, not an encoded seed phrase",
    );
    await expect(
      runRecoverDate(parseArguments(["--input", PUBLIC_SHARE, "--date", "2?-09-2026"])),
    ).rejects.toThrow("This is a Shamir share, not an encoded seed phrase");
  });

  it("refuses codes that fit no form before a search", async () => {
    // The library's reason for codes that fit no form, not a refusal of the date or the wallet.
    const codes = "not codes at all";
    await expect(
      runRecoverDate(parseArguments(["--input", codes, "--date", "2?-09-2026"])),
    ).rejects.toThrow(EncodedBackup.whyUnreadable(codes));
  });
});

describe("S005: the candidate list is written by one library writer", () => {
  const PHRASE = "abandon ".repeat(11) + "about";

  it("writes a list, tells an empty and a full one, and wipes every entropy", async () => {
    const { CandidateListWriter } = await import("../src/core/candidate-list-writer.js");
    const { NoProtection } = await import("../src/core/candidate-encryption.js");
    const { decodeCandidateList, LIST_KEEP, MAX_CANDIDATE_RECORDS, candidateListHolds } =
      await import("../src/core/candidate-list.js");
    const writer = new CandidateListWriter(new NoProtection(), "TREZOR");
    const made = await writer.writePhrases([PHRASE]);
    expect(made.kind).toBe("list");
    if (made.kind !== "list") return;
    expect(decodeCandidateList(made.list.bytes)).toMatchObject({ passphrase: "TREZOR" });
    expect(made.list.records).toBe(1);
    expect((await writer.writePhrases([])).kind).toBe("empty");
    expect((await writer.writePhrases(Array.from({ length: LIST_KEEP }, () => PHRASE))).kind).toBe(
      "full",
    );
    expect(candidateListHolds(MAX_CANDIDATE_RECORDS)).toBe(true);
    expect(candidateListHolds(LIST_KEEP)).toBe(false);
    const entropy = Uint8Array.from({ length: 16 }, (_, index) => index + 1);
    await writer.write([entropy]);
    expect(entropy.every((byte) => byte === 0)).toBe(true);
  });

  it("refuses a bad phrase after the first and leaves nothing of the first", async () => {
    const { CandidateListWriter } = await import("../src/core/candidate-list-writer.js");
    const { NoProtection } = await import("../src/core/candidate-encryption.js");
    const { mnemonicToEntropy } = await import("@scure/bip39");
    const turned = vi.mocked(mnemonicToEntropy);
    turned.mockClear();
    // A public BIP39 vector whose entropy is not zero (0x7f repeated), so that a wipe shows.
    const first = "legal winner thank year wave sausage worth useful legal winner thank yellow";
    await expect(
      new CandidateListWriter(new NoProtection()).writePhrases([first, "not a phrase"]),
    ).rejects.toThrow("Invalid mnemonic");
    const made = turned.mock.results[0];
    expect(made?.type).toBe("return");
    const entropy = made!.value as Uint8Array;
    expect(entropy).toHaveLength(16);
    expect(entropy.every((byte) => byte === 0)).toBe(true);
  });
});

describe("S010: complete and marked codes are read with the same separators", () => {
  it("reads a complete share written with commas, as its marked text is", async () => {
    const { readShare, writeShare } = await import("../src/sskr/transport.js");
    for (const format of ["colors", "unicode", "indexes"] as const) {
      const written = writeShare(PUBLIC_SHARE, format);
      const elements = format === "unicode" ? written.match(/.{4}/gu)! : written.split(" ");
      expect(readShare(elements.join(", ")).ur, format).toBe(PUBLIC_SHARE);
      expect(readShare(elements.join(";")).ur, format).toBe(PUBLIC_SHARE);
    }
  });

  it("reads the codes of a phrase with the same separators", async () => {
    const { parseInput, formatEncoded, representMnemonic } = await import("../src/core.js");
    const result = representMnemonic("abandon ".repeat(11) + "about");
    for (const format of ["indexes", "unicode", "colors"] as const) {
      const written = formatEncoded(result, format);
      const elements = format === "unicode" ? written.match(/.{4}/gu)! : written.split(" ");
      expect(parseInput(elements.join(", "), format), format).toEqual(result.shiftedIndexes);
    }
  });
});

describe("S015: a list question drops what was typed before it", () => {
  afterEach(() => {
    vi.doUnmock("../src/cli/terminal-input.js");
    vi.resetModules();
  });

  it("drops typed-ahead keys before it reads an answer", async () => {
    const events: string[] = [];
    vi.resetModules();
    vi.doMock("../src/cli/terminal-input.js", async (importOriginal) => ({
      ...(await importOriginal<typeof import("../src/cli/terminal-input.js")>()),
      dropTypedAhead: async () => {
        events.push("drop");
      },
      withRawTerminal: async <T>(body: (next: () => Promise<number | undefined>) => Promise<T>) => {
        events.push("read");
        // Escape: the question goes back.
        const keys = [0x1b];
        return body(async () => keys.shift());
      },
    }));
    const { choose } = await import("../src/cli/terminal-choice.js");
    await choose("Which?", [{ label: "One", value: 1 }], { label: "Next" });
    expect(events.slice(0, 2)).toEqual(["drop", "read"]);
  });
});

describe("S002, S123: ShareRestore holds the steps of a restore and a repair", () => {
  const vectors = JSON.parse(readFileSync("vectors/sskr-v1.json", "utf8")) as {
    deterministic: { entropy: string; shares: string[] }[];
  };
  const [first, second] = vectors.deterministic[0]!.shares as [string, string];

  async function restoreOf(texts: readonly string[], confirmed: boolean, limits = {}) {
    const { ShareInput } = await import("../src/sskr/share-input.js");
    const { ShareRestore } = await import("../src/sskr/share-restore.js");
    const { nodeSharePlatform } = await import("../src/sskr/share-platform-node.js");
    const input = new ShareInput({ decodeEntry: "Decode" });
    input.add(texts);
    return { input, restore: new ShareRestore(nodeSharePlatform), confirmed, limits };
  }

  it("restores the phrase of complete shares, with the backup and no repair", async () => {
    const { input, restore } = await restoreOf([first, second], false);
    const outcome = await restore.restore({ input, mode: "direct", confirmed: false });
    expect(outcome.kind).toBe("phrases");
    if (outcome.kind !== "phrases") return;
    expect(outcome.phrases).toHaveLength(1);
    expect(outcome.phrases[0]!.repairs).toEqual([]);
    expect(outcome.listed).toEqual([outcome.phrases[0]!.mnemonic]);
  });

  it("asks before a search longer than its limits allow, and searches once confirmed", async () => {
    const { writeShare } = await import("../src/sskr/transport.js");
    const parts = writeShare(second, "colors").split(" ");
    for (const place of [5, 7]) parts[place] = "?";
    const texts = [first, parts.join(" ")];
    const asked = await restoreOf(texts, false);
    const question = await asked.restore.restore({
      input: asked.input,
      mode: "direct",
      confirmed: false,
      limits: { shares: 1 },
    });
    expect(question.kind).toBe("question");
    const searched = await restoreOf(texts, true);
    const found = await searched.restore.restore({
      input: searched.input,
      mode: "direct",
      confirmed: true,
      limits: { shares: 1 },
    });
    expect(found.kind).toBe("phrases");
  });

  it("writes a marked share again whole, never the phrase", async () => {
    const { writeShare } = await import("../src/sskr/transport.js");
    const parts = writeShare(second, "colors").split(" ");
    parts[5] = "?";
    const { input, restore } = await restoreOf([first, parts.join(" ")], true);
    const outcome = await restore.repair({
      input,
      mode: "direct",
      confirmed: true,
      fingerprintOf: () => "00000000",
    });
    expect(outcome.kind).toBe("shares");
    if (outcome.kind !== "shares") return;
    expect(outcome.shares.map((share) => share.record)).toEqual([first, second]);
  });
});

describe("S123, S139: the command line takes ShareRestore's steps", () => {
  const vectors = JSON.parse(readFileSync("vectors/sskr-v1.json", "utf8")) as {
    deterministic: { entropy: string; shares: string[] }[];
  };
  const [first, second] = vectors.deterministic[0]!.shares as [string, string];
  // Shares 1 and 3 of a 2-of-3 split of "abandon ... about" masked with Seedshift and 23-09-2026
  // (scripts/verify-terminal-input.py), and that masked phrase.
  const MASKED_SHARES = [
    "ur:sskr/gomuttaeadaernclmdemdtlftsswsospsrjnjpwzuetlfhdltahh",
    "ur:sskr/gomuttaeadaojytnhyvtpaqdmobwreoyykutjtkofedicanladwm",
  ];
  const MASKED = `${"wool abuse actual ".repeat(3)}wool abuse congress`;
  const TEST_PHRASE = `${"abandon ".repeat(11)}about`;
  const noWallet = () => ({ matched: false });

  // Imported here, as the block above does: other blocks reset the modules, and a class checked
  // with instanceof (DatesAnswer) must come from the same load as the restore that checks it.
  async function modules() {
    const restore = await import("../src/sskr/share-restore.js");
    const { nodeSharePlatform } = await import("../src/sskr/share-platform-node.js");
    const { writeShare } = await import("../src/sskr/transport.js");
    const { ShareInput } = await import("../src/sskr/share-input.js");
    const { ShareUnmasking } = await import("../src/sskr/share-unmasking.js");
    const { DatesAnswer, walletReason } = await import("../src/core/date-search.js");
    const inputOf = (texts: readonly string[]) => {
      const input = new ShareInput({ decodeEntry: "Decode" });
      input.add(texts);
      return input;
    };
    return {
      ...restore,
      restorer: new restore.ShareRestore(nodeSharePlatform),
      writeShare,
      inputOf,
      ShareUnmasking,
      DatesAnswer,
      walletReason,
    };
  }

  /** The second share in colours with the elements at `marks` unreadable. */
  async function marked(marks: readonly number[]): Promise<string> {
    const { writeShare } = await modules();
    const parts = writeShare(second, "colors").split(" ");
    for (const place of marks) parts[place] = "?";
    return parts.join(" ");
  }

  async function maskedSet() {
    const { restorer, inputOf } = await modules();
    const read = await restorer.read(inputOf(MASKED_SHARES));
    if (read.kind !== "complete") throw new Error("Expected complete shares.");
    return read;
  }

  it("unmasks the phrases with the phrase held, the backup and the repairs", async () => {
    const { ShareRestore, ShareUnmasking, DatesAnswer } = await modules();
    const read = await maskedSet();
    const dates = DatesAnswer.parse("23-09-2026", { patterns: true });
    const unmasking = new ShareUnmasking({ mode: "seedshift", dates });
    const result = await ShareRestore.phrases(unmasking, [read.set], read.places);
    expect(result.kind).toBe("phrases");
    if (result.kind !== "phrases") return;
    expect(result.phrases.map((phrase) => phrase.mnemonic)).toEqual([TEST_PHRASE]);
    expect(result.phrases[0]!.held).toBe(MASKED);
    expect(result.phrases[0]!.backup).toEqual({ form: "english", text: MASKED });
    expect(result.phrases[0]!.repairs).toEqual([]);
    expect(result.sets).toEqual([read.set]);
    expect(result.listed).toEqual([TEST_PHRASE]);
  });

  it("says why no phrase is the wallet's, with the dates searched", async () => {
    const { ShareRestore, ShareUnmasking, DatesAnswer } = await modules();
    const { ShareSet } = await import("../src/sskr/share-set.js");
    const read = await maskedSet();
    const whole = new ShareUnmasking({
      mode: "seedshift",
      dates: DatesAnswer.parse("23-09-2026", { patterns: true }),
      walletCheck: noWallet,
    });
    expect(whole.searchedCombinations).toBeUndefined();
    expect(await ShareRestore.phrases(whole, [read.set], read.places)).toEqual({
      kind: "mismatch",
      message: ShareSet.walletMismatch(1),
    });
    const searched = new ShareUnmasking({
      mode: "seedshift",
      dates: DatesAnswer.parse("23-09-202?", { patterns: true }),
      walletCheck: noWallet,
    });
    expect(searched.searchedCombinations).toBe(10);
    expect(await ShareRestore.phrases(searched, [read.set], read.places)).toEqual({
      kind: "mismatch",
      message: "None of the 10 date combinations gives the wallet given.",
    });
  });

  it("refuses more dates than the phrase of a set takes", async () => {
    const { ShareRestore, ShareUnmasking, DatesAnswer } = await modules();
    const read = await maskedSet();
    const dates = DatesAnswer.parse("01-01-2001 02-02-2002 03-03-2003 04-04-2004 05-05-2005", {
      patterns: true,
    });
    const result = await ShareRestore.phrases(
      new ShareUnmasking({ mode: "seedshift", dates }),
      [read.set],
      read.places,
    );
    expect(result).toEqual({ kind: "dates", message: dates.tooManyFor(12) });
  });

  it("decides a search from the read alone, and names its extent for a refusal", async () => {
    const { releaseRead, restorer, searchDecision, inputOf } = await modules();
    const { RepairReport } = await import("../src/sskr/repair-report.js");
    const work = { combinations: 10, secondsEach: 0.001 };
    const complete = await maskedSet();
    // Complete shares restore one phrase, whose date search is all there is to time.
    expect(searchDecision(complete, work)).toEqual({
      notice: RepairReport.dateSearchNotice(work, 1),
    });
    expect(searchDecision(complete, undefined)).toEqual({});
    const read = await restorer.read(inputOf([first, await marked([5, 7])]));
    if (read.kind !== "marked") throw new Error("Expected marked shares.");
    expect(searchDecision(read, work, { shares: 1 })).toEqual({
      question: read.report.searchQuestion(work),
    });
    expect(read.report.searchExtent()).toBe(
      `The search takes 65,536 checks, ${read.report.duration()}.`,
    );
    releaseRead(read);
  });

  /**
   * Counts the wipes of every plan of marked shares made until `restore` is called: one entry per
   * plan, in the order they were made.
   */
  async function countWipes() {
    const { JointRepair } = await import("../src/sskr/joint-repair.js");
    const wipes: number[] = [];
    // oxlint-disable-next-line typescript/unbound-method -- the spy calls it on its own instance
    const plan = JointRepair.prototype.plan;
    const spy = vi.spyOn(JointRepair.prototype, "plan").mockImplementation(async function (
      this: InstanceType<typeof JointRepair>,
      ...args: Parameters<typeof plan>
    ) {
      const made = await plan.apply(this, args);
      const index = wipes.push(0) - 1;
      return {
        ...made,
        wipe: () => {
          wipes[index]! += 1;
          made.wipe();
        },
      };
    });
    return { wipes, restore: () => spy.mockRestore() };
  }

  it("wipes the plan of a search that is not made", async () => {
    const { releaseRead, restorer, inputOf } = await modules();
    const { wipes, restore } = await countWipes();
    try {
      const texts = [first, await marked([5, 7])];
      // A restore that stops with its question wipes the plan it does not search.
      const question = await restorer.restore({
        input: inputOf(texts),
        mode: "direct",
        confirmed: false,
        limits: { shares: 1 },
      });
      expect(question.kind).toBe("question");
      expect(wipes).toEqual([1]);
      // A read released, as the command line releases one whose search was declined.
      const read = await restorer.read(inputOf(texts));
      releaseRead(read);
      expect(wipes).toEqual([1, 1]);
      // Complete shares keep nothing for a search.
      releaseRead(await maskedSet());
      expect(wipes).toEqual([1, 1]);
    } finally {
      restore();
    }
  });

  it("wipes a plan made inside a watch that then rejects", async () => {
    const { restorer, inputOf } = await modules();
    const { wipes, restore } = await countWipes();
    try {
      // As a Ctrl+C read just after the assessment's last turn: the step ends, the watch throws.
      const late = async <T>(step: (signal: AbortSignal | undefined) => Promise<T>): Promise<T> => {
        await step(undefined);
        throw new Error("Stopped after the assessment.");
      };
      await expect(restorer.read(inputOf([first, await marked([5, 7])]), late)).rejects.toThrow(
        "Stopped after the assessment.",
      );
      expect(wipes).toEqual([1]);
    } finally {
      restore();
    }
  });

  it("names every option that allows a search it refuses", async () => {
    const { restorer, inputOf, releaseRead } = await modules();
    const { allowedBy } = await import("../src/cli/search-consent.js");
    const read = await restorer.read(inputOf([first, await marked([5, 7])]));
    if (read.kind !== "marked") throw new Error("Expected marked shares.");
    const work = { combinations: 10, secondsEach: 0.001 };
    expect(allowedBy(read.report.searchExtent(work), [["max-tries", 65_536]])).toBe(
      `The search takes 65,536 checks, ${read.report.duration(work)}. Allow it with --max-tries 65536.`,
    );
    expect(
      allowedBy(read.report.searchExtent(work), [
        ["max-tries", 65_536],
        ["max-candidates", 10],
      ]),
    ).toBe(
      `The search takes 65,536 checks, ${read.report.duration(work)}. Allow it with --max-tries 65536 and --max-candidates 10.`,
    );
    releaseRead(read);
  });

  it("decides a repair's refusal and a rewrite alone in the library", async () => {
    const { ShareRestore, SEEDSHIFT_REPAIR_NEEDS_WALLET, inputOf } = await modules();
    expect(ShareRestore.repairRefusal("seedshift", false)).toBe(SEEDSHIFT_REPAIR_NEEDS_WALLET);
    expect(ShareRestore.repairRefusal("seedshift", true)).toBeUndefined();
    expect(ShareRestore.repairRefusal("direct", false)).toBeUndefined();
    const complete = inputOf([first, second]);
    expect(ShareRestore.rewritesOnly(complete, false)).toBe(true);
    // A wallet check restores the phrase, and marked shares are repaired: neither only rewrites.
    expect(ShareRestore.rewritesOnly(complete, true)).toBe(false);
    expect(ShareRestore.rewritesOnly(inputOf([first, await marked([5])]), false)).toBe(false);
  });

  it("repairs each share on its own when too few are typed", async () => {
    const { restorer, inputOf, writeShare } = await modules();
    const fingerprintOf = () => "00000000";
    const lone = [await marked([5])];
    const few = await restorer.restore({ input: inputOf(lone), mode: "direct", confirmed: true });
    if (few.kind !== "few") throw new Error("Expected too few shares.");
    expect(
      await restorer.repair({
        input: inputOf(lone),
        mode: "direct",
        confirmed: true,
        fingerprintOf,
      }),
    ).toEqual({
      kind: "shares",
      shares: [
        {
          number: 1,
          text: writeShare(second, "colors"),
          format: "colors",
          record: second,
        },
      ],
      form: "colors",
      // The element at index 5, the sixth, filled in from the share's own checks.
      repairs: [
        {
          share: 1,
          elements: [
            { position: 6, value: writeShare(second, "colors").split(" ")[5], guess: false },
          ],
        },
      ],
      lines: [{ kind: "warning", text: few.message }],
      notes: [],
    });
  });

  it("writes no share that nothing settles, nor shares of two sets", async () => {
    const { restorer, inputOf, NO_SHARE_SETTLED, fingerprintOf } = {
      ...(await modules()),
      fingerprintOf: () => "00000000",
    };
    const { ShareInput } = await import("../src/sskr/share-input.js");
    const { unrepairedShare } = await import("../src/sskr/repair.js");
    const unsettled = { shares: [unrepairedShare(first)], unsettled: [{ share: 1, position: 3 }] };
    const none = ShareInput.checkedExport(unsettled, [1], undefined);
    expect(none.kind).toBe("none");
    const leftOut = none.written.leftOutMessages();
    expect(leftOut).toEqual([
      "Share 1 cannot be settled and is left out: read more of it, or use another copy.",
    ]);
    const other = vectors.deterministic[1]!.shares[0]!;
    const mixed = { shares: [first, other].map(unrepairedShare), unsettled: [] };
    expect(ShareInput.checkedExport(mixed, [1, 2], undefined)).toMatchObject({
      kind: "trouble",
      trouble: {
        message: ShareInput.looseSetTrouble([
          { place: 1, ur: first },
          { place: 2, ur: other },
        ])!.message,
      },
    });
    // A repair says so in one message: why none is written, then why each is left out.
    const spy = vi.spyOn(ShareInput, "checkedExport").mockReturnValue(none);
    try {
      expect(
        await restorer.repair({
          input: inputOf([first, second]),
          mode: "direct",
          confirmed: true,
          fingerprintOf,
        }),
      ).toEqual({ kind: "trouble", message: [NO_SHARE_SETTLED, ...leftOut].join(" "), lines: [] });
    } finally {
      spy.mockRestore();
    }
  });

  it("gives each set that fits once, with the fingerprint of its unmasked phrase", async () => {
    const { ShareRestore } = await modules();
    const { unrepairedShare } = await import("../src/sskr/repair.js");
    const { RepairReport } = await import("../src/sskr/repair-report.js");
    const plain = {
      mnemonic: TEST_PHRASE,
      shares: [first, second].map(unrepairedShare),
      unsettled: [],
    };
    const masked = { mnemonic: MASKED, shares: MASKED_SHARES.map(unrepairedShare), unsettled: [] };
    // Two phrases of the masked set, as a date search may find, then the plain set.
    const phrases = [
      { set: masked, mnemonic: TEST_PHRASE },
      { set: masked, mnemonic: "another phrase" },
      { set: plain, mnemonic: TEST_PHRASE },
    ];
    const places = [2, 3];
    const variants = ShareRestore.variants(phrases, places, "ur", (mnemonic) => `of ${mnemonic}`);
    expect(variants).toEqual(
      [masked, plain].map((set) => ({
        fingerprint: `of ${TEST_PHRASE}`,
        shares: set.shares.map((share, index) => ({
          number: places[index],
          text: share.ur,
          format: "ur",
          record: share.ur,
        })),
        repairs: RepairReport.repairs(set, places),
      })),
    );
  });

  it("refuses what a restore and a repair cannot do", async () => {
    const {
      restorer,
      inputOf,
      DatesAnswer,
      walletReason,
      SEEDSHIFT_REPAIR_NEEDS_WALLET,
      WALLET_CHECK_NEEDS_THRESHOLD,
    } = await modules();
    const fingerprintOf = () => "00000000";
    // Guessed dates need the wallet that tells the right ones.
    expect(
      await restorer.restore({
        input: inputOf(MASKED_SHARES),
        mode: "seedshift",
        dates: DatesAnswer.parse("23-09-202?", { patterns: true }),
        confirmed: true,
      }),
    ).toEqual({ kind: "trouble", message: walletReason("seedshift"), lines: [] });
    expect(
      await restorer.repair({
        input: inputOf(MASKED_SHARES),
        mode: "seedshift",
        dates: DatesAnswer.parse("23-09-2026", { patterns: true }),
        confirmed: true,
        fingerprintOf,
      }),
    ).toEqual({ kind: "trouble", message: SEEDSHIFT_REPAIR_NEEDS_WALLET, lines: [] });
    const few = await restorer.restore({
      input: inputOf([first]),
      mode: "direct",
      confirmed: true,
    });
    expect(few.kind).toBe("few");
    const checked = await restorer.repair({
      input: inputOf([first]),
      mode: "direct",
      walletCheck: noWallet,
      confirmed: true,
      fingerprintOf,
    });
    expect(checked).toMatchObject({ kind: "trouble", message: WALLET_CHECK_NEEDS_THRESHOLD });
  });
});

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

  it("the command line takes a word in capitals as the menu does", () => {
    const lines: string[] = [];
    const log = vi.spyOn(console, "log").mockImplementation((line: string) => lines.push(line));
    try {
      runTable({ word: "Abandon" });
    } finally {
      log.mockRestore();
    }
    expect(lines).toContain("unicode hex: 7684");
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
        "DateSearch",
        "DatesAnswer",
        "EncodedBackup",
        "KeptShares",
        "MissingCodes",
        "OpenedCandidateList",
        "PassphraseProtection",
        "ReEncoding",
        "RestoredShares",
        "Share",
        "ShareSet",
        "ShareUnmasking",
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
    const { splitSskrMnemonic } = await import("../src/sskr/shares.js");
    const phrase = "abandon ".repeat(11) + "about";
    const [first, second] = [
      await splitSskrMnemonic(phrase, 2, 3),
      await splitSskrMnemonic(phrase, 2, 3),
    ];
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
    expect(() => EncodedForm.of("json" as never)).toThrow("Unsupported encoded format: json.");
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

describe("S059: the menu's wallet answer is the command line that gives the same evidence", () => {
  it("reads back every way of the wallet question, and a place that is not the first", () => {
    const first = { ...FIRST_RECEIVING_LOCATION };
    const cases: WalletEvidence[] = [
      { kind: "master-fingerprint", value: "73c5da0a", network: "mainnet" },
      {
        kind: "address",
        value: "bc1qcr8te4kr609gcawutmrza0j4xv80jy8z306fyu",
        profiles: bitcoinProfiles,
        location: first,
        addresses: 20,
      },
      {
        kind: "address",
        value: "bc1qcr8te4kr609gcawutmrza0j4xv80jy8z306fyu",
        profiles: ["native-segwit"],
        location: { ...first, account: 1, index: 3 },
        addresses: 2,
      },
      {
        kind: "coin-address",
        coin: "ethereum",
        value: "0x9858EfFD232B4033E47d90003D41EC34EcaEda94",
        location: { account: 0, branch: 0, index: 0 },
        addresses: 5,
      },
    ];
    for (const evidence of cases)
      expect(walletEvidence(parseArguments(walletEvidenceArguments(evidence)))).toEqual(evidence);
  });
});

describe("S065: Dash Platform's account and branch paths follow one DIP17 rule", () => {
  it("builds the branch from the account path, with DIP9's purpose", () => {
    const dash = coinById("dash");
    expect(dash.purposeOf("dash-platform")).toBe(9);
    expect(dash.accountPathOf("dash-platform", 5, 2)).toBe("m/9'/5'/17'/2'");
    expect(dash.branchPathOf("dash-platform", 5, { account: 2, branch: 0, index: 7 })).toBe(
      "m/9'/5'/17'/2'/0'",
    );
    expect(dash.accountPathOf("p2pkh", 5, 0)).toBe("m/44'/5'/0'");
  });
});

describe("S064: one value type of Bech32 prefixes", () => {
  it("tells a coin's strings and their network, and refuses a foreign prefix with the separator", () => {
    const prefixes = new Bech32Prefixes("bc", "tb");
    expect(prefixes.starts).toEqual(["bc1", "tb1"]);
    expect([prefixes.testnetOf("bc"), prefixes.testnetOf("tb"), prefixes.testnetOf("ltc")]).toEqual(
      [false, true, undefined],
    );
    // A Bech32m string of another prefix that begins as Dash Platform's does.
    const foreign = bech32m.encode("dash1x", bech32m.toWords(new Uint8Array(21)));
    expect(() => coinById("dash").parse(foreign)).toThrow("it is not an address of Dash");
  });
});

describe("S070: one refusal of secrets given beside --ask-secrets", () => {
  it("names the options given, by their flags", () => {
    expect(() =>
      assertAskedNotGiven({ "ask-secrets": true, mnemonic: "x", date: ["01-01-2000"] }, [
        "mnemonic",
        "mnemonic-file",
        "date",
      ]),
    ).toThrow("--ask-secrets cannot be combined with --mnemonic or --dates.");
    expect(() => assertAskedNotGiven({ mnemonic: "x" }, ["mnemonic"])).not.toThrow();
    expect(flagOf("date")).toBe("--dates");
  });
});

describe("S069: one reader of the wallet options", () => {
  it("refuses a place without a wallet, and reads the wallet, its place and passphrase together", () => {
    expect(() => givenWallet({ network: "testnet" })).toThrow(
      "--network applies to a wallet given as an option",
    );
    const wallet = givenWallet({ "master-fingerprint": "73c5da0a" });
    expect(wallet.evidence).toEqual({
      kind: "master-fingerprint",
      value: "73c5da0a",
      network: "mainnet",
    });
    expect(wallet.place.location).toEqual(FIRST_RECEIVING_LOCATION);
    expect(wallet.passphrase).toBe("");
    expect(maxResultsOf({})).toBe(MAX_SHOWN_MATCHES);
  });
});

describe("S068: one question after a date search, one wording of each wallet answer", () => {
  it("types the wallet answers only where they are built", () => {
    const typedIn = readdirSync("src", { recursive: true, encoding: "utf8" })
      .filter((file) => file.endsWith(".ts"))
      .filter((file) => {
        const source = readFileSync(join("src", file), "utf8");
        return /"(?:Change the wallet|Check them against the wallet)"/u.test(source);
      });
    expect(typedIn).toEqual([join("cli", "ask.ts")]);
    expect(changeWalletAnswer("wallet")).toEqual({
      label: "Change the wallet",
      note: "the fingerprint or the address",
      value: "wallet",
    });
    expect(checkWalletAnswer(1, "without a list").note).toBe("without a list");
  });
});

describe("S071: every option list is typed once", () => {
  it("lists every option that names a file or a folder as exactly one input or output", () => {
    const options = new Set(Object.values(commandOptions).flat());
    const lists: readonly (readonly string[])[] = [FILE_INPUTS, FILE_OUTPUTS, FOLDER_OUTPUTS];
    for (const key of options) {
      const named = /\b(?:file|folder)\b/u.test(optionLabel(key));
      const listed = lists.filter((list) => list.includes(key)).length;
      expect([key, listed]).toEqual([key, named ? 1 : 0]);
    }
    for (const key of lists.flat()) expect(options.has(key)).toBe(true);
  });

  it("builds the wallet options from the evidence options and the place", () => {
    expect([...WALLET_EVIDENCE_OPTIONS].sort()).toEqual(
      [
        "bitcoin-address",
        "coin-address",
        "coin",
        "master-xpub",
        "account-xpub",
        "compressed-public-key",
        "master-fingerprint",
        "wif-file",
        "network",
        "bitcoin-profile",
        "account",
        "branch",
        "index",
        "scan-gap",
        "bip39-passphrase-file",
      ].sort(),
    );
    expect(() =>
      givenWallet({ "master-fingerprint": "73c5da0a", "bitcoin-profile": "bip84" }),
    ).toThrow("--bitcoin-profile places an address, a key or a WIF; a master key has no place.");
    expect(() =>
      givenWallet({ coin: "litecoin", "coin-address": "x", "bitcoin-profile": "bip84" }),
    ).toThrow("--bitcoin-profile is for Bitcoin evidence");
  });
});

describe("S072: a share file reads as a typed answer does", () => {
  const { deterministic } = JSON.parse(readFileSync("vectors/sskr-v1.json", "utf8")) as {
    deterministic: { shares: string[] }[];
  };
  const [first, second, third] = deterministic[0]!.shares as [string, string, string];

  it("splits at ;, joins a wrapped share and refuses a seed phrase one word per line", async () => {
    const directory = await mkdtemp(join(tmpdir(), "mnemocode-share-file-"));
    try {
      const joined = join(directory, "joined.txt");
      await writeFile(joined, `${first};${second}\n`);
      const wrapped = join(directory, "wrapped.txt");
      const cut = Math.floor(third.length / 2);
      await writeFile(wrapped, `${third.slice(0, cut)}\n${third.slice(cut)}\n`);
      const read = await givenShares({ "share-file": [joined, wrapped] });
      expect(read.texts()).toEqual([first, second, third]);
      const phrase = join(directory, "phrase.txt");
      await writeFile(phrase, `${"abandon\n".repeat(11)}about\n`);
      await expect(givenShares({ "share-file": phrase })).rejects.toThrow(
        "The file holds a seed phrase in words, not a Shamir share",
      );
      const blank = join(directory, "blank.txt");
      await writeFile(blank, " \n;\n");
      await expect(givenShares({ "share-file": blank })).rejects.toThrow(
        "Provide at least one complete share",
      );
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
});

describe("S073: the share separator is one constant", () => {
  it("names the separator in the prompts, the heir sheet and the too-few refusal", () => {
    expect(SHARE_ANSWER_HINT).toBe(
      `separate shares with ${SHARE_SEPARATOR}, ? for each unreadable code or digit`,
    );
    const input = new ShareInput({ decodeEntry: "Decode" });
    expect(input.sharesOfText(`a${SHARE_SEPARATOR}b\nc`)).toEqual(["a", "b", "c"]);
  });
});

describe("S075: one library split of a backup", () => {
  const phrase = `${"abandon ".repeat(11)}about`;
  const dated = [parseDate("23-09-2026")];

  it("splits the phrase that the mode holds, and refuses a mode without shares", async () => {
    const split = new ShareSplit(nodeSharePlatform, nodeFillRandom);
    const masked = await split.splitBackup({
      mnemonic: `  ${phrase.toUpperCase()} `,
      mode: "seedshift",
      dates: dated,
      threshold: 2,
      count: 3,
    });
    expect(masked.original).toBe(phrase);
    expect(masked.held).toBe(Masking.of("seedshift").held(phrase, dated));
    expect(masked.held).not.toBe(phrase);
    expect(await combineSskrShares(masked.records.slice(1))).toBe(masked.held);
    const direct = await split.splitBackup({
      mnemonic: phrase,
      mode: "direct",
      dates: [],
      threshold: 2,
      count: 2,
    });
    expect(direct.held).toBe(phrase);
    await expect(
      split.splitBackup({
        mnemonic: phrase,
        mode: "seedshift-legacy" as never,
        dates: dated,
        threshold: 2,
        count: 3,
      }),
    ).rejects.toThrow(SPLIT_MODES_ONLY);
  });
});

describe("S076: Encode keeps the library's encoding", () => {
  it("says whether the last word was replaced", () => {
    const phrase = `${"abandon ".repeat(11)}about`;
    const dated = [parseDate("23-09-2026")];
    const kept = EncodedBackup.encode(phrase, dated, "indexes", "seedshift-legacy");
    const asked = EncodedBackup.encode(phrase, dated, "indexes", "seedshift-legacy", {
      validLastWord: true,
    });
    expect(kept.replaced).toBe(false);
    expect(asked.replaced).toBe(asked.lastWordChanged);
    expect(asked.backup.mode).toBe(asked.replaced ? "seedshift-legacy-valid" : "seedshift-legacy");
  });
});

describe("S074: the share numbers are read within SSKR's bounds", () => {
  it("refuses a threshold or a count outside them before anything is asked", async () => {
    const { MIN_SHARES, MAX_SHARES } = ShareSetChoice;
    await expect(
      runSskrSplit({ threshold: String(MIN_SHARES - 1), shares: "3", mnemonic: "x" }),
    ).rejects.toThrow(String(MAX_SHARES));
    await expect(
      runSskrSplit({ threshold: "2", shares: String(MAX_SHARES + 1), mnemonic: "x" }),
    ).rejects.toThrow(String(MAX_SHARES));
    await expect(runSskrSplit({ threshold: "3", shares: "2", mnemonic: "x" })).rejects.toThrow(
      "A split needs a threshold",
    );
  });
});

describe("S078: the rules of printable cards have one owner", () => {
  it("refuses a QR code on separate colour cards without drawing", () => {
    expect(() => assertSheetQr({ kind: "colors", pageSize: "business", cardQr: true })).toThrow(
      "A QR code is printed on a sheet only.",
    );
    expect(() => assertSheetQr({ kind: "colors", pageSize: "a6", cardQr: true })).not.toThrow();
    expect(() => assertSheetQr({ kind: "sskr", pageSize: "business", cardQr: true })).not.toThrow();
  });

  it("draws the dry run with the longest sample phrase in the form of the codes", () => {
    expect(LONGEST_SAMPLE_WORDS).toBe(Math.max(...SAMPLE_WORD_COUNTS));
    expect(() => new CardPreviewClass(nodeCardRenderer, { colorForm: "indexes" })).toThrow(
      "Colour cards are not written as indexes.",
    );
    // Unicode codes have cards, which print them.
    const unicode = new CardPreviewClass(nodeCardRenderer, { colorForm: "unicode" });
    expect(unicode.content(CardPreviewClass.templates[0]!).labels).toBeDefined();
    const preview = new CardPreviewClass(nodeCardRenderer, { colorForm: "colors-unicode" });
    const colors = CardPreviewClass.templates.find((template) => template.kind === "colors")!;
    const content = preview.content(colors);
    expect(content.kind === "colors" && content.payload.startsWith("#")).toBe(false);
  });
});

describe("S079: one catalog of designs and one reader of their numbers", () => {
  it("keeps the ids, numbers them alike for every caller and lists every design once", () => {
    // Recorded commands name these ids: they never change.
    expect(TEMPLATE_CATALOG.map((entry) => entry.id)).toEqual([
      "business-architect",
      "business-it",
      "business-estate",
      "business-diagonal",
      "business-contact",
      "business-curves",
      "business-facets",
      "business-mixed",
      "material-vehicle",
      "material-enclosure",
      "material-tile",
      "material-switch",
      "material-kitchen",
    ]);
    expect(cardTemplates.map((template) => template.id)).toEqual(
      TEMPLATE_CATALOG.map((entry) => entry.id),
    );
    TEMPLATE_CATALOG.forEach((entry, index) => {
      const number = String(index + 1);
      expect(resolveTemplateId(number, "colors")).toBe(entry);
      expect(selectTemplate(number, "colors").id).toBe(entry.id);
      expect(selectTemplate(entry.id).style).toBe(entry.style);
    });
    expect(findTemplate("0")).toBeUndefined();
    expect(findTemplate("01")).toBeUndefined();
    expect(() => resolveTemplateId("business-nowhere")).toThrow("is unknown or incompatible");
    expect(DEFAULT_TEMPLATE_ID).toBe(selectTemplate().id);
  });

  it("gives the employer's sector by the style of a design, not by its place", () => {
    expect(sectorForStyle(selectTemplate("business-it").style)).toBe("it");
    expect(sectorForStyle(selectTemplate("business-architect").style)).toBe("architecture");
    expect(sectorForStyle(selectTemplate("business-estate").style)).toBe("property");
    for (const entry of TEMPLATE_CATALOG.slice(3))
      expect(sectorForStyle(entry.style)).toBeUndefined();
    expect(sectorForStyle("1")).toBeUndefined();
    expect(sectorForStyle(undefined)).toBeUndefined();
  });
});

describe("S080: one list of the styles of the designs", () => {
  it("derives the business styles, the texts of a design and the share card styles from it", async () => {
    expect(businessStyles).toEqual(BUSINESS_STYLES.filter((style) => style !== "mixed"));
    expect(designTexts(false)).toEqual(["referenceLabel"]);
    expect(designTexts(true)).toEqual(["studioName", "slogan", "subtitle", "footer"]);
    for (const entry of TEMPLATE_CATALOG) expect(designOfStyle(entry.style)).toBe(entry);
    expect(designOfStyle("business-it")).toBeUndefined();
    await expect(
      ShareCardSet.create(nodeCardRenderer, [], { style: "nowhere" as never }),
    ).rejects.toThrow("Unsupported SSKR card style.");
  });
});

describe("S082: one rule for card settings without a card output", () => {
  const NEED_OUTPUT =
    "Card settings require a PDF file, an image output folder or an individual-card output folder.";

  it("refuses them alike in Encode and in the commands of shares", () => {
    expect(() => validateCardOptions({ title: "Cards" }, "colors")).toThrow(NEED_OUTPUT);
    expect(() => exportOptions({ template: "business-it" }, "colors")).toThrow(NEED_OUTPUT);
    expect(exportOptions({}, "colors")).toBeUndefined();
    expect(cardOutputs({ pdf: "a.pdf" })).toEqual({ sheets: true, cards: false });
  });

  it("writes card files as PDF unless an image format is given", () => {
    expect(cardFileFormat({})).toBe(DEFAULT_DOCUMENT_FORMAT);
    expect(cardFileFormat({ "image-format": "jpeg" })).toBe("jpg");
  });
});

describe("S083: each option of Encode belongs to one of its modes", () => {
  it("splits Encode's options into three groups that cover them once", () => {
    const groups = [ENCODE_SHARED_OPTIONS, ENCODE_PLAIN_ONLY_OPTIONS, ENCODE_SSKR_ONLY_OPTIONS];
    const listed: string[] = groups.flat();
    expect(new Set(listed).size).toBe(listed.length);
    expect([...listed, "sskr"].sort()).toEqual([...commandOptions.encode].sort());
    // sskr-split names the form of the shares --format; every other option of it is SSKR's too.
    const sskr = new Set<string>([...ENCODE_SHARED_OPTIONS, ...ENCODE_SSKR_ONLY_OPTIONS]);
    for (const key of commandOptions["sskr-split"])
      expect([key, sskr.has(key)]).toEqual([key, true]);
  });
});

describe("S084: one source of the fingerprint lines", () => {
  it("builds the plain lines and notes from FINGERPRINT_NOTE and PHRASE_WORDS", () => {
    expect(plainFingerprintLine("original", "73c5da0a")).toBe(
      "Original BIP32 master fingerprint (empty BIP39 passphrase): 73c5da0a",
    );
    expect(plainFingerprintLine("encoded", "0d05289e", true)).toBe(
      "Encoded BIP32 master fingerprint of the masked phrase (empty BIP39 passphrase): 0d05289e",
    );
    expect(FINGERPRINT_HINT).toBe("Fingerprint uses an empty BIP39 passphrase.");
    expect(PHRASE_WORDS.encodedFingerprint).toBe("Encoded fingerprint (of the masked phrase)");
    expect(Masking.of("direct").encodedFingerprintLabel).toBe("Encoded fingerprint");
  });
});

describe("S085: one Stop that cancels, one question and one answer for more shares", () => {
  it("leaves the Stop that cancels to askOrCancel", () => {
    const stops = readdirSync("src", { recursive: true, encoding: "utf8" })
      .filter((file) => file.endsWith(".ts"))
      .filter((file) =>
        /=== "stop"\) throw new InputCancelledError\(\)/u.test(
          readFileSync(join("src", file), "utf8"),
        ),
      );
    expect(stops).toEqual([]);
    expect(WHAT_NOW).toBe("What now?");
    expect(addMoreShares(1)).toEqual({ label: "Add more shares", value: 1 });
  });
});

describe("S087: the rows around a result are measured as they are printed", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("counts a question, the closing lines and a coloured heading by their lines", () => {
    const three = [
      { label: "Type the words again", value: 1 },
      { label: "Change the wallet", note: "the fingerprint or the address", value: 2 },
      { label: "Done", value: 3 },
    ];
    // A blank line, the question, three choices, a blank line, the key hint, the cursor's row.
    expect(listQuestionRows(WHAT_NOW, three, "stops")).toBe(8);
    expect(closingRows()).toBe(2);
    vi.stubEnv("CLICOLOR_FORCE", "1");
    vi.stubEnv("NO_COLOR", "");
    // A blank line, the title and three facts: the hand count left out one of them.
    expect(
      rowsOf(
        resultHeaderLines("Date recovery", [
          ["A", "1"],
          ["B", "2"],
          ["C", "3"],
        ]),
      ),
    ).toBe(5);
    const message = "word ".repeat(40).trim();
    expect(rowsOf(noticeLines(message, "warning"))).toBe(markedLines(message, "warning").length);
    expect(markedLines(message, "warning").length).toBeGreaterThan(1);
  });
});

describe("S088: one rule for an empty typed answer", () => {
  it("gives the text, the fallback, a left-out answer or one hint", () => {
    expect(enteredAnswer("x", { leave: "back" })).toEqual({ kind: "text", text: "x" });
    expect(enteredAnswer("", { fallback: "20", leave: "back" })).toEqual({
      kind: "text",
      text: "20",
    });
    expect(enteredAnswer("", { optional: "random", leave: "back" })).toEqual({ kind: "left-out" });
    expect(enteredAnswer("", { what: "it", leave: "back" })).toEqual({
      kind: "refused",
      reason: "Type it, or press Esc to go back.",
    });
    expect(typeHint(undefined, "stop")).toBe("Type an answer, or press Ctrl+C to stop.");
    expect(NOT_UTF8).toBe("The answer is not valid UTF-8 text.");
  });
});

describe("S089: one tally of the wallet's matches", () => {
  it("counts the matches and keeps the first warning", () => {
    const tally = new MatchTally();
    tally.add(undefined);
    tally.add({ matched: false });
    tally.add({ matched: true, warning: "first" });
    tally.add({ matched: true, warning: "second" });
    expect([tally.matched, tally.warning]).toEqual([2, "first"]);
  });
});

describe("S090: one owner of the rules of output paths", () => {
  it("refuses no path for every output, and a folder that could not be made", async () => {
    expect(isUnusableOutputPath(" ")).toBe(true);
    expect(isUnusableOutputPath("-")).toBe(true);
    expect(isUnusableOutputPath("./-")).toBe(false);
    await expect(validateOutputPaths({ "images-dir": "-" })).rejects.toThrow(
      "The image output folder needs a path",
    );
    const root = await mkdtemp(join(tmpdir(), "mnemocode-s090-"));
    try {
      const file = join(root, "file.txt");
      await writeFile(file, "");
      await expect(preflightFolderDestination(join(file, "cards"))).rejects.toThrow(
        "A file stands where a folder of this name should be",
      );
      await expect(
        preflightFolderDestination(join(root, "a", "b", "cards")),
      ).resolves.toBeUndefined();
      // A folder named like a file that an export writes is refused, whatever its case.
      for (const name of ["cards.pdf", "pages.PNG", "pages.jpg", "pages.jpeg/"])
        await expect(preflightFolderDestination(join(root, name)), name).rejects.toThrow(
          "A new folder needs a name without .",
        );
      await expect(preflightFolderDestination(join(root, "cards.v2"))).resolves.toBeUndefined();
      // A file named like a folder that stands in its way: the message says so.
      await mkdir(join(root, "taken.pdf"));
      await expect(preflightFileDestination(join(root, "taken.pdf"), true)).rejects.toThrow(
        "A folder has this name; give the file another name, or a name inside that folder.",
      );
      expect(await entryAt(file)).toBe("other");
      await expect(absentPath(" ", "taken")).rejects.toThrow("A new folder needs a path");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});

describe("S091: the facts of each command in one table", () => {
  it("derives the private-screen commands and the listed ones from it", () => {
    expect([...PRIVATE_SCREEN_COMMANDS].sort()).toEqual(
      [
        "decode",
        "encode",
        "re-encode",
        "recover-date",
        "recover-word",
        "sskr-combine",
        "sskr-export",
        "sskr-split",
      ].sort(),
    );
    const unlisted = Object.entries(COMMAND_FACTS).filter(([, facts]) => !facts.listed);
    expect(unlisted.map(([name]) => name)).toEqual(["sskr-split"]);
    expect(Object.keys(COMMAND_FACTS).sort()).toEqual(Object.keys(commandOptions).sort());
  });
});

describe("S092: the shapes of terminal lines in the style leaf", () => {
  it("builds the heading, a fact, a marked warning and the cancel line once", () => {
    const plain = { isTTY: false };
    expect(headingLine(plain, "Self-test")).toBe("MnemoCode · Self-test");
    expect(factLine(plain, "Protection", "no network", 11)).toBe("  Protection  no network");
    expect(styledMarkedLinesForTest(plain, "Careful.", "warning")).toEqual(["! Careful."]);
    expect(styledNoticeLines(plain, "Careful.", "warning")).toEqual(["Careful."]);
    expect(new InputCancelledError().message).toBe(CANCELLED_MESSAGE);
    expect(CANCELLED_EXIT_CODE).toBe(130);
  });
});

describe("S093: one owner of the UTF-8 rules", () => {
  it("passes on whole valid characters only and steps over any byte", async () => {
    const bytes = [0xc0, 0x41, 0xff, 0x80, 0x42, 0xe2, 0x82, 0xac];
    const source = async (): Promise<number | undefined> => bytes.shift();
    const reader = validCharacters(source);
    const read: number[] = [];
    for (let byte = await reader.next(); byte !== undefined; byte = await reader.next())
      read.push(byte);
    expect(read).toEqual([0x41, 0x42, 0xe2, 0x82, 0xac]);
    expect(reader.leftOut()).toBe(true);
    expect([characterLength(0xc0), characterLength(0xe2), characterSize(0xff)]).toEqual([0, 3, 1]);
    expect(isContinuation(0x80)).toBe(true);
    expect(cursorUp(0) + cursorRight(-1)).toBe("");
  });
});

describe("S095: one gate of colour cards and one check of a card's number", () => {
  it("refuses a dated Unicode card and a card that is not there alike for every family", () => {
    expect(() =>
      // A JavaScript host may pass content of another kind.
      assertColorCards({ kind: "unicode", payload: "" } as never),
    ).toThrow("These cards draw color references");
    expect(() => assertCardIndex(3, 3)).toThrow("There is no card 4: the cards are 1 to 3.");
    expect(() => assertCardIndex(1.5, 3)).toThrow("There is no card");
    expect(() => assertCardIndex(2, 3)).not.toThrow();
  });
});

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
    expect(() => refusalMessage("fault")).toThrow();
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

describe("G1-033: every form of codes is written from the indexes", () => {
  it("writes a result and its indexes alike, whatever its stored words say", () => {
    const result = representMnemonic(zeroEntropyPhrase(12));
    for (const format of ENCODED_FORMATS) {
      const form = EncodedForm.of(format);
      expect(form.write(result)).toBe(form.codes(result.shiftedIndexes));
      // A result whose stored words disagree with its indexes is written from the indexes.
      expect(form.write({ ...result, shiftedEnglish: ["zoo"], unicodeCodePoints: ["0000"] })).toBe(
        form.codes(result.shiftedIndexes),
      );
    }
  });
});

describe("G1-035: one way to cut text and lists into pieces", () => {
  it("cuts exact pieces and refuses a remainder or a width below 1", () => {
    expect(textPieces("abcdef", 2)).toEqual(["ab", "cd", "ef"]);
    expect(textPieces("0a0b", 2, (byte) => Number.parseInt(byte, 16))).toEqual([10, 11]);
    expect(listPieces([1, 2, 3, 4], 2)).toEqual([
      [1, 2],
      [3, 4],
    ]);
    expect(textPieces("", 4)).toEqual([]);
    expect(() => textPieces("abc", 2)).toThrow(RangeError);
    expect(() => listPieces([1, 2, 3], 2)).toThrow(RangeError);
    expect(() => textPieces("ab", 0)).toThrow(RangeError);
  });
});

describe("G1-037: one layout of a raster pixel", () => {
  it("places a pixel's channels as the image's data holds them", () => {
    const image = createRasterImage(3, 2);
    expect(image.data.length).toBe(3 * 2 * RGBA_CHANNELS);
    expect(pixelOffset(image, 2, 1)).toBe((1 * 3 + 2) * RGBA_CHANNELS);
  });
});

describe("G1-031 follow-up: the dates of a pattern are counted by month", () => {
  it("counts every date of the whole pattern, and a February of leap and common years", () => {
    // 0001-01-01 through 9999-12-31: 9,999 years of 365 days and 2,424 leap days.
    expect(datePatternCandidateCount(parseDatePattern("??-??-????"))).toBe(3_652_059);
    // 29 February exists in 2000 and 2004, not in 2001-2003.
    expect(datePatternCandidateCount(parseDatePattern("29-02-200?"))).toBe(3);
    const start = performance.now();
    for (let run = 0; run < 3; run += 1) datePatternCandidateCount(parseDatePattern("??-??-????"));
    // Counted by month it takes milliseconds; date by date it took seconds at every start.
    expect(performance.now() - start).toBeLessThan(500);
  });
});

describe("G1-016 and G1-017: one source of the files of cards and of drawing them", () => {
  it("draws a business card at 1062 x 590 pixels and keeps the facts of each format", () => {
    const points = (millimetres: number): number => (millimetres * POINTS_PER_INCH) / 25.4;
    expect([coveredPixels(points(90)), coveredPixels(points(50))]).toEqual([1062, 590]);
    expect(JPEG_QUALITY).toBe(90);
    expect(DOCUMENT_FORMAT_FACTS.png.transparentPaper).toBe(true);
    expect(DOCUMENT_FORMAT_FACTS.jpg.transparentPaper).toBe(false);
    expect([parseDocumentFormat(""), parseDocumentFormat("jpeg")]).toEqual(["pdf", "jpg"]);
    expect(() => parseDocumentFormat("tiff")).toThrow(
      "Select PDF, PNG or JPEG as the file format.",
    );
    expect(DEFAULT_IMAGE_FORMAT).toBe("png");
  });
});

describe("G1-022: a set of share cards says the layout it resolved to", () => {
  it("gives separate cards for the business size, a sheet for A6, and QR cards when asked", async () => {
    const { deterministic } = JSON.parse(readFileSync("vectors/sskr-v1.json", "utf8")) as {
      deterministic: { shares: string[] }[];
    };
    const shares = deterministic[0]!.shares;
    expect(
      (await ShareCardSet.create(nodeCardRenderer, shares, { style: "it", pageSize: "business" }))
        .layout,
    ).toBe("individual");
    expect(
      (await ShareCardSet.create(nodeCardRenderer, shares, { style: "it", pageSize: "a6" })).layout,
    ).toBe("collection");
    expect(
      (await ShareCardSet.create(nodeCardRenderer, shares, { style: "it", layout: "qr" })).layout,
    ).toBe("qr");
  });
});

describe("G1-026: one reader of how a list file is protected", () => {
  const { age } = JSON.parse(readFileSync("vectors/candidates-v1.json", "utf8")) as {
    age: { refuse: { name: string; file: string }[] };
  };

  it("tells the key of a list file and refuses any other header before a key is asked", async () => {
    const recipient = (await createSessionIdentity()).recipient;
    const plain = Uint8Array.of(1, 2, 3);
    expect(listFileLock(await encryptCandidates(plain, recipient))).toBe("key");
    expect(
      listFileLock(await encryptCandidatesWithPassphrase(plain, "correct horse battery")),
    ).toBe("passphrase");
    for (const { name, file } of age.refuse)
      expect(() => listFileLock(bytesOfHex(file)), name).toThrow(/exactly one|work factor/u);
    expect(() => listFileLock(Uint8Array.of(1, 2, 3))).toThrow("This is not a binary age file.");
    expect(protectionFor({ kind: "none" })).toBeInstanceOf(NoProtection);
  });
});

describe("G1-027: one owner of an opened candidate list", () => {
  const { lists } = JSON.parse(readFileSync("vectors/candidates-v1.json", "utf8")) as {
    lists: {
      name: string;
      passphrase?: string;
      records: { phrase: string; passphrase?: string }[];
      bytes: string;
    }[];
  };

  it("gives each candidate its phrase and the passphrase that the format's rule names", () => {
    for (const list of lists) {
      const plain = bytesOfHex(list.bytes);
      const opened = OpenedCandidateList.fromBytes(plain);
      expect(
        plain.every((byte) => byte === 0),
        list.name,
      ).toBe(true);
      expect(opened.candidates(), list.name).toEqual(
        list.records.map((record) => ({
          phrase: record.phrase,
          passphrase: record.passphrase ?? list.passphrase ?? "",
        })),
      );
      const own = list.records.some((record) => record.passphrase !== undefined);
      expect(opened.passphrases, list.name).toBe(
        own ? "records" : list.passphrase === undefined ? "none" : "list",
      );
      opened.wipe();
      expect(opened.candidates()[0]!.phrase, list.name).toMatch(/^abandon abandon/u);
    }
  });

  it("wipes the bytes of a list that it refuses", () => {
    const damaged = bytesOfHex(lists[0]!.bytes);
    damaged[damaged.length - 1]! ^= 1;
    expect(() => OpenedCandidateList.fromBytes(damaged)).toThrow();
    expect(damaged.every((byte) => byte === 0)).toBe(true);
  });
});

describe("G1-028: a candidate file is refused with why", () => {
  it("tells a damaged file from a key that does not open it", async () => {
    const session = await createSessionIdentity();
    const other = await createSessionIdentity();
    const file = await encryptCandidates(Uint8Array.of(1, 2, 3), session.recipient);
    const refusal = async (key: { identity: string }, bytes: Uint8Array) =>
      decryptCandidates(bytes, key).then(
        () => undefined,
        (error: unknown) => error,
      );
    const wrongKey = await refusal({ identity: other.identity }, file);
    expect(wrongKey).toBeInstanceOf(CandidateFileRefusedError);
    expect((wrongKey as CandidateFileRefusedError).code).toBe("key");
    const changed = Uint8Array.from(file);
    changed[changed.length - 1]! ^= 1;
    const damaged = await refusal({ identity: session.identity }, changed);
    expect((damaged as CandidateFileRefusedError).code).toBe("damaged");
    expect((damaged as Error).message).toMatch(/invalid tag/u);
  });
});

describe("G1-031: the public entries of date patterns hold a pattern to its rules", () => {
  it("refuses a month that no calendar has instead of giving impossible dates", () => {
    const pattern = { key: "k", years: [2026], months: [13], days: [1] };
    expect(() => [...datePatternCandidates(pattern)]).toThrow("cannot match a valid month");
    expect(() => datePatternCandidateCount(pattern)).toThrow("cannot match a valid month");
    expect(() => expandDatePattern(pattern)).toThrow("cannot match a valid month");
    expect(() => daysInMonth(2026, 13)).toThrow("There is no month 13.");
    expect(
      datePatternCandidateCount({ key: "k", years: [2024], months: [2], days: [29, 30] }),
    ).toBe(1);
  });
});

describe("S017: one list of the files read at run time", () => {
  it("keeps the literal imports of the SSKR bridge on the path that the list names", () => {
    const source = readFileSync("src/sskr/runtime.ts", "utf8");
    const bridge = `../../${SSKR_ENGINE_FOLDER}${SSKR_BRIDGE}`;
    const imports = [...source.matchAll(/(?:import\(|from )"(\.\.\/\.\.\/sskr-wasm\/[^"]+)"/gu)];
    expect(imports.map((match) => match[1])).toEqual([bridge, bridge]);
  });
});

describe("S102: the colour conversions of the artwork live in color-math", () => {
  it("reads a pixel's bytes as hsv takes them and writes channels back as hex", () => {
    const pixels = Uint8Array.from([0x1e, 0xab, 0x91, 255, 0, 0, 0, 255]);
    expect(pixelHsv(pixels, 0)).toEqual(hsv(...rgbChannels("#1EAB91")));
    expect(pixelHsv(pixels, RGBA_CHANNELS)).toEqual([0, 0, 0]);
    expect(channelsHex(rgbChannels("#1eab91"))).toBe("1EAB91");
    // A blend can leave channels outside 0 to 1: they are clamped, and 0.5 rounds to 0x80.
    expect(channelsHex([1.2, -0.1, 0.5])).toBe("FF0080");
  });

  it("weighs a reference's hue by Rec. 709 luma over its brightest channel", () => {
    // Pure green weighs its Rec. 709 coefficient at any brightness, black weighs nothing.
    expect(peakRelativeLuma("#008000")).toBe(0.7152);
    expect(peakRelativeLuma("#000000")).toBe(0);
    expect(peakRelativeLuma("#0000FF")).toBeCloseTo(0.0722, 12);
    expect(peakRelativeLuma("#FFFF00")).toBeCloseTo(0.9278, 12);
  });

  it("takes a reference's hue and saturation from its bytes, as from its channels", () => {
    const [hue, saturation, ...rest] = hueAndSaturation("#1EAB91");
    expect(rest).toEqual([]);
    const [channelHue, channelSaturation] = hsv(...rgbChannels("#1EAB91"));
    expect(hue).toBeCloseTo(channelHue, 12);
    expect(saturation).toBeCloseTo(channelSaturation, 12);
  });
});

describe("S103: one descriptor per business design", () => {
  const profile = {
    name: "Alex Morgan",
    company: "Northline",
    role: "Consultant",
    email: "alex@example.com",
    website: "example.com",
    phone: "+44 20 7946 0281",
    location: "London",
  };

  it("describes every design completely, with no design left to a fall-through", () => {
    expect(Object.keys(businessDesigns)).toEqual([...businessStyles]);
    for (const style of businessStyles) {
      const fields = businessFields(style, profile);
      for (const field of fields) {
        expect(field.value, `${style} ${field.label}`).toBe(
          profile[field.label.toLowerCase() as keyof typeof profile],
        );
        expect(field.minimum).toBe(field.label === "Name" ? 6 : 4);
      }
      expect(fields.map((field) => field.label)).toEqual(
        expect.arrayContaining(["Company", "Name", "Role", "Email", "Website"]),
      );
    }
    // A detail is named by profileFieldLabel alone, which the menu's questions name it by too.
    expect(profileFields.map(profileFieldLabel)).toEqual([
      "Name",
      "Role",
      "Company",
      "Email",
      "Phone",
      "Website",
      "Location",
    ]);
    for (const style of businessStyles)
      for (const field of businessFields(style, profile))
        expect(profileFields.map(profileFieldLabel)).toContain(field.label);
    // The last design was the fall-through of an if-chain; it has its own entry now.
    expect(businessFields("facets", profile).map((field) => field.label)).toEqual([
      "Company",
      "Name",
      "Role",
      "Phone",
      "Email",
      "Website",
    ]);
  });

  it("keeps the approved differences between the designs", () => {
    const where = <K extends keyof (typeof businessDesigns)["it"]>(key: K, value: unknown) =>
      businessStyles.filter((style) => businessDesigns[style][key] === value);
    expect(where("tint", "muted")).toEqual(["architect", "it"]);
    expect(where("darkFieldInk", "contrast")).toEqual(["curves"]);
    expect(where("studyTheme", "noir")).toEqual(["it"]);
    expect(studyThemeOf("it")).toBe("noir");
    expect(studyThemeOf("mixed")).toBe("cool");
    expect(
      businessStyles.filter((style) => businessDesigns[style].reference.tone === "dark"),
    ).toEqual(["contact", "facets"]);
    expect(businessDesigns.it.reference).toMatchObject({ end: 55.5, align: "end" });
  });

  it("freezes the descriptors all the way down, so no importer can change a layout", () => {
    expect(Object.isFrozen(businessDesigns.it)).toBe(true);
    expect(Object.isFrozen(businessDesigns.it.reference)).toBe(true);
    expect(Object.isFrozen(businessDesigns.facets.fields)).toBe(true);
    expect(Object.isFrozen(businessDesigns.curves.fields[0])).toBe(true);
  });

  it("places the reference line as its design says", async () => {
    const font = await (await ScanPdfDocument.create()).embedFont(StandardFonts.Helvetica);
    const line = "Ref. 01 / 16  #8B0C06";
    expect(referencePlacement(font, line, "contact")).toEqual({ x: REFERENCE_MARGIN, size: 4.6 });
    expect(referencePlacement(font, line, "facets")).toEqual({ x: REFERENCE_MARGIN, size: 6.3 });
  });
});

describe("S104: one conversion to PDF points and one centring of text and of runs", () => {
  /** A page that records what is drawn on it. */
  function recordingPage(heightMm: number) {
    const drawn: { text: unknown[]; images: unknown[]; operators: string[] } = {
      text: [],
      images: [],
      operators: [],
    };
    const page = {
      getHeight: () => heightMm * LAYOUT_MM,
      drawText: (value: string, options: object) => drawn.text.push({ value, ...options }),
      drawImage: (_image: unknown, options: object) => drawn.images.push(options),
      pushOperators: (...operators: { toString(): string }[]) =>
        drawn.operators.push(...operators.map(String)),
    } as unknown as PDFPage;
    return { page, drawn };
  }

  it("turns millimetres from the top left into points from the bottom left", () => {
    const { page } = recordingPage(50);
    expect(pdfRect(page, { x: 10, y: 5, width: 20, height: 15 })).toEqual({
      x: 10 * LAYOUT_MM,
      y: 50 * LAYOUT_MM - 20 * LAYOUT_MM,
      width: 20 * LAYOUT_MM,
      height: 15 * LAYOUT_MM,
    });
    expect(pdfPoint(page, 10, 5)).toEqual({ x: 10 * LAYOUT_MM, y: 50 * LAYOUT_MM - 5 * LAYOUT_MM });
  });

  it("divides a run into cells and centres an incomplete one", () => {
    expect(runCellSize(100, 4, 4)).toBe(22);
    expect(centredRunStart(100, 4, 22, 4)).toBe(0);
    expect(centredRunStart(100, 2, 22, 4)).toBe(26);
  });

  it("centres a line in its box at the size that fits, and refuses one too long", async () => {
    const font = await (await ScanPdfDocument.create()).embedFont(StandardFonts.Helvetica);
    const { page, drawn } = recordingPage(50);
    centredText(page, font, "CENTRED", { left: 10, top: 5, width: 40 }, 9, 4, "Line");
    const [placed] = drawn.text as { x: number; size: number }[];
    expect(placed!.size).toBe(9);
    const middle = placed!.x + font.widthOfTextAtSize("CENTRED", 9) / 2;
    expect(middle / LAYOUT_MM).toBeCloseTo(30, 9);
    expect(() =>
      centredText(page, font, "CENTRED", { left: 10, top: 5, width: 2 }, 9, 4, "Line"),
    ).toThrow("Line is too long");
  });

  it("draws a card's artwork inside its rounded clip, in the card's box", () => {
    const { page, drawn } = recordingPage(50);
    const box = { x: 5, y: 5, width: 40, height: 20 };
    drawClippedArtwork(page, {} as PDFImage, box);
    expect(drawn.images).toEqual([pdfRect(page, box)]);
    expect(drawn.operators[0]).toBe("q");
    expect(drawn.operators.at(-1)).toBe("Q");
  });

  it("measures a caption at the least size its sheet prints it", async () => {
    const font = await (await ScanPdfDocument.create()).embedFont(StandardFonts.Helvetica);
    const lines = ["01  A3F09C"];
    const { page } = recordingPage(105);
    const caption = (captionWidth: number) => () =>
      drawStudyCaption(
        page,
        font,
        { metrics: { fontSize: 6, lineHeight: 3 } } as StudyLayout,
        { captionX: 5, captionTop: 50, captionWidth } as StudyBox,
        lines,
      );
    // A column as narrow as studyCaptionWidth allows still prints its caption.
    expect(caption(studyCaptionWidth(font, lines))).not.toThrow();
    expect(caption(studyCaptionWidth(font, lines) - 0.2)).toThrow("too long");
  });
});

describe("S096: one rule decides between a separate card and a sheet", () => {
  afterEach(() => vi.restoreAllMocks());
  const presentation = {
    studioName: "Review Studio",
    slogan: "Print, done properly.",
    subtitle: "Colour options for review.",
    footer: "CLIENT REVIEW",
    referenceLabel: "Ref.",
  };
  const colors = shareToColors(PUBLIC_SHARE);
  const share = {
    kind: "sskr",
    colors,
    payload: colors.join(" "),
    collectionReference: "376C-1-1",
    qrCard: true,
    cardQr: true,
    pageSize: "a6",
    presentation,
    profile: { name: "Alex Morgan" },
  } as const;

  it("keeps the index unless the content asks for a share's whole-share QR code", () => {
    expect(separateCardIndex({ kind: "colors", payload: "p" }, 2, 3)).toBe(2);
    expect(separateCardIndex({ kind: "sskr", payload: "p", qrCard: false }, 2, 3)).toBe(2);
    expect(separateCardIndex({ kind: "sskr", payload: "p", qrCard: true }, 2, 3)).toBeUndefined();
    expect(separateCardIndex({ kind: "sskr", payload: "p", qrCard: true }, undefined, 3)).toBe(
      undefined,
    );
    // An index that is not one of the cards is refused, also where only the sheet is drawn.
    expect(() => separateCardIndex({ kind: "sskr", payload: "p", qrCard: true }, 3, 3)).toThrow(
      "There is no card 4: the cards are 1 to 3.",
    );
  });

  it("refuses an index that is not one of the cards in every family, sheet or not", async () => {
    // Before the check was part of the rule, the business family drew the whole-share sheet here.
    await expect(renderBusinessCards(nodeCardRenderer, "it", share, 99)).rejects.toThrow(
      "There is no card 100",
    );
  });

  it("draws the whole-share QR sheet in every family, also when a card is asked for", async () => {
    const qr = vi.spyOn(cardQrModule, "drawCollectionQr");
    // The payload of each code drawn, as the renderer is asked for its matrix (S108).
    const payloads: string[] = [];
    const renderer = new CardRenderer({
      ...nodeRenderPlatform,
      qrModules: (text) => {
        payloads.push(text);
        return nodeRenderPlatform.qrModules(text);
      },
    });
    const sheets = [
      await renderBusinessCards(renderer, "it", share, 0),
      // A material design draws its sheet only (drawsSeparateCards).
      await renderMaterialCard(renderer, "tile", share),
    ];
    expect(qr).toHaveBeenCalledTimes(2);
    expect(payloads).toEqual(Array(2).fill(share.payload));
    for (const bytes of sheets) {
      const { width, height } = (await ScanPdfDocument.load(bytes)).getPage(0).getSize();
      expect([width, height].map((side) => Math.round(side / LAYOUT_MM))).toEqual(
        pageDimensions("a6"),
      );
    }
  });
});

describe("S097: one driver draws the collection sheet of every family", () => {
  const presentation = {
    studioName: "Review Studio",
    slogan: "Print, done properly.",
    subtitle: "Colour options for review.",
    footer: "CLIENT REVIEW",
    referenceLabel: "Ref.",
  };

  it("paints each card in its box and gives every caption the room of the longest", async () => {
    const doc = await ScanPdfDocument.create();
    const font = await doc.embedFont(StandardFonts.Helvetica);
    const captions = [["01  1EAB91"], ["02  3A2550", "Sage glaze"]];
    const painted: number[] = [];
    const pictures: number[] = [];
    const study = {
      doc,
      font,
      qr: nodeRenderPlatform,
      settings: { pageSize: "a6" },
      content: { kind: "colors", payload: "1EAB91 3A2550" },
      presentation,
      preparedFor: "Alex Morgan",
      theme: "cool",
      aspect: 1.8,
      captions,
      paint: (_page: PDFPage, box: StudyBox) => {
        painted.push(box.index);
      },
      pictureArea: (box: StudyBox) => {
        pictures.push(box.index);
        return box;
      },
    } as const;
    const layout = await drawCollectionStudy(study);
    expect(painted).toEqual([0, 1]);
    expect(pictures).toEqual([0, 1]);
    expect(doc.getPageCount()).toBe(1);
    const width = studyCaptionWidth(font, captions.flat());
    expect(layout).toEqual(collectionSheetLayout({ pageSize: "a6" }, 2, 1.8, 2, undefined, width));
  });
});

describe("G1-036: the measures of a sheet come from its page size alone", () => {
  it("has one record per size, whose heading fits above the cards in either orientation", () => {
    for (const pageSize of CARD_PAGE_SIZES) {
      const [portrait, landscape] = CARD_ORIENTATIONS.map((orientation) =>
        collectionSheetLayout({ pageSize, orientation }, 1, 1.8, 1),
      );
      // The frame once told an A4 sheet by its measured size, the layout by its name.
      expect(landscape!.metrics).toBe(portrait!.metrics);
      expect(portrait!.compact).toBe(isCardPageSize(pageSize));
      const { rows, headingHeight } = portrait!.metrics;
      for (const top of [rows.title, rows.kind, rows.subtitle, rows.rule ?? 0])
        expect(top, pageSize).toBeLessThan(headingHeight);
      // Only a card-sized page leaves out the rule under the heading.
      expect(rows.rule === undefined, pageSize).toBe(isCardPageSize(pageSize));
    }
  });

  it("keeps the measures the approved sheets were drawn with", () => {
    const metrics = (pageSize: "a6" | "a4" | "business") =>
      collectionSheetLayout({ pageSize }, 1, 1.8, 1).metrics;
    expect(metrics("a6")).toMatchObject({
      margin: 5,
      headingHeight: 23,
      fontSize: 6,
      titleSize: 13,
    });
    expect(metrics("a4")).toMatchObject({
      margin: 10,
      headingHeight: 33,
      fontSize: 8,
      titleSize: 19,
    });
    expect(metrics("business")).toMatchObject({ margin: 3, headingHeight: 11, fontSize: 4.3 });
  });
});

describe("S098, S099: a separate card is one card centred on its page", () => {
  it("centres the card, smaller only where the page is", () => {
    const { width, height } = BUSINESS_CARD_MM;
    expect(separateCardPage({}, width, height)).toEqual({
      width: 90,
      height: 50,
      x: 0,
      top: 0,
      scale: 1,
    });
    expect(separateCardPage({ pageSize: "a6", orientation: "portrait" }, width, height)).toEqual({
      width: 105,
      height: 148,
      x: 7.5,
      top: 49,
      scale: 1,
    });
    expect(separateCardPage({ pageSize: "a4", orientation: "landscape" }, width, height)).toEqual({
      width: 297,
      height: 210,
      x: 103.5,
      top: 80,
      scale: 1,
    });
    expect(() => separateCardPage({ pageSize: "wallet" as never }, width, height)).toThrow(
      "Page size must be",
    );
  });
});

describe("S146 follow-up: finish rows state their photograph once; one new-folder rule", () => {
  it("measures each crop on its material's photograph", () => {
    const [ivory] = materialArtwork.kitchen.finishes;
    expect(ivory!.crop).toEqual([49 / 1580, 186 / 996, 346 / 1580, 250 / 996]);
    expect(ivory!.outlineFit).toBeUndefined();
    const [charcoal] = materialArtwork.vehicle.finishes;
    expect(charcoal).toMatchObject({ surface: "matte", outlineFit: [1.005, -0.002, -0.002] });
    const sand = materialArtwork.tile.finishes.find((finish) => finish.name === "Fluted sand");
    expect(sand).toMatchObject({ surface: "fluted tile", onlyTinted: true });
  });

  it("refuses a card folder that exists, before anything is rendered", async () => {
    const root = await mkdtemp(join(tmpdir(), "mnemocode-s146-"));
    try {
      await expect(claimCardFolder(root)).rejects.toThrow(CARD_FOLDER_TAKEN);
      await expect(claimImageFolder(root)).rejects.toThrow(IMAGE_FOLDER_TAKEN);
      // A claim makes nothing: the command line asks it early, the export again when it writes.
      await claimImageFolder(join(root, "images"));
      expect(readdirSync(root)).toEqual([]);
      const folder = await claimCardFolder(join(root, "cards"));
      const files = await folder.publish(".cards-", async (staging) => {
        await writeFile(join(staging, "01.pdf"), "card");
        return 1;
      });
      expect(files).toBe(1);
      expect(readdirSync(join(root, "cards"))).toEqual(["01.pdf"]);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("publishes with the message it was claimed with, also when the name was taken meanwhile", async () => {
    const root = await mkdtemp(join(tmpdir(), "mnemocode-s146-"));
    try {
      const folder = await NewFolder.claim(join(root, "images"), IMAGE_FOLDER_TAKEN);
      await mkdir(join(root, "images"));
      await expect(folder.publish(".images-", async () => 0)).rejects.toThrow(IMAGE_FOLDER_TAKEN);
      // Nothing of the export is left beside the folder that took the name.
      expect(readdirSync(root)).toEqual(["images"]);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("refuses an image folder that exists, before any page is rasterized", async (context) => {
    // exportPageImages asks for pdftocairo first; without Poppler, image export is not offered.
    if (
      !(await assertImageRenderer().then(
        () => true,
        () => false,
      ))
    )
      context.skip();
    const root = await mkdtemp(join(tmpdir(), "mnemocode-s146-"));
    try {
      await expect(exportPageImages(new Uint8Array(), root)).rejects.toThrow(IMAGE_FOLDER_TAKEN);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});

describe("S108: the renderers and the share modules keep no platform of their own", () => {
  it("offers no platform to configure or read, for cards or for shares", async () => {
    const render = Object.keys(await import("../src/export/platform.js"));
    for (const gone of ["configureRenderPlatform", "renderPlatform", "platformChoice"])
      expect(render).not.toContain(gone);
    expect(Object.keys(await import("../src/sskr/share-platform.js")).sort()).toEqual([
      "ONE_GROUP",
      "SEED_BYTES",
    ]);
  });

  it("draws share cards with the renderer given: its details, and decoys unless given", async () => {
    const limits: number[] = [];
    const renderer = new CardRenderer({
      ...nodeRenderPlatform,
      randomInt: (limit) => {
        limits.push(limit);
        return 0;
      },
    });
    // Colors, whose decoys are random colors (2^24 codes).
    const options = { style: "it" } as const;
    await ShareCardSet.create(renderer, [PUBLIC_SHARE], options);
    // The invented person and texts, then the pool of decoys (MAX_DECOYS colors).
    const decoys = limits.filter((limit) => limit === 2 ** 24).length;
    expect(decoys).toBe(MAX_DECOYS);
    expect(limits.length).toBeGreaterThan(decoys);
    limits.length = 0;
    const own: number[] = [];
    await ShareCardSet.create(renderer, [PUBLIC_SHARE], options, (limit) => own.push(limit) && 0);
    expect(own.length).toBe(decoys);
    expect(limits).not.toContain(2 ** 24);
    expect(limits.length).toBeGreaterThan(0);
  });

  it("reads the font of the sheet for heirs from the assets given", async () => {
    const reads: RenderAsset[] = [];
    const assets: Pick<RenderPlatform, "readAsset"> = {
      readAsset: (path) => {
        reads.push(path);
        return nodeRenderPlatform.readAsset(path);
      },
    };
    const text = heirSheetText({
      backup: { kind: "encoded", format: "english", words: 12 },
      mode: "direct",
      dates: 0,
    });
    const bytes = await renderHeirSheet(assets, text, A6);
    expect(new TextDecoder().decode(bytes.subarray(0, 5))).toBe("%PDF-");
    expect(reads).toEqual(["fonts/DejaVuSans-UI.ttf"]);
  });
});
