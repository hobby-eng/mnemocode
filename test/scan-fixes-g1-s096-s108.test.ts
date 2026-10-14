// The other G1 findings and S017, S096 to S108 of the DRY/OOP scan of 2026-10-09
// (test/scan-fixes.test.ts), each with a case that would fail without its fix. Public test data
// only: the BIP39 test phrase and the public SSKR vectors.

import { readFileSync, readdirSync } from "node:fs";
import { createRasterImage, pixelOffset, RGBA_CHANNELS } from "../src/export/platform.js";
import { listPieces, textPieces } from "../src/core/pieces.js";
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
import { zeroEntropyPhrase } from "../src/core/english-words.js";
import { afterEach, describe, expect, it, vi } from "vitest";
import { shareToColors } from "../src/sskr/transport.js";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ENCODED_FORMATS } from "../src/core/types.js";
import { representMnemonic } from "../src/core.js";
import {
  assertImageRenderer,
  exportPageImages,
  IMAGE_FOLDER_TAKEN,
  claimImageFolder,
} from "../src/export/image-export.js";
import {
  pageDimensions,
  BUSINESS_CARD_MM,
  CARD_PAGE_SIZES,
  CARD_ORIENTATIONS,
  isCardPageSize,
  profileFieldLabel,
  profileFields,
} from "../src/export/card-settings.js";
import { EncodedForm } from "../src/core/encoded-form.js";
import {
  parseDatePattern,
  datePatternCandidates,
  datePatternCandidateCount,
  expandDatePattern,
  daysInMonth,
} from "../src/core/dates.js";
import { bytesOfHex } from "../src/core/bits.js";
import {
  businessDesigns,
  businessFields,
  businessStyles,
  REFERENCE_MARGIN,
  studyThemeOf,
} from "../src/export/business-designs.js";
import { nodeCardRenderer, nodeRenderPlatform } from "../src/export/platform-node.js";
import { ShareCardSet } from "../src/export/sskr-render.js";
import { NewFolder } from "../src/export/private-file.js";
import {
  drawCollectionStudy,
  drawStudyCaption,
  separateCardIndex,
} from "../src/export/collection-sheet.js";
import {
  collectionSheetLayout,
  studyCaptionWidth,
  type StudyBox,
  type StudyLayout,
} from "../src/export/collection-layout.js";
import * as cardQrModule from "../src/export/card-qr.js";
import { renderBusinessCards } from "../src/export/business-cards.js";
import { MAX_DECOYS } from "../src/export/card-decoys.js";
import { separateCardPage } from "../src/export/business-layout.js";
import { renderMaterialCard } from "../src/export/material-cards.js";
import { materialArtwork } from "../src/export/material-artwork.js";
import { CARD_FOLDER_TAKEN, claimCardFolder } from "../src/export/individual-cards.js";
import { heirSheetText } from "../src/cli/heir-sheet.js";
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
import { publicShare } from "./helpers/vectors.js";

/** The first share of the public SSKR vectors (vectors/sskr-v1.json). */
const PUBLIC_SHARE = publicShare();

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
