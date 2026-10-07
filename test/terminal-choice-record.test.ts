import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { format } from "node:util";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { MoreWithin, NextByte } from "../src/cli/terminal-input.js";

// The questions run as they do at a terminal, with their keys typed by the tests: `keysFor` gives
// the keys of each question in turn, and every question asked is recorded in `asked` first. A
// typed question that is asked again, after an answer it refused, asks `keysFor` again.
const terminal = vi.hoisted(() => ({
  keysFor: (): string | Buffer => {
    throw new Error("no keys were given for this question");
  },
  /** Called once a question is drawn, when it reads its first key. */
  onFirstKey: (): void => undefined,
  asked: [] as Question[],
  /** What each command run by the menu gives: its exit code, or an error that stops its start. */
  exit: async (): Promise<number> => 130,
  /** Whether the core self-test fails at the start of the menu. */
  selfTestFails: false,
  /** Whether standard input and standard error are taken for a terminal (terminalAvailable). */
  atTerminal: false,
  /** The programs that the menu ran with spawnSync, and when, among the commands it ran. */
  events: [] as string[],
}));

interface Question {
  readonly kind: "choose" | "line";
  readonly question: string;
  /** The labels of the entries of a list. */
  readonly labels?: readonly string[];
  readonly fallback?: string;
  readonly optional?: string;
  readonly warning?: string;
}

vi.mock("../src/cli/terminal-input.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../src/cli/terminal-input.js")>()),
  withRawTerminal: async <T>(body: (next: NextByte, moreWithin: MoreWithin) => Promise<T>) => {
    const keys = terminal.keysFor();
    const bytes = typeof keys === "string" ? Buffer.from(keys, "utf8") : keys;
    let read = 0;
    const next: NextByte = async () => {
      if (read === 0) terminal.onFirstKey();
      if (read === bytes.length) throw new Error("the question read more keys than were typed");
      return bytes[read++];
    };
    // A final Escape is Escape alone: no byte follows it.
    return body(next, async () => read < bytes.length);
  },
  // Nothing is typed ahead here: every question gets the keys given for it.
  dropTypedAhead: async () => undefined,
  // Not the test runner's own standard input, which may or may not be a terminal.
  terminalAvailable: () => terminal.atTerminal,
}));

// stty, which the menu runs around each command at a terminal, only records what it was asked.
vi.mock("node:child_process", async (importOriginal) => ({
  ...(await importOriginal<typeof import("node:child_process")>()),
  spawnSync: (program: string, args: readonly string[]) => {
    terminal.events.push(`${program} ${args.join(" ")}`);
    return { status: 0, stdout: args[0] === "-g" ? "saved-modes\n" : "" };
  },
}));

vi.mock("../src/cli/terminal-choice.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../src/cli/terminal-choice.js")>();
  return {
    ...actual,
    choose: ((...args: Parameters<typeof actual.choose>) => {
      const labels = args[1].map((choice) => choice.label);
      terminal.asked.push({ kind: "choose", question: args[0], labels, warning: args[2].warning });
      return actual.choose(...args);
    }) as typeof actual.choose,
    askLine: ((...args: Parameters<typeof actual.askLine>) => {
      const [question, , options] = args;
      terminal.asked.push({
        kind: "line",
        question,
        fallback: options?.fallback,
        optional: options?.optional,
        warning: options?.warning,
      });
      return actual.askLine(...args);
    }) as typeof actual.askLine,
  };
});

// The menu runs no command here: each one ends as `terminal.exit` says, cancelled by default.
vi.mock("../src/cli/protection.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../src/cli/protection.js")>()),
  dropForMenu: () => undefined,
  assertProtected: () => undefined,
  runInOwnProcess: () => terminal.exit(),
}));
vi.mock("../src/cli/self-test.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../src/cli/self-test.js")>()),
  assertCoreSelfTest: () => {
    if (terminal.selfTestFails) throw new Error("CRITICAL: MnemoCode core self-test failed.");
  },
}));
vi.mock("../src/export/image-export.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../src/export/image-export.js")>()),
  assertImageRenderer: async () => undefined,
}));

import { MENU_ENTRIES, runMenu } from "../src/cli/menu.js";
import {
  answerMark,
  askLine,
  choose,
  eraseAnswersSince,
  startRecord,
  waitForEnter,
} from "../src/cli/terminal-choice.js";
import { displayWidth } from "../src/cli/terminal-input.js";
import { COIN_ADDRESS_ANSWERS } from "./helpers/coin-addresses.js";

