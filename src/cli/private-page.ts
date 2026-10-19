// The page of the private screen: everything written to the terminal since the screen was last
// cleared. The alternate screen keeps no scrollback, so a result longer than the terminal, with
// its heading, notices and fingerprints, would lose the rows that scrolled over its top edge. The
// page is therefore recorded as it is written, and before a question or an Enter prompt is drawn
// under it, a page that does not fit with them is shown again whole, by pages, with the colours it
// was written in (settle). Then its end stays on the screen above what comes next. Output that
// goes to a file or a pipe is written there as before and is not part of the page.

import { PrivateSteps } from "./private-steps.js";
import { screenRows, type ScreenRows } from "./screen-rows.js";
import { CLEAR_SCREEN } from "./terminal.js";
import { rowsOfText, terminalColumns, terminalRows } from "./terminal-geometry.js";
import { dropTypedAhead, readKey, withRawTerminal } from "./terminal-input.js";
import { CANCELLED, type Cancelled } from "./terminal-keys.js";
import { paint, STYLE, STYLE_CODES } from "./terminal-style.js";

/** The keys of the pages, under each page. */
const NAVIGATION = ["↑/PgUp previous · ↓/PgDn next", "Home/End · Enter done · Esc cancel"];
/** The bytes of CLEAR_SCREEN, where a new page starts. */
const CLEAR_BYTES = Buffer.from(CLEAR_SCREEN, "utf8");
/** The bytes a record holds at first; it doubles as it grows. */
const FIRST_RECORD_BYTES = 16 * 1024;
const DECODER = new TextDecoder("utf-8");

/**
 * What was written to the terminal since the screen was last cleared, as bytes that are wiped when
 * the page ends: the page holds the secrets that were shown on it.
 */
class PageRecord {
  #bytes = new Uint8Array(FIRST_RECORD_BYTES);
  #length = 0;

  /** Adds a chunk that a stream was given: text, or bytes such as a typed secret's echo. */
  add(chunk: unknown): void {
    if (typeof chunk === "string") {
      const bytes = Buffer.from(chunk, "utf8");
      try {
        this.#addBytes(bytes);
      } finally {
        bytes.fill(0);
      }
    } else if (chunk instanceof Uint8Array) this.#addBytes(chunk);
  }

