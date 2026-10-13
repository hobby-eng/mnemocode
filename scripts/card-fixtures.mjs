// The public fixtures of the manual card-output scripts, business-goldens.mjs and
// check-card-output.mjs: the build they render with, the cards they draw and how they read a
// card's QR code back. Public test data only; not part of the program, its startup or its tests.

import { execFileSync } from "node:child_process";
import { access, readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { entropyToMnemonic } from "@scure/bip39";
import { wordlist } from "@scure/bip39/wordlists/english.js";
import jsQR from "jsqr";
import { PNG } from "pngjs";

/** The render platform of a build, which its renderers need before their first card. */
const RENDER_PLATFORM_MODULE = "dist/export/platform-node.js";
/** The card renderer of a build that passes it to every render (scan finding S108). */
const CARD_RENDERER_MODULE = "dist/export/card-renderer.js";
/** The family renderers, which take the card renderer first in such a build. */
const FAMILY_RENDERERS = ["renderBusinessCards", "renderMaterialCard"];

/**
 * The renderers of the build in `moduleRoot` and its SSKR vectors. They come from that root, not
 * from this checkout, so that two builds can be compared; so does the render platform, from that
 * build's own module. A build with a card renderer gets its Node.js renderer (nodeCardRenderer)
 * passed to each family renderer here, so that the scripts call every build alike; an older build
 * configures its platform on import (configureRenderPlatform), and one older than the render
 * platform read its assets itself and has no such module.
 */
export async function loadCardRenderer(moduleRoot) {
  const load = (path) => import(pathToFileURL(resolve(moduleRoot, path)).href);
  let drawing;
  if (await exists(resolve(moduleRoot, RENDER_PLATFORM_MODULE))) {
    const platform = await load(RENDER_PLATFORM_MODULE);
    if (await exists(resolve(moduleRoot, CARD_RENDERER_MODULE)))
      drawing = platform.nodeCardRenderer;
  } else console.log(`${moduleRoot} predates the render platform; its renderers need none.`);
  const modules = await Promise.all(
    [
      "dist/core.js",
      "dist/export/business-cards.js",
      "dist/export/material-cards.js",
      "dist/export/templates.js",
      "dist/sskr/transport.js",
    ].map(load),
  );
  const vector = JSON.parse(await readFile(resolve(moduleRoot, "vectors/sskr-v1.json"), "utf8"));
  const renderers = Object.assign({}, ...modules);
  if (drawing !== undefined)
    for (const name of FAMILY_RENDERERS) {
      const render = renderers[name];
      renderers[name] = (...parts) => render(drawing, ...parts);
    }
  // `drawing` is the build's card renderer, which its templates take first; none in older builds.
  return Object.freeze({ ...renderers, drawing, vector, load });
}

function exists(path) {
  return access(path).then(
    () => true,
    () => false,
  );
}

/**
 * The colour cards of the phrase whose entropy is the bytes 0, 1, 2, ... (`bytes` of them: 16 for
 * 12 words, 32 for 24), a public sequence, in `pageSize` when one is given.
 */
export function ordinaryContent(renderer, bytes, pageSize) {
  const mnemonic = entropyToMnemonic(
    Uint8Array.from({ length: bytes }, (_, i) => i),
    wordlist,
  );
  const colors = renderer.indexesToColors(renderer.representMnemonic(mnemonic).shiftedIndexes);
  return {
    kind: "colors",
    colors,
    payload: colors.join(" "),
    ...(pageSize === undefined ? {} : { pageSize }),
  };
}

/** The cards of the first share of the official SSKR vector, as a QR card of the business size. */
export function officialShareContent(renderer) {
  const colors = renderer.vector.official.firstShareColors;
  return {
    kind: "sskr",
    colors,
    payload: colors.join(" "),
    collectionReference: "PUBLIC-1-1",
    qrCard: true,
    pageSize: "business",
  };
}

/** The texts of a design study that both scripts print; each adds its own studio and slogan. */
export const REVIEW_TEXTS = Object.freeze({
  subtitle: "Colour options for review.",
  footer: "CLIENT REVIEW",
  referenceLabel: "Ref.",
});

/** The resolution at which a page is rasterized for its QR code, enough for jsQR to read it. */
export const QR_DPI = 200;

/**
 * The text of the QR code on page `page` (from 1) of the PDF at `pdfPath`, or undefined when it
 * has none; the page image is written to `prefix`.png. Read without inverting the image: a card
 * prints its code dark on light, as test/card-qr.test.ts reads it too.
 */
export async function qrOfPdfPage(pdfPath, page, prefix) {
  execFileSync(
    "pdftoppm",
    [
      "-f",
      String(page),
      "-l",
      String(page),
      "-singlefile",
      "-r",
      String(QR_DPI),
      "-png",
      pdfPath,
      prefix,
    ],
    { stdio: "pipe" },
  );
  const png = PNG.sync.read(await readFile(`${prefix}.png`));
  return jsQR(new Uint8ClampedArray(png.data), png.width, png.height, {
    inversionAttempts: "dontInvert",
  })?.data;
}
