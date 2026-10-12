// AUD-010 "shares": share cards rendered by the production renderers in every design, read back
// from the rendered pages. For each design and form it renders the collection sheet of one share
// with its QR code (ShareCardSet.renderShare), rasterises it with Poppler's pdftoppm, decodes the QR
// code with jsQR (an independent decoder) and extracts the printed text with pdftotext. Expected:
// the QR code holds exactly the share's codes in the form the cards print (oracle, shares-oracle.ts)
// and reads back as the share; every card's "NN codes" line is printed. It also decodes the PNG
// that exportQrPayload saves. Public data only: fresh splits of "abandon ... about" and
// "abandon ... art". Pages are kept for inspection in
// <workspace>/tmp/mnemocode/aud010/shares/render/.
// Run: node --import tsx docs/audits/AUD-010-harnesses/shares-render-qr.ts [quick]

import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import jsQR from "jsqr";
import { PNG } from "pngjs";
import "../../../src/export/platform-node.ts";
import { ShareCardSet, type SskrRenderOptions } from "../../../src/export/sskr-render.ts";
import { exportQrPayload } from "../../../src/cli/qr-export.ts";
import { splitSskrMnemonic } from "../../../src/sskr/shares.ts";
import { readShare } from "../../../src/sskr/transport.ts";
import { oracleCodes, oracleColors } from "./shares-oracle.ts";

const OUT = fileURLToPath(
  new URL("../../../../tmp/mnemocode/aud010/shares/render", import.meta.url),
);
const PHRASE_12 = `${"abandon ".repeat(11)}about`;
const PHRASE_24 = `${"abandon ".repeat(23)}art`;
const quick = process.argv.includes("quick");
const STYLES = quick
  ? (["curves", "glass-8in1", "tile"] as const)
  : ([
      "architect",
      "it",
      "estate",
      "diagonal",
      "contact",
      "curves",
      "facets",
      "mixed",
      "kitchen",
      "switch",
      "tile",
      "vehicle",
      "enclosure",
      "glass-4in1",
      "glass-6in1",
      "glass-8in1",
    ] as const);
const FORMS = ["indexes", "unicode", "words", "colors"] as const;

rmSync(OUT, { recursive: true, force: true });
mkdirSync(OUT, { recursive: true });
let failures = 0;
let checks = 0;
function check(name: string, ok: boolean, actual: unknown, expected?: unknown): void {
  checks += 1;
  if (!ok) failures += 1;
  const tail = expected === undefined ? "" : `\n  expected: ${JSON.stringify(expected)}`;
  console.log(`${ok ? "PASS" : "FAIL"}: ${name}\n  actual:   ${JSON.stringify(actual)}${tail}`);
}

/** The QR code that jsQR finds in `image`, whole or in one of its nine overlapping thirds. */
function decodeImage(image: PNG): string | undefined {
  const whole = jsQR(new Uint8ClampedArray(image.data), image.width, image.height);
  if (whole !== null) return whole.data;
  // jsQR sometimes takes artwork for a finder pattern on a whole page; a crop around the code
  // then reads it. Each crop is half the page wide and high, at nine positions.
  const width = Math.floor(image.width / 2);
  const height = Math.floor(image.height / 2);
  for (const fy of [0, 0.25, 0.5])
    for (const fx of [0.5, 0.25, 0]) {
      const left = Math.floor(image.width * fx);
      const top = Math.floor(image.height * fy);
      const crop = new Uint8ClampedArray(width * height * 4);
      for (let y = 0; y < height; y++)
        crop.set(
          image.data.subarray(
            ((top + y) * image.width + left) * 4,
            ((top + y) * image.width + left + width) * 4,
          ),
          y * width * 4,
        );
      const found = jsQR(crop, width, height);
      if (found !== null) return found.data;
    }
  return undefined;
}

/** Every QR code that jsQR finds on the page images of `pdf`, and the page text. */
function readBack(pdf: string, stem: string): { qr: string[]; text: string; pages: string[] } {
  execFileSync("pdftoppm", ["-r", "300", "-png", pdf, join(OUT, stem)]);
  const pages = readdirSync(OUT)
    .filter((file) => file.startsWith(`${stem}-`) && file.endsWith(".png"))
    .sort();
  const qr: string[] = [];
  for (const page of pages) {
    const found = decodeImage(PNG.sync.read(readFileSync(join(OUT, page))));
    if (found !== undefined) qr.push(found);
  }
  const text = execFileSync("pdftotext", ["-layout", pdf, "-"]).toString();
  return { qr, text, pages };
}

const collapse = (text: string): string => text.replace(/\s+/gu, " ");

