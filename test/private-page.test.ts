import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PrivatePage } from "../src/cli/private-page.js";
import { printShares, inForm } from "../src/cli/sskr-output.js";
import { CLEAR_SCREEN } from "../src/cli/terminal.js";
import { CANCELLED } from "../src/cli/terminal-keys.js";
import { STYLE_CODES } from "../src/cli/terminal-style.js";
import { Masking } from "../src/core/masking.js";
import { sskrSetVector } from "../src/sskr/known-answers.js";
import { SHARE_FORMATS } from "../src/sskr/transport.js";
import { PrivateTerminal } from "./helpers/private-terminal.js";
import { Screen } from "./helpers/terminal-screen.js";

// The page of the private screen (private-page.ts): what was written since the screen was last
// cleared, shown by pages before a question or an Enter prompt when it does not fit with them.

const keyboard = vi.hoisted(() => ({ bytes: [] as number[] }));
vi.mock("../src/cli/terminal-input.js", async (original) => ({
  ...(await original<typeof import("../src/cli/terminal-input.js")>()),
  dropTypedAhead: async () => undefined,
  withRawTerminal: async <T>(
    body: (next: () => Promise<number | undefined>, more: () => Promise<boolean>) => Promise<T>,
  ) =>
    body(
      async () => keyboard.bytes.shift(),
      async () => keyboard.bytes.length > 0,
    ),
}));

let terminal: PrivateTerminal;

function type(keys: string): void {
  keyboard.bytes = Array.from(Buffer.from(keys));
}

/** The rows that `frame` takes on the terminal, as a screen of its own reads them. */
function rowsOf(frame: string): string[] {
  const screen = new Screen(process.stderr.columns);
  screen.write(frame);
  return screen.lines().map((row) => row.replace(STYLE_CODES, ""));
}

/** What the terminal shows now: the rows since its last clear. */
function screen(): string[] {
  return rowsOf(terminal.frames().at(-1) ?? "");
}

/** `count` blocks of a heading and three rows, each after a blank row. */
function blocks(count: number): void {
  for (let block = 0; block < count; block += 1)
    console.log(`\nBlock ${block}\nfirst row\nsecond row\nthird row`);
}

beforeEach(() => {
  terminal = new PrivateTerminal();
});
afterEach(() => terminal.close());

