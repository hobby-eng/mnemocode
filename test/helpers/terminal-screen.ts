// The terminal of the tests of questions at a terminal: a screen that understands what the
// questions write, the keys that the tests type, and the hooks that put the terminal back after
// each test. The keys are given to keyed-terminal.ts, which replaces the terminal's input.

import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { format } from "node:util";
import { afterAll, afterEach, beforeAll, beforeEach, expect, vi } from "vitest";
import { askLine, startRecord } from "../../src/cli/terminal-choice.js";
import { displayWidth } from "../../src/cli/terminal-geometry.js";
import { terminal } from "./keyed-terminal.js";

/** The keys that the tests type. */
export const ESCAPE = "\x1b";
export const DOWN = "\x1b[B";
export const LEFT = "\x1b[D";
export const HOME = "\x1b[H";
export const CTRL_A = "\x01";
export const CTRL_D = "\x04";
export const CTRL_U = "\x15";
export const BACKSPACE = "\x7f";
export const ENTER = "\r";

/**
 * A terminal `columns` wide with as many rows as are written, or at most `height`, after which it
 * scrolls: its top row then goes into the scrollback, out of reach. It understands what the
 * questions write: text, which waits at the right edge until the next character before it wraps,
 * as terminals do, and a wide character that does not fit there goes whole to the next row; a line
 * feed, which also goes back to the left edge (ONLCR, which raw mode keeps); a carriage return;
 * and the sequences for cursor up, cursor right, cursor home, erase to the end of the screen or
 * all of it, and colours. Any other sequence fails the test.
 */
export class Screen {
  #rows: string[][] = [[]];
  #row = 0;
  #column = 0;
  /** Whether the cursor waits on the last column, where the next character wraps first. */
  #waiting = false;

  readonly #columns: number;
  readonly #height: number;

  constructor(columns: number, height = Number.POSITIVE_INFINITY) {
    this.#columns = columns;
    this.#height = height;
  }

  write(text: string): void {
    const characters = Array.from(text);
    for (let index = 0; index < characters.length; index += 1) {
      const character = characters[index]!;
      if (character === ESCAPE) index = this.#control(characters, index);
      else if (character === "\r") this.#moveTo(this.#row, 0);
      else if (character === "\n") this.#moveTo(this.#row + 1, 0);
      else this.#put(character);
    }
  }

  /** The text of every row, without the spaces at the end, down to the row of the cursor. */
  lines(): string[] {
    return this.#rows.map((cells) => cells.join("").trimEnd());
  }