const ESCAPE = "\x1b";
const DOWN = "\x1b[B";
const LEFT = "\x1b[D";
const HOME = "\x1b[H";
const CTRL_A = "\x01";
const CTRL_D = "\x04";
const CTRL_U = "\x15";
const BACKSPACE = "\x7f";
const ENTER = "\r";

/**
 * A terminal `columns` wide with as many rows as are written, or at most `height`, after which it
 * scrolls: its top row then goes into the scrollback, out of reach. It understands what the
 * questions write: text, which waits at the right edge until the next character before it wraps,
 * as terminals do, and a wide character that does not fit there goes whole to the next row; a line
 * feed, which also goes back to the left edge (ONLCR, which raw mode keeps); a carriage return;
 * and the sequences for cursor up, cursor right, cursor home, erase to the end of the screen or
 * all of it, and colours. Any other sequence fails the test.
 */
class Screen {
  private rows: string[][] = [[]];
  private row = 0;
  private column = 0;
  /** Whether the cursor waits on the last column, where the next character wraps first. */
  private waiting = false;

  constructor(
    private readonly columns: number,
    private readonly height = Number.POSITIVE_INFINITY,
  ) {}

  write(text: string): void {
    const characters = [...text];
    for (let index = 0; index < characters.length; index += 1) {
      const character = characters[index]!;
      if (character === ESCAPE) index = this.control(characters, index);
      else if (character === "\r") this.moveTo(this.row, 0);
      else if (character === "\n") this.moveTo(this.row + 1, 0);
      else this.put(character);
    }
  }

  /** The text of every row, without the spaces at the end, down to the row of the cursor. */
  lines(): string[] {
    return this.rows.map((cells) => cells.join("").trimEnd());
  }

  cursor(): readonly [number, number] {
    return [this.row, this.column];
  }

  private moveTo(row: number, column: number): void {
    this.row = Math.max(0, row);
    this.column = Math.min(this.columns - 1, column);
    this.waiting = false;
    while (this.rows.length <= this.row) this.rows.push([]);
    // Below the last row the screen scrolls up, and the cursor stays on the last row.
    while (this.rows.length > this.height) {
      this.rows.shift();
      this.row -= 1;
    }
  }

  private put(character: string): void {
    const width = displayWidth(character);
    if (this.waiting || this.column + width > this.columns) this.moveTo(this.row + 1, 0);
    const cells = this.rows[this.row]!;
    while (cells.length < this.column) cells.push(" ");
    // A wide character takes two cells; the second is left empty.
    cells.splice(this.column, width, character, ...Array<string>(width - 1).fill(""));
    if (this.column + width === this.columns) this.waiting = true;
    else this.column += width;
  }

  /** Reads the sequence that starts at `at` (ECMA-48 CSI) and returns where it ends. */
  private control(characters: readonly string[], at: number): number {
    if (characters[at + 1] !== "[") throw new Error(`unexpected escape at ${at}`);
    let end = at + 2;
    let parameters = "";
    while (end < characters.length && !/[@-~]/u.test(characters[end]!))
      parameters += characters[end++];
    const final = characters[end];
    const count = Number(parameters === "" ? "1" : parameters);
    if (final === "A") this.moveTo(this.row - count, this.column);
    else if (final === "C") this.moveTo(this.row, this.column + count);
    else if (final === "H" && parameters === "") this.moveTo(0, 0);
    else if (final === "J" && parameters === "") {
      this.rows[this.row] = this.rows[this.row]!.slice(0, this.column);
      this.rows.length = this.row + 1;
    } else if (final === "J" && parameters === "2") {
      // Every row is cleared; those below the cursor count as never written.
      this.rows = Array.from({ length: this.row + 1 }, () => []);
    } else if (final !== "m") throw new Error(`unexpected sequence ESC [ ${parameters}${final}`);
    return end;
  }
}

/** A screen of `columns` with `text` written on it, to compare a screen with. */
function screenOf(columns: number, text: string): { lines: string[]; cursor: readonly number[] } {
  const screen = new Screen(columns);
  screen.write(text);
  return { lines: screen.lines(), cursor: screen.cursor() };
}

/**
 * What the terminal says of its size; no `columns` when it does not say. A screen without a
 * `height` has as many rows as are written, and says that it has more than any test writes.
 */
interface Reported {
  readonly columns?: number;
  readonly height?: number;
}

/** The rows that a screen without a height says it has. */
const UNLIMITED_ROWS = 100_000;

/**
 * Sends everything written on standard error, also with console.error, to a screen of `columns`,
 * while the terminal says that it is as large as `reported`.
 */