const sets = [
  { name: "12w", shares: await splitSskrMnemonic(PHRASE_12, 2, 3) },
  { name: "24w", shares: await splitSskrMnemonic(PHRASE_24, 2, 3) },
];
for (const set of sets)
  for (const style of STYLES)
    for (const form of FORMS) {
      const ur = set.shares[1]!;
      const options: SskrRenderOptions = { style, shareFormat: form, cardQr: true };
      const cards = new ShareCardSet(set.shares, options);
      const stem = `${set.name}-${style}-${form}`;
      const pdf = join(OUT, `${stem}.pdf`);
      try {
        writeFileSync(pdf, await cards.renderShare(1));
      } catch (error) {
        // Sheets that a design cannot fit are counted by shares-sheet-capacity.ts, not here.
        console.log(`SKIP: ${stem}: the renderer refused the sheet: ${(error as Error).message}`);
        continue;
      }
      const { qr, text, pages } = readBack(pdf, stem);
      const codes = form === "colors" ? oracleColors(ur) : oracleCodes(ur, form);
      const expectedPayload = codes.join(" ");
      check(
        `${stem}: one QR code decoded by jsQR on ${pages.length} page(s)`,
        qr.length === 1,
        qr.length,
        1,
      );
      check(
        `${stem}: the QR code holds what the cards print`,
        qr[0] === expectedPayload,
        qr[0],
        expectedPayload,
      );
      check(
        `${stem}: the QR code reads back as the share`,
        qr[0] !== undefined && readShare(qr[0]).ur === ur,
        qr[0] === undefined ? null : readShare(qr[0]).ur === ur,
        true,
      );
      const printed = cards.printedCodes(1);
      const flat = collapse(text);
      const missing = printed
        .map((codeText, index) => `${String(index + 1).padStart(2, "0")} ${codeText}`)
        .filter((line) => !flat.includes(line));
      check(
        `${stem}: every card's number and codes appear in the page text`,
        missing.length === 0,
        missing,
        [],
      );
    }

// Separate cards (business size), each printing its number, codes and reference: the first and
// the last card of the 24-word share in Bytewords, the longest codes a card prints.
const longest = sets[1]!;
for (const style of STYLES) {
  const cards = new ShareCardSet(longest.shares, {
    style,
    shareFormat: "words",
    pageSize: "business",
  });
  const documents: { name: string; bytes: Uint8Array }[] = [];
  try {
    for await (const document of cards.documents(0)) documents.push(document);
  } catch (error) {
    check(`separate cards ${style}: render`, false, (error as Error).message, "every card");
    continue;
  }
  const printed = cards.printedCodes(0);
  const perCard = Math.ceil(printed.length / documents.length);
  for (const index of [0, documents.length - 1]) {
    const stem = `card-${style}-${String(index + 1).padStart(2, "0")}`;
    const pdf = join(OUT, `${stem}.pdf`);
    writeFileSync(pdf, documents[index]!.bytes);
    const { text } = readBack(pdf, stem);
    const flat = collapse(text);
    const expected = printed
      .slice(index * perCard, (index + 1) * perCard)
      .map((codes) => codes.split(" ").join(" "));
    const missing = expected.filter((codes) => !flat.includes(codes));
    check(
      `separate card ${stem}: its codes appear in the page text`,
      missing.length === 0,
      missing,
      [],
    );
  }
}

// The QR card of one share (layout qr) in the business size and in A6, 24-word share in Bytewords.
for (const style of ["it", "curves", "tile", "glass-4in1"] as const)
  for (const pageSize of ["business", "a6"] as const) {
    const stem = `qrcard-${style}-${pageSize}`;
    const cards = new ShareCardSet(longest.shares, {
      style,
      shareFormat: "words",
      layout: "qr",
      pageSize,
    });
    const pdf = join(OUT, `${stem}.pdf`);
    try {
      writeFileSync(pdf, await cards.renderShare(0));
    } catch (error) {
      console.log(`SKIP: ${stem}: the renderer refused the QR card: ${(error as Error).message}`);
      continue;
    }
    const { qr } = readBack(pdf, stem);
    const expected = oracleCodes(longest.shares[0]!, "words").join(" ");
    check(
      `${stem}: the QR card's code holds the share's Bytewords`,
      qr[0] === expected,
      qr[0],
      expected,
    );
  }

// The QR image that is saved beside a sheet, decoded by jsQR.
const ur = sets[1]!.shares[0]!;
for (const form of ["indexes", "unicode", "words"] as const) {
  const payload = oracleCodes(ur, form).join(" ");
  const path = join(OUT, `saved-${form}-qr.png`);
  await exportQrPayload(payload, path);
  const image = PNG.sync.read(readFileSync(path));
  const found = jsQR(new Uint8ClampedArray(image.data), image.width, image.height);
  check(
    `exportQrPayload PNG in ${form} decodes to the payload`,
    found?.data === payload,
    found?.data,
    payload,
  );
}

console.log(`Render and QR checks: ${checks - failures} passed, ${failures} failed.`);
process.exitCode = failures === 0 ? 0 : 1;
