// Ctrl+C during the assessment of shares marked with ? (share-repair.ts, assessShares): it is
// read as a key, as during the search, so that it stops the tool where a Windows pseudo-console
// sends no SIGINT. Public test vectors only (vectors/sskr-v1.json, synthetic entropy).
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Standard input and standard error are a terminal, and a Keyboard stands for the one on standard
// input, which records the raw modes asked for in `rawModes`. A question is answered once its
// prompt shows, with the raw modes until then recorded. The terminal's edge (terminal-input.ts)
// runs as it is, observed: its watch of a long search records each work it watches (`watches`),
// the first of a command being the assessment of the shares, and runs `atAssessment` as that
// work begins and `afterAssessment` once it has ended, while still watched; and the turns of the
// event loop that a search takes fail with `turnFailure` where a test gives one.
interface Watched {
  /** The raw modes asked for until the watched work began. */
  readonly modes: boolean[];
  readonly signal: AbortSignal;
  /** The verdict of the plan that the work gave, where it assessed marked shares. */
  verdict: string | undefined;
  /** What the work failed with; undefined where it did not fail. */
  error: unknown;
}
interface Terminal {
  rawModes: boolean[];
  /** The answer typed at each prompt, in turn, once the prompt shows. */
  answers: { readonly prompt: string; readonly typed: string }[];
  modesAtQuestions: boolean[][];
  watches: Watched[];
  atAssessment: (() => void) | undefined;
  afterAssessment: (() => void) | undefined;
  turnFailure: Error | undefined;
}
const terminal = vi.hoisted((): Terminal => ({
  rawModes: [],
  answers: [],
  modesAtQuestions: [],
  watches: [],
  atAssessment: undefined,
  afterAssessment: undefined,
  turnFailure: undefined,
}));
vi.mock("node:tty", async (importOriginal) => ({
  ...(await importOriginal<typeof import("node:tty")>()),
  isatty: () => true,
}));
vi.mock("../src/cli/terminal-input.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../src/cli/terminal-input.js")>();
  /** The verdict of `made`, where it is a plan of marked shares, which has an assessment. */
  const verdictOf = (made: unknown): string | undefined => {
    if (typeof made !== "object" || made === null || !("assessment" in made)) return undefined;
    const { assessment } = made;
    if (typeof assessment !== "object" || assessment === null || !("verdict" in assessment))
      return undefined;
    return typeof assessment.verdict === "string" ? assessment.verdict : undefined;
  };
  class RecordedWatch extends actual.CtrlCWatch {
    static override during<T>(this: void, search: (signal: AbortSignal) => Promise<T>): Promise<T> {
      return actual.CtrlCWatch.during(async (signal) => {
        const watched: Watched = {
          modes: [...terminal.rawModes],
          signal,
          verdict: undefined,
          error: undefined,
        };
        terminal.watches.push(watched);
        // Only the first work of a command is the assessment.
        const assessment = terminal.watches.length === 1;
        if (assessment) terminal.atAssessment?.();
        try {
          const made = await search(signal);
          watched.verdict = verdictOf(made);
          if (assessment) terminal.afterAssessment?.();
          return made;
        } catch (error) {
          watched.error = error;
          throw error;
        }
      });
    }
  }
  return {
    ...actual,
    CtrlCWatch: RecordedWatch,
    nodeTurn: async () => {
      if (terminal.turnFailure !== undefined) throw terminal.turnFailure;
      return actual.nodeTurn();
    },
  };
});

import { runSskrExport } from "../src/cli/sskr-export-command.js";
import { runSskrCombine } from "../src/cli/sskr-restore-command.js";
import { CANCELLED } from "../src/cli/terminal-keys.js";
import { MAX_JOINT_MARKED_ELEMENTS } from "../src/sskr/joint-repair.js";
import { writeShare } from "../src/sskr/transport.js";
import { SHARE_SEPARATOR } from "../src/sskr/share-input.js";
import { CTRL_C } from "./helpers/keys.js";
import { sskrVectors } from "./helpers/vectors.js";
import {
  expectTerminalGivenBack,
  Keyboard,
  keyboardAsStandardInput,
} from "./helpers/terminal-streams.js";
import { DATE } from "./helpers/test-phrase.js";

// Windows deliberately keeps raw mode between reads so that ConPTY cannot lose Ctrl+C.
// Pausing and removing listeners still ends the watch; Unix also restores line mode immediately.
const RAW_ENTRY = process.platform === "win32" ? [false, true] : [true];
const RAW_SESSION = process.platform === "win32" ? [false, true] : [true, false];

/** The beginnings of the questions for the shares and for the dates, as the restore asks them. */
const SHARES_QUESTION = "Shamir shares or text file path";
const DATES_QUESTION = "Dates (";
/**
 * Unreadable colours of the second share. One is settled by the assessment alone, which then takes
 * a single turn; two leave 65,536 combinations, and the assessment takes a turn for each share
 * after its first, to find the elements that would help (joint-repair.ts, helpfulElements).
 */
