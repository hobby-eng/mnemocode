// The QR codes of the cards, drawn from the matrix that the host's platform made (QrSource).
import type { QrModules } from "./platform.js";
import { rgb, type PDFPage } from "pdf-lib";
import { MM } from "./business-layout.js";
import { pdfRect } from "./business-render-primitives.js";
import { ErrorCatalog } from "../core/error-catalog.js";

const ERRORS = new ErrorCatalog("export.card-qr", {
  "qr-module-size-positive-physical-measurement": () =>
    "The QR module size must be a positive physical measurement.",
  "qr-too-small-payload-use-larger-page": () =>
    "The QR is too small for this payload; use a larger page.",
  "qr-does-not-fit-on-page": () => "The QR does not fit on this page.",
});

const QUIET_MODULES = 4;
/** The smallest module that a printed code keeps, in millimetres. */
export const MIN_MODULE_MM = 0.4;
/** How far a module may fall short of the smallest, in millimetres: rounding of the sums. */
const MODULE_ROUNDING_MM = 1e-8;
/** How far a code may reach past the page, in points: rounding of millimetres into points. */
const PAGE_ROUNDING_POINTS = 0.01;

/**
 * The side of the QR code `qr`, quiet zone included, in millimetres for modules `moduleMm` wide,
 * and at least `minimum`; refuses a module size that is not a positive measurement
 * (export.card-qr.qr-module-size-positive-physical-measurement).
 */
export function qrSizeForModuleMm(qr: QrModules, minimum: number, moduleMm: number): number {
  if (!Number.isFinite(moduleMm) || moduleMm <= 0)
    throw ERRORS.create("qr-module-size-positive-physical-measurement", []);
  return Math.max(minimum, (qr.size + QUIET_MODULES * 2) * moduleMm);
}

/**
 * Draw exact data, the code `qr`, as vector modules, never as part of a decorative bitmap, in a
 * square of `size` millimetres whose top left corner is `x` and `top` millimetres from the page's.
 * Refuses a square whose modules would be narrower than `minimumModuleMm`
 * (export.card-qr.qr-too-small-payload-use-larger-page), and one that reaches past the page
 * (export.card-qr.qr-does-not-fit-on-page).
 */
export function drawCollectionQr(
  page: PDFPage,
  qr: QrModules,
  x: number,
  top: number,
  size: number,
  minimumModuleMm = MIN_MODULE_MM,
): void {
  const totalModules = qr.size + QUIET_MODULES * 2;
  if (size / totalModules < minimumModuleMm - MODULE_ROUNDING_MM)
    throw ERRORS.create("qr-too-small-payload-use-larger-page", []);
  if (
    x < 0 ||
    top < 0 ||
    (x + size) * MM > page.getWidth() + PAGE_ROUNDING_POINTS ||
    (top + size) * MM > page.getHeight() + PAGE_ROUNDING_POINTS
  )
    throw ERRORS.create("qr-does-not-fit-on-page", []);
  const pitch = (size * MM) / totalModules;
  const plate = pdfRect(page, { x, y: top, width: size, height: size });
  page.drawRectangle({ ...plate, color: rgb(1, 1, 1) });
  const bottom = plate.y;
  for (let row = 0; row < qr.size; row++) {
    for (let col = 0; col < qr.size; col++) {
      if (!qr.get(row, col)) continue;
      page.drawRectangle({
        x: x * MM + (col + QUIET_MODULES) * pitch,
        y: bottom + (qr.size + QUIET_MODULES - 1 - row) * pitch,
        width: pitch,
        height: pitch,
        color: rgb(0, 0, 0),
      });
    }
  }
}
