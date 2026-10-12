// AUD-010 "shares": what the restore that Decode hands a share to prints of the text of a further QR
// code image (TypedShares.askMore, #askNextShare and #showRead in src/cli/share-repair.ts). The
// terminal is replaced as in shares-handover.probe.ts. The first image holds a share of the public
// phrase; the second holds text that is no share and carries terminal control sequences (ESC [31m,
// a cursor move and line erase, BEL); the third holds the second share. Expected: text read from an image
// is not written to the terminal with its control characters, which would let the image change
// the terminal (colours, cleared lines); it is refused or shown with them removed.
// NO_COLOR is set, so MnemoCode itself writes no escape sequence. Public data only.
// Run:
//   pnpm exec vitest run --config docs/audits/AUD-010-harnesses/shares-vitest.config.mts \
//     docs/audits/AUD-010-harnesses/shares-qr-echo.probe.ts

import { mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const terminal = vi.hoisted(() => ({
  answers: [] as string[],
  choices: [] as unknown[],
  questions: [] as string[],
}));
vi.mock("node:tty", async (importOriginal) => ({
  ...(await importOriginal<typeof import("node:tty")>()),
  isatty: () => false,
}));
vi.mock("../../../src/cli/private-screen.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../../src/cli/private-screen.js")>()),
  onPrivateScreen: () => true,
}));
vi.mock("../../../src/cli/terminal-input.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../../src/cli/terminal-input.js")>();
  return {
    ...actual,
    terminalAvailable: () => true,
    withRawTerminal: async <T>(
      body: (
        next: () => Promise<number | undefined>,
        moreWithin: () => Promise<boolean>,
      ) => Promise<T>,
    ) => {
      const bytes = [...Buffer.from(terminal.answers.shift() ?? "", "utf8")];
      return body(
        async () => bytes.shift(),
        async () => bytes.length > 0,
      );
    },
    withCtrlCWatch: <T>(search: (signal: AbortSignal) => Promise<T>) =>
      search(new AbortController().signal),
  };
});
vi.mock("../../../src/cli/terminal-choice.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../../src/cli/terminal-choice.js")>()),
  choose: async (question: string) => {
    terminal.questions.push(question);
    return terminal.choices.shift();
  },
}));

import { runDecode } from "../../../src/cli/decode-command.ts";
import { exportQrPayload } from "../../../src/cli/qr-export.ts";
import { splitSskrMnemonic } from "../../../src/sskr/shares.ts";
import { writeShare } from "../../../src/sskr/transport.ts";

const PHRASE = `${"abandon ".repeat(11)}about`;
const DIR = fileURLToPath(
  new URL("../../../../tmp/mnemocode/aud010/shares/qr-echo", import.meta.url),
);
// No ";": the restore reads ";" as the end of a share, so the text stays one share. ESC [1A ESC [2K
// moves the cursor up and erases that line, which could hide the line before; ESC [31m paints red;
// BEL rings the bell.
const HOSTILE = "\x1b[1A\x1b[2K\x1b[31mRED\x1b[0m hello\x07";

describe("AUD-010 shares: text of a further QR code image on the terminal", () => {
  let out: string[];
  let notices: string[];
  beforeEach(() => {
    rmSync(DIR, { recursive: true, force: true });
    mkdirSync(DIR, { recursive: true });
    Object.assign(terminal, { answers: [], choices: [], questions: [] });
    out = [];
    notices = [];
    vi.stubEnv("NO_COLOR", "1");
    vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    vi.spyOn(console, "log").mockImplementation(
      (...line: unknown[]) => void out.push(line.join(" ")),
    );
    vi.spyOn(console, "error").mockImplementation(
      (...line: unknown[]) => void notices.push(line.join(" ")),
    );
  });
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
  });

  it("does not write the control characters of an image's text to the terminal", async () => {
    const shares = await splitSskrMnemonic(PHRASE, 2, 3);
    const first = join(DIR, "first.png");
    const hostile = join(DIR, "hostile.png");
    const second = join(DIR, "second.png");
    await exportQrPayload(writeShare(shares[0]!, "indexes"), first);
    await exportQrPayload(HOSTILE, hostile);
    await exportQrPayload(writeShare(shares[1]!, "indexes"), second);
    // "The next share?" -> read an image; the image's text is no share -> "Leave share 2 out";
    // "The next share?" -> read an image; the second share restores the phrase.
    terminal.choices = ["qr", "out", "qr"];
    terminal.answers = [`'${hostile}'\r`, `'${second}'\r`];
    let ended = "finished";
    try {
      await runDecode({ "ask-secrets": true, mode: "direct", "qr-file": first });
    } catch (error) {
      ended = `stopped: ${(error as Error).message}`;
    }

    const withEscape = notices.filter((line) => line.includes("\x1b"));
    process.stdout.write(
      `questions asked\n  actual:   ${JSON.stringify(terminal.questions)}\n` +
        `the restore\n  actual:   ${JSON.stringify(ended)}\n` +
        `every line written to stderr, escaped for this log\n  actual:   ${JSON.stringify(notices)}\n` +
        `lines written to stderr that hold ESC (0x1B), escaped for this log\n  actual:   ${JSON.stringify(withEscape)}\n  expected: []\n` +
        `restored phrase\n  actual:   ${JSON.stringify(out.at(-1))}\n  expected: ${JSON.stringify(PHRASE)}\n`,
    );
    expect(out.at(-1)).toBe(PHRASE);
    expect(withEscape).toEqual([]);
  });
});