const SETTLED_MARK = [5];
const OPEN_MARKS = [5, 7];

let keys = new Keyboard(terminal);

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
    terminal.watches = [];
    terminal.atAssessment = undefined;
    terminal.afterAssessment = undefined;
    terminal.turnFailure = undefined;
    keyboardAsStandardInput(keys);
    // The assessment, progress and results are not looked at here; a prompt is answered once it
    // shows, as a person answers it.
    vi.spyOn(process.stderr, "write").mockImplementation((chunk) => {
      const next = terminal.answers[0];
      const text = typeof chunk === "string" ? chunk : Buffer.from(chunk).toString("utf8");
      if (next !== undefined && text.includes(next.prompt)) {
        terminal.answers.shift();
        terminal.modesAtQuestions.push([...terminal.rawModes]);
        setImmediate(() => keys.type(`${next.typed}\r`));
      }
      return true;
    });
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    vi.spyOn(console, "log").mockImplementation(() => undefined);
  });
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
    expect(terminal.answers, "a question that was not asked").toEqual([]);
  });

  it.each([
    ["restoring", runSskrCombine],
    ["exporting", runSskrExport],
  ])("stops it at its next turn when %s shares", async (_, run) => {
    // Typed once the assessment has begun: it arrives at the assessment's first turn.
    terminal.atAssessment = () => setTimeout(() => keys.type(CTRL_C), 0);
    expect(await run({ share: markedShares(OPEN_MARKS) })).toBe(CANCELLED);
    // The watch ran during the assessment, gave it its signal, and the assessment stopped. A stop
    // is no failure of the assessment (CORE-22): it ends with the verdict "stopped".
    expect(terminal.watches).toHaveLength(1);
    const [assessment] = terminal.watches;
    expect(assessment).toMatchObject({ modes: RAW_ENTRY, verdict: "stopped", error: undefined });
    expect(assessment!.signal.aborted).toBe(true);
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
    expect(terminal.watches).toHaveLength(1);
    const [assessment] = terminal.watches;
    expect(assessment!.signal.aborted).toBe(true);
    expect(assessment!.verdict).toBeDefined();
    expect(assessment!.verdict).not.toBe("stopped");
    expect(assessment!.error).toBeUndefined();
    expect(terminal.rawModes).toEqual(RAW_SESSION);
    expectTerminalGivenBack(keys);
    expect(console.log).not.toHaveBeenCalled();
  });

  it("stops watching when the assessment fails", async () => {
    // The turn that the assessment takes fails, as a broken event loop would.
    const failure = new Error("The assessment failed.");
    terminal.turnFailure = failure;
    await expect(runSskrCombine({ share: markedShares(SETTLED_MARK) })).rejects.toBe(failure);
    expect(terminal.watches).toHaveLength(1);
    expect(terminal.watches[0]).toMatchObject({
      modes: RAW_ENTRY,
      verdict: undefined,
      error: failure,
    });
    expect(terminal.rawModes).toEqual(RAW_SESSION);
    expectTerminalGivenBack(keys);
  });

  it("refuses too many marks before the assessment, without watching", async () => {
    const [first] = markedShares(SETTLED_MARK);
    const unreadable = Array.from({ length: MAX_JOINT_MARKED_ELEMENTS + 1 }, () => "?").join(" ");
    await expect(runSskrCombine({ share: [first, unreadable] })).rejects.toThrow(
      `Share 2: mark at most ${MAX_JOINT_MARKED_ELEMENTS} unreadable elements with ?.`,
    );
    expect(terminal.watches).toEqual([]);
    expect(terminal.rawModes).toEqual([]);
  });

  it("asks for the dates only after the watch of the assessment has stopped", async () => {
    terminal.answers = [
      { prompt: SHARES_QUESTION, typed: markedShares(SETTLED_MARK).join(SHARE_SEPARATOR) },
      { prompt: DATES_QUESTION, typed: DATE },
    ];
    await runSskrCombine({ mode: "seedshift", "ask-secrets": true });
    // The shares are asked before the assessment, the dates after it; neither while it is watched:
    // each question takes raw mode itself, after the watch has given it back.
    expect(terminal.modesAtQuestions).toEqual([
      RAW_ENTRY,
      [...RAW_SESSION, ...RAW_SESSION, ...RAW_ENTRY],
    ]);
    const [assessment] = terminal.watches;
    expect(assessment!.modes).toEqual([...RAW_SESSION, ...RAW_ENTRY]);
    expect(assessment!.signal.aborted).toBe(false);
    // Then the search is watched on its own (share-repair.ts).
    expect(terminal.rawModes).toEqual([
      ...RAW_SESSION,
      ...RAW_SESSION,
      ...RAW_SESSION,
      ...RAW_SESSION,
    ]);
    expectTerminalGivenBack(keys);
    expect(console.log).toHaveBeenCalled();
  });
});
