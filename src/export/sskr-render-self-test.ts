// The self-test of share cards (export/sskr-render.ts): the references and QR codes of the cards of
// two shares of the official SSKR vector, in colors and in Unicode codes, none for separate cards,
// a damaged share refused, and the PDF of a share's cards with the QR code its colors print. A
// host that offers share cards adds it to its self-test (SelfTestHost.features,
// MnemoCodeSelfTest.core), so that a build without them carries none of it.
//
// From the host it needs, for the PDF only, the render platform (export/platform.ts,
// configureRenderPlatform), set before the full check runs: the details of the cards are given
// here, so that nothing is chosen at random. It writes no file and holds no secret.
//
// Host-neutral: it imports only other export and sskr modules, core/self-test-check.ts and pdf-lib.

import { PDFDocument } from "pdf-lib";
import { expectRefused, expectSame, type SelfTestFeature } from "../core/self-test-check.js";
import { sskrVector } from "../sskr/known-answers.js";
import { assertShareQr } from "../sskr/transport.js";
import { ShareCardSet, type SskrRenderOptions } from "./sskr-render.js";

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
 * The details of the cards, given, so that nothing is chosen at random; the glass design, the
 * quickest to draw (cards-self-test.ts draws every design).
 */
const OPTIONS: SskrRenderOptions = {
  style: "glass-4in1",
  layout: "qr",
  pageSize: "a6",
  orientation: "landscape",
  // Every field given: one left out would be invented, with the render platform's randomness.
  profile: {
    name: "Alex Morgan",
    role: "Design Director",
    company: "VECTOR STUDIO",
    email: "alex@vector.example",
    phone: "+44 20 7946 0281",
    website: "vector.example",
    location: "London",
  },
  presentation: {
    studioName: "VECTOR STUDIO",
    slogan: "Design with purpose.",
    subtitle: "Selected finishes",
    footer: "Crafted with care.",
    referenceLabel: "Ref.",
  },
};
/** An A6 page in landscape is 148 mm wide; a PDF measures in points of 1/72 inch. */
const A6_WIDTH_POINTS = (148 * 72) / 25.4;
const WIDTH_TOLERANCE_POINTS = 0.01;

/** The QR codes of a set of cards as one line: reference and payload of each. */
function qrCodesOf(set: ShareCardSet): string {
  return set.qrCodes.map((code) => `${code.reference}: ${code.payload}`).join("; ");
}

/**
 * The quick known answers: the references and QR codes of the cards in colors and in Unicode
 * codes, none for separate cards, and a damaged share refused.
 */
function checkShareCardsStartup(): void {
  const cards = new ShareCardSet(SHARES, OPTIONS);
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
    qrCodesOf(new ShareCardSet(SHARES, { ...OPTIONS, shareFormat: "unicode" })).split("; ")[0],
    `4BBF-1-1: ${sskrVector.firstShareUnicode}`,
    "Share card QR code in Unicode codes",
  );
  // In word numbers the cards print the numbers, three to a card, and the QR code holds them all.
  const numbers = new ShareCardSet(SHARES, { ...OPTIONS, shareFormat: "indexes" });
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
    new ShareCardSet(SHARES, { ...OPTIONS, layout: "individual", pageSize: "business" }).qrCodes
      .length,
    0,
    "QR codes of separate cards",
  );
  expectRefused(
    () => new ShareCardSet([SHARES[0]!.replace(/w$/u, "y"), SHARES[1]!], OPTIONS),
    /checksum|Bytewords/u,
    "Share cards of a damaged share",
  );
}

/** Every check: the quick ones, and the A6 PDF of the first share with the QR code it prints. */
async function checkShareCards(): Promise<void> {
  checkShareCardsStartup();
  const cards = new ShareCardSet(SHARES, OPTIONS);
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
  const numbers = new ShareCardSet(SHARES, { ...OPTIONS, shareFormat: "indexes" });
  expectRefused(
    () => assertShareQr([], cards.qrCodes[1]!.payload, numbers.printedCodes(0)),
    /does not match/u,
    "A QR code of another share beside word numbers",
  );
}

/** The checks of share cards, for a host that offers them. */
export const SHARE_CARDS_SELF_TEST: SelfTestFeature = Object.freeze({
  startup: checkShareCardsStartup,
  check: Object.freeze({
    name: "Share cards",
    detail: "references, codes and QR codes in three forms, refusals; A6 PDF",
    run: checkShareCards,
  }),
});
