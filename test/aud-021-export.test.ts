// AUD-021-FUN003: exercise runEncode's real destination and retry loops with the library planner,
// which plans the sheet with the real font. What crosses the program's edge is replaced: the
// exporters, which would render and write PDFs and images, are passive stand-ins for the files and
// pdftocairo; the terminal answers and the host's randomness are synthetic, and the font's read is
// counted and fails where a test asks.
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ParsedArguments } from "../src/cli/arguments.js";
import type { AnswerParser } from "../src/cli/ask.js";
import { separateCardJob, type CardJob } from "../src/export/render.js";
import type { CardDrawing } from "../src/export/templates.js";
import type { EncodedFormat } from "../src/core/types.js";

type Destination = "pdf" | "images" | "cards";
interface Attempt {
  readonly destination: Destination;
  readonly job: CardJob;
  readonly randomChoices: number;
  readonly identityChoices: number;
}

const observed = vi.hoisted(() => ({
  attempts: [] as Attempt[],
  saved: [] as { destination: Destination; path: string }[],
  failures: {} as Partial<Record<Destination, number>>,
  randomChoices: 0,
  identityChoices: 0,
  fontReads: 0,
  fontFailures: 0,
  privateScreen: false,
  choices: [] as ("again" | "other" | "skip")[],
  questions: [] as string[],
  names: [] as string[],
  nameQuestions: [] as string[],
  notices: [] as string[],
  plainSaves: [] as string[],
}));

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
      // The font, which only a sheet's plan reads here, since the exporters are passive.
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
vi.mock("../src/export/pdf.js", async (original) => ({
  ...(await original<typeof import("../src/export/pdf.js")>()),
  exportCards: async (jobs: readonly CardJob[], path: string) => {
    observe("pdf", jobs[0]!);
    save("pdf", path);
  },
  renderCards: async (_drawing: CardDrawing, jobs: readonly CardJob[]) => {
    observe("images", jobs[0]!);
    return new Uint8Array();
  },
}));
vi.mock("../src/export/image-export.js", async (original) => ({
  ...(await original<typeof import("../src/export/image-export.js")>()),
  assertImageRenderer: async () => undefined,
  exportPageImages: async (_document: Uint8Array, path: string) => {
    save("images", path);
    return 1;
  },
}));
vi.mock("../src/export/individual-cards.js", async (original) => ({
  ...(await original<typeof import("../src/export/individual-cards.js")>()),
  exportIndividualCards: async (
    template: CardJob["template"],
    content: CardJob["content"],
    path: string,
  ) => {
    observe("cards", { template, content });
    save("cards", path);
    return content.colors.length;
  },
}));
vi.mock("../src/export/private-file.js", async (original) => ({
  ...(await original<typeof import("../src/export/private-file.js")>()),
  publishNewPrivateFile: async (path: string) => {
    observed.plainSaves.push(path);
  },
}));
vi.mock("../src/export/qr-image.js", async (original) => ({
  ...(await original<typeof import("../src/export/qr-image.js")>()),
  exportQrPayload: async (_payload: string, path: string) => {
    observed.plainSaves.push(path);
  },
}));
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

function observe(destination: Destination, job: CardJob): void {
  observed.attempts.push({
    destination,
    job,
    randomChoices: observed.randomChoices,
    identityChoices: observed.identityChoices,
  });
}

function save(destination: Destination, path: string): void {
  const failures = observed.failures[destination] ?? 0;
  if (failures > 0) {
    observed.failures[destination] = failures - 1;
    throw Object.assign(new Error("Synthetic full disk."), { code: "ENOSPC" });
  }
  observed.saved.push({ destination, path });
}

function argumentsFor(format: EncodedFormat = "colors-unicode"): ParsedArguments {
  return {
    mnemonic: TEST_PHRASE,
    mode: "direct",
    format,
    template: "business-it",
    "page-size": "business",
    pdf: join(folder, "public.pdf"),
    "images-dir": join(folder, "images"),
    "cards-dir": join(folder, "cards"),
  };
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
      expect(attempt.job.content).toBe(content);
    }
    expect(attempt.job.template).toBe(first.job.template);
    expect(attempt.randomChoices).toBe(first.randomChoices);
    expect(attempt.identityChoices).toBe(first.identityChoices);
  }
}

beforeEach(async () => {
  folder = await mkdtemp(join(tmpdir(), "mnemocode-aud021-export-"));
  observed.attempts = [];
  observed.saved = [];
  observed.failures = {};
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
  observed.plainSaves = [];
  vi.stubEnv("NO_COLOR", "1");
  vi.spyOn(console, "log").mockImplementation(() => undefined);
  vi.spyOn(console, "error").mockImplementation((...line: unknown[]) => {
    observed.notices.push(line.join(" "));
  });
});

afterEach(async () => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  await rm(folder, { recursive: true, force: true });
});

