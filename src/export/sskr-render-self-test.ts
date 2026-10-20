// The self-test of share cards (export/sskr-render.ts): the references and QR codes of the cards of
// two shares of the official SSKR vector, in colors and in Unicode codes, one color for each
// distinct code, no cards for word numbers or Bytewords, a damaged share refused; and in the full
// self-test the decoys after a share's codes, none for its QR code, and the PDF of a share's cards
// with the QR code its colors print. A host that offers share cards adds it to its self-test
// (SelfTestHost.features, MnemoCodeSelfTest.core), so that a build without them carries none of it.
//
// From the host it needs its CardRenderer (card-renderer.ts), which the cards are drawn with: the
// details of the cards and the source of their decoys are given here, so that nothing printed is
// chosen at random. The quick checks call none of the renderer's services (AUD-010-API002), only
// the full ones do. It writes no file and holds no secret.
//
// Host-neutral: it imports only other export and sskr modules, core/self-test-check.ts and pdf-lib.

import { PDFDocument } from "pdf-lib";
import {
  expectRefused,
  expectRefusedLater,
  expectSame,
  selfTestFeature,
  type SelfTestFeature,
} from "../core/self-test-check.js";
import { SSKR_VECTOR } from "../sskr/known-answers.js";
import { assertShareQr, Share, shareFormatHasCards, SHARE_FORMATS } from "../sskr/transport.js";
import {
  ShareCardSet,
  shareCardFace,
  shareReference,
  type SskrRenderOptions,
} from "./sskr-render.js";
import type { CardDrawing } from "./templates.js";
import {
  A6_WIDTH_POINTS,
  SELF_TEST_CARD_DETAILS,
  WIDTH_TOLERANCE_POINTS,
} from "./self-test-cards.js";
import { defined } from "../core/defined.js";
import { ErrorCatalog } from "../core/error-catalog.js";

const ERRORS = new ErrorCatalog("export.sskr-render-self-test", {
  "share-cards-no-decoy": () => "Share cards have no decoy.",
  "share-card-pdf-no-page": () => "Share card PDF has no page.",
  "share-card-a6-dimensions-mismatch": () => "Share card A6 dimensions mismatch.",
});

/** The first two shares of the official vector: members 1 and 2 of its first group. */
const SHARES = [
  SSKR_VECTOR.shares[0],
  "ur:sskr/gogrrsbyadadbnluotnykpaootdaweatrotlmsttrobsghbnurrh",
];
/**
 * Their references, identifier, group and member, as the published bytes of the shares give them
 * (BCR-2020-011): identifier 4BBF, group 1, members 1 and 2.
 */
const REFERENCES = "4BBF-1-1 4BBF-1-2";
/** The share forms with cards: colors and Unicode codes (owner, 2026-10-13). */
const FORMS_WITH_CARDS = "unicode colors colors-unicode";
/**
 * The source of the decoys: fixed, so that the full check draws nothing at random. The word of
 * index 0 has the Unicode code 7684 (core/words.ts), and the color of 0 is #000000.
 */
const FIXED_DECOYS = (): number => 0;
/** The Unicode code of the word of index 0, which every fixed decoy beside Unicode codes is. */
const FIXED_DECOY_CODE = "7684";
/**
 * The details of the cards, given, so that nothing is chosen at random; a material design, which
 * tints its samples in the PDF without recoloring a photograph (cards-self-test.ts draws every
 * design).
 */
const OPTIONS: SskrRenderOptions = {
  style: "tile",
  layout: "qr",
  pageSize: "a6",
  orientation: "landscape",
  ...SELF_TEST_CARD_DETAILS,
};

/** The QR codes of a set of cards as one line: reference and payload of each. */
function qrCodesOf(set: ShareCardSet): string {
  return set.qrCodes.map((code) => `${code.reference}: ${code.payload}`).join("; ");
}

/**
 * The quick known answers: the references of the cards, what they print and their QR codes hold
 * in colors and in Unicode codes, one color for each distinct code, the forms with cards, and a
 * damaged share refused.
 */
function checkShareCardsStartup(): void {
  const shares = Share.readSet(SHARES, false);
  try {
    expectSame(shares.map(shareReference).join(" "), REFERENCES, "Share card references");
    const colors = shareCardFace(defined(shares[0]), "colors");
    expectSame(
      colors.payload,
      SSKR_VECTOR.firstShareColors.join(" "),
      "Share card QR code in colors",
    );
    expectSame(colors.labels, undefined, "Share cards in colors print their colors");
    const codes = shareCardFace(defined(shares[0]), "unicode");
    expectSame(codes.payload, SSKR_VECTOR.firstShareUnicode, "Share card QR code in Unicode codes");
    expectSame(codes.labels?.join(" "), SSKR_VECTOR.firstShareUnicode, "Share card Unicode codes");
    // One color for each distinct code, and the same color for the same code.
    const distinct = new Set(codes.labels).size;
    expectSame(new Set(codes.colors).size, distinct, "Colors of the Unicode codes");
    expectSame(
      SHARE_FORMATS.filter(shareFormatHasCards).join(" "),
      FORMS_WITH_CARDS,
      "Share forms with cards",
    );
    expectRefused(
      () => Share.readSet([defined(SHARES[0]).replace(/w$/u, "y"), defined(SHARES[1])], false),
      /checksum|Bytewords/u,
      "Share cards of a damaged share",
    );
  } finally {
    for (const share of shares) share.wipe();
  }
}

