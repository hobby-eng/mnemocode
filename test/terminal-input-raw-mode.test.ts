import { EventEmitter } from "node:events";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Standard input is a terminal, and a Keyboard stands for it as Node.js and libuv drive it: a
// paused terminal is still read until the next tick, when Node.js stops reading it, and a change of
// mode while it is read makes libuv read it again in the new mode. Leaving raw mode then starts a
// line-mode read, which on Windows (ReadConsoleW) libuv cancels with an Enter of its own, dropping
// the keys that read took: the next question missed the key pressed for it. libuv also skips a
// mode it believes set, while the console's own mode is shared with the other processes at it.
vi.mock("node:tty", async (importOriginal) => ({
  ...(await importOriginal<typeof import("node:tty")>()),
  isatty: () => true,
}));

import { CtrlCWatch, TerminalKeys } from "../src/cli/terminal-input.js";
import { keyboardAsStandardInput } from "./helpers/terminal-streams.js";

/** Standard input as a terminal: its console's mode, and the line-mode reads that leaving started. */
class Keyboard extends EventEmitter {
  readonly isTTY = true;
  /** The mode that libuv believes it set, which it does not set again. */
  #believed = false;
  /** The console's own mode, which another process at the same console may change. */
  raw = false;
  reading = false;
  /** Each time raw mode was left while the terminal was still read. */
  lineReads = 0;

  setRawMode(raw: boolean): this {
    if (raw === this.#believed) return this;
    if (this.reading && !raw) this.lineReads += 1;
    this.#believed = raw;
    this.raw = raw;
    return this;
  }

  resume(): this {
    this.reading = true;
    return this;
  }

  pause(): this {
    // Node.js stops reading a paused terminal one tick later (getStdin, onpause).
    process.nextTick(() => (this.reading = false));
    return this;
  }
}

let keys = new Keyboard();

/** The listeners of the process's "exit" that `body` adds. */
async function exitListenersAddedBy(body: () => Promise<unknown>): Promise<NodeJS.ExitListener[]> {
  const before = process.listeners("exit");
  await body();
  return process.listeners("exit").filter((listener) => !before.includes(listener));
}

beforeEach(() => {
  keys = new Keyboard();
  keyboardAsStandardInput(keys);
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

describe("leaving raw mode on Linux and macOS", () => {
  beforeEach(() => {
    vi.spyOn(process, "platform", "get").mockReturnValue("linux");
  });

  it("waits until the terminal is no longer read, after a question", async () => {
    await TerminalKeys.dropTypedAhead();
    expect(keys.raw).toBe(false);
    expect(keys.lineReads).toBe(0);
  });

  it("waits until the terminal is no longer read, after a long search", async () => {
    await CtrlCWatch.during(async () => undefined);
    expect(keys.raw).toBe(false);
    expect(keys.lineReads).toBe(0);
  });
});

describe("raw mode on Windows (AUD-024)", () => {
  beforeEach(() => {
    vi.spyOn(process, "platform", "get").mockReturnValue("win32");
  });

  it("stays on between questions, so that Ctrl+C is a key, and is left when the process ends", async () => {
    const added = await exitListenersAddedBy(() => TerminalKeys.dropTypedAhead());
    expect(keys.raw).toBe(true);
    expect(keys.lineReads).toBe(0);
    expect(added).toHaveLength(1);
    const [restore] = added;
    process.off("exit", restore!);
    // As Node.js calls it at the end of the process, with the exit code.
    restore!(0);
    expect(keys.raw).toBe(false);
  });

  it("is taken again at a question after a command of the menu gave the console its line mode", async () => {
    await TerminalKeys.dropTypedAhead();
    // Another process at the same console, which libuv here does not see.
    keys.raw = false;
    await CtrlCWatch.during(async () => expect(keys.raw).toBe(true));
    await TerminalKeys.dropTypedAhead();
    expect(keys.raw).toBe(true);
  });
});
