// The streams of a person's terminal, for the test that asks for them. Standard output and standard
// error: the layout of results follows whether a stream is a terminal (terminalLayout), and colour
// follows the colour settings alone (AUD-037-UI006), so that a test of the terminal layout makes
// both streams terminals rather than only forcing colour. Standard input: a Keyboard that the test
// types on, read by the real reader of terminal-input.ts.

import { EventEmitter } from "node:events";
import { expect, onTestFinished, vi } from "vitest";

/** Makes both streams terminals until the end of the current test. */
export function streamsAsTerminal(): void {
  const saved = (["stdout", "stderr"] as const).map(
    (name) => [name, Object.getOwnPropertyDescriptor(process[name], "isTTY")] as const,
  );
  for (const [name] of saved)
    Object.defineProperty(process[name], "isTTY", { value: true, configurable: true });
  onTestFinished(() => {
    for (const [name, descriptor] of saved)
      if (descriptor === undefined) Reflect.deleteProperty(process[name], "isTTY");
      else Object.defineProperty(process[name], "isTTY", descriptor);
  });
}

/** Where a Keyboard records the raw modes asked of it, and whether it refuses raw mode. */
export interface RawModes {
  /** Each raw mode asked for, in order. */
  readonly rawModes: boolean[];
  /** Whether turning raw mode on fails, as on a terminal that cannot do it. */
  readonly refusesRawMode?: boolean;
}

/**
 * Standard input as a terminal in raw mode. What is typed while nothing reads it stays in the
 * Keyboard, as in a terminal's own buffer, and arrives a moment after reading starts again. Each
 * raw mode asked for is recorded in the `RawModes` it is given, read at each call, so that a test
 * may put new records there.
 */
export class Keyboard extends EventEmitter {
  readonly isTTY = true;
  flowing = false;
  readonly #record: RawModes;
  /** Bytes typed while nothing reads: the terminal keeps them until a question reads again. */
  #held: Buffer[] = [];

  constructor(record: RawModes = { rawModes: [] }) {
    super();
    this.#record = record;
  }

  /** The raw modes asked for so far, in order. */
  get rawModes(): readonly boolean[] {
    return this.#record.rawModes;
  }

  setRawMode(raw: boolean): this {
    if (raw && this.#record.refusesRawMode === true) throw new Error("setRawMode EIO");
    this.#record.rawModes.push(raw);
    return this;
  }

  resume(): this {
    this.flowing = true;
    // A terminal gives what it kept at the next read, a moment after reading starts.
    setImmediate(() => {
      for (const chunk of this.#held.splice(0)) this.emit("data", chunk);
    });
    return this;
  }

  pause(): this {
    this.flowing = false;
    return this;
  }

  /** `keys` typed now, as one chunk, which it returns. */
  type(keys: string | Buffer): Buffer {
    const chunk = typeof keys === "string" ? Buffer.from(keys, "utf8") : keys;
    if (this.flowing) this.emit("data", chunk);
    else this.#held.push(chunk);
    return chunk;
  }
}

/**
 * Makes `keyboard` standard input until the end of the current test, as its own property of
 * process, on a terminal that TERM does not call dumb.
 */
export function keyboardAsStandardInput(keyboard: EventEmitter): void {
  const stdin = Object.getOwnPropertyDescriptor(process, "stdin");
  Object.defineProperty(process, "stdin", { get: () => keyboard, configurable: true });
  onTestFinished(() => {
    if (stdin === undefined) Reflect.deleteProperty(process, "stdin");
    else Object.defineProperty(process, "stdin", stdin);
  });
  vi.stubEnv("TERM", "xterm");
}

/**
 * Checks that the reader gave `keyboard` back: in line mode, except on Windows, which keeps raw
 * mode between reads so that ConPTY cannot lose Ctrl+C; paused; and with no listener left.
 */
export function expectTerminalGivenBack(keyboard: Keyboard): void {
  expect(keyboard.rawModes.at(-1)).toBe(process.platform === "win32");
  expect(keyboard.flowing).toBe(false);
  expect(keyboard.listenerCount("data")).toBe(0);
}
