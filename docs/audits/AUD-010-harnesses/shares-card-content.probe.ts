// AUD-010 "shares": what share cards print, through the production content builder (ShareCardSet,
// src/export/sskr-render.ts) and printedCode (src/export/card-codes.ts), compared with the
// independent oracle (shares-oracle.ts, checked by shares-oracle-check.ts). The three renderers
// are replaced so that the content they are given is recorded; the content itself is built by the
// unchanged production code. Public data only: BCR-2020-011 shares, the vectors/sskr-v1.json
// fixtures, and fresh splits of the public "abandon ... about" and "abandon ... art" phrases.
// Run:
//   pnpm exec vitest run --config docs/audits/AUD-010-harnesses/shares-vitest.config.mts \
//     docs/audits/AUD-010-harnesses/shares-card-content.probe.ts

import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it, vi } from "vitest";

const recorded = vi.hoisted(() => ({ contents: [] as unknown[] }));
async function emptyPdf(): Promise<Uint8Array> {
  const { PDFDocument: Document } = await import("pdf-lib");
  return (await Document.create()).save();
}
vi.mock("../../../src/export/business-cards.js", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  renderBusinessCards: async (_style: unknown, content: unknown) => {
    recorded.contents.push(content);
    return emptyPdf();
  },
}));
vi.mock("../../../src/export/glass-cards.js", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  renderGlassCards: async (content: unknown) => {
    recorded.contents.push(content);
    return emptyPdf();
  },
}));
vi.mock("../../../src/export/material-cards.js", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  renderMaterialCard: async (_style: unknown, content: unknown) => {
    recorded.contents.push(content);
    return emptyPdf();
  },
}));

import { ShareCardSet, type SskrRenderOptions } from "../../../src/export/sskr-render.ts";
import { printedCode } from "../../../src/export/card-codes.ts";
import { configureRenderPlatform } from "../../../src/export/platform.ts";
import { nodeRenderPlatform } from "../../../src/export/platform-node.ts";
import { splitSskrMnemonic } from "../../../src/sskr/shares.ts";
import { readShare } from "../../../src/sskr/transport.ts";
import { oracleCodes, oracleColors, reference } from "./shares-oracle.ts";

interface Captured {
  readonly colors: readonly string[];
  readonly labels?: readonly string[];
  readonly payload: string;
  readonly collectionReference: string;
}

const vectors = JSON.parse(
  readFileSync(new URL("../../../vectors/sskr-v1.json", import.meta.url), "utf8"),
);
const PHRASE_12 = `${"abandon ".repeat(11)}about`;
const PHRASE_24 = `${"abandon ".repeat(23)}art`;
const LABELLED = ["indexes", "unicode", "words", "ur"] as const;
const CODES_PER_CARD = 3;
const COLOR = /^#[0-9A-F]{6}$/u;

function log(name: string, actual: unknown, expected?: unknown): void {
  const tail = expected === undefined ? "" : `\n  expected: ${JSON.stringify(expected)}`;
  console.log(`${name}\n  actual:   ${JSON.stringify(actual)}${tail}`);
}

async function captured(cards: ShareCardSet, place: number): Promise<Captured> {
  recorded.contents = [];
  await cards.renderShare(place);
  expect(recorded.contents.length).toBeGreaterThan(0);
  return recorded.contents[0] as Captured;
}

async function sets(): Promise<{ readonly name: string; readonly shares: readonly string[] }[]> {
  const deterministic = vectors.deterministic as { name: string; shares: string[] }[];
  return [
    { name: "BCR-2020-011 official (2 groups, 16 bytes)", shares: vectors.official.shares },
    { name: "fixture bip39-256-2-of-3 (32 bytes)", shares: deterministic.at(-1)!.shares },
    { name: "fresh 2-of-3 of abandon..about", shares: await splitSskrMnemonic(PHRASE_12, 2, 3) },
    { name: "fresh 3-of-5 of abandon..art", shares: await splitSskrMnemonic(PHRASE_24, 3, 5) },
    { name: "fresh 16-of-16 of abandon..art", shares: await splitSskrMnemonic(PHRASE_24, 16, 16) },
  ];
}

