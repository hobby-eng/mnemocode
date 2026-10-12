// The self-test of share cards (export/sskr-render.ts): the references and QR codes of the cards of
// two shares of the official SSKR vector, in colors and in Unicode codes, none for separate cards,
// a damaged share refused, and the PDF of a share's cards with the QR code its colors print. A
// host that offers share cards adds it to its self-test (SelfTestHost.features,
// MnemoCodeSelfTest.core), so that a build without them carries none of it.
//
// From the host it needs its CardRenderer (card-renderer.ts), which the cards are drawn with: the
// details of the cards and the source of their decorative colors are given here, so that nothing
// printed is chosen at random, and the quick checks call none of the renderer's services
// (AUD-010-API002), only the PDF does. It writes no file and holds no secret.
//
// Host-neutral: it imports only other export and sskr modules, core/self-test-check.ts and pdf-lib.

import { PDFDocument } from "pdf-lib";
import {
  expectRefused,
  expectSame,
  selfTestFeature,
  type SelfTestFeature,
} from "../core/self-test-check.js";
import { sskrVector } from "../sskr/known-answers.js";
import { assertShareQr } from "../sskr/transport.js";
import { ShareCardSet, type SskrRenderOptions } from "./sskr-render.js";
import type { CardDrawing } from "./templates.js";
import {
  A6_WIDTH_POINTS,
  SELF_TEST_CARD_DETAILS,
  WIDTH_TOLERANCE_POINTS,
} from "./self-test-cards.js";

/** The first two shares of the official vector: members 1 and 2 of its first group. */
const SHARES = [
  sskrVector.shares[0],
  "ur:sskr/gogrrsbyadadbnluotnykpaootdaweatrotlmsttrobsghbnurrh",
];
/**
 * Their references, identifier, group and member, as the published bytes of the shares give them
 * (BCR-2020-011): identifier 4BBF, group 1, members 1 and 2.
 */
const REFERENCES = "4BBF-1-1 4BBF-1-2";
/**
 * The source of the decorative colors of cards that print codes: fixed, so that the quick check
 * draws nothing at random; colors that repeat take the next free one.
 */
const FIXED_DECORATION = (): number => 0;
/**
 * The details of the cards, given, so that nothing is chosen at random; the glass design, the
 * quickest to draw (cards-self-test.ts draws every design).
 */
const OPTIONS: SskrRenderOptions = {
  style: "glass-4in1",
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
 * The quick known answers: the references and QR codes of the cards in colors and in Unicode
 * codes, none for separate cards, and a damaged share refused.
 */
function checkShareCardsStartup(drawing: CardDrawing): void {
  const cards = new ShareCardSet(drawing, SHARES, OPTIONS);
  expectSame(
    cards.shares.map((share) => share.reference).join(" "),
    REFERENCES,
    "Share card references",
  );
  expectSame(
    qrCodesOf(cards).split("; ")[0],
    `4BBF-1-1: ${sskrVector.firstShareColors.join(" ")}`,
    "Share card QR code in colors",
  );
  expectSame(
    qrCodesOf(
      new ShareCardSet(drawing, SHARES, { ...OPTIONS, shareFormat: "unicode" }, FIXED_DECORATION),
    ).split("; ")[0],
    `4BBF-1-1: ${sskrVector.firstShareUnicode}`,
    "Share card QR code in Unicode codes",
  );
  // In word numbers the cards print the numbers, three to a card, and the QR code holds them all.
  const numbers = new ShareCardSet(
    drawing,
    SHARES,
    { ...OPTIONS, shareFormat: "indexes" },
    FIXED_DECORATION,
  );
  expectSame(
    numbers.printedCodes(0)[0],
    sskrVector.firstShareNumbers.split(" ").slice(0, 3).join(" "),
    "Share card codes in word numbers",
  );
  expectSame(
    qrCodesOf(numbers).split("; ")[0],
    `4BBF-1-1: ${sskrVector.firstShareNumbers}`,
    "Share card QR code in word numbers",
  );
  expectSame(
    new ShareCardSet(drawing, SHARES, { ...OPTIONS, layout: "individual", pageSize: "business" })
      .qrCodes.length,
    0,
    "QR codes of separate cards",
  );
  expectRefused(
    () => new ShareCardSet(drawing, [SHARES[0]!.replace(/w$/u, "y"), SHARES[1]!], OPTIONS),
    /checksum|Bytewords/u,
    "Share cards of a damaged share",
  );
}

/** Every check: the quick ones, and the A6 PDF of the first share with the QR code it prints. */
async function checkShareCards(drawing: CardDrawing): Promise<void> {
  checkShareCardsStartup(drawing);
  const cards = new ShareCardSet(drawing, SHARES, OPTIONS);
  const pdf = await PDFDocument.load(await cards.renderShare(0));
  if (pdf.getPageCount() < 1) throw new Error("Share card PDF has no page.");
  for (const page of pdf.getPages())
    if (Math.abs(page.getWidth() - A6_WIDTH_POINTS) > WIDTH_TOLERANCE_POINTS)
      throw new Error("Share card A6 dimensions mismatch.");
  const [first] = cards.qrCodes;
  assertShareQr(sskrVector.firstShareColors, first!.payload);
  expectRefused(
    () => assertShareQr(sskrVector.firstShareColors, cards.qrCodes[1]!.payload),
    /does not match/u,
    "A QR code of another share",
  );
  // Cards that print word numbers: the QR code must hold the share those spell.
  const numbers = new ShareCardSet(
    drawing,
    SHARES,
    { ...OPTIONS, shareFormat: "indexes" },
    FIXED_DECORATION,
  );
  expectRefused(
    () => assertShareQr([], cards.qrCodes[1]!.payload, numbers.printedCodes(0)),
    /does not match/u,
    "A QR code of another share beside word numbers",
  );
}

/** The checks of share cards, drawn with the host's `drawing`, for a host that offers them. */
export function shareCardsSelfTest(drawing: CardDrawing): SelfTestFeature {
  return selfTestFeature({
    name: "Share cards",
    detail: "references, codes and QR codes in three forms, refusals; A6 PDF",
    startup: () => checkShareCardsStartup(drawing),
    run: () => checkShareCards(drawing),
  });
}
