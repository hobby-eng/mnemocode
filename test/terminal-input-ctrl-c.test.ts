import { EventEmitter } from "node:events";
import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Standard input and standard error are a terminal while `terminal.present` is set, and a Keyboard
// stands for the one on standard input, which records the raw modes asked for in `rawModes` and
// refuses raw mode while `refusesRawMode` is set. A question on the private screen is answered
// with Yes and records the raw modes until then.
const terminal = vi.hoisted(() => ({
  present: true,
  privateScreen: false,
  refusesRawMode: false,
  rawModes: [] as boolean[],
  modesAtQuestions: [] as boolean[][],
}));
vi.mock("node:tty", async (importOriginal) => ({
  ...(await importOriginal<typeof import("node:tty")>()),
  isatty: () => terminal.present,
}));
vi.mock("../src/cli/private-screen.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../src/cli/private-screen.js")>()),
  onPrivateScreen: () => terminal.privateScreen,
}));
vi.mock("../src/cli/terminal-choice.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../src/cli/terminal-choice.js")>()),
  choose: async () => {
    terminal.modesAtQuestions.push([...terminal.rawModes]);
    return true;
  },
}));

import { runRecoverDate } from "../src/cli/recover-date-command.js";
import { runRecoverWord } from "../src/cli/recover-word-command.js";
import { searchShareRepair } from "../src/cli/share-repair.js";
import { InputCancelled, watchForCtrlC, withCtrlCWatch } from "../src/cli/terminal-input.js";
import { planJointRepair } from "../src/sskr/joint-repair.js";
import "../src/sskr/share-platform-node.js";
import { writeShare } from "../src/sskr/transport.js";

const TEST_PHRASE =
  "abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about";
const CTRL_C = "\x03";
const CTRL_BACKSLASH = "\x1c";
const CTRL_Z = "\x1a";

/** Standard input as a terminal: what is typed arrives as chunks of bytes, as in raw mode. */
class Keyboard extends EventEmitter {
  readonly isTTY = true;
  flowing = false;

  setRawMode(raw: boolean): this {
    if (raw && terminal.refusesRawMode) throw new Error("setRawMode EIO");
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

  /** Delivers `text` as one chunk, and returns the chunk. */
  type(text: string): Buffer {
    const chunk = Buffer.from(text, "utf8");
    this.emit("data", chunk);
    return chunk;
  }
}

let keys = new Keyboard();

/** Expects the terminal given back as watchForCtrlC found it: raw mode left, nothing read. */
function expectTerminalGivenBack(): void {
  expect(terminal.rawModes.at(-1)).toBe(false);
  expect(keys.flowing).toBe(false);
  expect(keys.listenerCount("data")).toBe(0);
}

describe("Ctrl+C during a long search", () => {
  beforeEach(() => {
    keys = new Keyboard();
    terminal.present = true;
    terminal.privateScreen = false;
    terminal.refusesRawMode = false;
    terminal.rawModes = [];
    terminal.modesAtQuestions = [];
    vi.spyOn(process, "stdin", "get").mockReturnValue(keys as unknown as typeof process.stdin);
    vi.stubEnv("TERM", "xterm");
    // Progress and notices are not looked at here.
    vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    vi.spyOn(console, "log").mockImplementation(() => undefined);
  });
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
  });

  it("is read as a key in raw mode; other keys are dropped unseen and wiped", () => {
    const watch = watchForCtrlC();
    expect(terminal.rawModes).toEqual([true]);
    expect(keys.flowing).toBe(true);
    const typed = keys.type("abandon\r");
    expect(watch.signal.aborted).toBe(false);
    expect(typed.every((byte) => byte === 0)).toBe(true);
    keys.type(`x${CTRL_C}`);
    expect(watch.signal.aborted).toBe(true);
    expect(() => watch.signal.throwIfAborted()).toThrow(InputCancelled);
    watch.stop();
    expectTerminalGivenBack();
    // A second stop changes nothing.
    watch.stop();
    expect(terminal.rawModes).toEqual([true, false]);
  });

  it("takes Ctrl+\\ for Ctrl+C, so that no SIGQUIT ends the tool on the private screen", () => {
    const watch = watchForCtrlC();
    keys.type(CTRL_BACKSLASH);
    expect(() => watch.signal.throwIfAborted()).toThrow(InputCancelled);
    watch.stop();
    expectTerminalGivenBack();
  });

