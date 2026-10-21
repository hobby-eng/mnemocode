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
// search first. How it is run: the document on its standard input and each page's image on its
// standard output, never a file outside the destination (CORE-24), within the limits of a page.
// The stubs are shell scripts, so the cases run where a shell does.

/**
 * A stub of the renderer in `folder` that notes each run, the stub's own path, its working folder
 * and its arguments, and then, unless it is asked for its version, runs `drawing`.
 */
function stub(folder: string, log: string, drawing = ""): void {
  mkdirSync(folder, { recursive: true });
  const file = join(folder, "pdftocairo");
  const version = `if [ "$1" = "-v" ]; then exit 0; fi\n`;
  writeFileSync(file, `#!/bin/sh\necho "$0 $PWD $*" >> '${log}'\n${version}${drawing}\n`);
  chmodSync(file, 0o755);
}

/** A public PDF of `count` pages of 200 by 100 points, which hold nothing. */
async function emptyPages(count: number): Promise<Uint8Array> {
  const document = await PDFDocument.create();
  for (let page = 0; page < count; page += 1) document.addPage([200, 100]);
  return document.save();
}

/** The image export module, with a stub renderer that runs `drawing`, first in PATH. */
async function drawnWith(drawing: string): Promise<typeof import("../src/export/image-export.js")> {
  stub(join(root, "poppler"), log, drawing);
  process.env["PATH"] = [join(root, "poppler"), path ?? ""].join(delimiter);
  return imageExport();
}

/** The bytes that a page of 200 by 100 points may take as an image: 833 by 416 pixels, 8 each. */
const PAGE_IMAGE_LIMIT = 833 * 416 * 8;

