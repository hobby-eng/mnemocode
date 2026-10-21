import { ShareInput } from "../src/sskr/share-input.js";
import { ShareRestore } from "../src/sskr/share-restore.js";
import { nodeSharePlatform } from "../src/sskr/share-platform-node.js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Standard input and standard error are a terminal while `terminal.present` is set, and a Keyboard
// stands for the one on standard input, which records the raw modes asked for in `rawModes` and
// refuses raw mode while `refusesRawMode` is set.
interface Terminal {
  present: boolean;
  refusesRawMode: boolean;
  rawModes: boolean[];
}
const terminal = vi.hoisted((): Terminal => ({
  present: true,
  refusesRawMode: false,
  rawModes: [],
}));
vi.mock("node:tty", async (importOriginal) => ({
  ...(await importOriginal<typeof import("node:tty")>()),
  isatty: () => terminal.present,
}));

import { runRecoverDate } from "../src/cli/recover-date-command.js";
import { runRecoverWord } from "../src/cli/recover-word-command.js";
import { withPrivateScreen } from "../src/cli/private-screen.js";
import { searchShareRepair } from "../src/cli/share-repair.js";
import { CtrlCWatch } from "../src/cli/terminal-input.js";
import { CANCELLED } from "../src/cli/terminal-keys.js";
import { writeShare } from "../src/sskr/transport.js";
import { drawnList, keysOfAnswer } from "./helpers/drawn-list.js";
import { CTRL_C, CTRL_Z } from "./helpers/keys.js";
import { sskrVectors } from "./helpers/vectors.js";
import {
  expectTerminalGivenBack,
  Keyboard,
  keyboardAsStandardInput,
} from "./helpers/terminal-streams.js";
import { replacedAt, TEST_PHRASE } from "./helpers/test-phrase.js";

// Windows deliberately keeps raw mode between reads so that ConPTY cannot lose Ctrl+C.
// Pausing and removing listeners still ends the watch; Unix also restores line mode immediately.
const RAW_ENTRY = process.platform === "win32" ? [false, true] : [true];
const RAW_SESSION = process.platform === "win32" ? [false, true] : [true, false];

const CTRL_BACKSLASH = "\x1c";

let keys = new Keyboard(terminal);

