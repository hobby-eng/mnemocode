import { afterEach, describe, expect, it, vi } from "vitest";
import {
  dropTypedAhead,
  InputCancelled,
  readKey,
  readLine,
  rowsOfOutputLine,
  type Key,
  type MoreWithin,
  type NextByte,
} from "../src/cli/terminal-input.js";

/** The bytes of `text` as a terminal in raw mode delivers them, then the end of the input. */
function typed(text: string): NextByte {
  const bytes = [...Buffer.from(text, "utf8")];
  return async () => bytes.shift();
}

/**
 * Bytes that arrive in `chunks`: the bytes of one chunk at once, as a terminal sends a key's
 * sequence or a paste, and each chunk a while after the one before, as keys are typed.
 */
function arriving(...chunks: string[]): { next: NextByte; moreWithin: MoreWithin } {
  const queue = chunks.map((chunk) => [...Buffer.from(chunk, "utf8")]);
  return {
    next: async () => {
      while (queue.length > 0 && queue[0]!.length === 0) queue.shift();
      return queue[0]?.shift();
    },
    moreWithin: async () => (queue[0]?.length ?? 0) > 0,
  };
}

async function keys(text: string): Promise<string[]> {
  const next = typed(text);
  const read: string[] = [];
  for (;;) {
    const key = await readKey(next);
    read.push(key.kind === "digit" ? `digit ${key.digit}` : key.kind);
    if (key.kind === "back") return read;
  }
}

describe("terminal keys", () => {
  it("reads the arrows in both VT forms, Enter, digits and q", async () => {
    expect(await keys("\x1b[A\x1b[B\x1bOA\x1bOB\r\n7q")).toEqual([
      "up",
      "down",
      "up",
      "down",
      "enter",
      "enter",
      "digit 7",
      "back",
    ]);
  });

  it("goes back at Escape alone, which no more bytes follow, on every keyboard layout", async () => {
    const bytes = [0x1b];
    const next: NextByte = async () => bytes.shift();
    const moreWithin = async () => bytes.length > 0;
    expect(await readKey(next, moreWithin)).toEqual({ kind: "back" });
    bytes.push(0x1b, 0x5b, 0x41);
    expect(await readKey(next, moreWithin)).toEqual({ kind: "up" });
  });

  it("cancels the tool at Ctrl+C", async () => {
    await expect(readKey(typed("\x03"))).rejects.toBeInstanceOf(InputCancelled);
  });

  it("reads an escape sequence with parameters to its end, so that Ctrl+Up is no digit 5", async () => {
    expect(await keys("\x1b[1;5A\x1b[3~x")).toEqual(["other", "other", "other", "back"]);
  });

  it.each([
    ["Ctrl+D", "\x04"],
    ["the end of the input", ""],
  ])("goes back on %s", async (_, text) => {
    expect(await keys(text)).toEqual(["back"]);
  });

  it("reads the keys after an ESC [ that is no key's sequence, so that Enter is not lost", async () => {
    // Alt+[, or Escape and [ pressed quickly, then digits and Enter: they keep their meaning.
    expect(await keys("\x1b[12\r")).toEqual(["other", "digit 1", "digit 2", "enter", "back"]);
    // A space ends the sequence too; a second Escape starts a key of its own.
    expect(await keys("\x1b[1 3\x1b[A")).toEqual([
      "other",
      "digit 1",
      "other",
      "digit 3",
      "up",
      "back",
    ]);
    await expect(keys("\x1b[1;\x03")).rejects.toBeInstanceOf(InputCancelled);
    // No key's sequence is longer than eight bytes after the [.
    expect(await keys(`\x1b[${"1".repeat(9)}A`)).toEqual([
      "other",
      ...Array.from({ length: 9 }, () => "digit 1"),
      "other",
      "back",
    ]);
  });

  it("reads the keys after ESC [ and a pause, or after ESC with a control key", async () => {
    // The rest of a key's sequence comes at once: typed later, the digit is a key.
    const paused = arriving("\x1b[1", "2", "\r");
    const read: Key[] = [];
    do read.push(await readKey(paused.next, paused.moreWithin));
    while (read.at(-1)!.kind !== "back");
    expect(read).toEqual([
      { kind: "other" },
      { kind: "digit", digit: 1 },
      { kind: "digit", digit: 2 },
      { kind: "enter" },
      { kind: "back" },
    ]);
    // Alt+Enter is Enter; Escape pressed twice quickly goes back.
    expect(await keys("\x1b\r")).toEqual(["other", "enter", "back"]);
    const twice = arriving("\x1b\x1b");
    expect(await readKey(twice.next, twice.moreWithin)).toEqual({ kind: "other" });
    expect(await readKey(twice.next, twice.moreWithin)).toEqual({ kind: "back" });
  });

  it("drops the keys given back with what was typed ahead, and cancels at a Ctrl+C among them", async () => {
    expect(await readKey(typed("\x1b[1\r"))).toEqual({ kind: "other" });
    await dropTypedAhead();
    expect(await readKey(typed(""))).toEqual({ kind: "back" });
    expect(await readKey(typed("\x1b[1\x03"))).toEqual({ kind: "other" });
    await expect(dropTypedAhead()).rejects.toBeInstanceOf(InputCancelled);
    expect(await readKey(typed(""))).toEqual({ kind: "back" });
  });
});

