// Ctrl+C during the assessment of shares marked with ? (sskr-command.ts, assessMarkedShares): it is
// read as a key, as during the search, so that it stops the tool where a Windows pseudo-console
// sends no SIGINT. Public test vectors only (vectors/sskr-v1.json, synthetic entropy).
import { EventEmitter } from "node:events";
import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Standard input and standard error are a terminal, and a Keyboard stands for the one on standard
// input, which records the raw modes asked for in `rawModes`. A question (askSecretUntil) records
// the raw modes until then and gives the next of `answers` that its check takes. The assessment
// (planJointRepair) records the signal it is given, the raw modes until then and how it ended, and
// runs `atAssessment` first; without `passSignal` it is made without the signal, and so never
// checks it.
const terminal = vi.hoisted(() => ({
  rawModes: [] as boolean[],
  answers: [] as string[],
  modesAtQuestions: [] as boolean[][],
  modesAtAssessments: [] as boolean[][],
  signals: [] as (AbortSignal | undefined)[],
  assessmentErrors: [] as unknown[],
  atAssessment: undefined as (() => void) | undefined,
  passSignal: true,
}));
vi.mock("node:tty", async (importOriginal) => ({
  ...(await importOriginal<typeof import("node:tty")>()),
  isatty: () => true,
}));
vi.mock("../src/cli/ask.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../src/cli/ask.js")>()),
  askSecretUntil: async <T>(_prompt: string, check: (answer: string) => T | Promise<T>) => {
    terminal.modesAtQuestions.push([...terminal.rawModes]);
    const answer = terminal.answers.shift();
    if (answer === undefined) throw new Error("No answer was expected.");
    return check(answer);
  },
}));
vi.mock("../src/sskr/joint-repair.js", async (importOriginal) => {
  const original = await importOriginal<typeof import("../src/sskr/joint-repair.js")>();
  return {
    ...original,
    planJointRepair: (records: readonly string[], options?: { readonly signal?: AbortSignal }) => {
      terminal.signals.push(options?.signal);
      terminal.modesAtAssessments.push([...terminal.rawModes]);
      terminal.atAssessment?.();
      const plan = original.planJointRepair(records, terminal.passSignal ? options : {});
      plan.catch((error: unknown) => terminal.assessmentErrors.push(error));
      return plan;
    },
  };
});

import { runSskrCombine, runSskrExport } from "../src/cli/sskr-command.js";
import { InputCancelled } from "../src/cli/terminal-input.js";
import { MAX_JOINT_MARKED_ELEMENTS } from "../src/sskr/joint-repair.js";
import "../src/sskr/share-platform-node.js";
import { writeShare } from "../src/sskr/transport.js";

const CTRL_C = "\x03";
/** Any date: the Seedshift test only needs the question for it asked. */
const TEST_DATE = "23-09-2026";
/**
 * Unreadable colours of the second share. One is settled by the assessment alone, which then takes
 * a single turn; two leave 65,536 combinations, and the assessment takes a turn for each share
 * after its first, to find the elements that would help (joint-repair.ts, helpfulElements).
 */
const SETTLED_MARK = [5];
const OPEN_MARKS = [5, 7];

/** Standard input as a terminal: what is typed arrives as chunks of bytes, as in raw mode. */
class Keyboard extends EventEmitter {
  readonly isTTY = true;
  flowing = false;

  setRawMode(raw: boolean): this {
    terminal.rawModes.push(raw);
    return this;
  }

  resume(): this {
    this.flowing = true;
    return this;
  }

  pause(): this {
    this.flowing = false;
    return this;
  }

  type(text: string): void {
    this.emit("data", Buffer.from(text, "utf8"));
  }
}

let keys = new Keyboard();

/** Expects the terminal given back as the watch found it: raw mode left, nothing read. */
function expectTerminalGivenBack(): void {
  expect(terminal.rawModes.at(-1)).toBe(false);
  expect(keys.flowing).toBe(false);
  expect(keys.listenerCount("data")).toBe(0);
}

/** Two shares of a 2-of-3 set, the second in colours with the elements at `marks` unreadable. */
function markedShares(marks: readonly number[]): [string, string] {
  const vectors = JSON.parse(
    readFileSync(new URL("../vectors/sskr-v1.json", import.meta.url), "utf8"),
  ) as { deterministic: { shares: string[] }[] };
  const [first, second] = vectors.deterministic[0]!.shares;
  const parts = writeShare(second!, "colors").split(" ");
  for (const place of marks) parts[place] = "?";
  return [first!, parts.join(" ")];
}