/**
 * The actual self-test plans and their known answers, without rendering a PDF: decoys, retained
 * individual cards, refused layouts and QR payloads. Returns the public test plan that the full
 * self-test renders, so a host can also check planning independently of PDF drawing. The caller
 * disposes that returned plan; every other temporary plan is disposed here. Fails at the first
 * difference (core.self-test-check.mismatch, was-accepted, was-refused-another-reason), at cards
 * without a decoy (export.sskr-render-self-test.share-cards-no-decoy), and with the refusal of a
 * plan it must make, or the failure of a service of `drawing`.
 */
export async function shareCardPlanSelfTest(drawing: CardDrawing): Promise<ShareCardSet> {
  checkShareCardsStartup();
  const cards = await ShareCardSet.create(drawing, SHARES, OPTIONS, FIXED_DECOYS);
  try {
    const printed = cards.printedCodes(0);
    const own = SSKR_VECTOR.firstShareColors.map((color) => color.slice(1));
    expectSame(cards.ownCodes(0), own.length, "Own codes of a share's cards");
    expectSame(printed.slice(0, own.length).join(" "), own.join(" "), "Codes of a share's cards");
    if (printed.length <= own.length) throw ERRORS.create("share-cards-no-decoy", []);
    expectSame(printed.at(-1), "000000", "Decoy of a share's colors");
    using unicode = await ShareCardSet.create(
      drawing,
      SHARES,
      { ...OPTIONS, shareFormat: "unicode" },
      FIXED_DECOYS,
    );
    expectSame(
      unicode.printedCodes(0).at(-1),
      FIXED_DECOY_CODE,
      "Decoy of a share's Unicode codes",
    );
    expectSame(
      qrCodesOf(unicode).split("; ")[0],
      `4BBF-1-1: ${SSKR_VECTOR.firstShareUnicode}`,
      "Share card QR code without decoys",
    );
    // Separate cards are drawn in the business card designs only (drawsSeparateCards).
    using separate = await ShareCardSet.create(
      drawing,
      SHARES,
      { ...OPTIONS, style: "it", layout: "individual", pageSize: "business" },
      FIXED_DECOYS,
    );
    expectSame(separate.qrCodes.length, 0, "QR codes of separate cards");
    using business = await ShareCardSet.create(
      drawing,
      SHARES,
      { ...OPTIONS, style: "it", layout: "collection", shareFormat: "unicode" },
      FIXED_DECOYS,
    );
    // The vector's own codes and the fixed decoy, never the plan's own counts, which would move
    // with a wrong plan.
    const ownUnicode = SSKR_VECTOR.firstShareUnicode.split(" ").length;
    expectSame(business.ownCodes(0), ownUnicode, "Own Unicode codes of a share's cards");
    using retained = business.forIndividualCards();
    expectSame(
      retained.printedCodes(0).join(" "),
      `${SSKR_VECTOR.firstShareUnicode} ${FIXED_DECOY_CODE}`,
      "Retained share codes and first decoy",
    );
    // Each own code and the one decoy of separate cards on a card of its own.
    expectSame(defined(retained.shares[0]).documents, ownUnicode + 1, "Retained share cards");
    expectSame(retained.qrCodes.length, 0, "QR codes of retained individual cards");
    expectRefused(
      () => retained.forIndividualCards({ pageSize: "a4" }),
      /business size/u,
      "Retained individual cards on a sheet size",
    );
    await expectRefusedLater(
      () =>
        ShareCardSet.create(drawing, SHARES, {
          ...OPTIONS,
          layout: "individual",
          pageSize: "business",
        }),
      /printed on sheets only/u,
      "Separate share cards of a material design",
    );
    await expectRefusedLater(
      () => ShareCardSet.create(drawing, SHARES, { ...OPTIONS, shareFormat: "indexes" }),
      /have no cards/u,
      "Share cards in word numbers",
    );
    const [first] = cards.qrCodes;
    assertShareQr(SSKR_VECTOR.firstShareColors, defined(first).payload);
    expectRefused(
      () => assertShareQr(SSKR_VECTOR.firstShareColors, defined(cards.qrCodes[1]).payload),
      /does not match/u,
      "A QR code of another share",
    );
    // Cards that print Unicode codes: the QR code must hold the share those spell.
    expectRefused(
      () =>
        assertShareQr(
          [],
          defined(unicode.qrCodes[1]).payload,
          SSKR_VECTOR.firstShareUnicode.split(" "),
        ),
      /does not match/u,
      "A QR code of another share beside Unicode codes",
    );
    return cards;
  } catch (error) {
    cards.wipe();
    throw error;
  }
}

/** All planning checks, followed by the A6 PDF of the first share. */
async function checkShareCards(drawing: CardDrawing): Promise<void> {
  using cards = await shareCardPlanSelfTest(drawing);
  const bytes = await cards.renderShare(0);
  try {
    const pdf = await PDFDocument.load(bytes);
    if (pdf.getPageCount() < 1) throw ERRORS.create("share-card-pdf-no-page", []);
    for (const page of pdf.getPages())
      if (Math.abs(page.getWidth() - A6_WIDTH_POINTS) > WIDTH_TOLERANCE_POINTS)
        throw ERRORS.create("share-card-a6-dimensions-mismatch", []);
  } finally {
    bytes.fill(0);
  }
}

/** The checks of share cards, drawn with the host's `drawing`, for a host that offers them. */
export function shareCardsSelfTest(drawing: CardDrawing): SelfTestFeature {
  return selfTestFeature({
    name: "Share cards",
    detail: "references, codes, colors, decoys and QR codes in colors and Unicode codes; A6 PDF",
    startup: checkShareCardsStartup,
    run: () => checkShareCards(drawing),
  });
}