describe("AUD-010 shares: printed codes of share cards", () => {
  afterEach(() => configureRenderPlatform(nodeRenderPlatform));

  it("prints, card after card, exactly the share's own codes in each labelled form", async () => {
    let compared = 0;
    for (const set of await sets())
      for (const form of LABELLED)
        for (const style of ["it", "glass-4in1", "tile"] as const) {
          const options: SskrRenderOptions = { style, shareFormat: form, cardQr: true };
          const cards = new ShareCardSet(set.shares, options);
          for (const [place, ur] of set.shares.entries()) {
            const expected = oracleCodes(ur, form);
            const printed = cards.printedCodes(place);
            const content = await captured(cards, place);
            const label = `${set.name} / ${form} / ${style} / share ${place + 1}`;
            log(`${label}: codes printed across the cards`, printed, expected);
            // Card by card: three codes each, in order, the last card with the rest.
            expect(printed.length, label).toBe(Math.ceil(expected.length / CODES_PER_CARD));
            for (const [card, text] of printed.entries())
              expect(text, `${label} card ${card + 1}`).toBe(
                expected.slice(card * CODES_PER_CARD, (card + 1) * CODES_PER_CARD).join(" "),
              );
            expect(printed.join(" ").split(" "), label).toEqual(expected);
            // printedCode over the content the renderer received gives the same texts.
            expect(
              content.colors.map((_, index) => printedCode(content, index)),
              label,
            ).toEqual(printed);
            expect(content.labels, label).toEqual(printed);
            // Decorative colors: one per card, well formed, none twice.
            log(`${label}: decorative colors`, content.colors);
            expect(content.colors.length, label).toBe(printed.length);
            expect(content.colors.every((color) => COLOR.test(color)), label).toBe(true);
            expect(new Set(content.colors).size, label).toBe(content.colors.length);
            // The QR code holds what the cards print, and reads back as the share.
            log(`${label}: QR payload`, content.payload, expected.join(" "));
            expect(content.payload, label).toBe(expected.join(" "));
            expect(readShare(content.payload).ur, label).toBe(ur);
            expect(content.collectionReference, label).toBe(reference(ur));
            compared += 1;
          }
        }
    console.log(`Shares compared in labelled forms: ${compared}`);
  });

  it("prints the colors themselves in the color form", async () => {
    for (const set of await sets()) {
      const cards = new ShareCardSet(set.shares, { style: "it", cardQr: true, shareFormat: "colors" });
      for (const [place, ur] of set.shares.entries()) {
        const expected = oracleColors(ur);
        const content = await captured(cards, place);
        const label = `${set.name} / colors / share ${place + 1}`;
        log(label, cards.printedCodes(place), expected.map((color) => color.slice(1)));
        expect(content.colors, label).toEqual(expected);
        expect(content.labels, label).toBeUndefined();
        expect(cards.printedCodes(place), label).toEqual(expected.map((color) => color.slice(1)));
        expect(content.payload, label).toBe(expected.join(" "));
      }
    }
  });

  it("draws the largest set of decorative colors, and ends with the poorest random source", async () => {
    const [share] = await splitSskrMnemonic(PHRASE_24, 2, 2);
    const words = oracleCodes(share!, "words");
    const cards = Math.ceil(words.length / CODES_PER_CARD);
    log("Bytewords of a 24-word share, and the cards they take", [words.length, cards]);
    // A random source that always gives the same color: each color drawn twice takes the next free
    // one, around the end of the 24-bit range.
    configureRenderPlatform({ ...nodeRenderPlatform, randomInt: (limit) => limit - 1 });
    const content = await captured(new ShareCardSet([share!], { style: "it", shareFormat: "words" }), 0);
    const expected = Array.from({ length: cards }, (_, index) =>
      `#${((0xffffff + index) % 0x1000000).toString(16).padStart(6, "0").toUpperCase()}`,
    );
    log("colors with a constant random source", content.colors, expected);
    expect(content.colors).toEqual(expected);
    // The colors do not depend on the share: another share gets the same ones from that source.
    const [other] = await splitSskrMnemonic(PHRASE_12, 2, 2);
    const second = await captured(new ShareCardSet([other!], { style: "it", shareFormat: "indexes" }), 0);
    log("another share, same constant source", second.colors, expected.slice(0, second.colors.length));
    expect(second.colors).toEqual(expected.slice(0, second.colors.length));
    // And with the system source the same share gets other colors each time.
    configureRenderPlatform(nodeRenderPlatform);
    // One after another: captured() reads the content of the render it started.
    const draws: string[] = [];
    for (let draw = 0; draw < 3; draw++)
      draws.push(
        (await captured(new ShareCardSet([share!], { style: "it", shareFormat: "words" }), 0)).colors.join(
          " ",
        ),
      );
    log("three draws with the system source", draws);
    expect(new Set(draws).size).toBe(3);
  });

  it("names separate cards and counts their documents for labelled forms", async () => {
    const shares = await splitSskrMnemonic(PHRASE_12, 2, 3);
    for (const form of LABELLED)
      for (const style of ["it", "glass-4in1"] as const) {
        const cards = new ShareCardSet(shares, { style, shareFormat: form, pageSize: "business" });
        const perCard = style === "it" ? 1 : 4;
        const groups = cards.printedCodes(0);
        const names: string[] = [];
        for await (const document of cards.documents(0)) names.push(document.name);
        const expected = Array.from(
          { length: Math.ceil(groups.length / perCard) },
          (_, index) => `${String(index + 1).padStart(2, "0")}-${groups[index * perCard]}`,
        );
        log(`separate cards, ${form}, ${style}: document names`, names, expected);
        expect(names).toEqual(expected);
        expect(cards.shares[0]!.documents).toBe(expected.length);
      }
  });
});