describe("Ctrl+C during the assessment of marked shares", () => {
  beforeEach(() => {
    keys = new Keyboard();
    terminal.rawModes = [];
    terminal.answers = [];
    terminal.modesAtQuestions = [];
    terminal.modesAtAssessments = [];
    terminal.signals = [];
    terminal.assessmentErrors = [];
    terminal.atAssessment = undefined;
    terminal.passSignal = true;
    vi.spyOn(process, "stdin", "get").mockReturnValue(keys as unknown as typeof process.stdin);
    vi.stubEnv("TERM", "xterm");
    // The assessment, progress and results are not looked at here.
    vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    vi.spyOn(console, "log").mockImplementation(() => undefined);
  });
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
  });

  it.each([
    ["restoring", runSskrCombine],
    ["exporting", runSskrExport],
  ])("stops it at its next turn when %s shares", async (_, run) => {
    // Typed once the assessment has begun: it arrives at the assessment's first turn.
    terminal.atAssessment = () => setTimeout(() => keys.type(CTRL_C), 0);
    await expect(run({ share: markedShares(OPEN_MARKS) })).rejects.toBeInstanceOf(InputCancelled);
    // The watch ran during the assessment, gave it its signal, and the assessment stopped.
    expect(terminal.modesAtAssessments).toEqual([[true]]);
    expect(terminal.signals).toHaveLength(1);
    expect(terminal.signals[0]?.aborted).toBe(true);
    expect(terminal.assessmentErrors).toHaveLength(1);
    expect(terminal.assessmentErrors[0]).toBeInstanceOf(InputCancelled);
    expect(terminal.rawModes).toEqual([true, false]);
    expectTerminalGivenBack();
    // Nothing is shown or saved.
    expect(console.log).not.toHaveBeenCalled();
  });

  it("stops after the assessment when Ctrl+C came after its last check of the signal", async () => {
    // As at the assessment's last turn: the assessment never sees the signal aborted.
    terminal.atAssessment = () => keys.type(CTRL_C);
    terminal.passSignal = false;
    await expect(runSskrCombine({ share: markedShares(SETTLED_MARK) })).rejects.toBeInstanceOf(
      InputCancelled,
    );
    // The assessment ended without hearing it; the check after it did.
    expect(terminal.assessmentErrors).toEqual([]);
    expect(terminal.rawModes).toEqual([true, false]);
    expectTerminalGivenBack();
    expect(console.log).not.toHaveBeenCalled();
  });

  it("stops watching when the assessment fails", async () => {
    terminal.atAssessment = () => {
      throw new Error("The assessment failed.");
    };
    await expect(runSskrCombine({ share: markedShares(SETTLED_MARK) })).rejects.toThrow(
      "The assessment failed.",
    );
    expect(terminal.modesAtAssessments).toEqual([[true]]);
    expect(terminal.rawModes).toEqual([true, false]);
    expectTerminalGivenBack();
  });

  it("refuses too many marks before the assessment, without watching", async () => {
    const [first] = markedShares(SETTLED_MARK);
    const unreadable = Array.from({ length: MAX_JOINT_MARKED_ELEMENTS + 1 }, () => "?").join(" ");
    await expect(runSskrCombine({ share: [first, unreadable] })).rejects.toThrow(
      `Share 2: mark at most ${MAX_JOINT_MARKED_ELEMENTS} unreadable elements with ?.`,
    );
    expect(terminal.modesAtAssessments).toEqual([]);
    expect(terminal.rawModes).toEqual([]);
  });

  it("asks for the dates only after the watch of the assessment has stopped", async () => {
    terminal.answers = [markedShares(SETTLED_MARK).join(";"), TEST_DATE];
    await runSskrCombine({ mode: "seedshift", "ask-secrets": true });
    // The shares are asked before the assessment, the dates after it; neither while it is watched.
    expect(terminal.modesAtQuestions).toEqual([[], [true, false]]);
    expect(terminal.modesAtAssessments).toEqual([[true]]);
    expect(terminal.signals[0]?.aborted).toBe(false);
    // Then the search is watched on its own (share-repair.ts).
    expect(terminal.rawModes).toEqual([true, false, true, false]);
    expectTerminalGivenBack();
    expect(console.log).toHaveBeenCalled();
  });
});
