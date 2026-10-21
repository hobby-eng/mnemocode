import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { readLine, type LineOptions } from "../src/cli/terminal-input.js";
import { WordList } from "../src/core/word-hints.js";
import { answerEndRow, rowsOfText, terminalColumns } from "../src/cli/terminal-geometry.js";
import { BACKSPACE, CTRL_A, END, ESCAPE, HOME, LEFT, RIGHT } from "./helpers/keys.js";
import { TEST_PHRASE, TEST_WORDS } from "./helpers/test-phrase.js";
import type { Cancelled } from "../src/cli/terminal-keys.js";
import { TypedAnswer } from "../src/cli/typed-answer.js";

/**
 * The limit of the test of a long answer typed key by key: an echo whose work for each key does not
 * grow with the answer ends in about a second, one that counted the whole answer again took minutes.
 */
const LINEAR_ECHO_TIME_LIMIT_MS = 20_000;

/**
 * The bytes of `text` as a terminal in raw mode delivers them, then the end of the input. Read by
 * index: shifting a long array takes time of its own, which would hide the time readLine takes.
 * `moreWithin` says whether bytes are left, so that a final Escape is Escape alone.
 */
function keyboard(text: string): Required<Pick<LineOptions, "moreWithin">> & {
  readonly next: () => Promise<number | undefined>;
} {
  const bytes = Buffer.from(text, "utf8");
  let read = 0;
  return {
    next: async () => (read < bytes.length ? bytes[read++] : undefined),
    moreWithin: async () => read < bytes.length,
  };
}

/** Reads `text` as a visible answer on a terminal `columns` wide; returns it and what was shown. */
async function showTyping(
  text: string,
  columns: number,
  options: Omit<LineOptions, "echo"> = {},
): Promise<{ readonly answer: string | undefined | Cancelled; readonly screen: string }> {
  process.stderr.columns = columns;
  const written: Buffer[] = [];
  vi.spyOn(process.stderr, "write").mockImplementation((chunk) => {
    written.push(Buffer.from(chunk));
    return true;
  });
  const keys = keyboard(text);
  const answer = await readLine(keys.next, { echo: true, moreWithin: keys.moreWithin, ...options });
  vi.restoreAllMocks();
  return { answer, screen: Buffer.concat(written).toString("utf8") };
}

/**
 * Characters of one to four UTF-8 bytes and the columns that a terminal gives each: 的 begins
 * Chinese BIP39 words, 가 is Hangul, 𠀀 (U+20000) wide in four bytes, 𝐀 (U+1D400) narrow in four.
 */
const SAMPLES: readonly (readonly [string, number])[] = [
  ["a", 1],
  [" ", 1],
  ["é", 1],
  ["€", 1],
  ["的", 2],
  ["가", 2],
  ["𠀀", 2],
  ["𝐀", 1],
];

/** A long answer that mixes the samples, so that wide characters meet the right edge everywhere. */
function mixedAnswer(count: number): (readonly [string, number])[] {
  return Array.from({ length: count }, (_, index) => SAMPLES[(index * 5 + (index >> 3)) % 8]!);
}

/**
 * What a terminal receives when `characters` are typed at the end of an empty answer: each
 * character once it is complete, and a new line wherever the answer reaches the right edge, where
 * the terminal itself would wait before it wraps. A wide character that does not fit at the last
 * column goes whole to the next row, which the terminal does by itself.
 */
function expectedTyping(
  characters: readonly (readonly [string, number])[],
  columns: number,
  promptWidth: number,
): string {
  // A prompt that ends at the right edge is settled first.
  let screen = promptWidth > 0 && promptWidth % columns === 0 ? "\r\n" : "";
  let offset = promptWidth % columns;
  for (const [character, width] of characters) {
    const column = offset % columns;
    if (column > 0 && column + width > columns) offset += columns - column;
    screen += character;
    offset += width;
    if (offset % columns === 0) screen += "\r\n";
  }
  return screen;
}

/** The columns of each sample character, and 1 for every other one (the prompt's letters). */
const WIDTHS = new Map(SAMPLES);
// Literal oracle for this regression, independent of production geometry.
WIDTHS.set("\u0301", 0);
WIDTHS.set("\u0300", 0);

/**
 * A terminal screen as xterm, VTE and Windows Terminal keep it, for what readLine writes: printable
 * characters with autowrap, CR, LF (with the CR that the terminal adds), cursor up (CSI n A),
 * cursor forward (CSI n C) and erase to the end of the screen (CSI J). After the last column the
 * cursor waits there (`pending`) until the next character wraps it. A wide character that does not
 * fit at the last column leaves that cell empty and goes to the start of the next row.
 */
