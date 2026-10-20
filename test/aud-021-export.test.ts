// AUD-021-FUN003: exercise runEncode's real destination and retry loops with the library planner,
// which plans the sheet with the real font. Every exporter draws and saves as it is, into a folder
// of the test's own, and the job of each is noted on its way through. What crosses the program's
// edge is replaced: the files, where the name of a destination cannot be made, as on a full disk,
// where a test asks; pdftocairo, a fake on PATH that answers each page with a few bytes, which
// Windows, looking for pdftocairo.exe, does not take, so the file is skipped there; the terminal
// answers; the host's randomness, which is counted; and the font's read, which is counted and
// fails where a test asks.
import { existsSync } from "node:fs";
import { chmod, mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { delimiter, join } from "node:path";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { ParsedArguments } from "../src/cli/arguments.js";
import type { AnswerParser } from "../src/cli/ask.js";
import { separateCardJob, type CardJob } from "../src/export/render.js";
import type { EncodedFormat } from "../src/core/types.js";
import { LONG_TEST_TIME_LIMIT_MS } from "./helpers/limits.js";
import { testFolder } from "./helpers/test-folders.js";

type Destination = "pdf" | "images" | "cards";
interface Attempt {
  readonly destination: Destination;
  readonly job: CardJob;
  readonly randomChoices: number;
  readonly identityChoices: number;
}

/** What the exporters and the stand-ins saw, and what a test asks of them. */
interface Observed {
  attempts: Attempt[];
  /** How many times making each path fails, as on a full disk, before it succeeds. */
  failures: Map<string, number>;
  randomChoices: number;
  identityChoices: number;
  fontReads: number;
  fontFailures: number;
  privateScreen: boolean;
  choices: ("again" | "other" | "skip")[];
  questions: string[];
  names: string[];
  nameQuestions: string[];
  notices: string[];
}

const observed = vi.hoisted((): Observed => ({
  attempts: [],
  failures: new Map(),
  randomChoices: 0,
  identityChoices: 0,
  fontReads: 0,
  fontFailures: 0,
  privateScreen: false,
  choices: [],
  questions: [],
  names: [],
  nameQuestions: [],
  notices: [],
}));

// The files: a new file is given its name with link, a new folder with mkdir; either fails for a
// path of `observed.failures` as often as it says.
vi.mock("node:fs/promises", async (original) => {
  const actual = await original<typeof import("node:fs/promises")>();
  const fullAt = (path: unknown): void => {
    const left = typeof path === "string" ? (observed.failures.get(path) ?? 0) : 0;
    if (left === 0) return;
    observed.failures.set(String(path), left - 1);
    throw Object.assign(new Error("Synthetic full disk."), { code: "ENOSPC" });
  };
  return {
    ...actual,
    link: async (...made: Parameters<typeof actual.link>) => {
      fullAt(made[1]);
      return actual.link(...made);
    },
    mkdir: async (...made: Parameters<typeof actual.mkdir>) => {
      fullAt(made[0]);
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
// The exporters, each noted with its job before it draws and saves as it is.
vi.mock("../src/export/pdf.js", async (original) => {
  const actual = await original<typeof import("../src/export/pdf.js")>();
  return {
    ...actual,
    exportCards: async (...draw: Parameters<typeof actual.exportCards>) => {
      observe("pdf", draw[0][0]!);
      return actual.exportCards(...draw);
    },
    renderCards: async (...draw: Parameters<typeof actual.renderCards>) => {
      observe("images", draw[1][0]!);
      return actual.renderCards(...draw);
    },
  };
});
vi.mock("../src/export/individual-cards.js", async (original) => {
  const actual = await original<typeof import("../src/export/individual-cards.js")>();
  return {
    ...actual,
    exportIndividualCards: async (...draw: Parameters<typeof actual.exportIndividualCards>) => {
      const [template, content] = draw;
      observe("cards", { template, content });
      return actual.exportIndividualCards(...draw);
    },
  };
});
vi.mock("../src/cli/private-screen.js", async (original) => ({
  ...(await original<typeof import("../src/cli/private-screen.js")>()),
  onPrivateScreen: () => observed.privateScreen,
}));
vi.mock("../src/cli/terminal-input.js", async (original) => ({
  ...(await original<typeof import("../src/cli/terminal-input.js")>()),
  terminalAvailable: () => true,
}));
vi.mock("../src/cli/terminal-choice.js", async (original) => ({
  ...(await original<typeof import("../src/cli/terminal-choice.js")>()),
  choose: async (question: string) => {
    observed.questions.push(question);
    return observed.choices.shift();
  },
}));
vi.mock("../src/cli/ask.js", async (original) => ({
  ...(await original<typeof import("../src/cli/ask.js")>()),
  // Name validation remains the real save-retry/checkOutputName path.
  askValueUntil: async <T>(question: string, parse: AnswerParser<T>) => {
    observed.nameQuestions.push(question);
    const name = observed.names.shift();
    if (name === undefined) throw new Error("No synthetic output name was supplied.");
    return parse(name);
  },
}));

import { runEncode } from "../src/cli/encode-command.js";
import { EncodedBackup } from "../src/core/encoded-backup.js";
import { backupCardContent } from "../src/export/backup-cards.js";
import { assertColorCardContent } from "../src/export/card-content.js";
import { TEST_PHRASE } from "./helpers/test-phrase.js";

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

/** A fake pdftocairo in `bin`: it reads a page's PDF and answers with a few bytes. */
async function fakeImageRenderer(bin: string): Promise<void> {
  const program = join(bin, "pdftocairo");
  await writeFile(
    program,
    `#!${process.execPath}
if (process.argv.includes("-v")) process.exit(0);
process.stdin.resume();
process.stdin.on("end", () => process.stdout.write("public fake page image"));
`,
  );
  await chmod(program, 0o700);
}

function observe(destination: Destination, job: CardJob): void {
  observed.attempts.push({
    destination,
    job,
    randomChoices: observed.randomChoices,
    identityChoices: observed.identityChoices,
  });
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

function expectSameCollection(attempts: readonly Attempt[], format: EncodedFormat): void {
  expect(attempts.length).toBeGreaterThan(1);
  // The plan as the sheets and page images take it; separate cards take it without its page turn.
  const first = attempts.find((attempt) => attempt.destination !== "cards")!;
  const content = first.job.content;
  const own = backupCardContent(EncodedBackup.encode(TEST_PHRASE, [], format, "direct").backup);
  expect(content.decoys).toBeGreaterThan(0);
  expect(content.colors.length).toBe(own.colors.length + content.decoys!);
  expect(content.colors.slice(0, own.colors.length)).toEqual(own.colors);
  expect(content.labels?.slice(0, own.colors.length)).toEqual(own.labels);
  expect(content.payload).toBe(own.payload);
  assertColorCardContent(content);
  for (const attempt of attempts) {
    // Compare the full collection, including the trailing decoys, labels, profile and copy.
    // Separate cards keep the person's page turn, not the one the plan chose for its sheets
    // (AUD-022-FUN002).
    if (attempt.destination === "cards") {
      expect(attempt.job.content).toEqual(separateCardJob(first.job, undefined).content);
    } else {
      // Each save borrows fresh decoded views of the same byte-owned plan.
      expect(attempt.job.content).toEqual(content);
    }
    expect(attempt.job.template).toBe(first.job.template);
    expect(attempt.randomChoices).toBe(first.randomChoices);
    expect(attempt.identityChoices).toBe(first.identityChoices);
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

beforeEach(async () => {
  folder = await testFolder("mnemocode-aud021-export-");
  vi.stubEnv("PATH", `${bin}${delimiter}${process.env["PATH"] ?? ""}`);
  observed.attempts = [];
  observed.failures = new Map();
  observed.randomChoices = 0;
  observed.identityChoices = 0;
  observed.fontReads = 0;
  observed.fontFailures = 0;
  observed.privateScreen = false;
  observed.choices = [];
  observed.questions = [];
  observed.names = [];
  observed.nameQuestions = [];
  observed.notices = [];
  vi.stubEnv("NO_COLOR", "1");
  vi.spyOn(console, "log").mockImplementation(() => undefined);
  vi.spyOn(console, "error").mockImplementation((...line: unknown[]) => {
    observed.notices.push(line.join(" "));
  });
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

/** Whether the fake pdftocairo can stand in for the real one here. */
const PAGE_IMAGES = process.platform !== "win32";

describe.runIf(PAGE_IMAGES)(
  "AUD-021-FUN003: one card plan through the production Encode dispatcher",
  () => {
    it.each(["colors-unicode", "colors", "unicode"] as const)(
      "shares every real code and decorative decoy across all destinations for %s",
      async (format) => {
        await runEncode(argumentsFor(format));
        expect(observed.attempts.map(({ destination }) => destination)).toEqual([
          "pdf",
          "images",
          "cards",
        ]);
        expectSameCollection(observed.attempts, format);
        expect(observed.randomChoices).toBeGreaterThan(0);
        expect(observed.identityChoices).toBeGreaterThan(0);
        const pages = (await readdir(pathOf("images"))).length;
        const cards = observed.attempts[0]!.job.content.colors.length;
        expect(observed.notices.filter((line) => line.startsWith("Saved"))).toEqual([
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
        observed.privateScreen = true;
        for (const destination of ["pdf", "images", "cards"] as const) failOnce(destination);
        observed.choices = ["again", "again", "again"];
        await runEncode(argumentsFor());
        expect(observed.attempts.map(({ destination }) => destination)).toEqual([
          "pdf",
          "pdf",
          "images",
          "images",
          "cards",
          "cards",
        ]);
        expectSameCollection(observed.attempts, "colors-unicode");
        expect(saved()).toEqual(["pdf", "images", "cards"]);
        expect(observed.questions).toEqual([
          "What now?",
          "What now?",
          "What now?",
          "Check the backup now?",
        ]);
        expect(observed.notices.filter((line) => line.includes("could not be saved"))).toEqual([
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
        observed.privateScreen = true;
        failOnce("pdf");
        observed.choices = ["skip"];
        await runEncode(argumentsFor());
        expectSameCollection(observed.attempts, "colors-unicode");
        expect(saved()).toEqual(["images", "cards"]);
        expect(observed.notices).toContain("The PDF was not saved.");
        expect(observed.notices.some((line) => line.startsWith("Saved PDF:"))).toBe(false);
        expect(observed.questions).toEqual(["What now?", "Check the backup now?"]);
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
        observed.privateScreen = true;
        failOnce("pdf");
        observed.choices = ["other"];
        const other = join(folder, "other.pdf");
        observed.names = [other];
        const args = argumentsFor();
        await runEncode(args);
        expectSameCollection(observed.attempts, "colors-unicode");
        expect(existsSync(other)).toBe(true);
        expect(saved()).toEqual(["images", "cards"]);
        expect(args.pdf).toBe(other);
        expect(observed.nameQuestions).toEqual(["New name for the PDF:"]);
        expect(observed.notices).toContain(`Saved PDF: ${other}`);
      },
      LONG_TEST_TIME_LIMIT_MS,
    );

    it(
      "allows a failed library plan to be retried inside the destination's save loop",
      async () => {
        observed.privateScreen = true;
        observed.fontFailures = 1;
        observed.choices = ["again"];
        const args = argumentsFor();
        args["page-size"] = "a6";
        delete args["cards-dir"];
        await runEncode(args);
        expectSameCollection(observed.attempts, "colors-unicode");
        expect(saved()).toEqual(["pdf", "images"]);
        expect(observed.notices).toContain(
          `The PDF could not be saved as ${pathOf("pdf")}: synthetic font read failure.`,
        );
        expect(observed.questions).toEqual(["What now?", "Check the backup now?"]);
      },
      LONG_TEST_TIME_LIMIT_MS,
    );

    it("propagates a save error outside the private screen without saving later destinations", async () => {
      failOnce("pdf");
      await expect(runEncode(argumentsFor())).rejects.toMatchObject({ code: "ENOSPC" });
      expect(observed.attempts.map(({ destination }) => destination)).toEqual(["pdf"]);
      expect(saved()).toEqual([]);
      expect(observed.questions).toEqual([]);
    });

    it("does not plan cards for a record and standalone QR output", async () => {
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
      expect(observed.attempts).toEqual([]);
    });

    it(
      "starts a fresh plan for the next Encode run",
      async () => {
        const args = argumentsFor();
        await runEncode(args);
        const first = observed.attempts.splice(0);
        // The second run saves to new names: the first run's are taken.
        folder = await testFolder("mnemocode-aud021-export-");
        await runEncode(argumentsFor());
        expectSameCollection(first, "colors-unicode");
        expectSameCollection(observed.attempts, "colors-unicode");
        expect(observed.attempts[0]!.job.content.colors).not.toEqual(first[0]!.job.content.colors);
      },
      LONG_TEST_TIME_LIMIT_MS,
    );
  },
);