  it("suspends the whole job at Ctrl+Z, out of raw mode, and reads on once it continues", () => {
    // What kill is asked, with the raw modes until then; the job is not really stopped.
    const kills: [number, unknown, boolean[]][] = [];
    vi.spyOn(process, "kill").mockImplementation((pid, signal) => {
      kills.push([pid, signal, [...terminal.rawModes]]);
      return true;
    });
    const watch = watchForCtrlC();
    keys.type(CTRL_Z);
    expect(kills).toEqual([[0, "SIGTSTP", [true, false]]]);
    expect(terminal.rawModes).toEqual([true, false, true]);
    expect(watch.signal.aborted).toBe(false);
    keys.type(CTRL_C);
    expect(() => watch.signal.throwIfAborted()).toThrow(InputCancelled);
    watch.stop();
    expectTerminalGivenBack();
  });

  it("drops Ctrl+Z on Windows, which has no job control", () => {
    const kill = vi.spyOn(process, "kill").mockImplementation(() => true);
    vi.spyOn(process, "platform", "get").mockReturnValue("win32");
    const watch = watchForCtrlC();
    keys.type(CTRL_Z);
    expect(kill).not.toHaveBeenCalled();
    expect(terminal.rawModes).toEqual([true]);
    expect(watch.signal.aborted).toBe(false);
    watch.stop();
    expectTerminalGivenBack();
  });

  it("stops the search with the error when raw mode cannot be taken again after Ctrl+Z", () => {
    vi.spyOn(process, "kill").mockImplementation(() => {
      terminal.refusesRawMode = true;
      return true;
    });
    const watch = watchForCtrlC();
    keys.type(CTRL_Z);
    expect(() => watch.signal.throwIfAborted()).toThrow("setRawMode EIO");
    watch.stop();
    expectTerminalGivenBack();
  });

  it("stops watching when the search watched ends or fails", async () => {
    await expect(withCtrlCWatch(async (signal) => signal.aborted)).resolves.toBe(false);
    expectTerminalGivenBack();
    const failure = new Error("search failed");
    await expect(
      withCtrlCWatch(async () => {
        throw failure;
      }),
    ).rejects.toBe(failure);
    expectTerminalGivenBack();
    expect(terminal.rawModes).toEqual([true, false, true, false]);
  });

  it.each([
    ["no terminal", () => (terminal.present = false)],
    ["a dumb terminal", () => vi.stubEnv("TERM", "dumb")],
  ])("leaves standard input alone with %s, where Ctrl+C stays a signal", (_, setUp) => {
    setUp();
    const watch = watchForCtrlC();
    expect(watch.signal.aborted).toBe(false);
    watch.stop();
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
    await expect(search).rejects.toBeInstanceOf(InputCancelled);
    expect(terminal.rawModes).toEqual([true, false]);
    expectTerminalGivenBack();
  });

  it("stops a search for forgotten words at its next turn", async () => {
    // Two forgotten words: 4,194,304 combinations, some seconds of search.
    const search = runRecoverWord({ mnemonic: `? ? ${TEST_PHRASE.split(" ").slice(2).join(" ")}` });
    setTimeout(() => keys.type(CTRL_C), 10);
    await expect(search).rejects.toBeInstanceOf(InputCancelled);
    expect(terminal.rawModes).toEqual([true, false]);
    expectTerminalGivenBack();
  });

  it("stops a share repair at its next turn, watching only after the question", async () => {
    const vectors = JSON.parse(
      readFileSync(new URL("../vectors/sskr-v1.json", import.meta.url), "utf8"),
    ) as { deterministic: { shares: string[] }[] };
    const [first, second] = vectors.deterministic[0]!.shares;
    // Two unreadable colours: 65,536 combinations, several turns of the search.
    const parts = writeShare(second!, "colors").split(" ");
    for (const place of [5, 7]) parts[place] = "?";
    const plan = await planJointRepair([first!, parts.join(" ")]);
    expect(plan.assessment.verdict).toBe("search");
    expect(plan.assessment.combinations).toBe(2 ** 16);
    // Longer than allowed without a question, on the private screen: Yes is chosen.
    terminal.privateScreen = true;
    const search = searchShareRepair({ plan, triesPerSecond: 1 }, { shares: 1 });
    // Typed once the question is answered: a Ctrl+C typed before it would cancel at the drop of
    // the keys typed ahead, before the question is asked.
    const typeAfterQuestion = (): void => {
      if (terminal.modesAtQuestions.length === 0) setTimeout(typeAfterQuestion, 1);
      else setTimeout(() => keys.type(CTRL_C), 0);
    };
    typeAfterQuestion();
    await expect(search).rejects.toBeInstanceOf(InputCancelled);
    // The keys typed ahead are dropped in raw mode, which is left before the question; the watch
    // takes raw mode only after it.
    expect(terminal.modesAtQuestions).toEqual([[true, false]]);
    expect(terminal.rawModes).toEqual([true, false, true, false]);
    expectTerminalGivenBack();
  });
});