class Screen {
  /** The cells of each row: a character, "" for the second half of a wide one, or nothing. */
  readonly #cells: (string | undefined)[][] = [[]];
  /** Where the cursor is: its row and column, counted from 0. */
  #row = 0;
  #column = 0;
  #pending = false;

  readonly #columns: number;

  constructor(columns: number) {
    this.#columns = columns;
  }

  write(text: string): void {
    const characters = Array.from(text);
    for (let index = 0; index < characters.length; index += 1) {
      const character = characters[index]!;
      if (character === "\x1b") {
        let parameter = "";
        index += 2; // ESC [
        while (/[0-9;]/u.test(characters[index]!)) parameter += characters[index++];
        this.#control(characters[index]!, parameter === "" ? 1 : Number(parameter));
      } else if (character === "\r") {
        this.#column = 0;
        this.#pending = false;
      } else if (character === "\n") {
        this.#row += 1;
        this.#column = 0;
        this.#pending = false;
      } else this.#put(character, WIDTHS.get(character) ?? 1);
    }
  }

  #control(final: string, count: number): void {
    this.#pending = false;
    if (final === "A") this.#row = Math.max(0, this.#row - count);
    else if (final === "B") this.#row += count;
    else if (final === "m") return;
    else if (final === "C") this.#column = Math.min(this.#columns - 1, this.#column + count);
    else if (final === "J") {
      this.#cells[this.#row]?.splice(this.#column);
      this.#cells.splice(this.#row + 1);
    } else throw new Error(`unexpected control sequence ${final}`);
  }

  #put(character: string, width: number): void {
    if (width === 0) {
      const previous = this.#pending ? this.#column : this.#column - 1;
      const row = this.#cells[this.#row];
      if (previous >= 0 && row?.[previous] !== undefined) row[previous] += character;
      return;
    }
    if (this.#pending) {
      this.#row += 1;
      this.#column = 0;
      this.#pending = false;
    }
    if (width === 2 && this.#column === this.#columns - 1) {
      this.#row += 1;
      this.#column = 0;
    }
    const row = (this.#cells[this.#row] ??= []);
    row[this.#column] = character;
    if (width === 2) row[this.#column + 1] = "";
    this.#column += width;
    if (this.#column >= this.#columns) {
      this.#column = this.#columns - 1;
      this.#pending = true;
    }
  }

  /** The characters on the screen in reading order, and the cell of each. */
  shown(): { readonly text: string; readonly at: readonly (readonly [number, number])[] } {
    let text = "";
    const at: [number, number][] = [];
    this.#cells.forEach((cells, row) =>
      cells.forEach((cell, column) => {
        if (cell === undefined || cell === "") return;
        text += cell;
        at.push([row, column]);
      }),
    );
    return { text, at };
  }

  /** The text of each row, the empty cells as spaces, without the spaces at the end. */
  rows(): string[] {
    return this.#cells.map((cells) =>
      Array.from(cells, (cell) => cell ?? " ")
        .join("")
        .trimEnd(),
    );
  }

  /** Where the cursor is: a cursor waiting at the right edge has not wrapped yet. */
  cursor(): readonly [number, number] {
    return this.#pending ? [this.#row, this.#columns] : [this.#row, this.#column];
  }
}

/** A line as a shell edits it, to tell where readLine's answer and cursor must be. */
class EditedLine {
  characters: string[] = [];
  cursor = 0;

  apply(key: string): void {
    if (key === LEFT) this.cursor = Math.max(0, this.cursor - 1);
    else if (key === HOME) this.cursor = 0;
    else if (key === END) this.cursor = this.characters.length;
    else if (key === BACKSPACE) {
      if (this.cursor > 0) this.characters.splice(--this.cursor, 1);
    } else this.characters.splice(this.cursor++, 0, key);
  }
}

/**
 * Types `keys` one at a time into readLine after a prompt of `promptWidth` letters, on a Screen
 * `columns` wide, and checks after each key that the screen shows the prompt and the answer as
 * edited, with the cursor on the character it stands before, or just after the end.
 */