/** Stubs in the working folder `work` and in its folder bin, and one in an absolute folder. */
function stubs(work: string): string {
  stub(work, log);
  stub(join(work, "bin"), log);
  stub(join(root, "poppler"), log);
  return join(root, "poppler", "pdftocairo");
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
    await expect((await imageExport()).ImageRenderer.assert()).rejects.toHaveProperty(
      "code",
      NO_RENDERER,
    );
    expect(existsSync(log)).toBe(false);
    // One in an absolute folder is found after them, and asked for its version in its folder.
    const program = stubs(work);
    process.env["PATH"] = ["", ".", "bin", join(root, "poppler")].join(delimiter);
    await (await imageExport()).ImageRenderer.assert();
    expect(readFileSync(log, "utf8")).toBe(`${program} ${join(root, "poppler")} -v\n`);
  });

  it("looks again after a search that failed, and keeps the renderer once found", async () => {
    const folder = join(root, "poppler");
    process.env["PATH"] = folder;
    const { ImageRenderer } = await imageExport();
    await expect(ImageRenderer.assert()).rejects.toHaveProperty("code", NO_RENDERER);
    stub(folder, log);
    const program = join(folder, "pdftocairo");
    expect(await ImageRenderer.find()).toBe(program);
    // Found once for the process: it is asked for its version only the first time.
    expect(await ImageRenderer.find()).toBe(program);
    expect(readFileSync(log, "utf8")).toBe(`${program} ${folder} -v\n`);
  });

  it("draws each page with the renderer found, in its own folder, without a file", async () => {
    const work = join(root, "work");
    const program = stubs(work);
    process.chdir(work);
    process.env["PATH"] = ["", ".", "bin", join(root, "poppler")].join(delimiter);
    const { writeRenderedDocument } = await imageExport();
    // The stub draws nothing, so the export is refused once the page was asked for.
    await expect(
      writeRenderedDocument(await emptyPages(1), join(root, "card"), "png"),
    ).rejects.toHaveProperty("code", "export.image-export.local-pdf-renderer-produced-no-images");
    const [probe, page] = readFileSync(log, "utf8").trim().split("\n");
    expect(probe).toMatch(new RegExp(`^${program} .* -v$`, "u"));
    const [ran, folder, ...arguments_] = (page ?? "").split(" ");
    expect(ran).toBe(program);
    expect(folder).toBe(join(root, "poppler"));
    // The document from standard input, the image to standard output: no path is given.
    expect(arguments_.slice(-2)).toEqual(["-", "-"]);
    expect(arguments_.filter((argument) => argument.includes("/"))).toEqual([]);
  });

  it("writes the image of each page that the renderer draws from the document it is given", async () => {
    const received = join(root, "received.pdf");
    // The page number follows -r 300 -f.
    const { writeRenderedDocument } = await drawnWith(`cat > '${received}'\nprintf 'page %s' "$4"`);
    const bytes = await emptyPages(2);
    expect(await writeRenderedDocument(bytes, join(root, "card"), "png")).toBe(2);
    expect(readFileSync(received)).toEqual(Buffer.from(bytes));
    expect(readFileSync(join(root, "card-01.png"), "utf8")).toBe("page 1");
    expect(readFileSync(join(root, "card-02.png"), "utf8")).toBe("page 2");
  });

  it("draws a page from a renderer that does not read the whole document", async () => {
    const { writeRenderedDocument } = await drawnWith("printf 'page'");
    const document = await PDFDocument.create();
    document.addPage([200, 100]);
    // Far more than a pipe holds, so that the renderer's end closes its input while it is written.
    document.setSubject("a".repeat(200_000));
    const bytes = await document.save({ useObjectStreams: false });
    expect(await writeRenderedDocument(bytes, join(root, "card"), "png")).toBe(1);
    expect(readFileSync(join(root, "card.png"), "utf8")).toBe("page");
  });

  it("refuses a page whose image is longer than its pixels can take, and writes nothing", async () => {
    const drawing = `head -c ${PAGE_IMAGE_LIMIT + 1} /dev/zero`;
    const { writeRenderedDocument } = await drawnWith(drawing);
    const failure = writeRenderedDocument(await emptyPages(1), join(root, "card"), "png");
    await expect(failure).rejects.toMatchObject({
      code: "export.image-export.local-pdf-renderer-wrote-too-much",
      message: `The local PDF renderer wrote more than ${PAGE_IMAGE_LIMIT} bytes for one page.`,
    });
    expect(existsSync(join(root, "card.png"))).toBe(false);
    // As many bytes as a page may take are an image.
    const { writeRenderedDocument: within } = await drawnWith(
      `head -c ${PAGE_IMAGE_LIMIT} /dev/zero`,
    );
    expect(await within(await emptyPages(1), join(root, "card"), "png")).toBe(1);
    expect(readFileSync(join(root, "card.png")).length).toBe(PAGE_IMAGE_LIMIT);
  });

  it("refuses a page when the renderer ends with an error or a signal", async () => {
    const { writeRenderedDocument } = await drawnWith("exit 3");
    await expect(
      writeRenderedDocument(await emptyPages(1), join(root, "card"), "png"),
    ).rejects.toMatchObject({
      code: "export.image-export.local-pdf-renderer-failed",
      message: "The local PDF renderer failed: exit code 3.",
    });
    const { writeRenderedDocument: killed } = await drawnWith("kill -KILL $$");
    await expect(killed(await emptyPages(1), join(root, "card"), "png")).rejects.toMatchObject({
      code: "export.image-export.local-pdf-renderer-failed",
      message: "The local PDF renderer failed: stopped by SIGKILL.",
    });
    expect(existsSync(join(root, "card.png"))).toBe(false);
  });

  it("stops a renderer that takes longer than its time for a page", async () => {
    const started = join(root, "started");
    const { ImageRenderer, writeRenderedDocument } = await drawnWith(
      `: > '${started}'\nexec sleep 30`,
    );
    await ImageRenderer.assert();
    // Fake time that also runs on, so that the reading of the document goes on as it does.
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"], shouldAdvanceTime: true });
    try {
      const failure = writeRenderedDocument(await emptyPages(1), join(root, "card"), "png");
      const settled = expect(failure).rejects.toMatchObject({
        code: "export.image-export.local-pdf-renderer-took-too-long",
        message: "The local PDF renderer took longer than 120 seconds for one page.",
      });
      while (!existsSync(started)) await new Promise((next) => setImmediate(next));
      vi.advanceTimersByTime(120_000);
      await settled;
    } finally {
      vi.useRealTimers();
    }
  });
});