function watchScreen(columns: number, reported: Reported = { columns }): Screen {
  stopWatching();
  (process.stderr as { columns?: number }).columns = reported.columns;
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
const originalWrite = process.stderr.write;
const originalError = console.error;

/** Puts back what watchScreen replaced. */
function stopWatching(): void {
  process.stderr.write = originalWrite;
  console.error = originalError;
}

/** A line of the record of answers as writeAnswer writes it, without colours. */
function answerLine(label: string, answer: string): string {
  return `  ${label.padEnd(11)} ${answer}\n`;
}

/** A warning above a question, as askLine and choose show it without colours. */
function warningLine(warning: string): string {
  return `! ${warning}\n`;
}

/** A folder for the files that the menu's questions name, made for these tests. */
let folder = "";
beforeAll(async () => {
  folder = await mkdtemp(join(tmpdir(), "mnemocode-record-"));
  await mkdir(join(folder, "my backups"));
});
afterAll(async () => {
  await rm(folder, { recursive: true, force: true });
});

const originalColumns = process.stderr.columns;
const originalRows = process.stderr.rows;
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

describe("a typed answer leaves only its line in the record of answers", () => {
  const BEFORE = "before\n";
  // Three rows of 20 columns after the prompt "Word: ".
  const LONG_ANSWER = "abandon ability able about above absent";

  /** Answers askLine with `keys` on a screen of `columns`; returns the screen and the answer. */
  async function answer(
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

  function expectScreen(screen: Screen, expected: ReturnType<typeof screenOf>): void {
    expect({ lines: screen.lines(), cursor: screen.cursor() }).toEqual(expected);
  }

  it.each([
    ["Enter", ""],
    ["Enter after Home", HOME],
    ["Enter after Ctrl+A", CTRL_A],
    ["Enter after Left", LEFT.repeat(5)],
  ])("%s, after a long answer", async (_, moved) => {
    const result = await answer(`${LONG_ANSWER}${moved}${ENTER}`, 20);
    expect(result.answer).toBe(LONG_ANSWER);
    expectScreen(result.screen, screenOf(20, BEFORE + answerLine("Word", LONG_ANSWER)));
  });

  it.each([
    ["Escape", ""],
    ["Escape after Home", HOME],
    ["Escape after Left", LEFT.repeat(5)],
    ["Escape after Ctrl+U", CTRL_U],
  ])("%s, after a long answer", async (_, moved) => {
    const result = await answer(`${LONG_ANSWER}${moved}${ESCAPE}`, 20);
    expect(result.answer).toBeUndefined();
    expectScreen(result.screen, screenOf(20, BEFORE));
  });

  it.each([
    // Prompt and answer end at the right edge: ShownLine has already gone on to the next row.
    [20, 2],
    [20, 3],
    [21, 2],
    [7, 4],
    // The prompt alone ends at the right edge, and Enter takes the fallback.
    [21, 1],
    [7, 3],
  ])("an answer that ends at the right edge of %i columns on row %i", async (columns, rows) => {
    const promptWidth = displayWidth("Word (Enter: about): ");
    const typed = "abandon".repeat(columns).slice(0, columns * rows - promptWidth);
    const result = await answer(`${typed}${ENTER}`, columns, { fallback: "about" });
    const given = typed === "" ? "about" : typed;
    expect(result.answer).toBe(given);
    expectScreen(result.screen, screenOf(columns, BEFORE + answerLine("Word", given)));
    // And the same left with Escape.
    const left = await answer(`${typed}${ESCAPE}`, columns, { fallback: "about" });
    expectScreen(left.screen, screenOf(columns, BEFORE));
  });

  // A wide character, such as a word of a Chinese file name, that reaches the last column does not
  // fit there: the terminal leaves the column empty and puts it whole on the next row.
  it.each([7, 9, 13, 21, 33])(
    "an answer with wide characters at the right edge of %i columns",
    async (columns) => {
      const promptWidth = displayWidth("Word: ");
      for (const narrow of [1, 2, 3].map((left) => columns - left - (promptWidth % columns))) {
        const typed = `${"a".repeat(Math.max(0, narrow))}日本語のファイル`;
        const result = await answer(`${typed}${ENTER}`, columns);
        expect(result.answer).toBe(typed);
        expectScreen(result.screen, screenOf(columns, BEFORE + answerLine("Word", typed)));
        const left = await answer(`${typed}${ESCAPE}`, columns);
        expectScreen(left.screen, screenOf(columns, BEFORE));
        // The line of the record wraps alike, and is counted alike when it is taken away.
        const screen = watchScreen(columns);
        screen.write(BEFORE);
        const mark = answerMark();
        terminal.keysFor = () => `${typed}${ENTER}`;
        await askLine("Word", "Word");
        eraseAnswersSince(mark);
        expectScreen(screen, screenOf(columns, BEFORE));
      }
    },
  );

  it.each([{ columns: 0 }, {}])(
    "counts at 80 columns where the terminal says %j, as readLine wraps",
    async (reported: Reported) => {
      const typed = `${LONG_ANSWER} ${LONG_ANSWER} ${LONG_ANSWER}`;
      const result = await answer(`${typed}${ENTER}`, 80, {}, reported);
      expectScreen(result.screen, screenOf(80, BEFORE + answerLine("Word", typed)));
      const left = await answer(`${typed}${ESCAPE}`, 80, {}, reported);
      expectScreen(left.screen, screenOf(80, BEFORE));
    },
  );

  it("shows a warning above the question and takes it away with it", async () => {
    const warning = "Choose 2 to 16 shares, and 2 or more of them to restore it.";
    let shown: string[] = [];
    terminal.onFirstKey = () => (shown = screen.lines());
    const screen = watchScreen(30);
    screen.write(BEFORE);
    terminal.keysFor = () => `7${ENTER}`;
    expect(await askLine("How many", "In all", { warning })).toBe("7");
    // The warning wraps at 30 columns onto further rows.
    expect(shown.slice(1, 5)).toEqual([
      "",
      "! Choose 2 to 16 shares, and 2",
      " or more of them to restore it",
      ".",
    ]);
    expect(shown[5]).toBe("How many:");
    expectScreen(screen, screenOf(30, BEFORE + answerLine("In all", "7")));
  });

  it("asks again with one line of why, until an answer can be used", async () => {
    const screen = watchScreen(80);
    screen.write(BEFORE);
    const shown: string[][] = [];
    terminal.onFirstKey = () => shown.push(screen.lines());
    // Enter alone, an answer that is not UTF-8 (a stray byte 0xFF), one that the check refuses.
    const keys: (string | Buffer)[] = [
      ENTER,
      Buffer.from([0x61, 0xff, 0x0d]),
      `73c5da0${ENTER}`,
      `73c5da0a${ENTER}`,
    ];
    terminal.keysFor = () => keys.shift()!;
    const given = await askLine("Fingerprint", "Fingerprint", {
      what: "the eight characters of the fingerprint",
      check: (typed) => {
        if (typed !== "73c5da0a")
          throw new Error("A master fingerprint must be eight hexadecimal characters.");
        return typed;
      },
    });
    expect(given).toBe("73c5da0a");
    const warnings = [
      "Type the eight characters of the fingerprint, or press Esc to go back.",
      "The answer is not valid UTF-8 text.",
      "A master fingerprint must be eight hexadecimal characters.",
    ];
    // Each asking shows the warning of the one before it, and only that, above the question.
    expect(shown.map((lines) => lines.slice(1, -1))).toEqual([
      [""],
      ...warnings.map((warning) => ["", `! ${warning}`]),
    ]);
    expectScreen(screen, screenOf(80, BEFORE + answerLine("Fingerprint", "73c5da0a")));
    // Escape still goes back from a question asked again.
    const left = await answer([`x${ENTER}`, `${LONG_ANSWER}${ESCAPE}`], 20, {
      check: (typed) => {
        if (typed === "x") throw new Error("Not x.");
        return typed;
      },
    });
    expect(left.answer).toBeUndefined();
    expectScreen(left.screen, screenOf(20, BEFORE));
  });

  it.each([
    ["Ctrl+D", CTRL_D],
    ["Ctrl+D after a long answer and Ctrl+U", `${LONG_ANSWER}${CTRL_U}${CTRL_D}`],
  ])("%s at a prompt wider than the terminal goes back without a trace", async (_, keys) => {
    // "Word (Enter: about): " takes 21 columns: one more than the screen has.
    const result = await answer(keys, 20, { fallback: "about" });
    expect(result.answer).toBeUndefined();
    expectScreen(result.screen, screenOf(20, BEFORE));
  });

  it.each([
    // A stray byte after an answer typed and taken back again.
    [
      "0xFF after corrections",
      Buffer.from(`${"a".repeat(20)}${BACKSPACE.repeat(20)}\xff\r`, "latin1"),
    ],
    // é from a terminal set to Latin-1: a first byte of three, then an a.
    ["a Latin-1 é", Buffer.from([0xe9, 0x61, 0x0d])],
    // A surrogate, which UTF-8 may not hold, and an overlong slash.
    ["a surrogate", Buffer.from([0x61, 0xed, 0xa0, 0x80, 0x0d])],
    ["an overlong form", Buffer.from([0xc0, 0xaf, 0x0d])],
  ])("an answer with %s is asked again, and only the question goes", async (_, keys) => {
    const result = await answer([keys, `abandon${ENTER}`], 20);
    expect(result.answer).toBe("abandon");
    expectScreen(result.screen, screenOf(20, BEFORE + answerLine("Word", "abandon")));
  });

  it("shows no byte of an answer that is not UTF-8, and says why above the question", async () => {
    const screen = watchScreen(80);
    screen.write(BEFORE);
    // Everything written, decoded: a byte that is no UTF-8 would show as U+FFFD.
    const written: string[] = [];
    const toScreen = process.stderr.write;
    process.stderr.write = ((chunk: string | Uint8Array) => {
      written.push(typeof chunk === "string" ? chunk : Buffer.from(chunk).toString("utf8"));
      return toScreen.call(process.stderr, chunk);
    }) as typeof process.stderr.write;
    const shown: string[][] = [];
    terminal.onFirstKey = () => shown.push(screen.lines());
    // é from a terminal set to Latin-1 between a and b, then Left, which draws the answer again
    // with every byte that readLine holds, and Enter.
    const keys = [Buffer.from(`a\xe9b${LEFT}${ENTER}`, "latin1"), Buffer.from(`ab${ENTER}`)];
    terminal.keysFor = () => keys.shift()!;
    expect(await askLine("Word", "Word")).toBe("ab");
    expect(written.join("")).not.toContain("\ufffd");
    expect(shown[1]!.slice(1, -1)).toEqual(["", "! The answer is not valid UTF-8 text."]);
  });

  it.each([
    ["q, Q and Ctrl+D, then Enter", `qQ${CTRL_D}word${ENTER}`, {}, false],
    ["q, Q and Ctrl+D, then Enter", `qQ${CTRL_D}word${ENTER}`, { onlyEscapeLeaves: true }, true],
    ["a word, then Escape", `query${ESCAPE}`, { onlyEscapeLeaves: true }, false],
    // A function key whose sequence ends in a letter that alone would leave.
    ["F2 (ESC O Q), then Enter", `\x1bOQ${ENTER}`, { onlyEscapeLeaves: true }, true],
  ])("waits for Enter after %s with %j", async (_, keys, options, entered) => {
    watchScreen(80);
    terminal.keysFor = () => keys;
    expect(await waitForEnter("Press Enter.", options)).toBe(entered);
  });

  it("leaves out an optional answer at Enter and records what that means", async () => {
    const result = await answer(ENTER, 80, { optional: "random" });
    expect(result.answer).toBe("");
    expectScreen(result.screen, screenOf(80, BEFORE + answerLine("Word", "random")));
  });

  it("shows a warning above a list too, and the label column fits Fingerprint", async () => {
    const screen = watchScreen(40);
    screen.write(BEFORE);
    let shown: string[] = [];
    terminal.onFirstKey = () => (shown = screen.lines());
    terminal.keysFor = () => ENTER;
    const warning = "Images need Poppler's pdftocairo, which is not installed here; choose a PDF.";
    const chosen = await choose(
      "How should the cards be saved?",
      [{ label: "One PDF, A6 sheets", value: "a6" }],
      { label: "Fingerprint", warning },
    );
    expect(chosen).toBe("a6");
    // One line of a warning, which the terminal of 40 columns wraps.
    expect(shown.slice(1, 5)).toEqual([
      "",
      "! Images need Poppler's pdftocairo, whic",
      "h is not installed here; choose a PDF.",
      "How should the cards be saved?",
    ]);
    expectScreen(screen, screenOf(40, BEFORE + answerLine("Fingerprint", "One PDF, A6 sheets")));
    expect(answerLine("Fingerprint", "x")).toBe("  Fingerprint x\n");
  });
});

describe("going back from an entry of the start menu", () => {
  const MENU_QUESTION = "What do you want to do?";
  // Narrower than LINE_WIDTH, so that lists, prompts and lines of the record wrap.
  const COLUMNS = 40;
  const SHARE_COUNT = "How many shares in all? (2 to 16)";

  /**
   * A file name that wraps both its prompt and its line in the record of answers, one for each
   * question of a file (its `fallback`), so that two files of an entry never have the same name,
   * in a folder that exists, so that the menu takes it.
   */
  function longFileName(fallback: string): string {
    return join(folder, "my backups", `${"a".repeat(40)}-${fallback}`);
  }

  // The files that the menu reads must be there.
  beforeAll(async () => {
    for (const fallback of ["mnemocode-record.txt", "mnemocode-qr.png"])
      await writeFile(longFileName(fallback), "");
  });

  /** The typed answers to the questions without a fallback, as public test data. */
  const TYPED: Readonly<Record<string, string>> = {
    "How many of them restore the seed phrase?": "4",
    Word: "abandon",
    "Word number": "1",
    "Unicode code": "4E00",
    // The public test phrase's fingerprint and its first native SegWit address.
    "Original fingerprint of the wallet, such as 73c5da0a (not the encoded one)": "73c5da0a",
    "Bitcoin address (one of the first receiving ones)":
      "bc1qcr8te4kr609gcawutmrza0j4xv80jy8z306fyu",
    // The public test phrase\'s first address in each other coin.
    ...COIN_ADDRESS_ANSWERS,
    // A public test key: the recipient of a key that is thrown away.
    "Scanner key": "age12d86zp9uj65df2snvl656uewdl82zrdfya8a2zgxu5rauaw7fsaqrr6w3x",
  };

  /** The question after an address: among how many of the first addresses it is. */
  const ADDRESS_COUNT = "Compare with how many addresses from the first";

  /** Share sets of the list, such as "2 of 3", which all lead to the same questions. */
  const SHARE_SET = /^\d+ of \d+$/u;

  /** Lists whose entries all lead to the same questions: only the first is chosen. */
  const SAME_QUESTIONS = new Set([
    "Which card design?",
    "Add a QR code with all the codes of the sheet?",
    "Which coin?",
  ]);

  /**
   * Lists asked under many paths whose own questions are walked through from the first path that
   * reaches them only, by its answers so far (`firstPath`); elsewhere they get their first entry.
   * Going back from them is the same under every path, and the walk stays small.
   */
  const WALKED_ONCE = new Set([
    "Which kind of file?",
    "How should the cards be laid out?",
    "Type your own details for the cards?",
  ]);
  const firstPath = new Map<string, string>();

  /** Whether the entry at `place` leads to the same questions as one before it in its list. */
  function asAnEarlierEntry(labels: readonly string[], place: number): boolean {
    const label = labels[place]!;
    if (SHARE_SET.test(label)) return place !== labels.findIndex((other) => SHARE_SET.test(other));
    return label === "A4 sheets";
  }

  /**
   * The keys of the answers that a question is given, so that every path through the questions is
   * taken. Answers that lead to the same questions are given once: the first card design, the first
   * share set, and the like; a file name is always a long one, and a detail on the cards is left
   * random. A count of shares is also answered with 1 where it is first asked, which SSKR
   * refuses: it is then asked again (`again`), with a warning, and given 7.
   */
  function answersOf(question: Question, again: boolean, path: readonly number[]): string[] {
    const walked = (): boolean => {
      const first = firstPath.get(question.question) ?? path.join(",");
      firstPath.set(question.question, first);
      return first === path.join(",");
    };
    if (question.kind === "choose") {
      if (SAME_QUESTIONS.has(question.question)) return [ENTER];
      if (WALKED_ONCE.has(question.question) && !walked()) return [ENTER];
      const labels = question.labels!;
      return labels.flatMap((_, place) =>
        asAnEarlierEntry(labels, place) ? [] : [`${DOWN.repeat(place)}${ENTER}`],
      );
    }
    // Enter takes the first 20 addresses; every other fallback is a file name.
    if (question.question === ADDRESS_COUNT) return [ENTER];
    if (question.fallback !== undefined) return [`${longFileName(question.fallback)}${ENTER}`];
    if (question.optional !== undefined) return [ENTER];
    if (question.question === SHARE_COUNT)
      return again || !walked() ? [`7${ENTER}`] : [`7${ENTER}`, `1${ENTER}`];
    const typed = TYPED[question.question];
    if (typed === undefined) throw new Error(`no answer for "${question.question}"`);
    return [`${typed}${ENTER}`];
  }

  /** One asking of a question: the question, and whether it is asked again after a refusal. */
  interface Asking {
    readonly question: Question;
    readonly again: boolean;
  }

  interface MenuRun {
    readonly screen: { lines: string[]; cursor: readonly number[] };
    /** What each showing of the menu had above it. */
    readonly above: string[][];
    /** Each asking of the entry's questions, and the screen once each of them was drawn. */
    readonly askings: Asking[];
    readonly shown: string[][];
  }

  /**
   * Runs the menu: chooses the entry with `digit`, gives the askings of the entry's questions
   * `answers` (places in answersOf), goes back with Escape at the next one, after typing a little
   * at a typed one, and quits with Escape when the menu shows again.
   */
  async function runEntry(digit: number | undefined, answers: readonly number[]): Promise<MenuRun> {
    terminal.asked = [];
    const screen = watchScreen(COLUMNS);
    const above: string[][] = [];
    const askings: Asking[] = [];
    const shown: string[][] = [];
    terminal.onFirstKey = () => {
      const lines = screen.lines();
      if (terminal.asked.at(-1)!.question === MENU_QUESTION)
        above.push(lines.slice(0, lines.indexOf(MENU_QUESTION)));
      else shown.push(lines);
    };
    terminal.keysFor = () => {
      const question = terminal.asked.at(-1)!;
      if (question.question === MENU_QUESTION)
        return above.length === 0 && digit !== undefined ? String(digit) : ESCAPE;
      // A typed question asked again after a refusal is the same question, asked once more.
      const again = askings.at(-1)?.question === question;
      askings.push({ question, again });
      const place = askings.length - 1;
      if (place < answers.length)
        return answersOf(question, again, answers.slice(0, place))[answers[place]!]!;
      if (place === answers.length) return question.kind === "line" ? `typed${ESCAPE}` : ESCAPE;
      throw new Error(`"${question.question}" was asked after going back`);
    };
    await runMenu();
    stopWatching();
    return { screen: { lines: screen.lines(), cursor: screen.cursor() }, above, askings, shown };
  }

  it.each(MENU_ENTRIES.filter((entry) => entry.digit >= 1 && entry.digit <= 7))(
    "$digit $label: Escape at any question shows the menu under the same record",
    async (entry) => {
      firstPath.clear();
      const quit = await runEntry(undefined, []);
      expect(quit.above).toHaveLength(1);
      const pending: number[][] = [[]];
      let backs = 0;
      while (pending.length > 0) {
        const answers = pending.pop()!;
        const run = await runEntry(entry.digit, answers);
        // The entry built its command line before a question for Escape came: nothing to check.
        if (run.askings.length <= answers.length) continue;
        backs += 1;
        const path = run.askings.map((asking) => asking.question.question).join(" / ");
        // No line of the task or of its answers is left above the menu, nor below it at the end.
        expect(run.above, path).toEqual([quit.above[0], quit.above[0]]);
        expect(run.screen, path).toEqual(quit.screen);
        const next = run.askings[answers.length]!;
        const count = answersOf(next.question, next.again, answers).length;
        for (let place = 0; place < count; place += 1) pending.push([...answers, place]);
      }
      expect(backs).toBeGreaterThan(0);
    },
  );

  it("asks only the refused number of shares again, without it in the record", async () => {
    // Encode: word numbers, MnemoCode Seedshift, Other, then 1 share in all, which SSKR refuses.
    firstPath.clear();
    const run = await runEntry(1, [0, 0, 2, 1, 0]);
    expect(run.askings[4]).toMatchObject({ question: { question: SHARE_COUNT }, again: true });
    const lines = run.shown[4]!;
    expect(lines).toContain("  Shares      Other");
    expect(lines.filter((line) => /^ {2}(In all|Restore) /u.test(line))).toEqual([]);
    expect(lines).toContain("! Choose 2 to 16 shares.");
    // The threshold comes next, under the count that was taken.
    expect(run.askings[5]!.question.question).toBe("How many of them restore the seed phrase?");
    expect(run.shown[5]).toContain("  In all      7");
  });
});

describe("going back on a terminal shorter than the record of answers", () => {
  /** What a shell showed above the menu, which only a screen drawn anew loses. */
  const SHELL = "$ mnemocode\n";

  /**
   * Runs the menu with `keys` for its questions in turn on a screen of 80 x 24 that shows `above`
   * first; returns the screen at the end.
   */
  async function onShortScreen(
    above: string,
    keys: string[],
  ): Promise<ReturnType<typeof screenOf>> {
    const screen = watchScreen(80, { columns: 80, height: 24 });
    screen.write(above);
    terminal.keysFor = () => {
      const next = keys.shift();
      if (next === undefined) throw new Error("the menu asked more than was answered");
      return next;
    };
    await runMenu();
    stopWatching();
    return { lines: screen.lines(), cursor: screen.cursor() };
  }

  it("erases in place what is still on the screen", async () => {
    const quit = await onShortScreen(SHELL, [ESCAPE]);
    // Encode, then Escape at its first question.
    expect(await onShortScreen(SHELL, ["1", ESCAPE, ESCAPE])).toEqual(quit);
  });

  it("draws the menu anew from the top where answers scrolled out of reach", async () => {
    const quit = await onShortScreen("", [ESCAPE]);
    // Encode: colors, no Seedshift, no shares, printable cards as a PDF of A6 sheets under its
    // usual name, in the first design, a QR code, and own details, each left random; then Escape at
    // the question about heirs, under 22 lines of answers.
    const deep = await onShortScreen(SHELL, [
      "1",
      `${DOWN.repeat(2)}${ENTER}`,
      `${DOWN}${ENTER}`,
      ENTER,
      `${DOWN.repeat(3)}${ENTER}`,
      ENTER,
      ENTER,
      ENTER,
      ENTER,
      ENTER,
      `${DOWN}${ENTER}`,
      ...Array<string>(11).fill(ENTER),
      ESCAPE,
      ESCAPE,
    ]);
    expect(deep).toEqual(quit);
  });
});

describe("what the menu does when a command cannot run or stops", () => {
  /**
   * Runs the menu with `keys` for its questions in turn, on a screen of 80 columns; returns the
   * questions asked and the screen as each of them first showed it.
   */
  async function menuWith(keys: string[]): Promise<{ asked: Question[]; shown: string[][] }> {
    terminal.asked = [];
    const screen = watchScreen(80);
    const shown: string[][] = [];
    terminal.onFirstKey = () => shown.push(screen.lines());
    terminal.keysFor = () => {
      const next = keys.shift();
      if (next === undefined) throw new Error("the menu asked more than was answered");
      return next;
    };
    await runMenu();
    stopWatching();
    return { asked: terminal.asked, shown };
  }

  // Entry 7, a word, abandon: a command without a private screen.
  const LOOK_UP = ["7", ENTER, `abandon${ENTER}`];

  it("says that a signal stopped a command, and starts it again on request", async () => {
    const codes = [137, 130];
    terminal.exit = async () => codes.shift()!;
    const { asked, shown } = await menuWith([...LOOK_UP, ENTER, ESCAPE]);
    expect(asked.map((question) => question.question)).toEqual([
      "What do you want to do?",
      "What do you want to look up?",
      "Word",
      "What now?",
      "What do you want to do?",
    ]);
    expect(asked[3]!.warning).toBe("The command stopped unexpectedly (SIGKILL).");
    expect(shown[3]).toContain("! The command stopped unexpectedly (SIGKILL).");
    // Started again: the second run was cancelled, which leads straight back to the menu.
    expect(codes).toEqual([]);
  });

  it("hides the keys typed while a command starts, and gives the terminal back as it was", async () => {
    terminal.atTerminal = true;
    terminal.exit = async () => {
      terminal.events.push("command");
      return 0;
    };
    await menuWith([...LOOK_UP, ENTER, ESCAPE]);
    // A Windows console shows no key before a program reads it.
    expect(terminal.events).toEqual(
      process.platform === "win32"
        ? ["command"]
        : ["/bin/stty -g", "/bin/stty -echo", "command", "/bin/stty saved-modes"],
    );
  });

  it("quits at Press Enter only with Escape, not with q or the rest of a paste", async () => {
    terminal.exit = async () => 1;
    const { asked } = await menuWith([...LOOK_UP, `q${CTRL_D}rest of a paste${ENTER}`, ESCAPE]);
    expect(asked.map((question) => question.question)).toEqual([
      "What do you want to do?",
      "What do you want to look up?",
      "Word",
      "What do you want to do?",
    ]);
  });

  it("says that a command could not be started, and goes back on request", async () => {
    terminal.exit = async () => {
      throw Object.assign(new Error("spawn EAGAIN"), { code: "EAGAIN" });
    };
    const { asked } = await menuWith([...LOOK_UP, `${DOWN}${ENTER}`, ESCAPE]);
    expect(asked[3]).toMatchObject({
      question: "What now?",
      warning: "The command could not be started (EAGAIN).",
    });
    expect(asked.at(-1)!.question).toBe("What do you want to do?");
  });

  it("offers no entry that asks for a secret when the self-test fails", async () => {
    terminal.selfTestFails = true;
    const { asked, shown } = await menuWith([ESCAPE]);
    expect(asked[0]!.labels).toEqual(
      MENU_ENTRIES.filter((entry) => entry.digit === 0 || entry.digit >= 6).map(
        (entry) => entry.label,
      ),
    );
    expect(shown[0]!.join("\n")).toContain("CRITICAL: MnemoCode core self-test failed.");
    // Entry 8 failing has the same effect for the rest of the session.
    terminal.selfTestFails = false;
    terminal.exit = async () => 1;
    const after = await menuWith(["8", ENTER, ESCAPE]);
    expect(after.asked[0]!.labels).toHaveLength(MENU_ENTRIES.length);
    expect(after.asked[1]!.labels).toEqual(asked[0]!.labels);
    expect(after.shown[1]!.join("\n")).toContain("The self-test failed.");
  });
});