async function typeOnScreen(keys: readonly string[], columns: number, promptWidth: number) {
  process.stderr.columns = columns;
  const screen = new Screen(columns);
  vi.spyOn(process.stderr, "write").mockImplementation((chunk) => {
    screen.write(Buffer.from(chunk).toString("utf8"));
    return true;
  });
  const prompt = "P".repeat(promptWidth);
  screen.write(prompt);
  const edited = new EditedLine();
  const pending = [...keys.map((key) => Buffer.from(key, "utf8")), Buffer.from("\r")];
  let bytes: number[] = [];
  let typed = -1;
  const check = (): void => {
    const { text, at } = screen.shown();
    expect(text).toBe(prompt + edited.characters.join(""));
    const place = promptWidth + edited.cursor;
    const [row, column] = place < at.length ? at[place]! : screen.cursor();
    const [cursorRow, cursorColumn] = screen.cursor();
    // At the end the cursor is where the next character would go: on the next row at the edge.
    const expected = column === columns ? [row + 1, 0] : [row, column];
    const actual = cursorColumn === columns ? [cursorRow + 1, 0] : [cursorRow, cursorColumn];
    expect(actual).toEqual(expected);
  };
  const next = async (): Promise<number | undefined> => {
    if (bytes.length === 0) {
      // Every key has been taken and drawn: the screen must show it.
      if (typed >= 0) {
        edited.apply(keys[typed]!);
        check();
      }
      typed += 1;
      bytes = [...(pending.shift() ?? [])];
    }
    return bytes.shift();
  };
  const answer = await readLine(next, {
    echo: true,
    moreWithin: async () => bytes.length > 0,
    promptWidth,
  });
  vi.restoreAllMocks();
  return { answer, screen, text: edited.characters.join("") };
}

const originalColumns = process.stderr.columns;

describe("A combining mark typed after a base at the right edge", () => {
  restoreTerminalAroundEach();

  it("redraws the base and mark together and keeps the next character on the next row", async () => {
    const { answer, screen: written } = await showTyping("e\u0301x\r", 5, { promptWidth: 4 });
    const screen = new Screen(5);
    screen.write("PPPP" + written);
    expect(answer).toBe("e\u0301x");
    expect(screen.rows()).toEqual(["PPPPe\u0301", "x"]);
    expect(screen.cursor()).toEqual([1, 1]);
  });

  it.each([5, 80])("keeps appended decomposed text linear on a %s-column terminal", (columns) => {
    process.stderr.columns = columns;
    for (const text of ["e\u0301".repeat(2000), "a".repeat(columns) + "\u0301".repeat(2000)]) {
      let written = 0;
      vi.spyOn(process.stderr, "write").mockImplementation((chunk) => {
        written += typeof chunk === "string" ? Buffer.byteLength(chunk) : chunk.length;
        return true;
      });
      const bytes = Buffer.from(text);
      using answer = new TypedAnswer(bytes.length, true, 0, undefined);
      for (const byte of bytes) answer.insert(byte);
      answer.moveToEnd();
      expect(answer.text()).toBe(text);
      // A fixed output-per-input budget, not a wall-clock threshold or the production width rule.
      expect(written).toBeLessThan(bytes.length * 8);
      vi.restoreAllMocks();
    }
  });

  it.each([
    {
      keys: "e\u0301\u0300x\r",
      answer: "e\u0301\u0300x",
      rows: ["PPPPe\u0301\u0300", "x"],
      column: 1,
    },
    { keys: "e\u0301" + BACKSPACE + "x\r", answer: "ex", rows: ["PPPPe", "x"], column: 1 },
    { keys: "e\u0301" + HOME + "x\r", answer: "xe\u0301", rows: ["PPPPx", "e\u0301"], column: 1 },
    { keys: "e\u0301" + LEFT + "x\r", answer: "ex\u0301", rows: ["PPPPe", "x\u0301"], column: 1 },
    { keys: "e\u0301\r", answer: "e\u0301", rows: ["PPPPe\u0301"], column: 0 },
  ])("keeps marked edge edits correct for $answer", async ({ keys, answer, rows, column }) => {
    const shown = await showTyping(keys, 5, { promptWidth: 4 });
    const screen = new Screen(5);
    screen.write("PPPP" + shown.screen);
    expect(shown.answer).toBe(answer);
    expect(screen.rows().filter((row, index, all) => row !== "" || index < all.length - 1)).toEqual(
      rows,
    );
    expect(screen.cursor()).toEqual([1, column]);
  });
});

/** Puts back the mocks and the width of the terminal around each test. */
function restoreTerminalAroundEach(): void {
  beforeEach(() => vi.restoreAllMocks());
  afterEach(() => {
    vi.restoreAllMocks();
    process.stderr.columns = originalColumns;
  });
}