  /** The page as text, for the time it is drawn. */
  text(): string {
    return DECODER.decode(this.#bytes.subarray(0, this.#length));
  }

  /** Wipes the page: a new one starts empty. */
  wipe(): void {
    this.#bytes.fill(0);
    this.#length = 0;
  }

  #addBytes(chunk: Uint8Array): void {
    const view = Buffer.from(chunk.buffer, chunk.byteOffset, chunk.byteLength);
    const cleared = view.lastIndexOf(CLEAR_BYTES);
    const added = cleared < 0 ? view : view.subarray(cleared + CLEAR_BYTES.length);
    if (cleared >= 0) this.wipe();
    if (this.#length + added.length > this.#bytes.length) {
      let size = this.#bytes.length;
      while (size < this.#length + added.length) size *= 2;
      const grown = new Uint8Array(size);
      grown.set(this.#bytes.subarray(0, this.#length));
      this.#bytes.fill(0);
      this.#bytes = grown;
    }
    this.#bytes.set(added, this.#length);
    this.#length += added.length;
  }
}

/** Records the page of the private screen of one command, and shows it by pages when needed. */
export class PrivatePage {
  static readonly #record = new PageRecord();
  static #stop: (() => void) | undefined;
  /** Whether the pages are being shown: what they write is not part of the page. */
  static #paging = false;

  /**
   * Starts recording what is written to standard error, and to standard output where it is the
   * same terminal.
   */
  static open(): void {
    PrivatePage.close();
    const add = (chunk: unknown): void => {
      if (!PrivatePage.#paging) PrivatePage.#record.add(chunk);
    };
    const streams =
      process.stdout.isTTY === true ? [process.stderr, process.stdout] : [process.stderr];
    const stops = streams.map((stream) => recordWrites(stream, add));
    PrivatePage.#stop = () => {
      for (const stop of stops) stop();
    };
  }

  /** Stops recording and wipes the page. */
  static close(): void {
    PrivatePage.#stop?.();
    PrivatePage.#stop = undefined;
    PrivatePage.#record.wipe();
  }

  /**
   * Before `reserve` rows are drawn under the page, down to the row the cursor then waits on: a
   * page that does not fit on the terminal with them is shown by pages until Enter, and then its
   * last rows that fit stay above them. CANCELLED at Escape or Ctrl+C.
   */
  static async settle(reserve: number): Promise<Cancelled | undefined> {
    if (PrivatePage.#stop === undefined) return undefined;
    const page = (): ScreenRows => screenRows(PrivatePage.#record.text(), terminalColumns());
    if (page().cursorRow + reserve <= terminalRows()) return undefined;
    PrivatePage.#paging = true;
    try {
      if ((await showPages(() => page().rows)) === CANCELLED) return CANCELLED;
    } finally {
      PrivatePage.#paging = false;
    }
    const { rows, cursorRow } = page();
    const room = Math.max(0, terminalRows() - reserve);
    const above = room === 0 ? [] : rows.slice(0, cursorRow).slice(-room);
    // Written through the record: the end of the page is the page now, which fits.
    process.stderr.write(`${CLEAR_SCREEN}${above.map((row) => `${row}\n`).join("")}`);
    return undefined;
  }

  /**
   * settle before a question of `rows` rows under a displayed result. A question on a step screen
   * of its own needs none: its screen is cleared first (PrivateSteps.begin).
   */
  static async beforeQuestion(rows: number): Promise<Cancelled | undefined> {
    return PrivateSteps.showingResult ? PrivatePage.settle(rows) : undefined;
  }
}

/** Makes `stream` give every chunk it writes to `add` first; returns what undoes it. */
function recordWrites(stream: NodeJS.WriteStream, add: (chunk: unknown) => void): () => void {
  const own = Object.getOwnPropertyDescriptor(stream, "write");
  const write = stream.write.bind(stream);
  stream.write = (chunk: unknown, ...rest: unknown[]): boolean => {
    add(chunk);
    return Reflect.apply(write, undefined, [chunk, ...rest]) !== false;
  };
  return () => {
    if (own === undefined) Reflect.deleteProperty(stream, "write");
    else Object.defineProperty(stream, "write", own);
  };
}

/**
 * Shows `rows` by pages, the keys under each, until Enter (undefined), or Escape or Ctrl+C
 * (CANCELLED). When the terminal is resized, the rows are read again at its new width.
 */
async function showPages(rows: () => readonly string[]): Promise<Cancelled | undefined> {
  return withRawTerminal(async (next, moreWithin) => {
    if ((await dropTypedAhead()) === CANCELLED) return CANCELLED;
    let page = 0;
    let pages = 1;
    const draw = (): void => {
      const shown = withoutBlankEnd(rows());
      const footer = (count: number): string[] => [`Page ${page + 1}/${count}`, ...NAVIGATION];
      const footerRows = footer(pages).reduce((total, line) => total + rowsOfText(line), 0);
      const starts = pageStarts(shown, Math.max(1, terminalRows() - footerRows));
      pages = starts.length;
      page = Math.min(page, pages - 1);
      const lines = shown.slice(starts[page], starts[page + 1] ?? shown.length);
      const keys = footer(pages).map((line) => paint(process.stderr, STYLE.muted, line));
      process.stderr.write(`${CLEAR_SCREEN}${[...lines, ...keys].join("\n")}`);
    };
    process.on("SIGWINCH", draw);
    try {
      draw();
      for (;;) {
        const key = await readKey(next, moreWithin);
        if (key.kind === "cancel" || key.kind === "back") return CANCELLED;
        if (key.kind === "enter") return undefined;
        const before = page;
        if (key.kind === "up" || key.kind === "page-up") page = Math.max(0, page - 1);
        else if (key.kind === "down" || key.kind === "page-down")
          page = Math.min(pages - 1, page + 1);
        else if (key.kind === "home") page = 0;
        else if (key.kind === "end") page = pages - 1;
        if (page !== before) draw();
      }
    } finally {
      process.off("SIGWINCH", draw);
    }
  });
}

/**
 * Where each page of `rows` starts: a page holds `capacity` rows, and ends after a blank row when
 * one falls in its second half, so that a block, such as a share with its heading, stays whole.
 */
export function pageStarts(rows: readonly string[], capacity: number): number[] {
  const starts = [0];
  for (let start = 0; start + capacity < rows.length;) {
    let end = start + capacity;
    for (let row = end; row > start + capacity / 2; row -= 1)
      if (blank(rows[row - 1])) {
        end = row;
        break;
      }
    starts.push(end);
    start = end;
  }
  return starts;
}

/** `rows` without the blank rows at their end. */
function withoutBlankEnd(rows: readonly string[]): readonly string[] {
  let end = rows.length;
  while (end > 0 && blank(rows[end - 1])) end -= 1;
  return rows.slice(0, end);
}

function blank(row: string | undefined): boolean {
  return (row ?? "").replace(STYLE_CODES, "").trim() === "";
}
