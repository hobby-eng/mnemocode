import { EventEmitter } from "node:events";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Standard input and standard error are a terminal; a Keyboard stands for the one on standard
// input, with the real reader of terminal-input.ts. What is typed while no question reads it stays
// in the Keyboard, as in a terminal's own buffer, and arrives once a question reads again: a key
// typed ahead, such as a second Enter pressed while a result was worked out.
vi.mock("node:tty", async (importOriginal) => ({
  ...(await importOriginal<typeof import("node:tty")>()),
  isatty: () => true,
}));

import { clearPrivateScreen, withPrivateScreen } from "../src/cli/private-screen.js";
import { waitForEnter } from "../src/cli/terminal-choice.js";
import { InputCancelled } from "../src/cli/terminal-input.js";

const ENTER = "\r";
const ESCAPE = "\x1b";
const CTRL_C = "\x03";
/** How private-screen.ts leaves the alternate screen (xterm's "?1049l"). */
const LEAVE_ALTERNATE_SCREEN = "\x1b[?1049l";
/**
 * How long a person reads before pressing a key: longer than any wait of the reader, of which
 * telling Escape alone from an arrow key's sequence is the longest (100 ms in terminal-input.ts).
 */
const READING_MS = 150;

/** Standard input as a terminal in raw mode. */
class Keyboard extends EventEmitter {
  readonly isTTY = true;
  flowing = false;
  /** Bytes typed while nothing reads: the terminal keeps them until a question reads again. */
  private held: Buffer[] = [];

  setRawMode(): this {
    return this;
  }

  resume(): this {
    this.flowing = true;
    // A terminal gives what it kept at the next read, a moment after reading starts.
    setImmediate(() => {
      for (const chunk of this.held.splice(0)) this.emit("data", chunk);
    });
    return this;
  }

  pause(): this {
    this.flowing = false;
    return this;
  }

  /** `keys` typed now, as one chunk. */
  type(keys: string): void {
    const chunk = Buffer.from(keys, "utf8");
    if (this.flowing) this.emit("data", chunk);
    else this.held.push(chunk);
  }
}

let keys = new Keyboard();
/** Everything written to standard error. */
let screen = "";
/** The message to wait for and the keys typed READING_MS after it shows. */
let pending: { readonly message: string; readonly keys: string } | undefined;
/** How much of `screen` had been written when those keys were typed. */
let typedAt: number | undefined;
/** The keys still to type, cleared after each test so that none reaches the next one. */
let typing: ReturnType<typeof setTimeout> | undefined;

/** Types `typed` a moment after `message` shows, as a person who has read the screen. */
function after(message: string, typed: string): void {
  pending = { message, keys: typed };
}

describe("waitForEnter takes only keys pressed after its message", () => {
  beforeEach(() => {
    keys = new Keyboard();
    screen = "";
    pending = undefined;
    typedAt = undefined;
    vi.spyOn(process, "stdin", "get").mockReturnValue(keys as unknown as typeof process.stdin);
    vi.stubEnv("TERM", "xterm");
    vi.stubEnv("NO_COLOR", "1");
    vi.spyOn(process.stderr, "write").mockImplementation((chunk) => {
      screen += typeof chunk === "string" ? chunk : Buffer.from(chunk).toString("utf8");
      const next = pending;
      if (next !== undefined && screen.includes(next.message)) {
        pending = undefined;
        typing = setTimeout(() => {
          typedAt = screen.length;
          keys.type(next.keys);
        }, READING_MS);
      }
      return true;
    });
  });
  afterEach(() => {
    clearTimeout(typing);
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
  });

  it("does not take an Enter pressed before the message showed", async () => {
    keys.type(ENTER);
    after("Press Enter.", ESCAPE);
    // The Enter typed ahead would have answered true.
    expect(await waitForEnter("Press Enter.")).toBe(false);
    keys.type(`${ENTER}${ENTER}`);
    after("Press Enter.", ENTER);
    expect(await waitForEnter("Press Enter.")).toBe(true);
  });

  it("does not take an Escape typed ahead where only Escape leaves", async () => {
    keys.type(ESCAPE);
    after("Press Enter to return to the menu (Esc quits).", ENTER);
    expect(
      await waitForEnter("Press Enter to return to the menu (Esc quits).", {
        onlyEscapeLeaves: true,
      }),
    ).toBe(true);
  });

  it("still cancels at a Ctrl+C typed ahead", async () => {
    keys.type(`left over${CTRL_C}`);
    await expect(waitForEnter("Press Enter.")).rejects.toBeInstanceOf(InputCancelled);
    expect(screen).not.toContain("Press Enter.");
  });

  it("clears the private screen for a result, and nothing outside it", async () => {
    expect(clearPrivateScreen()).toBe(false);
    expect(screen).toBe("");
    after("Press Enter to clear this screen.", ENTER);
    await withPrivateScreen(async () => {
      process.stderr.write("A question.\n");
      expect(clearPrivateScreen()).toBe(true);
      process.stderr.write("The result.\n");
    });
    // Erase in display and home, between the question and the result.
    const cleared = screen.lastIndexOf("\x1b[2J\x1b[H", screen.indexOf("The result."));
    expect(cleared).toBeGreaterThan(screen.indexOf("A question."));
  });

  it("keeps the private screen with a result until Enter is pressed after it", async () => {
    after("Press Enter to clear this screen.", ENTER);
    const result = await withPrivateScreen(async () => {
      // Enter pressed twice, or a bouncing key, while the result is worked out and written.
      keys.type(`${ENTER}${ENTER}`);
      process.stderr.write("The result.\n");
      return 7;
    });
    expect(result).toBe(7);
    expect(typedAt).toBeDefined();
    // The screen is left only after the Enter pressed once the message showed.
    expect(screen.indexOf(LEAVE_ALTERNATE_SCREEN)).toBeGreaterThan(typedAt!);
  });
});