describe("visible answer on the terminal", () => {
  restoreTerminalAroundEach();

  it.each([
    [7, 0],
    [7, 5],
    [7, 14],
    [10, 3],
    [80, 31],
  ])(
    "shows a long mixed answer typed at the end as it did, %i columns after a prompt of %i",
    async (columns, promptWidth) => {
      const characters = mixedAnswer(3_000);
      const text = characters.map(([character]) => character).join("");
      const { answer, screen } = await showTyping(`${text}\r`, columns, { promptWidth });
      expect(answer).toBe(text);
      expect(screen).toBe(expectedTyping(characters, columns, promptWidth));
    },
  );

  it("counts the answer from its start again after a redraw", async () => {
    // Backspace at the right edge redraws from the first row; e then reaches the edge again.
    expect((await showTyping(`abcde${BACKSPACE}ef\r`, 5)).screen).toBe(
      "abcde\r\n" + "\x1b[1A\r\x1b[Jabcd\r\x1b[4C" + "e\r\nf",
    );
    // Home and End redraw an answer of wide characters; typing then goes on at its end.
    expect((await showTyping(`的的${HOME}${END}a的b\r`, 4)).screen).toBe(
      "的的\r\n" + "\x1b[1A\r\x1b[J的的\r\n\x1b[1A\r" + "\r\x1b[J的的\r\n\r" + "a的b\r\n",
    );
  });

  it("leaves the cursor after the end of the answer, as End does, at Enter and at Escape", async () => {
    // Nothing more is drawn when the cursor is at the end already.
    expect((await showTyping("abandon about\r", 6)).screen).toBe("abando\r\nn abou\r\nt");
    for (const moved of [HOME, `${LEFT}${LEFT}`, CTRL_A, `${LEFT}\x1b[1;5D`]) {
      const entered = await showTyping(`abandon about${moved}\r`, 6);
      const ended = await showTyping(`abandon about${moved}${END}\r`, 6);
      expect(entered).toEqual(ended);
      expect(entered.answer).toBe("abandon about");
    }
    // The redraw ends on the last row, two columns in: after "ab" of "abcdef" at 4 columns.
    expect((await showTyping(`abcdef${HOME}\r`, 4)).screen.endsWith("\r\x1b[2C")).toBe(true);
    // Escape alone goes back from a menu's question; the cursor is left at the end there too.
    const back = await showTyping(`abc${LEFT}${LEFT}${ESCAPE}`, 80, { escapeGoesBack: true });
    const ended = await showTyping(`abc${LEFT}${LEFT}${END}`, 80);
    expect(back.answer).toBeUndefined();
    expect(back.screen).toBe(ended.screen);
  });

  it(
    "echoes a long answer within a fixed output budget",
    async () => {
      // Counting the whole answer again for each key took minutes for this many bytes.
      process.stderr.columns = 80;
      let shown = 0;
      vi.spyOn(process.stderr, "write").mockImplementation((chunk) => {
        shown += Buffer.byteLength(chunk);
        return true;
      });
      const text = "abandon 的 ".repeat(20_000);
      const keys = keyboard(`${text}\r`);
      expect(await readLine(keys.next, { echo: true })).toBe(text);
      expect(shown).toBeGreaterThan(Buffer.byteLength(text));
      expect(shown).toBeLessThan(Buffer.byteLength(text) * 8);
    },
    LINEAR_ECHO_TIME_LIMIT_MS,
  );

  it.each([
    [5, 0],
    [5, 3],
    [7, 6],
    [9, 4],
    [11, 10],
    [3, 2],
  ])(
    "wraps a wide character whole, as terminals do, while typing and editing at %i columns after a prompt of %i",
    async (columns, promptWidth) => {
      // Wide characters meet the right edge at every column; then edits in the middle redraw.
      const characters = mixedAnswer(60).map(([character]) => character);
      const keys = [
        ...characters,
        HOME,
        "的",
        "a",
        LEFT,
        "가",
        ...Array.from({ length: 7 }, () => LEFT),
        BACKSPACE,
        "的",
        END,
        BACKSPACE,
        "的",
        LEFT,
        LEFT,
        "a",
      ];
      const { answer, text } = await typeOnScreen(keys, columns, promptWidth);
      expect(answer).toBe(text);
    },
  );
});

