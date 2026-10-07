// The self-test of the sheet for heirs (export/heir-sheet-text.ts, export/heir-sheet.ts): the words
// it prints for an encoded backup and for shares, the facts and routes it refuses, and the two
// pages of the PDF in A5 and A6. A host that offers the sheet adds it to its self-test
// (SelfTestHost.features, MnemoCodeSelfTest.core), so that a build without the sheet carries none
// of it.
//
// From the host it needs, for the PDF only, the render platform that the renderer reads its font
// from (export/platform.ts, configureRenderPlatform), set before the full check runs. It writes no
// file and holds no secret.
//
// Host-neutral: it imports only other export modules, core/self-test-check.ts and pdf-lib.

import { PDFDocument } from "pdf-lib";
import { expectRefused, expectRefusedLater, expectSame } from "../core/self-test-check.js";
import type { SelfTestFeature } from "../core/self-test-check.js";
import {
  HeirInstructions,
  type HeirMode,
  type HeirRoute,
  type HeirSheetFacts,
} from "./heir-sheet-text.js";
import { A5, A6, renderHeirSheet, type HeirSheetFormat, type HeirSheetText } from "./heir-sheet.js";

/** An address reserved for examples (RFC 2606), the one the test route prints. */
const ROUTE_ADDRESS = "https://example.org/heirs";
/** A route through no real program: what the sheet adds around its steps is what is checked. */
const TEST_ROUTE: HeirRoute = Object.freeze({
  subtitle: "Made by the self-test.",
  address: ROUTE_ADDRESS,
  start: [`Open ${ROUTE_ADDRESS} offline.`],
  decode: (mode: HeirMode, dates: string | undefined) => [
    `Decode ${mode}; ${dates ?? "no dates"}.`,
  ],
  restore: (mode: string, threshold: number, dates: string | undefined) => [
    `Restore ${threshold} shares ${mode}; ${dates ?? "no dates"}.`,
  ],
  dateDigitHelp: "Search an unclear digit.",
});
const instructions = new HeirInstructions(TEST_ROUTE);

/** Shares in colors, any 2 of 3, masked with two dates. */
const SHARES: HeirSheetFacts = {
  backup: { kind: "shares", format: "colors", threshold: 2, count: 3 },
  mode: "seedshift",
  dates: 2,
};
/** The seed phrase itself in English words, not masked. */
const PHRASE: HeirSheetFacts = {
  backup: { kind: "encoded", format: "english" },
  mode: "direct",
  dates: 0,
};

/**
 * The words of the sheet that the facts above give, as heir-sheet-text.ts writes them: a change of
 * these words must change this check too, on purpose.
 */
const OPEN_WALLET = "Open the wallet with this seed phrase in a wallet program (see below).";
const SHARES_LINES = [
  "Any 2 of the 3 Shamir shares, written as color codes such as #1EAB91, on paper or on printed cards.",
  "The owner's 2 secret dates (see the back). They are written nowhere; the hint may lead to them.",
  `Open ${ROUTE_ADDRESS} offline.`,
  "Restore 2 shares seedshift; the secret dates as day-month-year (23-09-2026).",
  OPEN_WALLET,
  "An error usually means a mistyped code or word: check each one against the paper. Type ? for each code you cannot read. Search an unclear digit.",
  "Never type the backup, the dates or the seed phrase into a website or send them to anyone.",
] as const;
const PHRASE_LINES = [
  "The seed phrase itself: English words, not masked.",
  "No secret dates are needed.",
  OPEN_WALLET,
  "Never type the backup or the seed phrase into a website or send them to anyone.",
] as const;

/** ISO 216 page sizes in PDF points, 72 to the inch: A5 is 148 × 210 mm, A6 105 × 148 mm. */
const POINTS_PER_MM = 72 / 25.4;
const PAGE_SIZES: readonly (readonly [HeirSheetFormat, number, number, string])[] = [
  [A5, 148 * POINTS_PER_MM, 210 * POINTS_PER_MM, "A5"],
  [A6, 105 * POINTS_PER_MM, 148 * POINTS_PER_MM, "A6"],
];
/** How far a page measure may differ from the ISO size by rounding. */
const TOLERANCE_POINTS = 0.01;
/** The front and the back. */
const SHEET_PAGES = 2;
/** Steps enough to overflow the back of any size. */
const OVERFLOWING_STEPS = 200;

/** The lines of a sheet that its facts decide: what is needed, the steps, the advice, the warning. */
function factLines(text: HeirSheetText): string[] {
  return [...text.needs, ...text.steps, text.trouble, text.warning];
}

/**
 * The quick known answers: the words for shares and for the phrase itself, and the facts and the
 * route refused.
 */
function checkHeirTextStartup(): void {
  expectSame(
    factLines(instructions.text(SHARES)).join("\n"),
    SHARES_LINES.join("\n"),
    "Heir sheet for shares",
  );
  const phraseText = instructions.text(PHRASE);
  expectSame(
    [...phraseText.needs, ...phraseText.steps, phraseText.warning].join("\n"),
    PHRASE_LINES.join("\n"),
    "Heir sheet for the phrase itself",
  );
  expectRefused(
    () => instructions.text({ ...SHARES, mode: "seedshift-legacy" }),
    /Shares cannot use the original Seedshift/u,
    "Heir sheet for shares of the Original Seedshift",
  );
  expectRefused(
    () => instructions.text({ ...PHRASE, dates: 1 }),
    /no dates in direct mode/u,
    "Heir sheet with dates and no Seedshift",
  );
  const twoAddresses = new HeirInstructions({
    ...TEST_ROUTE,
    start: [...TEST_ROUTE.start, "Or open https://example.com/elsewhere."],
  });
  expectRefused(
    () => twoAddresses.text(SHARES),
    /route's address once and no other/u,
    "Heir sheet with another address",
  );
}

/** Every check: the quick ones, the PDF in A5 and A6, and a sheet whose back overflows refused. */
async function checkHeirSheet(): Promise<void> {
  checkHeirTextStartup();
  const text = instructions.text(SHARES);
  for (const [format, width, height, name] of PAGE_SIZES) {
    const pdf = await PDFDocument.load(await renderHeirSheet(text, format));
    expectSame(pdf.getPageCount(), SHEET_PAGES, `Heir sheet ${name} pages`);
    for (const page of pdf.getPages())
      if (
        Math.abs(page.getWidth() - width) > TOLERANCE_POINTS ||
        Math.abs(page.getHeight() - height) > TOLERANCE_POINTS
      )
        throw new Error(`Heir sheet ${name} page size mismatch.`);
  }
  const overflowing = { ...text, steps: Array<string>(OVERFLOWING_STEPS).fill(OPEN_WALLET) };
  await expectRefusedLater(
    () => renderHeirSheet(overflowing, A6),
    /do not fit on the back/u,
    "Heir sheet whose steps overflow",
  );
}

/** The checks of the sheet for heirs, for a host that offers it. */
export const HEIR_SHEET_SELF_TEST: SelfTestFeature = Object.freeze({
  startup: checkHeirTextStartup,
  check: Object.freeze({
    name: "Heir sheet",
    detail: "words for a backup and for shares, refusals; A5, A6 PDF",
    run: checkHeirSheet,
  }),
});