/** Expects an idle terminal with no listeners, retaining raw mode only on Windows. */
beforeEach(() => {
  keys = new Keyboard(terminal);
  terminal.present = true;
  terminal.refusesRawMode = false;
  terminal.rawModes = [];
  keyboardAsStandardInput(keys);
  // Progress and notices are not looked at here.
  vi.spyOn(process.stderr, "write").mockImplementation(() => true);
  vi.spyOn(console, "log").mockImplementation(() => undefined);
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

describe("Ctrl+C during a long search", () => {
  it("is read as a key in raw mode; other keys are dropped unseen and wiped", async () => {
    const watch = new CtrlCWatch();
    expect(terminal.rawModes).toEqual(RAW_ENTRY);
    expect(keys.flowing).toBe(true);
    const typed = keys.type("abandon\r");
    expect(watch.signal.aborted).toBe(false);
    expect(typed.every((byte) => byte === 0)).toBe(true);
    keys.type(`x${CTRL_C}`);
    expect(watch.signal.aborted).toBe(true);
    expect(watch.signal.reason).toBe(CANCELLED);
    await watch.stop();
    expectTerminalGivenBack(keys);
    // A second stop changes nothing.
    await watch.stop();
    expect(terminal.rawModes).toEqual(RAW_SESSION);
  });

  it("takes Ctrl+\\ for Ctrl+C, so that no SIGQUIT ends the tool on the private screen", async () => {
    const watch = new CtrlCWatch();
    keys.type(CTRL_BACKSLASH);
    expect(watch.signal.reason).toBe(CANCELLED);
    await watch.stop();
    expectTerminalGivenBack(keys);
  });

  // Windows has no job control: Ctrl+Z is dropped there, as a test of this file shows, never sent.
  it.skipIf(process.platform === "win32")(
    "suspends the whole job at Ctrl+Z, out of raw mode, and reads on once it continues",
    async () => {
      // What kill is asked, with the raw modes until then; the job is not really stopped.
      const kills: [number, unknown, boolean[]][] = [];
      vi.spyOn(process, "kill").mockImplementation((pid, signal) => {
        kills.push([pid, signal, [...terminal.rawModes]]);
        return true;
      });
      const watch = new CtrlCWatch();
      keys.type(CTRL_Z);
      expect(kills).toEqual([[0, "SIGTSTP", [true, false]]]);
      expect(terminal.rawModes).toEqual([true, false, true]);
      expect(watch.signal.aborted).toBe(false);
      keys.type(CTRL_C);
      expect(watch.signal.reason).toBe(CANCELLED);
      await watch.stop();
      expectTerminalGivenBack(keys);
    },
  );

  it("drops Ctrl+Z on Windows, which has no job control", async () => {
    const kill = vi.spyOn(process, "kill").mockImplementation(() => true);
    vi.spyOn(process, "platform", "get").mockReturnValue("win32");
    const watch = new CtrlCWatch();
    keys.type(CTRL_Z);
    expect(kill).not.toHaveBeenCalled();
    // Raw mode is taken again at once (RawMode.take), as another process may have left it.
    expect(terminal.rawModes).toEqual([false, true]);
    expect(watch.signal.aborted).toBe(false);
    await watch.stop();
    // Windows keeps raw mode until the process ends, so that a Ctrl+C is never lost (AUD-024).
    expect(terminal.rawModes.at(-1)).toBe(true);
    expect(keys.flowing).toBe(false);
    expect(keys.listenerCount("data")).toBe(0);
  });

  // Windows has no job control: Ctrl+Z is dropped there, as a test of this file shows, never sent.
  it.skipIf(process.platform === "win32")(
    "stops the search with the error when raw mode cannot be taken again after Ctrl+Z",
    async () => {
      vi.spyOn(process, "kill").mockImplementation(() => {
        terminal.refusesRawMode = true;
        return true;
      });
      const watch = new CtrlCWatch();
      keys.type(CTRL_Z);
      expect(() => watch.signal.throwIfAborted()).toThrow("setRawMode EIO");
      await watch.stop();
      expectTerminalGivenBack(keys);
    },
  );

  it("stops watching when the search watched ends or fails", async () => {
    await expect(CtrlCWatch.during(async (signal) => signal.aborted)).resolves.toBe(false);
    expectTerminalGivenBack(keys);
    const failure = new Error("search failed");
    await expect(
      CtrlCWatch.during(async () => {
        throw failure;
      }),
    ).rejects.toBe(failure);
    expectTerminalGivenBack(keys);
    expect(terminal.rawModes).toEqual([...RAW_SESSION, ...RAW_SESSION]);
  });
});

describe("Ctrl+C during a long search", () => {
  it.each([
    ["no terminal", () => (terminal.present = false)],
    ["a dumb terminal", () => vi.stubEnv("TERM", "dumb")],
  ])("leaves standard input alone with %s, where Ctrl+C stays a signal", async (_, setUp) => {
    setUp();
    const watch = new CtrlCWatch();
    expect(watch.signal.aborted).toBe(false);
    await watch.stop();
    expect(terminal.rawModes).toEqual([]);
    expect(keys.listenerCount("data")).toBe(0);
  });

  it("stops a date search at its next turn", async () => {
    const search = runRecoverDate({
      mode: "seedshift",
      format: "english",
      input: TEST_PHRASE,
      date: "01-01-????",
      "master-fingerprint": "deadbeef",
      "max-candidates": "10000",
    });
    setTimeout(() => keys.type(CTRL_C), 10);
    expect(await search).toBe(CANCELLED);
    expect(terminal.rawModes).toEqual(RAW_SESSION);
    expectTerminalGivenBack(keys);
  });

  it("stops a search for forgotten words at its next turn", async () => {
    // Two forgotten words: 4,194,304 combinations, some seconds of search.
    const search = runRecoverWord({ mnemonic: replacedAt(TEST_PHRASE, { 1: "?", 2: "?" }) });
    setTimeout(() => keys.type(CTRL_C), 10);
    expect(await search).toBe(CANCELLED);
    expect(terminal.rawModes).toEqual(RAW_SESSION);
    expectTerminalGivenBack(keys);
  });

  it("stops a share repair at its next turn, watching only after the question", async () => {
    const [first, second] = sskrVectors().deterministic[0]!.shares;
    // Two unreadable colours: 65,536 combinations.
    const parts = writeShare(second!, "colors").split(" ");
    for (const place of [5, 7]) parts[place] = "?";
    const input = new ShareInput({ decodeEntry: "The Decode entry" });
    input.add([first!, parts.join(" ")]);
    const read = await new ShareRestore(nodeSharePlatform).read(input);
    if (read.kind !== "marked") throw new Error("The shares were not read as marked.");
    expect(read.plan.assessment.verdict).toBe("search");
    expect(read.plan.assessment.combinations).toBe(2 ** 16);
    // Longer than allowed without a question, on the private screen, which asks it: Yes is chosen
    // once the question shows, with the raw modes until then.
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    let drawn = "";
    const modesAtQuestions: boolean[][] = [];
    vi.spyOn(process.stderr, "write").mockImplementation((chunk) => {
      drawn += typeof chunk === "string" ? chunk : Buffer.from(chunk).toString("utf8");
      const question = drawnList(drawn);
      if (question !== undefined) {
        drawn = "";
        modesAtQuestions.push([...terminal.rawModes]);
        setImmediate(() => keys.type(keysOfAnswer(question, "Yes")));
      }
      return true;
    });
    // Typed once the watch has taken the terminal, after the drop of the keys typed ahead and the
    // question, each of which took it and left it: a Ctrl+C typed before the question would cancel
    // at that drop, before the question is asked.
    const watched = 2 * RAW_SESSION.length + RAW_ENTRY.length;
    // Advance the host clock at each read so that even a fast computer yields. Deliver Ctrl+C at
    // the terminal's read edge, without a timer racing the search's completion.
    let now = 0;
    vi.spyOn(performance, "now").mockImplementation(() => (now += 100));
    const resume = keys.resume.bind(keys);
    let typedCancel = false;
    vi.spyOn(keys, "resume").mockImplementation(() => {
      const result = resume();
      if (!typedCancel && terminal.rawModes.length === watched) {
        typedCancel = true;
        setImmediate(() => keys.type(CTRL_C));
      }
      return result;
    });
    const search = withPrivateScreen(() => searchShareRepair(read, { shares: 1 }));
    expect(await search).toBe(CANCELLED);
    expect(typedCancel).toBe(true);
    // The question drops the keys typed ahead itself, then reads its own; the watch takes raw mode
    // only after it.
    expect(modesAtQuestions).toEqual([[...RAW_SESSION, ...RAW_ENTRY]]);
    expect(terminal.rawModes).toEqual([...RAW_SESSION, ...RAW_SESSION, ...RAW_SESSION]);
    expectTerminalGivenBack(keys);
  });
});