describe("hidden line", () => {
  afterEach(() => vi.restoreAllMocks());

  it("keeps every byte as typed and shows nothing", async () => {
    const shown = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    expect(await readLine(typed("test only\ttab\r"), { echo: false })).toBe("test only\ttab");
    expect(shown).not.toHaveBeenCalled();
  });

  it("edits with Backspace, Delete and Ctrl+U, also over a character of several bytes", async () => {
    expect(await readLine(typed("abc\x7fd\r"), { echo: false })).toBe("abd");
    expect(await readLine(typed("ab€\x08c\r"), { echo: false })).toBe("abc");
    expect(await readLine(typed("wrong\x15right\n"), { echo: false })).toBe("right");
  });

  it("ends with Ctrl+D or the end of the input only when nothing was typed", async () => {
    expect(await readLine(typed("\x04"), { echo: false })).toBeUndefined();
    expect(await readLine(typed(""), { echo: false })).toBeUndefined();
    expect(await readLine(typed("partial"), { echo: false })).toBe("partial");
    expect(await readLine(typed("a\x04b\r"), { echo: false })).toBe("a\x04b");
  });

  it("is cancelled by Ctrl+C", async () => {
    await expect(readLine(typed("secret\x03"), { echo: false })).rejects.toBeInstanceOf(
      InputCancelled,
    );
  });

  it("refuses an answer longer than its limit and text that is not UTF-8", async () => {
    await expect(readLine(typed("12345\r"), { echo: false, limit: 4 })).rejects.toThrow(
      "longer than 4 bytes",
    );
    const invalid: NextByte = (() => {
      const bytes = [0xff, 0x0d];
      return async () => bytes.shift();
    })();
    await expect(readLine(invalid, { echo: false })).rejects.toThrow("not valid UTF-8");
  });

  it("shows a visible answer as it is typed, without control keys and escape sequences", async () => {
    const shown: string[] = [];
    vi.spyOn(process.stderr, "write").mockImplementation((chunk) => {
      shown.push(Buffer.from(chunk as Uint8Array).toString("utf8"));
      return true;
    });
    // Up is no editing key; Ctrl+A goes to the start, where x goes in and Backspace takes it out.
    expect(await readLine(typed("ab\x1b[Ac\x01x\x7f\r"), { echo: true })).toBe("abc");
    expect(shown.join("")).not.toContain("\x1b[A");
    // A pasted Tab between words counts and shows as a space.
    shown.length = 0;
    expect(await readLine(typed("abandon\tabout\r"), { echo: true })).toBe("abandon about");
    expect(shown.join("")).toBe("abandon about");
  });

  it("edits a visible answer at the cursor, as a shell does", async () => {
    vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    const LEFT = "\x1b[D";
    const RIGHT = "\x1b[C";
    // Left twice, then a character goes in before the last two.
    expect(await readLine(typed(`abcd${LEFT}${LEFT}X\r`), { echo: true })).toBe("abXcd");
    // Backspace deletes before the cursor, Delete under it.
    expect(await readLine(typed(`abcd${LEFT}${LEFT}\x7f\x1b[3~\r`), { echo: true })).toBe("ad");
    // Home and End, also as Ctrl+A and Ctrl+E, and the O forms of application mode.
    expect(await readLine(typed(`bc\x1b[Ha\x1b[Fd\r`), { echo: true })).toBe("abcd");
    expect(await readLine(typed(`bc\x1bOHa\x05d\r`), { echo: true })).toBe("abcd");
    // Ctrl+Left and Ctrl+Right move by words; Ctrl+W deletes the word before the cursor.
    expect(
      await readLine(typed(`one two three\x1b[1;5D\x1b[1;5DX\x1b[1;5C${RIGHT}Y\r`), { echo: true }),
    ).toBe("one Xtwo Ythree");
    expect(await readLine(typed(`one two three\x17\x17four\r`), { echo: true })).toBe("one four");
    // Ctrl+U deletes what is before the cursor, Ctrl+K what follows it.
    expect(
      await readLine(typed(`wrong right${LEFT}${LEFT}${LEFT}${LEFT}${LEFT}\x15\r`), { echo: true }),
    ).toBe("right");
    expect(await readLine(typed(`keep cut${LEFT}${LEFT}${LEFT}\x0b\r`), { echo: true })).toBe(
      "keep ",
    );
    // A character of several bytes moves and deletes as one.
    expect(await readLine(typed(`a€b${LEFT}${LEFT}\x7f\r`), { echo: true })).toBe("€b");
  });

  it("ignores Escape alone in a secret prompt and goes back with it in the menu", async () => {
    vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    const lone = (text: string) => {
      const next = typed(text);
      // Escape alone: nothing follows it at once.
      let first = true;
      return {
        next,
        moreWithin: async () => {
          const answer = !first;
          first = false;
          return answer;
        },
      };
    };
    const secret = lone("\x1babc\r");
    expect(await readLine(secret.next, { echo: true, moreWithin: secret.moreWithin })).toBe("abc");
    const menu = lone("\x1babc\r");
    expect(
      await readLine(menu.next, { echo: true, moreWithin: menu.moreWithin, escapeGoesBack: true }),
    ).toBeUndefined();
  });

  it("reads the rest of an arrow key that a slow link split from its Escape as that key", async () => {
    vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    // ESC arrives alone, "[B" (Down) and "OD" (Left) later; Left then moves before the c.
    const down = arriving("\x1b", "[B", "a", "b", "c", "\x1b", "OD", "x", "\r");
    expect(await readLine(down.next, { echo: true, moreWithin: down.moreWithin })).toBe("abxc");
    // Ctrl+Left (ESC [ 1 ; 5 D) goes to the start of the word.
    const word = arriving("a", "b", "\x1b", "[1;5D", "x", "\r");
    expect(await readLine(word.next, { echo: true, moreWithin: word.moreWithin })).toBe("xab");
    // A [ typed later than LATE_SEQUENCE_MS after the Escape is text.
    const now = Date.now();
    const clock = vi.spyOn(Date, "now").mockReturnValue(now);
    const slow = typed("\x1b[x\r");
    let calls = 0;
    const answer = readLine(
      async () => {
        calls += 1;
        // The second key comes two seconds later.
        if (calls === 2) clock.mockReturnValue(now + 2_000);
        return slow();
      },
      { echo: true, moreWithin: async () => false },
    );
    expect(await answer).toBe("[x");
  });

  it("keeps text that starts with [ or O after an ignored Escape, typed or pasted", async () => {
    vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    const answers: string[] = [];
    for (const chunks of [
      // Typed key by key: no key's sequence comes this slowly.
      ["\x1b", "O", "x", "f", "o", "r", "d", "\r"],
      ["\x1b", "[", "A", "\r"],
      // Pasted: no key ends in x, and a key's sequence is not followed at once by more text.
      ["\x1b", "Oxford passphrase\r"],
      ["\x1b", "OBrien\r"],
      ["\x1b", "[1;5Dx\r"],
    ]) {
      const input = arriving(...chunks);
      answers.push((await readLine(input.next, { echo: true, moreWithin: input.moreWithin }))!);
    }
    expect(answers).toEqual(["Oxford", "[A", "Oxford passphrase", "OBrien", "[1;5Dx"]);
    // Ctrl+C right after the [ still cancels.
    const cancelled = arriving("\x1b", "[\x03");
    await expect(
      readLine(cancelled.next, { echo: true, moreWithin: cancelled.moreWithin }),
    ).rejects.toBeInstanceOf(InputCancelled);
  });

  it("keeps what is typed after an ESC [ that is no key's sequence", async () => {
    vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    // Alt+[ inside word numbers, as the final review typed it: the digits, the spaces and Enter
    // after it count; before, they were taken for the sequence until a letter came.
    expect(await readLine(typed("1 1 \x1b[1 1\r"), { echo: true })).toBe("1 1 1 1");
    const paused = arriving("1 1 \x1b[1", " 1\r");
    expect(await readLine(paused.next, { echo: true, moreWithin: paused.moreWithin })).toBe(
      "1 1 1 1",
    );
    // Backspace deletes, Alt+Enter ends the answer, Ctrl+C cancels.
    expect(await readLine(typed("ab\x1b[1\x7f\r"), { echo: true })).toBe("ab");
    expect(await readLine(typed("abc\x1b\r"), { echo: true })).toBe("abc");
    await expect(readLine(typed("ab\x1b[1;\x03"), { echo: true })).rejects.toBeInstanceOf(
      InputCancelled,
    );
    // A whole sequence of a key that edits nothing, such as F9 (ESC [ 2 0 ~), is still left out.
    expect(await readLine(typed("ab\x1b[20~c\r"), { echo: true })).toBe("abc");
  });
});

describe("rows of output", () => {
  it("counts a tab to the next stop of eight columns, then wraps the line", () => {
    // "1" and a tab take 8 columns: 72 more characters fill a row of 80, 73 wrap onto a second.
    expect(rowsOfOutputLine(`1\t${"x".repeat(72)}`, 80)).toBe(1);
    expect(rowsOfOutputLine(`1\t${"x".repeat(73)}`, 80)).toBe(2);
    expect(rowsOfOutputLine("", 80)).toBe(1);
  });
});