describe("visible answer on the terminal", () => {
  restoreTerminalAroundEach();

  it("counts the rows of a line and the row after an answer as terminals wrap them", () => {
    // At 5 columns "abcd的" leaves the fifth cell of the first row empty: two rows.
    expect(rowsOfText("abcd的", 5)).toBe(2);
    expect(rowsOfText("abc的", 5)).toBe(1);
    expect(rowsOfText("abcde", 5)).toBe(1);
    expect(rowsOfText("", 5)).toBe(1);
    expect(rowsOfText("的的的", 5)).toBe(2);
    // A prompt of 4, then 的 does not fit in the last column: row 1. An answer that ends at the
    // right edge leaves the cursor on the next row.
    expect(answerEndRow(4, "的", 5)).toBe(1);
    expect(answerEndRow(3, "的", 5)).toBe(1);
    expect(answerEndRow(3, "a", 5)).toBe(0);
    expect(answerEndRow(5, "", 5)).toBe(1);
    expect(answerEndRow(12, "的的", 5)).toBe(3);
    // Narrow characters give what the columns alone give.
    for (const width of [0, 1, 4, 5, 9, 31])
      expect(answerEndRow(width, "abandon about", 7)).toBe(Math.floor((width + 13) / 7));
    // The same rows as the Screen above shows after typing.
    for (const [columns, promptWidth] of [
      [5, 0],
      [7, 3],
      [9, 8],
    ] as const) {
      const text = mixedAnswer(40)
        .map(([character]) => character)
        .join("");
      const screen = new Screen(columns);
      screen.write(`${"P".repeat(promptWidth)}${text}`);
      const [row, column] = screen.cursor();
      expect(answerEndRow(promptWidth, text, columns)).toBe(column === columns ? row + 1 : row);
      const line = new Screen(columns);
      line.write(text);
      const [lastRow] = line.cursor();
      expect(rowsOfText(text, columns)).toBe(lastRow + 1);
    }
  });

  it("wraps at the width of the terminal, or at 80 columns when it does not say", () => {
    process.stderr.columns = 33;
    expect(terminalColumns()).toBe(33);
    process.stderr.columns = 0;
    expect(terminalColumns()).toBe(80);
    // A stream that does not say its width, as a pipe or an old terminal.
    Reflect.set(process.stderr, "columns", undefined);
    expect(terminalColumns()).toBe(80);
  });
});

/**
 * Types `keys` one at a time into readLine with BIP39 hints after a prompt of `promptWidth`
 * letters, on a Screen `columns` wide, and gives the rows of the screen and the cursor after each
 * key, once it is drawn, and the answer.
 */
async function typeWithHints(keys: readonly string[], columns: number, promptWidth = 6) {
  process.stderr.columns = columns;
  const screen = new Screen(columns);
  vi.spyOn(process.stderr, "write").mockImplementation((chunk) => {
    screen.write(Buffer.from(chunk).toString("utf8"));
    return true;
  });
  screen.write("P".repeat(promptWidth));
  const pending = [...keys.map((key) => Buffer.from(key, "utf8")), Buffer.from("\r")];
  const after: { readonly rows: string[]; readonly cursor: readonly number[] }[] = [];
  let bytes: number[] = [];
  let started = false;
  const next = async (): Promise<number | undefined> => {
    if (bytes.length === 0) {
      if (started) after.push({ rows: screen.rows(), cursor: screen.cursor() });
      started = true;
      bytes = [...(pending.shift() ?? [])];
    }
    return bytes.shift();
  };
  const answer = await readLine(next, {
    echo: true,
    moreWithin: async () => bytes.length > 0,
    promptWidth,
    hints: WordList.BIP39,
  });
  const end = screen.rows();
  vi.restoreAllMocks();
  return { answer, after, end };
}

