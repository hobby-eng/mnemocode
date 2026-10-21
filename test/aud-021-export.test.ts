// AUD-021-FUN003: exercise runEncode's real destination and retry loops with the library planner,
// which plans the sheet with the real font. Every exporter draws and saves as it is, into a folder
// of the test's own, and each save is seen where it crosses the program's edge: the texts that
// pdf-lib was asked to draw for it, and the publish of its file or folder, with the random choices
// made until then. What crosses the edge is replaced: the files, where the name of a destination
// cannot be made, as on a full disk, where a test asks; pdftocairo, a fake on PATH that answers
// each page with a few bytes, which Windows, looking for pdftocairo.exe, does not take, so the
// file is skipped there; the terminal, whose questions are answered as they show
// (question-terminal.ts); the host's randomness, which is counted; and the font's read, which is
// counted and fails where a test asks.
import { existsSync } from "node:fs";
import { mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { delimiter, join } from "node:path";
import { PDFPage } from "pdf-lib";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { ParsedArguments } from "../src/cli/arguments.js";
import type { EncodedFormat } from "../src/core/types.js";
import { fakeImageRenderer, numberedCodes, PAGE_IMAGES } from "./helpers/drawn-cards.js";
import { LONG_TEST_TIME_LIMIT_MS } from "./helpers/limits.js";
import { questionsOnPrivateScreen, seen, terminal } from "./helpers/question-terminal.js";
import { testFolder } from "./helpers/test-folders.js";

type Destination = "pdf" | "images" | "cards";

/** One save of a destination, as the files saw it publish its file or folder. */
interface Save {
  readonly destination: Destination;
  /** The texts that pdf-lib was asked to draw since the save before. */
  readonly texts: readonly string[];
  /** The random choices of the card renderer and of the export's details made until then. */
  readonly randomChoices: number;
  readonly identityChoices: number;
}

/** What the stand-ins at the edge saw, and what a test asks of them. */
interface Observed {
  saves: Save[];
  /** The destination of each path that a save publishes. */
  destinations: Map<string, Destination>;
  /** Every text that pdf-lib was asked to draw so far, in order. */
  drawn: () => readonly string[];
  /** How many of them the saves recorded so far have taken. */
  taken: number;
  /** How many times making each path fails, as on a full disk, before it succeeds. */
  failures: Map<string, number>;
  randomChoices: number;
  identityChoices: number;
  fontReads: number;
  fontFailures: number;
}

const observed = vi.hoisted((): Observed => ({
  saves: [],
  destinations: new Map(),
  drawn: () => [],
  taken: 0,
  failures: new Map(),
  randomChoices: 0,
  identityChoices: 0,
  fontReads: 0,
  fontFailures: 0,
}));

const harness = await vi.hoisted(async () => import("./helpers/question-terminal.js"));
vi.mock("node:tty", async (importOriginal) => harness.replacedTty(await importOriginal()));
vi.mock("../src/cli/terminal-input.js", async (importOriginal) =>
  harness.replacedTerminalInput(await importOriginal()),
);
// The files: a new file is given its name with link, a new folder with mkdir, each a save of the
// destination of that path; either fails for a path of `observed.failures` as often as it says.
vi.mock("node:fs/promises", async (original) => {
  const actual = await original<typeof import("node:fs/promises")>();
  const publishing = (path: unknown): void => {
    const destination = typeof path === "string" ? observed.destinations.get(path) : undefined;
    if (destination !== undefined) {
      const drawn = observed.drawn();
      observed.saves.push({
        destination,
        texts: drawn.slice(observed.taken),
        randomChoices: observed.randomChoices,
        identityChoices: observed.identityChoices,
      });
      observed.taken = drawn.length;
    }
    const left = typeof path === "string" ? (observed.failures.get(path) ?? 0) : 0;
    if (left === 0) return;
    observed.failures.set(String(path), left - 1);
    throw Object.assign(new Error("Synthetic full disk."), { code: "ENOSPC" });
  };
  return {
    ...actual,
    link: async (...made: Parameters<typeof actual.link>) => {
      publishing(made[1]);
      return actual.link(...made);
    },
    mkdir: async (...made: Parameters<typeof actual.mkdir>) => {
      publishing(made[0]);
      return actual.mkdir(...made);
    },
  };
});

vi.mock("../src/export/platform-node.js", async (original) => {
  const actual = await original<typeof import("../src/export/platform-node.js")>();
  return {
    ...actual,
    nodeRenderPlatform: {
      ...actual.nodeRenderPlatform,
      randomInt: (upper: number) => observed.identityChoices++ % upper,
    },
    // The production renderer is frozen: replace the service rather than mutating it.
    nodeCardRenderer: {
      qrModules: actual.nodeCardRenderer.qrModules,
      businessArtwork: actual.nodeCardRenderer.businessArtwork,
      randomInt: (upper: number) => observed.randomChoices++ % upper,
      // The font, which a sheet's plan and every drawing read.
      readAsset: async (path: Parameters<typeof actual.nodeCardRenderer.readAsset>[0]) => {
        if (path.endsWith(".ttf")) {
          observed.fontReads += 1;
          if (observed.fontFailures > 0) {
            observed.fontFailures -= 1;
            throw new Error("Synthetic font read failure.");
          }
        }
        return actual.nodeCardRenderer.readAsset(path);
      },
    },
  };
});

import { runEncode } from "../src/cli/encode-command.js";
import { PrivateSteps } from "../src/cli/private-steps.js";
import { EncodedBackup } from "../src/core/encoded-backup.js";
import { backupCardContent } from "../src/export/backup-cards.js";
import { separateCardName } from "../src/export/card-codes.js";
import { TEST_PHRASE } from "./helpers/test-phrase.js";
import { BACKUP_CHECK_QUESTION } from "./helpers/prompts.js";

let folder: string;

/** Where each destination of argumentsFor is saved. */
function pathOf(destination: Destination): string {
  return join(folder, { pdf: "public.pdf", images: "images", cards: "cards" }[destination]);
}

/** The destinations of argumentsFor that are there after a run, in their order. */
function saved(): Destination[] {
  return (["pdf", "images", "cards"] as const).filter((destination) =>
    existsSync(pathOf(destination)),
  );
}

/** Takes each destination of argumentsFor in `folder` for a save of it. */
function watchDestinations(): void {
  for (const destination of ["pdf", "images", "cards"] as const)
    observed.destinations.set(pathOf(destination), destination);
}

function argumentsFor(format: EncodedFormat = "colors-unicode"): ParsedArguments {
  return {
    mnemonic: TEST_PHRASE,
    mode: "direct",
    format,
    template: "business-it",
    "page-size": "business",
    pdf: pathOf("pdf"),
    "images-dir": pathOf("images"),
    "cards-dir": pathOf("cards"),
  };
}

/** Makes the destination's name fail once, as on a full disk, before it is made. */
function failOnce(destination: Destination): void {
  observed.failures.set(pathOf(destination), 1);
}

/**
 * Expects `saves` to show one plan of the cards of the test phrase in `format`: every sheet, its
 * PDF or its page images, retries included, drew the same texts, the backup's codes first, then at
 * least one decoy; every save of separate cards drew the same cards, the backup's codes and a decoy
 * of the sheet's; and no save came after a random choice that the first did not.
 */
function expectSameCollection(saves: readonly Save[], format: EncodedFormat): void {
  expect(saves.length).toBeGreaterThan(1);
  const [sheet, ...sheets] = saves.filter(({ destination }) => destination !== "cards");
  const own = backupCardContent(EncodedBackup.encode(TEST_PHRASE, [], format, "direct").backup);
  const codes = own.colors.map((_, index) => separateCardName(own, index));
  const drawn = numberedCodes(sheet!.texts);
  expect(drawn.slice(0, codes.length)).toEqual(codes);
  expect(drawn.length).toBeGreaterThan(codes.length);
  // Each save draws fresh views of the same byte-owned plan, details and decoys included.
  for (const save of sheets) expect(save.texts).toEqual(sheet!.texts);
  const [cards, ...retries] = saves.filter(({ destination }) => destination === "cards");
  if (cards !== undefined) {
    for (const save of retries) expect(save.texts).toEqual(cards.texts);
    // Separate cards keep every real code and a decoy of the plan (AUD-022-FUN002).
    const separate = numberedCodes(cards.texts);
    expect(separate.slice(0, codes.length)).toEqual(codes);
    expect(separate.length).toBeGreaterThan(codes.length);
    expect(drawn).toEqual(expect.arrayContaining(separate));
  }
  for (const save of saves) {
    expect(save.randomChoices).toBe(saves[0]!.randomChoices);
    expect(save.identityChoices).toBe(saves[0]!.identityChoices);
  }
}

// One fake pdftocairo for the file: the exporter finds it once and keeps its path.
let bin: string;
beforeAll(async () => {
  bin = await mkdtemp(join(tmpdir(), "mnemocode-aud021-bin-"));
  await fakeImageRenderer(bin);
});
afterAll(async () => {
  await rm(bin, { recursive: true, force: true });
});

questionsOnPrivateScreen();
beforeEach(async () => {
  folder = await testFolder("mnemocode-aud021-export-");
  vi.stubEnv("PATH", `${bin}${delimiter}${process.env["PATH"] ?? ""}`);
  observed.saves = [];
  observed.destinations = new Map();
  observed.taken = 0;
  observed.failures = new Map();
  observed.randomChoices = 0;
  observed.identityChoices = 0;
  observed.fontReads = 0;
  observed.fontFailures = 0;
  watchDestinations();
  const drawText = vi.spyOn(PDFPage.prototype, "drawText");
  observed.drawn = () => drawText.mock.calls.map(([text]) => text);
});

describe.runIf(PAGE_IMAGES)(
  "AUD-021-FUN003: one card plan through the production Encode dispatcher",
  () => {
    it.each(["colors-unicode", "colors", "unicode"] as const)(
      "keeps real codes across destinations, sheet decoys in PDF and images, and a sheet decoy on cards for %s",
      async (format) => {
        PrivateSteps.close();
        await runEncode(argumentsFor(format));
        expect(observed.saves.map(({ destination }) => destination)).toEqual([
          "pdf",
          "images",
          "cards",
        ]);
        expectSameCollection(observed.saves, format);
        expect(observed.randomChoices).toBeGreaterThan(0);
        expect(observed.identityChoices).toBeGreaterThan(0);
        const pages = (await readdir(pathOf("images"))).length;
        const cards = numberedCodes(observed.saves[0]!.texts).length;
        expect(seen.notices.filter((line) => line.startsWith("Saved"))).toEqual([
          `Saved PDF: ${pathOf("pdf")}`,
          `Saved ${pages} PNG pages to: ${pathOf("images")}`,
          `Saved ${cards} individual card files to: ${pathOf("cards")}`,
        ]);
        expect(await readdir(pathOf("cards"))).toHaveLength(cards);
      },
      LONG_TEST_TIME_LIMIT_MS,
    );

    it(
      "keeps the completed plan while each destination retries its own save failure",
      async () => {
        for (const destination of ["pdf", "images", "cards"] as const) failOnce(destination);
        terminal.choices = ["Try again", "Try again", "Try again"];
        await runEncode(argumentsFor());
        expect(observed.saves.map(({ destination }) => destination)).toEqual([
          "pdf",
          "pdf",
          "images",
          "images",
          "cards",
          "cards",
        ]);
        expectSameCollection(observed.saves, "colors-unicode");
        expect(saved()).toEqual(["pdf", "images", "cards"]);
        expect(terminal.questions).toEqual([
          "What now?",
          "What now?",
          "What now?",
          BACKUP_CHECK_QUESTION,
        ]);
        expect(seen.notices.filter((line) => line.includes("could not be saved"))).toEqual([
          `The PDF could not be saved as ${pathOf("pdf")}: the disk is full.`,
          `The images could not be saved as ${pathOf("images")}: the disk is full.`,
          `The card files could not be saved as ${pathOf("cards")}: the disk is full.`,
        ]);
      },
      LONG_TEST_TIME_LIMIT_MS,
    );

    it(
      "keeps the same plan for the remaining destinations after the PDF is skipped",
      async () => {
        failOnce("pdf");
        terminal.choices = ["Skip"];
        await runEncode(argumentsFor());
        expectSameCollection(observed.saves, "colors-unicode");
        expect(saved()).toEqual(["images", "cards"]);
        expect(seen.notices).toContain("The PDF was not saved.");
        expect(seen.notices.some((line) => line.startsWith("Saved PDF:"))).toBe(false);
        expect(terminal.questions).toEqual(["What now?", BACKUP_CHECK_QUESTION]);
      },
      LONG_TEST_TIME_LIMIT_MS,
    );
  },
);

describe.runIf(PAGE_IMAGES)(
  "AUD-021-FUN003: one card plan through the production Encode dispatcher",
  () => {
    it(
      "keeps the card plan when a failed PDF is saved under another checked name",
      async () => {
        failOnce("pdf");
        terminal.choices = ["Another file name"];
        const other = join(folder, "other.pdf");
        observed.destinations.set(other, "pdf");
        terminal.answers = [`${other}\r`];
        const args = argumentsFor();
        await runEncode(args);
        expectSameCollection(observed.saves, "colors-unicode");
        expect(existsSync(other)).toBe(true);
        expect(saved()).toEqual(["images", "cards"]);
        expect(args.pdf).toBe(other);
        expect(seen.screen.match(/New name for the PDF: /gu)).toHaveLength(1);
        expect(seen.notices).toContain(`Saved PDF: ${other}`);
      },
      LONG_TEST_TIME_LIMIT_MS,
    );

    it(
      "allows a failed library plan to be retried inside the destination's save loop",
      async () => {
        observed.fontFailures = 1;
        terminal.choices = ["Try again"];
        const args = argumentsFor();
        args["page-size"] = "a6";
        delete args["cards-dir"];
        await runEncode(args);
        expectSameCollection(observed.saves, "colors-unicode");
        expect(saved()).toEqual(["pdf", "images"]);
        expect(seen.notices).toContain(
          `The PDF could not be saved as ${pathOf("pdf")}: synthetic font read failure.`,
        );
        expect(terminal.questions).toEqual(["What now?", BACKUP_CHECK_QUESTION]);
      },
      LONG_TEST_TIME_LIMIT_MS,
    );

    it("propagates a save error outside the private screen without saving later destinations", async () => {
      PrivateSteps.close();
      failOnce("pdf");
      await expect(runEncode(argumentsFor())).rejects.toMatchObject({ code: "ENOSPC" });
      expect(observed.saves.map(({ destination }) => destination)).toEqual(["pdf"]);
      expect(saved()).toEqual([]);
      expect(terminal.questions).toEqual([]);
    });

    it("does not plan cards for a record and standalone QR output", async () => {
      PrivateSteps.close();
      const record = join(folder, "public.txt");
      const qr = join(folder, "public.png");
      await runEncode({
        mnemonic: TEST_PHRASE,
        mode: "direct",
        format: "indexes",
        output: record,
        qr,
      });
      expect([existsSync(record), existsSync(qr)]).toEqual([true, true]);
      expect(observed.fontReads).toBe(0);
      expect(observed.randomChoices).toBe(0);
      expect(observed.identityChoices).toBe(0);
      expect(observed.saves).toEqual([]);
      expect(observed.drawn()).toEqual([]);
    });

    it(
      "starts a fresh plan for the next Encode run",
      async () => {
        PrivateSteps.close();
        await runEncode(argumentsFor());
        const first = observed.saves.splice(0);
        // The second run saves to new names: the first run's are taken.
        folder = await testFolder("mnemocode-aud021-export-");
        watchDestinations();
        await runEncode(argumentsFor());
        expectSameCollection(first, "colors-unicode");
        expectSameCollection(observed.saves, "colors-unicode");
        expect(numberedCodes(observed.saves[0]!.texts)).not.toEqual(numberedCodes(first[0]!.texts));
      },
      LONG_TEST_TIME_LIMIT_MS,
    );
  },
);
