import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, join } from "node:path";
import { PDFDocument } from "pdf-lib";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Which pdftocairo image export runs (AUD-037-SEC001): only one in an absolute folder of PATH, by
// its absolute name, never one of the working folder or of a relative entry, which Windows would
// search first. The stubs are shell scripts, so the cases run where a shell does.

/** A stub of the renderer in `folder` that notes each run, its working folder and its arguments. */
function stub(folder: string, log: string): void {
  mkdirSync(folder, { recursive: true });
  const file = join(folder, "pdftocairo");
  writeFileSync(file, `#!/bin/sh\necho "$PWD $*" >> '${log}'\n`);
  chmodSync(file, 0o755);
}

/** The image export module as a fresh import: it keeps the renderer it found. */
async function imageExport(): Promise<typeof import("../src/export/image-export.js")> {
  vi.resetModules();
  return import("../src/export/image-export.js");
}

const NO_RENDERER = "export.image-export.png-jpeg-export-requires-local-poppler-pdftocairo-program";
let root: string;
let log: string;
const workingFolder = process.cwd();
const path = process.env["PATH"];

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "mnemocode-renderer-"));
  log = join(root, "runs.log");
});
afterEach(() => {
  process.chdir(workingFolder);
  process.env["PATH"] = path;
  rmSync(root, { recursive: true, force: true });
});

describe.skipIf(process.platform === "win32")("the image renderer", () => {
  it("is never one of the working folder or of an empty or relative PATH entry", async () => {
    const work = join(root, "work");
    stub(work, log);
    stub(join(work, "bin"), log);
    process.chdir(work);
    process.env["PATH"] = ["", ".", "bin"].join(delimiter);
    await expect((await imageExport()).assertImageRenderer()).rejects.toHaveProperty(
      "code",
      NO_RENDERER,
    );
    expect(existsSync(log)).toBe(false);
    // One in an absolute folder is found after them, and asked for its version.
    stub(join(root, "poppler"), log);
    process.env["PATH"] = ["", ".", "bin", join(root, "poppler")].join(delimiter);
    await (await imageExport()).assertImageRenderer();
    expect(readFileSync(log, "utf8")).toBe(`${work} -v\n`);
  });

  it("draws each page with the renderer found, in the private folder of the drawing", async () => {
    stub(join(root, "poppler"), log);
    process.env["PATH"] = join(root, "poppler");
    const document = await PDFDocument.create();
    document.addPage([200, 100]);
    const bytes = await document.save();
    const { writeRenderedDocument } = await imageExport();
    // The stub draws nothing, so the export is refused once the page was asked for.
    await expect(writeRenderedDocument(bytes, join(root, "card"), "png")).rejects.toHaveProperty(
      "code",
      "export.image-export.local-pdf-renderer-produced-no-images",
    );
    const [probe, page] = readFileSync(log, "utf8").trim().split("\n");
    expect(probe).toMatch(/ -v$/u);
    const [folder = "", ...arguments_] = (page ?? "").split(" ");
    expect(folder).toMatch(/mnemocode-raster-/u);
    expect(arguments_).toContain(join(folder, "document.pdf"));
    expect(existsSync(folder)).toBe(false);
  });
});