describe("hints below a visible answer, as in mhfe", () => {
  restoreTerminalAroundEach();

  it("shows how many words begin with a letter, then the words, and a word no word begins like", async () => {
    const { answer, after, end } = await typeWithHints(["a", "b", "x", BACKSPACE, " "], 80);
    expect(after[0]!.rows).toEqual(["PPPPPPa", "  136 BIP39 words begin with this letter"]);
    expect(after[1]!.rows).toEqual([
      "PPPPPPab",
      "  abandon   ability   able      about     above     absent    absorb",
      "  abstract  absurd    abuse",
    ]);
    expect(after[2]!.rows).toEqual(["PPPPPPabx", "  ! No BIP39 word begins like this."]);
    expect(after[3]!.rows).toHaveLength(3);
    // After a space no word is being typed.
    expect(after[4]!.rows).toEqual(["PPPPPPab"]);
    // The cursor stays where the next character goes.
    expect(after.map(({ cursor }) => cursor)).toEqual([
      [0, 7],
      [0, 8],
      [0, 9],
      [0, 8],
      [0, 9],
    ]);
    // Enter takes the hint off the screen.
    expect(answer).toBe("ab ");
    expect(end).toEqual(["PPPPPPab"]);
  });

  it("completes a word with Tab as far as the words agree, and ends it with a space", async () => {
    const { answer, after } = await typeWithHints(
      [...Array.from("abou"), "\t", ...Array.from("abs"), "\t"],
      80,
    );
    expect(after[4]!.rows).toEqual(["PPPPPPabout"]);
    expect(after[4]!.cursor).toEqual([0, 12]);
    // The words that begin with "abs" differ at once: Tab adds nothing, and the hint stays.
    expect(after[8]!.rows).toEqual(["PPPPPPabout abs", "  absent    absorb    abstract  absurd"]);
    expect(answer).toBe("about abs");
  });

  it("keeps a pasted Tab a space, and draws a paste's hint once, at its end", async () => {
    process.stderr.columns = 80;
    const written: string[] = [];
    vi.spyOn(process.stderr, "write").mockImplementation((chunk) => {
      written.push(Buffer.from(chunk).toString("utf8"));
      return true;
    });
    const keys = keyboard("abandon\tabandon ab");
    const done = readLine(keys.next, {
      echo: true,
      moreWithin: keys.moreWithin,
      hints: WordList.BIP39,
    });
    const answer = await done;
    vi.restoreAllMocks();
    expect(answer).toBe("abandon abandon ab");
    // The hint of "ab" once, and the erasure of it at the end of the input.
    expect(written.filter((chunk) => chunk.includes("abstract"))).toHaveLength(1);
  });

  it("hints the word before the cursor inside a long answer, below its last row", async () => {
    const { after } = await typeWithHints(
      [...Array.from("abandon abandon abandon ab"), HOME, ...Array<string>(8).fill(RIGHT), LEFT],
      30,
    );
    // 6 + 26 columns: two rows, the hint below the second, two words to a row.
    const answer = ["PPPPPPabandon abandon abandon", "ab"];
    expect(after[25]!.rows).toEqual([
      ...answer,
      "  abandon   ability",
      "  able      about",
      "  above     absent",
      "  and 4 more",
    ]);
    expect(after[25]!.cursor).toEqual([1, 2]);
    // Home, then eight right: the cursor stands on a word, which is not being typed.
    expect(after[34]!.rows).toEqual(answer);
    expect(after[34]!.cursor).toEqual([0, 14]);
    // One left: the cursor ends "abandon", a whole word, which needs no hint.
    expect(after[35]!.rows).toEqual(answer);
    expect(after[35]!.cursor).toEqual([0, 13]);
  });
});

describe("hints below a visible answer, as in mhfe", () => {
  restoreTerminalAroundEach();

  it("gives a hint the last words typed only, never the phrase typed so far (AUD-019-SEC001)", async () => {
    process.stderr.columns = 80;
    vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    const seen: string[] = [];
    const phrase = TEST_PHRASE;
    const keys = [...Buffer.from(`${phrase}\r`)];
    let read = 0;
    const answer = await readLine(async () => keys[read++], {
      echo: true,
      // A pause after every key: the hint is drawn each time.
      moreWithin: async () => false,
      hints: {
        hint: (line) => {
          seen.push(line);
          return WordList.BIP39.hint(line);
        },
        completion: (line) => WordList.BIP39.completion(line),
      },
    });
    vi.restoreAllMocks();
    expect(answer).toBe(phrase);
    const most = Math.max(...seen.map((line) => line.trim().split(/\s+/u).length));
    expect(most).toBe(4);
    expect(seen.at(-1)).toBe(TEST_WORDS.slice(-4).join(" "));
  });

  it("shows no hint where the terminal is too narrow or the answer hidden", async () => {
    expect((await typeWithHints(["a", "b"], 23)).after[1]!.rows).toEqual(["PPPPPPab"]);
    process.stderr.columns = 80;
    const written: string[] = [];
    vi.spyOn(process.stderr, "write").mockImplementation((chunk) => {
      written.push(String(chunk));
      return true;
    });
    const keys = keyboard("ab\t\r");
    expect(
      await readLine(keys.next, {
        echo: false,
        moreWithin: keys.moreWithin,
        hints: WordList.BIP39,
      }),
    ).toBe("ab\t");
    expect(written).toEqual([]);
  });
});
