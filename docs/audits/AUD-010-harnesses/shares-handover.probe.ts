// AUD-010 "shares": the restore that Decode hands a share to (decode-command.ts, restoreFromShare
// in sskr-command.ts, TypedShares.startingWith in share-repair.ts). The terminal is replaced as in
// test/encode-decode-questions.test.ts: each question that reads a line takes the next answer, each
// list question the next choice. Expected: the share read from the first QR code image is kept as
// share 1, shown once, never asked for again; a second image of the same share is a copy, used
// once, and does not make up the threshold; the next image of another share completes it. Public
// data only: shares of "abandon ... about", written by exportQrPayload into a scratch folder.
// Run:
//   pnpm exec vitest run --config docs/audits/AUD-010-harnesses/shares-vitest.config.mts \
//     docs/audits/AUD-010-harnesses/shares-handover.probe.ts

import { mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const terminal = vi.hoisted(() => ({
  answers: [] as string[],
  choices: [] as unknown[],
  questions: [] as string[],
  labels: [] as string[][],
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
  choose: async (question: string, choices: readonly { readonly label: string }[]) => {
    terminal.questions.push(question);
    terminal.labels.push(choices.map((choice) => choice.label));
    return terminal.choices.shift();
  },
}));

import { runDecode } from "../../../src/cli/decode-command.ts";
import { exportQrPayload } from "../../../src/cli/qr-export.ts";
import { splitSskrMnemonic } from "../../../src/sskr/shares.ts";
import { writeShare } from "../../../src/sskr/transport.ts";

const PHRASE = `${"abandon ".repeat(11)}about`;
const DIR = fileURLToPath(
  new URL("../../../../tmp/mnemocode/aud010/shares/handover", import.meta.url),
);
const SHARES_PROMPT = "Shamir shares (separate shares with ;";

describe("AUD-010 shares: a QR share handed from Decode to the restore", () => {
  let out: string[];
  let notices: string[];
  let screen: string;
  beforeEach(() => {
    rmSync(DIR, { recursive: true, force: true });
    mkdirSync(DIR, { recursive: true });
    Object.assign(terminal, { answers: [], choices: [], questions: [], labels: [] });
    out = [];
    notices = [];
    screen = "";
    vi.stubEnv("NO_COLOR", "1");
    vi.spyOn(process.stderr, "write").mockImplementation((chunk) => {
      screen += Buffer.from(chunk as Uint8Array).toString("utf8");
      return true;
    });
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

  function report(name: string, actual: unknown, expected: unknown): void {
    process.stdout.write(
      `${name}\n  actual:   ${JSON.stringify(actual)}\n  expected: ${JSON.stringify(expected)}\n`,
    );
  }

  it("keeps the first share once, takes a second image of it as a copy, then restores", async () => {
    const shares = await splitSskrMnemonic(PHRASE, 2, 3);
    const first = join(DIR, "first.png");
    const again = join(DIR, "first again.png");
    const second = join(DIR, "second.png");
    await exportQrPayload(writeShare(shares[0]!, "indexes"), first);
    await exportQrPayload(writeShare(shares[0]!, "indexes"), again);
    await exportQrPayload(writeShare(shares[1]!, "indexes"), second);
    terminal.choices = ["qr", "qr"];
    terminal.answers = [`'${again}'\r`, `'${second}'\r`];
    await runDecode({ "ask-secrets": true, mode: "direct", "qr-file": first });

    const shown = notices.filter((line) => line.includes("from its QR code"));
    const expectedShown = [1, 2, 3].map(
      (place) =>
        `✓ Share ${place}, from its QR code: ${writeShare(shares[place === 3 ? 1 : 0]!, "indexes")}`,
    );
    report("shares shown from QR code images", shown, expectedShown);
    expect(shown).toEqual(expectedShown);

    const copies = notices.filter((line) => line.includes("is a copy of share"));
    report("copy notes", copies, ["Share 2 is a copy of share 1: it is used once."]);
    expect(copies).toEqual(["Share 2 is a copy of share 1: it is used once."]);

    // Once after share 1 alone, and once more after its copy was left out: "One share" both
    // times, so the copy was not counted.
    const few = notices.filter((line) => line.includes("not enough"));
    const expectedFew = [
      "One share is not enough: this set needs 2.",
      "One share is not enough: this set needs 2.",
    ];
    report("too-few notes, after share 1 and after its copy", few, expectedFew);
    expect(few).toEqual(expectedFew);
    const order = notices
      .filter((line) => /not enough|is a copy|from its QR code/u.test(line))
      .map((line) => (line.includes("QR code") ? line.slice(0, 29) : line));
    const expectedOrder = [
      "✓ Share 1, from its QR code: ",
      "One share is not enough: this set needs 2.",
      "✓ Share 2, from its QR code: ",
      "Share 2 is a copy of share 1: it is used once.",
      "One share is not enough: this set needs 2.",
      "✓ Share 3, from its QR code: ",
    ];
    report("order of the notes", order, expectedOrder);
    expect(order).toEqual(expectedOrder);

    report("list questions", terminal.questions, ["The next share?", "The next share?"]);
    expect(terminal.questions).toEqual(["The next share?", "The next share?"]);
    const askedAll = screen.includes(SHARES_PROMPT);
    report("the first share asked for again", askedAll, false);
    expect(askedAll).toBe(false);
    report("restored phrase", out.at(-1), PHRASE);
    expect(out.at(-1)).toBe(PHRASE);
  });
});