describe("AUD-021-FUN003: one card plan through the production Encode dispatcher", () => {
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
      expect(observed.fontReads).toBe(0);
      expect(observed.randomChoices).toBeGreaterThan(0);
      expect(observed.identityChoices).toBeGreaterThan(0);
      expect(observed.notices.filter((line) => line.startsWith("Saved"))).toEqual([
        `Saved PDF: ${join(folder, "public.pdf")}`,
        `Saved 1 PNG pages to: ${join(folder, "images")}`,
        `Saved ${observed.attempts[0]!.job.content.colors.length} individual card files to: ${join(folder, "cards")}`,
      ]);
    },
  );

  it("keeps the completed plan while each destination retries its own save failure", async () => {
    observed.privateScreen = true;
    observed.failures = { pdf: 1, images: 1, cards: 1 };
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
    expect(observed.fontReads).toBe(0);
    expect(observed.saved.map(({ destination }) => destination)).toEqual([
      "pdf",
      "images",
      "cards",
    ]);
    expect(observed.questions).toEqual([
      "What now?",
      "What now?",
      "What now?",
      "Check the backup now?",
    ]);
    expect(observed.notices.filter((line) => line.includes("could not be saved"))).toEqual([
      `The PDF could not be saved as ${join(folder, "public.pdf")}: the disk is full.`,
      `The images could not be saved as ${join(folder, "images")}: the disk is full.`,
      `The card files could not be saved as ${join(folder, "cards")}: the disk is full.`,
    ]);
  });

  it("keeps the same plan for the remaining destinations after the PDF is skipped", async () => {
    observed.privateScreen = true;
    observed.failures.pdf = 1;
    observed.choices = ["skip"];
    await runEncode(argumentsFor());
    expectSameCollection(observed.attempts, "colors-unicode");
    expect(observed.fontReads).toBe(0);
    expect(observed.saved.map(({ destination }) => destination)).toEqual(["images", "cards"]);
    expect(observed.notices).toContain("The PDF was not saved.");
    expect(observed.notices.some((line) => line.startsWith("Saved PDF:"))).toBe(false);
    expect(observed.questions).toEqual(["What now?", "Check the backup now?"]);
  });
});

describe("AUD-021-FUN003: one card plan through the production Encode dispatcher", () => {
  it("keeps the card plan when a failed PDF is saved under another checked name", async () => {
    observed.privateScreen = true;
    observed.failures.pdf = 1;
    observed.choices = ["other"];
    const other = join(folder, "other.pdf");
    observed.names = [other];
    const args = argumentsFor();
    await runEncode(args);
    expectSameCollection(observed.attempts, "colors-unicode");
    expect(observed.fontReads).toBe(0);
    expect(observed.saved[0]).toEqual({ destination: "pdf", path: other });
    expect(args.pdf).toBe(other);
    expect(observed.nameQuestions).toEqual(["New name for the PDF:"]);
    expect(observed.notices).toContain(`Saved PDF: ${other}`);
  });

  it("allows a failed library plan to be retried inside the destination's save loop", async () => {
    observed.privateScreen = true;
    observed.fontFailures = 1;
    observed.choices = ["again"];
    const args = argumentsFor();
    args["page-size"] = "a6";
    delete args["cards-dir"];
    await runEncode(args);
    expect(observed.fontReads).toBe(2);
    expectSameCollection(observed.attempts, "colors-unicode");
    expect(observed.saved.map(({ destination }) => destination)).toEqual(["pdf", "images"]);
    expect(observed.notices).toContain(
      `The PDF could not be saved as ${join(folder, "public.pdf")}: synthetic font read failure.`,
    );
    expect(observed.questions).toEqual(["What now?", "Check the backup now?"]);
  });

  it("propagates a save error outside the private screen without saving later destinations", async () => {
    observed.failures.pdf = 1;
    await expect(runEncode(argumentsFor())).rejects.toMatchObject({ code: "ENOSPC" });
    expect(observed.attempts.map(({ destination }) => destination)).toEqual(["pdf"]);
    expect(observed.saved).toEqual([]);
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
    expect(observed.plainSaves).toEqual([record, qr]);
    expect(observed.fontReads).toBe(0);
    expect(observed.randomChoices).toBe(0);
    expect(observed.identityChoices).toBe(0);
    expect(observed.attempts).toEqual([]);
  });

  it("starts a fresh plan for the next Encode run", async () => {
    const args = argumentsFor();
    await runEncode(args);
    const first = observed.attempts.splice(0);
    await runEncode(args);
    expectSameCollection(first, "colors-unicode");
    expectSameCollection(observed.attempts, "colors-unicode");
    expect(observed.fontReads).toBe(0);
    expect(observed.attempts[0]!.job.content.colors).not.toEqual(first[0]!.job.content.colors);
  });
});
