import { afterEach, describe, expect, it, vi } from "vitest";
import { InputCancelled, readKey, readLine, type NextByte } from "../src/cli/terminal-input.js";

/** The bytes of `text` as a terminal in raw mode delivers them, then the end of the input. */
function typed(text: string): NextByte {
  const bytes = [...Buffer.from(text, "utf8")];
  return async () => bytes.shift();
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
});