describe("the page of the private screen", () => {
  it("leaves a page that fits with what comes under it as it is", async () => {
    console.log("A short result");
    type("");
    expect(await PrivatePage.keepReadable(2)).toBeUndefined();
    expect(terminal.written).not.toContain("Page ");
  });

  it("shows a long page whole by pages, the lines before its result too (AUD-037-UI004)", async () => {
    process.stderr.write(CLEAR_SCREEN);
    console.error("MnemoCode · SSKR export");
    console.error("The shares do not store the dates or the mode; keep them yourself.");
    for (let row = 0; row < 60; row += 1) console.log(`Public row ${row}`);
    type("\x1b[6~".repeat(10) + "\x1b[1~" + "\x1b[4~" + "\r");
    expect(await PrivatePage.keepReadable(2)).toBeUndefined();
    const shown = terminal.frames().join("\n");
    expect(shown).toContain("MnemoCode · SSKR export");
    expect(shown).toContain("keep them yourself.");
    for (let row = 0; row < 60; row += 1) expect(shown).toContain(`Public row ${row}\n`);
    // Every frame fits on the terminal, its keys under the page.
    for (const frame of terminal.frames().slice(2))
      expect(frame.split("\n").length).toBeLessThanOrEqual(24);
    // Home and End as a VT220 sends them reach the first and the last page (AUD-037-UI005).
    // The last frame is the end of the page left on the screen after Enter.
    expect(terminal.frames().at(-3)).toContain("Page 1/");
    expect(terminal.frames().at(-2)).toMatch(/Public row 59\n[^]*Page \d+\/\d+/u);
  });

  it("paints the page's keys grey and keeps the page's own colours", async () => {
    vi.stubEnv("CLICOLOR_FORCE", "1");
    vi.stubEnv("NO_COLOR", "");
    try {
      process.stderr.write(CLEAR_SCREEN);
      console.log("\x1b[1mMnemoCode · SSKR share 1 of 3\x1b[0m");
      for (let row = 0; row < 40; row += 1) console.log(`Public row ${row}`);
      type("\r");
      await PrivatePage.keepReadable(2);
      expect(terminal.written).toContain("\x1b[90mPage 1/");
      expect(terminal.written).toContain("\x1b[1mMnemoCode · SSKR share 1 of 3\x1b[0m");
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it("leaves the end of the page on the screen after Enter, without the keys, and fits then", async () => {
    process.stderr.write(CLEAR_SCREEN);
    for (let row = 0; row < 40; row += 1) console.log(`Public row ${row}`);
    type("\r");
    await PrivatePage.keepReadable(2);
    const after = screen();
    expect(after.join("\n")).not.toMatch(/Page |Enter done/u);
    expect(after.at(-2)).toBe("Public row 39");
    expect(after).toHaveLength(23);
    // What is under it now fits: no second round of pages.
    const drawn = terminal.written.length;
    expect(await PrivatePage.keepReadable(2)).toBeUndefined();
    expect(terminal.written.length).toBe(drawn);
  });

  it.each([
    ["\x03", CANCELLED],
    // Escape, q and Ctrl+D end the pages as Enter does: the question under them says what Escape
    // does there.
    ["\x1b", undefined],
    ["q", undefined],
  ] as const)("ends at %j with %s and releases the resize listener", async (key, ended) => {
    process.stderr.write(CLEAR_SCREEN);
    for (let row = 0; row < 40; row += 1) console.log(`Public row ${row}`);
    type(key);
    const listeners = process.listenerCount("SIGWINCH");
    expect(await PrivatePage.keepReadable(2)).toBe(ended);
    expect(process.listenerCount("SIGWINCH")).toBe(listeners);
  });

  it("shows again only when rows written since it was read do not fit (AUD-037-UI002)", async () => {
    process.stderr.write(CLEAR_SCREEN);
    for (let row = 0; row < 40; row += 1) console.log(`Public row ${row}`);
    type("\r");
    await PrivatePage.keepReadable(3);
    // An answer refused again and again: each try is read as it is typed, and none is paged.
    for (let attempt = 0; attempt < 12; attempt += 1) {
      console.error(`Answer: wrong ${attempt}\n! It is refused.`);
      const drawn = terminal.written.length;
      expect(await PrivatePage.keepReadable(3)).toBeUndefined();
      expect(terminal.written.length).toBe(drawn);
    }
    // A result longer than the screen after them is.
    for (let row = 0; row < 30; row += 1) console.log(`Later row ${row}`);
    type("\r");
    await PrivatePage.keepReadable(3);
    expect(terminal.frames().some((frame) => frame.includes("Later row 0"))).toBe(true);
  });

  it("reflows the page when the terminal is resized while it waits", async () => {
    process.stderr.write(CLEAR_SCREEN);
    console.log("First public row");
    for (let row = 0; row < 40; row += 1) console.log(`Public wide row ${row} ${"的".repeat(30)}`);
    type("\r");
    terminal.stderr.mockImplementation((chunk: unknown) => {
      terminal.write(chunk);
      if (process.stderr.columns === 80 && String(chunk).includes("Page 1/")) {
        process.stderr.columns = 32;
        process.stderr.rows = 12;
        process.emit("SIGWINCH");
      }
      return true;
    });
    await PrivatePage.keepReadable(2);
    const pages = terminal.frames().filter((frame) => frame.includes("Page 1/"));
    expect(pages).toHaveLength(2);
    expect(pages[1]).toContain("First public row");
    expect(rowsOf(pages[1] ?? "").length).toBeLessThanOrEqual(12);
  });

  it("records no output that goes to a file", async () => {
    PrivatePage.close();
    Object.defineProperty(process.stdout, "isTTY", { value: false, configurable: true });
    PrivatePage.open();
    process.stderr.write(CLEAR_SCREEN);
    for (let row = 0; row < 60; row += 1) console.log(`Public row ${row}`);
    type("");
    expect(await PrivatePage.keepReadable(2)).toBeUndefined();
    expect(terminal.written).not.toContain("Page ");
  });

  it("gives the streams back their own writers when it closes", () => {
    const writer = (): unknown => Object.getOwnPropertyDescriptor(process.stderr, "write")?.value;
    const recorded = writer();
    PrivatePage.close();
    const own = writer();
    expect(own).not.toBe(recorded);
    PrivatePage.open();
    PrivatePage.close();
    expect(writer()).toBe(own);
    PrivatePage.open();
  });

  it("ends a page after a blank row where one falls in its second half", async () => {
    process.stderr.rows = 12;
    process.stderr.write(CLEAR_SCREEN);
    blocks(6);
    type("\x1b[6~".repeat(10) + "\r");
    await PrivatePage.keepReadable(2);
    const pages = terminal.frames().filter((frame) => frame.includes("Page "));
    expect(pages.length).toBeGreaterThan(1);
    // Each page but the first starts with a block's heading, after the blank row before it.
    for (const page of pages.slice(1)) expect(rowsOf(page)[0]).toMatch(/^Block \d$/u);
  });

  it.each([
    [80, 24],
    [32, 12],
    [120, 40],
  ])("draws each page within a %i by %i terminal", async (width, height) => {
    process.stderr.columns = width;
    process.stderr.rows = height;
    process.stderr.write(CLEAR_SCREEN);
    for (let row = 0; row < 85; row += 1) console.log(`Public row ${row} ${"的".repeat(row % 50)}`);
    // Page by page, then the last and the first as a VT220 or rxvt sends End and Home.
    type("\x1b[6~".repeat(100) + "\x1b[8~\x1b[7~\r");
    await PrivatePage.keepReadable(2);
    const pages = terminal.frames().filter((frame) => frame.includes("Page "));
    for (const page of pages) expect(rowsOf(page).length).toBeLessThanOrEqual(height);
    for (let row = 0; row < 85; row += 1)
      expect(pages.some((page) => new RegExp(`Public row ${row}(?!\\d)`, "u").test(page))).toBe(
        true,
      );
    expect(pages.at(-1)).toContain("Page 1/");
  });
});

describe("the rows that a page takes", () => {
  it("counts a tab as the columns it moves on when it bounds the page's rows", async () => {
    // Nine tabs and nine letters take 81 columns of an 80-column terminal from 18 bytes: two rows.
    for (let row = 0; row < 11; row += 1) console.log(`${"\t".repeat(9)}${"x".repeat(9)}`);
    type("\r");
    expect(await PrivatePage.keepReadable(3)).toBeUndefined();
    expect(terminal.frames().join("\n")).toContain("Page 1/");
  });
});

describe("shares on the private screen", () => {
  it.each(SHARE_FORMATS)("keeps every one of 16 shares in %s reachable", async (form) => {
    process.stderr.rows = 12;
    process.stderr.write(CLEAR_SCREEN);
    const shares = Array.from({ length: 16 }, (_, at) => sskrSetVector.shares[at % 3]!);
    printShares(inForm(shares, form));
    type("\x1b[6~".repeat(200) + "\r");
    await PrivatePage.keepReadable(2);
    for (let number = 1; number <= 16; number += 1)
      expect(terminal.frames().join("\n")).toContain(`SSKR share ${number} of 16`);
  });

  it.each(["unicode", "colors-unicode"] as const)(
    "keeps all three %s shares reachable beside the lines around them in colour (AUD-037-UI002)",
    async (form) => {
      vi.stubEnv("CLICOLOR_FORCE", "1");
      vi.stubEnv("NO_COLOR", "");
      try {
        process.stderr.write(CLEAR_SCREEN);
        console.log("MnemoCode · SSKR export");
        printShares(inForm(sskrSetVector.shares, form), 3, Masking.of("direct").holds);
        console.log("Original fingerprint 73c5da0a");
        type("\x1b[6~".repeat(20) + "\r");
        await PrivatePage.keepReadable(8);
        const shown = terminal.frames().join("\n");
        for (let number = 1; number <= 3; number += 1)
          expect(shown).toContain(`SSKR share ${number} of 3`);
        expect(shown).toContain("MnemoCode · SSKR export");
        expect(shown).toContain("Original fingerprint 73c5da0a");
      } finally {
        vi.unstubAllEnvs();
      }
    },
  );

  it("keeps every redirected share on stdout and its plain header on stderr", () => {
    const output: string[] = [];
    const errors: string[] = [];
    vi.spyOn(console, "log").mockImplementation((line: unknown) => output.push(String(line)));
    vi.spyOn(console, "error").mockImplementation((line: unknown) => errors.push(String(line)));
    Object.defineProperty(process.stdout, "isTTY", { value: false, configurable: true });
    printShares(inForm(sskrSetVector.shares, "ur"), 3, Masking.of("direct").holds);
    for (const share of sskrSetVector.shares) expect(output).toContain(share);
    for (let number = 1; number <= 3; number += 1)
      expect(errors.join("\n")).toContain(`SSKR share ${number} of 3`);
    expect(output.join("\n")).not.toContain("\x1b");
  });
});
