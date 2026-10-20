// Ctrl+C during the assessment of shares marked with ? (share-repair.ts, assessShares): it is
// read as a key, as during the search, so that it stops the tool where a Windows pseudo-console
// sends no SIGINT. Public test vectors only (vectors/sskr-v1.json, synthetic entropy).
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Standard input and standard error are a terminal, and a Keyboard stands for the one on standard
// input, which records the raw modes asked for in `rawModes`. A question (askSecretUntil) records
// the raw modes until then and gives the next of `answers` that its check takes. The assessment
// (planJointRepair) records the signal it is given, the raw modes until then and how it ended, and
// runs `atAssessment` first and `afterAssessment` once it has ended, before its caller goes on.
interface Terminal {
  rawModes: boolean[];
  answers: string[];
  modesAtQuestions: boolean[][];
  modesAtAssessments: boolean[][];
  signals: (AbortSignal | undefined)[];
  assessmentErrors: unknown[];
  assessmentVerdicts: string[];
  atAssessment: (() => void) | undefined;
  afterAssessment: (() => void) | undefined;
}
const terminal = vi.hoisted((): Terminal => ({
  rawModes: [],
  answers: [],
  modesAtQuestions: [],
  modesAtAssessments: [],
  signals: [],
  assessmentErrors: [],
  assessmentVerdicts: [],
  atAssessment: undefined,
  afterAssessment: undefined,
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
  // The restore assesses through JointRepair (sskr/share-restore.ts); its plan is watched here.
  class JointRepair extends original.JointRepair {
    override plan(records: readonly string[], options: { readonly signal?: AbortSignal } = {}) {
      terminal.signals.push(options.signal);
      terminal.modesAtAssessments.push([...terminal.rawModes]);
      terminal.atAssessment?.();
      const plan = super.plan(records, options);
      plan.then(
        (made) => {
          terminal.assessmentVerdicts.push(made.assessment.verdict);
          terminal.afterAssessment?.();
        },
        (error: unknown) => terminal.assessmentErrors.push(error),
      );
      return plan;
    }
  }
  return { ...original, JointRepair };
});

import { runSskrExport } from "../src/cli/sskr-export-command.js";
import { runSskrCombine } from "../src/cli/sskr-restore-command.js";
import { CANCELLED } from "../src/cli/terminal-keys.js";
import { MAX_JOINT_MARKED_ELEMENTS } from "../src/sskr/joint-repair.js";
import { writeShare } from "../src/sskr/transport.js";
import { sskrVectors } from "./helpers/vectors.js";
import {
  expectTerminalGivenBack,
  Keyboard,
  keyboardAsStandardInput,
} from "./helpers/terminal-streams.js";

// Windows deliberately keeps raw mode between reads so that ConPTY cannot lose Ctrl+C.
// Pausing and removing listeners still ends the watch; Unix also restores line mode immediately.
const RAW_ENTRY = process.platform === "win32" ? [false, true] : [true];
const RAW_SESSION = process.platform === "win32" ? [false, true] : [true, false];

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

let keys = new Keyboard(terminal);

/** Expects an idle terminal with no listeners, retaining raw mode only on Windows. */
/** Two shares of a 2-of-3 set, the second in colours with the elements at `marks` unreadable. */
function markedShares(marks: readonly number[]): [string, string] {
  const [first, second] = sskrVectors().deterministic[0]!.shares;
  const parts = writeShare(second!, "colors").split(" ");
  for (const place of marks) parts[place] = "?";
  return [first!, parts.join(" ")];
}

describe("Ctrl+C during the assessment of marked shares", () => {
  beforeEach(() => {
    keys = new Keyboard(terminal);
    terminal.rawModes = [];
    terminal.answers = [];
    terminal.modesAtQuestions = [];
    terminal.modesAtAssessments = [];
    terminal.signals = [];
    terminal.assessmentErrors = [];
    terminal.assessmentVerdicts = [];
    terminal.atAssessment = undefined;
    terminal.afterAssessment = undefined;
    keyboardAsStandardInput(keys);
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
    expect(await run({ share: markedShares(OPEN_MARKS) })).toBe(CANCELLED);
    // The watch ran during the assessment, gave it its signal, and the assessment stopped.
    expect(terminal.modesAtAssessments).toEqual([RAW_ENTRY]);
    expect(terminal.signals).toHaveLength(1);
    expect(terminal.signals[0]?.aborted).toBe(true);
    // A stop is no failure of the assessment (CORE-22): it ends with the verdict "stopped".
    expect(terminal.assessmentErrors).toEqual([]);
    expect(terminal.assessmentVerdicts).toEqual(["stopped"]);
    expect(terminal.rawModes).toEqual(RAW_SESSION);
    expectTerminalGivenBack(keys);
    // Nothing is shown or saved.
    expect(console.log).not.toHaveBeenCalled();
  });

  it("stops after the assessment when Ctrl+C came after its last check of the signal", async () => {
    // Typed once the assessment has ended, while it is still watched: it never sees the signal.
    terminal.afterAssessment = () => keys.type(CTRL_C);
    expect(await runSskrCombine({ share: markedShares(SETTLED_MARK) })).toBe(CANCELLED);
    // The assessment ended without hearing it; the check after it did.
    expect(terminal.signals).toHaveLength(1);
    expect(terminal.signals[0]?.aborted).toBe(true);
    expect(terminal.assessmentVerdicts).toHaveLength(1);
    expect(terminal.assessmentVerdicts).not.toContain("stopped");
    expect(terminal.assessmentErrors).toEqual([]);
    expect(terminal.rawModes).toEqual(RAW_SESSION);
    expectTerminalGivenBack(keys);
    expect(console.log).not.toHaveBeenCalled();
  });

  it("stops watching when the assessment fails", async () => {
    terminal.atAssessment = () => {
      throw new Error("The assessment failed.");
    };
    await expect(runSskrCombine({ share: markedShares(SETTLED_MARK) })).rejects.toThrow(
      "The assessment failed.",
    );
    expect(terminal.modesAtAssessments).toEqual([RAW_ENTRY]);
    expect(terminal.rawModes).toEqual(RAW_SESSION);
    expectTerminalGivenBack(keys);
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
    expect(terminal.modesAtQuestions).toEqual([[], RAW_SESSION]);
    expect(terminal.modesAtAssessments).toEqual([RAW_ENTRY]);
    expect(terminal.signals[0]?.aborted).toBe(false);
    // Then the search is watched on its own (share-repair.ts).
    expect(terminal.rawModes).toEqual([...RAW_SESSION, ...RAW_SESSION]);
    expectTerminalGivenBack(keys);
    expect(console.log).toHaveBeenCalled();
  });
});