  cursor(): readonly [number, number] {
    return [this.#row, this.#column];
  }

  #moveTo(row: number, column: number): void {
    this.#row = Math.max(0, row);
    this.#column = Math.min(this.#columns - 1, column);
    this.#waiting = false;
    while (this.#rows.length <= this.#row) this.#rows.push([]);
    // Below the last row the screen scrolls up, and the cursor stays on the last row.
    while (this.#rows.length > this.#height) {
      this.#rows.shift();
      this.#row -= 1;
    }
  }

  #put(character: string): void {
    const width = displayWidth(character);
    if (this.#waiting || this.#column + width > this.#columns) this.#moveTo(this.#row + 1, 0);
    const cells = this.#rows[this.#row]!;
    while (cells.length < this.#column) cells.push(" ");
    // A wide character takes two cells; the second is left empty.
    cells.splice(this.#column, width, character, ...Array<string>(width - 1).fill(""));
    if (this.#column + width === this.#columns) this.#waiting = true;
    else this.#column += width;
  }

  /** Reads the sequence that starts at `at` (ECMA-48 CSI) and returns where it ends. */
  #control(characters: readonly string[], at: number): number {
    if (characters[at + 1] !== "[") throw new Error(`unexpected escape at ${at}`);
    let end = at + 2;
    let parameters = "";
    while (end < characters.length && !/[@-~]/u.test(characters[end]!))
      parameters += characters[end++];
    const final = characters[end];
    const count = Number(parameters === "" ? "1" : parameters);
    if (final === "A") this.#moveTo(this.#row - count, this.#column);
    else if (final === "C") this.#moveTo(this.#row, this.#column + count);
    else if (final === "H" && parameters === "") this.#moveTo(0, 0);
    else if (final === "J" && parameters === "") {
      this.#rows[this.#row] = this.#rows[this.#row]!.slice(0, this.#column);
      this.#rows.length = this.#row + 1;
    } else if (final === "J" && parameters === "2") {
      // Every row is cleared; those below the cursor count as never written.
      this.#rows = Array.from({ length: this.#row + 1 }, () => []);
    } else if (final !== "m") throw new Error(`unexpected sequence ESC [ ${parameters}${final}`);
    return end;
  }
}

/** A screen of `columns` with `text` written on it, to compare a screen with. */
export function screenOf(
  columns: number,
  text: string,
): { lines: string[]; cursor: readonly number[] } {
  const screen = new Screen(columns);
  screen.write(text);
  return { lines: screen.lines(), cursor: screen.cursor() };
}

/**
 * What the terminal says of its size; no `columns` when it does not say. A screen without a
 * `height` has as many rows as are written, and says that it has more than any test writes.
 */
export interface Reported {
  readonly columns?: number;
  readonly height?: number;
}

/** The rows that a screen without a height says it has. */
const UNLIMITED_ROWS = 100_000;

/**
 * Sends everything written on standard error, also with console.error, to a screen of `columns`,
 * while the terminal says that it is as large as `reported`.
 */
export function watchScreen(columns: number, reported: Reported = { columns }): Screen {
  stopWatching();
  (process.stderr as { columns?: number | undefined }).columns = reported.columns;
  (process.stderr as { rows?: number }).rows = reported.height ?? UNLIMITED_ROWS;
  const screen = new Screen(columns, reported.height);
  // Replaced by hand, not with vi.spyOn: a spy keeps every call it sees, and the walk through every
  // path of the menu below writes so much that the kept calls took gigabytes of memory.
  process.stderr.write = ((chunk: string | Uint8Array) => {
    // Decoded at once: readLine wipes its buffer when it returns.
    screen.write(typeof chunk === "string" ? chunk : Buffer.from(chunk).toString("utf8"));
    return true;
  }) as typeof process.stderr.write;
  console.error = (...parts: unknown[]) => {
    screen.write(`${format(...parts)}\n`);
  };
  return screen;
}

/** The writers that watchScreen replaces. */
// oxlint-disable-next-line typescript/unbound-method -- kept to be put back on process.stderr
const originalWrite = process.stderr.write;
const originalError = console.error;

/** Puts back what watchScreen replaced. */
export function stopWatching(): void {
  process.stderr.write = originalWrite;
  console.error = originalError;
}

/** A line of the record of answers as writeAnswer writes it, without colours. */
export function answerLine(label: string, answer: string): string {
  return `  ${label.padEnd(11)} ${answer}\n`;
}

/** A folder for the files that the menu's questions name, made for the tests. */
export let folder = "";

const originalColumns = process.stderr.columns;
const originalRows = process.stderr.rows;

/**
 * Before the tests, the folder; before each, a terminal with nothing asked and a record of
 * answers of its own; after each, the writers, the mocks and the size of the terminal put back;
 * after them, the folder removed.
 */
export function keyedQuestions(): void {
  beforeAll(async () => {
    folder = await mkdtemp(join(tmpdir(), "mnemocode-record-"));
    await mkdir(join(folder, "my backups"));
  });
  afterAll(async () => {
    await rm(folder, { recursive: true, force: true });
  });
  beforeEach(() => {
    terminal.asked = [];
    terminal.onFirstKey = () => undefined;
    terminal.exit = async () => 130;
    terminal.selfTestFails = false;
    terminal.atTerminal = false;
    terminal.events = [];
    // Each test's record of answers starts on its own screen.
    startRecord();
  });
  afterEach(() => {
    stopWatching();
    vi.restoreAllMocks();
    process.stderr.columns = originalColumns;
    process.stderr.rows = originalRows;
  });
}

export const BEFORE = "before\n";
// Three rows of 20 columns after the prompt "Word: ".
export const LONG_ANSWER = "abandon ability able about above absent";

/** Answers askLine with `keys` on a screen of `columns`; returns the screen and the answer. */
export async function answer(
  keys: string | readonly (string | Buffer)[],
  columns: number,
  options: Parameters<typeof askLine>[2] = {},
  reported: Reported = { columns },
): Promise<{ screen: Screen; answer: string | undefined }> {
  const screen = watchScreen(columns, reported);
  screen.write(BEFORE);
  // The keys for each time the question is asked.
  const asked = typeof keys === "string" ? [keys] : [...keys];
  terminal.keysFor = () => asked.shift()!;
  return { screen, answer: await askLine("Word", "Word", options) };
}

export function expectScreen(screen: Screen, expected: ReturnType<typeof screenOf>): void {
  expect({ lines: screen.lines(), cursor: screen.cursor() }).toEqual(expected);
}
