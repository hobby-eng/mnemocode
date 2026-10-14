import { EventEmitter } from "node:events";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Standard input is a terminal, and a Keyboard stands for it as Node.js and libuv drive it: a
// paused terminal is still read until the next tick, when Node.js stops reading it, and a change of
// mode while it is read makes libuv read it again in the new mode. Leaving raw mode then starts a
// line-mode read, which on Windows (ReadConsoleW) libuv cancels with an Enter of its own, dropping
// the keys that read took: the next question missed the key pressed for it.
vi.mock("node:tty", async (importOriginal) => ({
  ...(await importOriginal<typeof import("node:tty")>()),
  isatty: () => true,
}));

import { dropTypedAhead, withCtrlCWatch } from "../src/cli/terminal-input.js";

/** Standard input as a terminal: records the line-mode reads that leaving raw mode started. */
class Keyboard extends EventEmitter {
  readonly isTTY = true;
  raw = false;
  reading = false;
  /** Each time raw mode was left while the terminal was still read. */
  lineReads = 0;

  setRawMode(raw: boolean): this {
    if (this.reading && this.raw && !raw) this.lineReads += 1;
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

beforeEach(() => {
  keys = new Keyboard();
  vi.spyOn(process, "stdin", "get").mockReturnValue(keys as unknown as typeof process.stdin);
  vi.stubEnv("TERM", "xterm");
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

describe("leaving raw mode", () => {
  it("waits until the terminal is no longer read, after a question", async () => {
    await dropTypedAhead();
    expect(keys.raw).toBe(false);
    expect(keys.lineReads).toBe(0);
  });

  it("waits until the terminal is no longer read, after a long search", async () => {
    await withCtrlCWatch(async () => undefined);
    expect(keys.raw).toBe(false);
    expect(keys.lineReads).toBe(0);
  });
});
