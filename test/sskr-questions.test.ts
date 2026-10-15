// sskr-combine on the private screen, with the terminal replaced
// (test/helpers/question-terminal.ts). Public test data only: the "abandon … about" phrase, its
// fingerprint 73c5da0a, and vectors/sskr-v1.json. test/sskr-export-questions.test.ts has
// sskr-export and sskr-split.

import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ParsedArguments } from "../src/cli/arguments.js";
import { masterFingerprint } from "../src/bitcoin-evidence.js";
import { encodeMnemonic, parseDate } from "../src/core.js";
import { runSskrCombine } from "../src/cli/sskr-command.js";
import { CANCELLED, type Cancelled } from "../src/cli/terminal-keys.js";
import { JointRepair } from "../src/sskr/joint-repair.js";
import { splitSskrMnemonic } from "../src/sskr/shares.js";
import { writeShare } from "../src/sskr/transport.js";
import { markUnits, VALUE_BYTE, wrongValue } from "./helpers/shares.js";
import { STYLE_CODES } from "../src/cli/terminal-style.js";
import { questionsOnPrivateScreen, seen, terminal } from "./helpers/question-terminal.js";
import {
  marked,
  OTHER_SET_SHARE,
  PHRASE,
  promptsShown,
  SHARES,
  SHARES_PROMPT,
} from "./helpers/share-questions.js";
import { TEST_FINGERPRINT, TEST_PHRASE } from "./helpers/test-phrase.js";

const harness = await vi.hoisted(async () => import("./helpers/question-terminal.js"));
vi.mock("node:tty", async (importOriginal) => harness.replacedTty(await importOriginal()));
vi.mock("../src/cli/private-screen.js", async (importOriginal) =>
  harness.replacedPrivateScreen(await importOriginal()),
);
vi.mock("../src/cli/terminal-input.js", async (importOriginal) =>
  harness.replacedTerminalInput(await importOriginal()),
);
vi.mock("../src/cli/terminal-choice.js", async (importOriginal) =>
  harness.replacedTerminalChoice(await importOriginal()),
);

const TEST_DATE = "23-09-2026";
const DATES_PROMPT = "Dates (up to 4, DD-MM-YYYY, ? for what is forgotten, separated by spaces):";

/** `share` with one Bytewords pair of its UR replaced: its checksum then fails. */
function misread(share: string): string {
  const body = share.slice("ur:sskr/".length);
  const at = 2 * VALUE_BYTE;
  const pair = body.slice(at, at + 2) === "ae" ? "ad" : "ae";
  return `ur:sskr/${body.slice(0, at)}${pair}${body.slice(at + 2)}`;
}

/** `line` without its colour codes. */
function withoutColour(line: string): string {
  return line.replace(STYLE_CODES, "");
}

/** Restores with --ask-secrets and `options`, answering as the terminal says. */
function combine(options: ParsedArguments = {}): Promise<Cancelled | undefined> {
  return runSskrCombine({ "ask-secrets": true, ...options });
}

const masked = encodeMnemonic(TEST_PHRASE, [parseDate(TEST_DATE)]).shiftedEnglish.join(" ");
let shares: string[];

/** The fingerprint of the masked phrase, in the words that encode shows it with. */
const encodedLine = (): string =>
  `Encoded BIP32 master fingerprint of the masked phrase (empty BIP39 passphrase): ${masterFingerprint(masked)}`;

/** Splits the masked phrase into new shares before each test. */
function splitSharesBeforeEach(): void {
  beforeEach(async () => {
    shares = await splitSskrMnemonic(masked, 2, 3);
  });
}

questionsOnPrivateScreen();

describe("shares on the private screen", () => {
  it("names a share that cannot be read and asks only for it again", async () => {
    const wrong = misread(SHARES[1]);
    // A ; at the end leaves an empty part, which is no share.
    terminal.answers = [`${SHARES[0]};${wrong};\r`, `${SHARES[2]}\r`];
    terminal.choices = ["again"];
    await combine();
    expect(seen.out).toContain(PHRASE);
    expect(seen.notices).toContain(
      "Share 2 cannot be read: SSKR transport checksum does not match.",
    );
    expect(terminal.labels).toEqual([["Leave share 2 out", "Type share 2 again"]]);
    expect(promptsShown()).toEqual([SHARES_PROMPT, "Share 2 again, or its text file path:"]);
    // The private screen shows what is typed; no warning repeats it.
    expect(seen.notices.join("\n")).not.toContain(wrong.slice(8));
  });

  it("names a color written with too few symbols and asks only for that share again", async () => {
    const colors = writeShare(SHARES[1], "colors").split(" ");
    colors[2] = `${colors[2]!.slice(0, 5)}?`;
    terminal.answers = [`${SHARES[0]};${colors.join(" ")}\r`, `${SHARES[1]}\r`];
    terminal.choices = ["again"];
    await combine();
    expect(seen.notices).toContain(
      "Share 2: color 3 has 5 of 6 symbols: write a ? for each digit that cannot be read, or a lone ? for the whole color.",
    );
    expect(promptsShown()).toEqual([SHARES_PROMPT, "Share 2 again, or its text file path:"]);
    expect(seen.out).toContain(PHRASE);
  });

  it("restores colors with some of their digits unreadable", async () => {
    const colors = writeShare(SHARES[1], "colors").split(" ");
    for (const place of [4, 5, 6]) colors[place] = `${colors[place]!.slice(0, 5)}??`;
    terminal.answers = [`${SHARES[0]};${colors.join(" ")}\r`];
    await combine();
    expect(seen.notices).toContain("✓ Marked elements: settled by the shares together");
    expect(seen.out).toContain(PHRASE);
  });

  it("lets a pasted line that is no share be left out, also after it was typed again", async () => {
    // A heading copied with the shares, then typed again as something that is still no share.
    terminal.answers = [`${SHARES[0]}\n${SHARES[2]}\nSSKR share 3 of 3\r`, "nothing\r"];
    terminal.choices = ["again", "out"];
    await combine();
    expect(seen.notices.filter((line) => line.startsWith("Share 3 cannot be read: "))).toHaveLength(
      2,
    );
    expect(terminal.labels).toEqual([
      ["Leave share 3 out", "Type share 3 again"],
      ["Leave share 3 out", "Type share 3 again"],
    ]);
    expect(promptsShown()).toEqual([SHARES_PROMPT, "Share 3 again, or its text file path:"]);
    expect(seen.out).toContain(PHRASE);
  });

  it("joins a share that a paste wrapped over lines", async () => {
    // A UR cut in its middle, and Bytewords broken between two words.
    const cut = Math.floor(SHARES[0].length / 2);
    const words = writeShare(SHARES[2], "words").split(" ");
    const half = Math.floor(words.length / 2);
    terminal.answers = [
      [
        SHARES[0].slice(0, cut),
        SHARES[0].slice(cut),
        words.slice(0, half).join(" "),
        words.slice(half).join(" "),
      ].join("\n") + "\r",
    ];
    await combine();
    expect(promptsShown()).toEqual([SHARES_PROMPT]);
    expect(terminal.labels).toEqual([]);
    expect(seen.out).toContain(PHRASE);
  });

  it("says that a seed phrase is no share, typed in one line or one word per line", async () => {
    terminal.answers = [
      `${TEST_PHRASE}\r`,
      `${TEST_PHRASE.replaceAll(" ", "\n")}\r`,
      `${SHARES[0]};${SHARES[1]}\r`,
    ];
    await combine();
    const line =
      "This is a seed phrase in words, not a Shamir share: Decode numbers, codes or colors back into a seed phrase reads a masked one.";
    expect(seen.notices.filter((notice) => notice === line)).toHaveLength(2);
    expect(promptsShown()).toEqual([SHARES_PROMPT, SHARES_PROMPT, SHARES_PROMPT]);
    expect(seen.out).toContain(PHRASE);
  });

  it("names an encoded seed phrase given as a share on the command line", async () => {
    // "abandon … about" as word numbers.
    await expect(runSskrCombine({ share: "1 1 1 1 1 1 1 1 1 1 1 4" })).rejects.toThrow(
      "Share 1 is an encoded seed phrase, not a Shamir share: Decode numbers, codes or colors back into a seed phrase reads it.",
    );
  });
});

describe("shares on the private screen", () => {
  it("takes a share file pasted as lines as one answer of several shares", async () => {
    terminal.answers = [`${SHARES[0]}\n${SHARES[2]}\r`];
    await combine();
    expect(seen.out).toContain(PHRASE);
    expect(promptsShown()).toEqual([SHARES_PROMPT]);
  });

  it("asks for an empty answer again", async () => {
    terminal.answers = ["\r", ` ; \r`, `${SHARES[0]};${SHARES[1]}\r`];
    await combine();
    expect(seen.out).toContain(PHRASE);
    expect(seen.notices).toContain(
      "Type the shares or their text file path, or press Ctrl+C to stop.",
    );
    expect(seen.notices).toContain("Type at least one share.");
  });

  it("leaves out a share of another set when the person chooses it", async () => {
    terminal.answers = [`${SHARES[0]};${OTHER_SET_SHARE};${SHARES[1]}\r`];
    terminal.choices = ["out"];
    await combine();
    expect(seen.notices).toContain("Share 2 is of another set than share 1.");
    expect(terminal.labels).toEqual([["Leave share 2 out", "Type share 2 again"]]);
    expect(seen.out).toContain(PHRASE);
  });

  it("lets either share be changed when nothing tells which set is right", async () => {
    // The wrong share first: one share of each set, so neither is named alone.
    terminal.answers = [`${OTHER_SET_SHARE};${SHARES[0]}\r`, `${SHARES[2]}\r`];
    terminal.choices = ["out", 1];
    await combine();
    expect(seen.notices).toContain(
      "Shares 1 and 2 are of different sets, and nothing tells which is right.",
    );
    expect(terminal.labels.slice(0, 2)).toEqual([
      [
        "Type one share again",
        "Leave a share out",
        "Type every share again",
        "Add more shares",
        "Stop",
      ],
      ["Share 1", "Share 2"],
    ]);
    expect(seen.notices).toContain("One share is not enough: this set needs 2.");
    expect(promptsShown()).toEqual([
      SHARES_PROMPT,
      "More shares or text file path (separate shares with ;):",
    ]);
    expect(seen.out).toContain(PHRASE);
  });

  it("names both shares that are the same member but differ, and lets either go", async () => {
    // A wrong copy of the first share typed before the right one.
    terminal.answers = [`${wrongValue(SHARES[0])};${SHARES[0]};${SHARES[1]}\r`];
    terminal.choices = ["out", 1];
    await combine();
    expect(seen.notices).toContain(
      "Shares 1 and 2 are the same member of the set but differ, and nothing tells which is right.",
    );
    expect(terminal.labels[1]).toEqual(["Share 1", "Share 2", "Share 3"]);
    expect(seen.out).toContain(PHRASE);
  });

  it("uses a share typed twice once", async () => {
    terminal.answers = [`${SHARES[0]};${SHARES[0]};${SHARES[2]}\r`];
    await combine();
    expect(seen.notices).toContain("Share 2 is a copy of share 1: it is used once.");
    expect(seen.out).toContain(PHRASE);
  });

  it("asks only for the missing shares when too few were typed", async () => {
    terminal.answers = [`${SHARES[0]}\r`, `${SHARES[2]}\r`];
    await combine();
    expect(seen.notices).toContain("One share is not enough: this set needs 2.");
    expect(promptsShown()).toEqual([
      SHARES_PROMPT,
      "More shares or text file path (separate shares with ;):",
    ]);
    expect(seen.out).toContain(PHRASE);
  });

  it("offers to leave out a surplus share that gives another phrase", async () => {
    terminal.answers = [`${SHARES[0]};${SHARES[1]};${wrongValue(SHARES[2])}\r`];
    terminal.choices = ["out"];
    await combine();
    expect(seen.notices).toContain(
      "Share 3 does not fit with the others: with it they give another phrase or none. Leave it out, or check it.",
    );
    expect(terminal.labels).toEqual([["Leave share 3 out", "Type share 3 again"]]);
    expect(seen.out).toContain(PHRASE);
  });
});

describe("shares on the private screen", () => {
  it("asks which shares to change after a refusal of the assessment", async () => {
    // A marked share of a 12-word set beside a share of a 15-word set.
    terminal.answers = [`${OTHER_SET_SHARE};${marked([5])}\r`, `${SHARES[0]};${SHARES[1]}\r`];
    terminal.choices = ["all"];
    await combine();
    expect(seen.notices).toContain("These shares are of different lengths: not of one set.");
    expect(terminal.labels[0]).toEqual([
      "Type one share again",
      "Leave a share out",
      "Type every share again",
      "Add more shares",
      "Stop",
    ]);
    expect(promptsShown()).toEqual([SHARES_PROMPT, SHARES_PROMPT]);
    expect(seen.out).toContain(PHRASE);
  });

  it("lets several shares that a refusal names be left out one by one", async () => {
    // Two wrong shares of a 2-of-5 set: no single share left out mends the others.
    const shares = await splitSskrMnemonic(TEST_PHRASE, 2, 5);
    const typed = [shares[0], shares[1], wrongValue(shares[2]!), wrongValue(shares[3]!)];
    terminal.answers = [`${typed.join(";")}\r`];
    terminal.choices = ["out", 3, "out"];
    await combine();
    expect(terminal.labels).toEqual([
      [
        "Type one share again",
        "Leave a share out",
        "Type every share again",
        "Add more shares",
        "Stop",
      ],
      ["Share 1", "Share 2", "Share 3", "Share 4"],
      ["Leave share 4 out", "Type share 4 again"],
    ]);
    expect(seen.notices).toContain(
      "Share 4 does not fit with the others: with it they give another phrase or none. Leave it out, or check it.",
    );
    expect(promptsShown()).toEqual([SHARES_PROMPT]);
    expect(seen.out).toContain(TEST_PHRASE);
  });

  it("goes back to the shares when the search is not wanted", async () => {
    // Two unreadable colours leave 65,536 combinations, more than --max-tries 1 allows.
    terminal.answers = [`${SHARES[0]};${marked([5, 7])}\r`, `${SHARES[1]}\r`];
    terminal.choices = ["no", "one", 2];
    await combine({ "max-tries": "1" });
    expect(terminal.questions[0]).toMatch(/^Search 65,536 combinations, .+\?$/u);
    // Keys typed during the assessment do not answer it: choose drops them
    // (test/scan-fixes.test.ts, S015).
    expect(terminal.questions.slice(1)).toEqual(["Which shares to change?", "Which share?"]);
    expect(terminal.labels[2]).toEqual(["Share 1", "Share 2"]);
    expect(promptsShown()).toEqual([SHARES_PROMPT, "Share 2 again, or its text file path:"]);
    expect(seen.out).toContain(PHRASE);
  });

  it("wipes the plan of a search not made before the shares are typed again", async () => {
    // Each wipe of a plan of marked shares is told among the questions and answers.
    // oxlint-disable-next-line typescript/unbound-method -- the spy calls it on its own instance
    const plan = JointRepair.prototype.plan;
    vi.spyOn(JointRepair.prototype, "plan").mockImplementation(async function (
      this: JointRepair,
      ...args: Parameters<typeof plan>
    ) {
      const made = await plan.apply(this, args);
      return {
        ...made,
        wipe: () => {
          terminal.events.push("wipe");
          made.wipe();
        },
      };
    });
    terminal.answers = [`${SHARES[0]};${marked([5, 7])}\r`, `${SHARES[0]};${SHARES[1]}\r`];
    // No to the search, then "Type every share again".
    terminal.choices = ["no", "all"];
    await combine({ "max-tries": "1" });
    expect(seen.out).toContain(PHRASE);
    const wipes = terminal.events.flatMap((event, at) => (event === "wipe" ? [at] : []));
    const answers = terminal.events.flatMap((event, at) => (event === "answered" ? [at] : []));
    // Once: after the search question, and before the person is asked what to change.
    expect(wipes).toHaveLength(1);
    expect(wipes[0]).toBeGreaterThan(terminal.events.indexOf(terminal.questions[0]!));
    expect(wipes[0]).toBeLessThan(terminal.events.indexOf("Which shares to change?"));
    expect(wipes[0]).toBeLessThan(answers[1]!);
  });
});

describe("shares on the private screen", () => {
  it("goes back from the share question to the one after a wallet that nothing matched", async () => {
    terminal.answers = [`${SHARES[0]};${SHARES[1]}\r`, `${masterFingerprint(PHRASE)}\r`];
    // "Change a share", Escape at the share question, then "Change the wallet".
    terminal.choices = ["shares", undefined, "wallet", "fingerprint"];
    await combine({ "master-fingerprint": TEST_FINGERPRINT });
    expect(seen.notices).toContain(
      "The phrase that these shares restore does not match the wallet given.",
    );
    expect(terminal.questions.slice(0, 3)).toEqual([
      "What now?",
      "Which shares to change?",
      "What now?",
    ]);
    expect(promptsShown()).toEqual([
      SHARES_PROMPT,
      "Original fingerprint of the wallet, such as 73c5da0a (not the encoded one):",
    ]);
    expect(seen.out).toContain(PHRASE);
  });

  it("lists what a repair filled in as a table on a colour terminal", async () => {
    vi.stubEnv("NO_COLOR", "");
    vi.stubEnv("CLICOLOR_FORCE", "1");
    terminal.answers = [`${SHARES[0]};${marked([5])}\r`];
    await combine();
    const plain = seen.notices.map(withoutColour);
    const heading = plain.indexOf("! Filled in where ? stood:");
    expect(heading).toBeGreaterThanOrEqual(0);
    // A row for the share, its element's position and what was filled in, then the advice.
    expect(plain[heading + 1]).toMatch(/^ {4}Share 2 {3}6 #[0-9A-F]{6}$/u);
    expect(plain[heading + 2]).toBe(
      "Correct the written copy; then check the wallet that comes back.",
    );
    expect(seen.out.map(withoutColour)).toContain(PHRASE);
  });

  it("stops when the person chooses Stop", async () => {
    terminal.answers = [`${SHARES[0]};${marked([5, 7])}\r`];
    terminal.choices = ["no", "stop"];
    expect(await combine({ "max-tries": "1" })).toBe(CANCELLED);
    expect(seen.out).toEqual([]);
  });
});

describe("shares on the private screen", () => {
  describe("with Seedshift", () => {
    splitSharesBeforeEach();

    it("shows the encoded fingerprint once the shares are read, before the dates", async () => {
      terminal.answers = [`${shares[0]};${shares[1]}\r`, "23-09-2O26\r", `${TEST_DATE}\r`];
      await combine({ mode: "seedshift" });
      const shown = seen.notices.indexOf(encodedLine());
      expect(shown).toBeGreaterThanOrEqual(0);
      // Before the first answer to the dates, which is asked again.
      expect(shown).toBeLessThan(
        seen.notices.indexOf(
          "Date 1: use DD-MM-YYYY with a four-digit year, for example 23-09-2026.",
        ),
      );
      expect(seen.notices.filter((line) => line.startsWith("Encoded BIP32"))).toHaveLength(1);
      expect(seen.out).toContain(TEST_PHRASE);
    });

    it("shows the encoded fingerprint with the dates typed, only on the private screen", async () => {
      terminal.answers = [`${shares[0]};${shares[2]}\r`, `${TEST_DATE}\r`];
      await combine({ mode: "seedshift" });
      expect(seen.notices).toContain(encodedLine());
      expect(seen.out).toContain(TEST_PHRASE);
      // From the command line, as decode, and without Seedshift, none is shown.
      seen.notices = [];
      await runSskrCombine({ share: [shares[0]!, shares[2]!], mode: "seedshift", date: TEST_DATE });
      expect(seen.notices.some((line) => line.startsWith("Encoded BIP32"))).toBe(false);
      terminal.answers = [`${shares[0]};${shares[2]}\r`];
      await combine();
      expect(seen.notices.some((line) => line.startsWith("Encoded BIP32"))).toBe(false);
      expect(seen.out).toContain(masked);
    });

    it("shows each part of the result apart on a colour terminal, each phrase with its fingerprint", async () => {
      vi.stubEnv("NO_COLOR", "");
      vi.stubEnv("CLICOLOR_FORCE", "1");
      terminal.answers = [`${shares[0]};${shares[1]}\r`, `${TEST_DATE}\r`];
      await combine({ mode: "seedshift" });
      const shown = seen.out.map(withoutColour);
      const parts = [
        "\nMnemoCode · Restored from shares",
        "\nEnglish BIP39 words of the masked phrase (decoy)",
        masked,
        `Encoded fingerprint (of the masked phrase)  ${masterFingerprint(masked)}  (empty BIP39 passphrase)`,
        "\nThe original seed phrase, the wallet's",
        "    1. abandon      2. abandon      3. abandon      4. abandon",
        "    9. abandon     10. abandon     11. abandon     12. about",
        "On one line, for copying:",
        TEST_PHRASE,
        `Original fingerprint  ${TEST_FINGERPRINT}  (empty BIP39 passphrase)`,
      ];
      const places = parts.map((part) => shown.indexOf(part));
      expect(places).not.toContain(-1);
      // In this order, the original seed phrase last.
      expect(places).toEqual([...places].sort((a, b) => a - b));
    });

    it("shows the encoded fingerprint as a status line in colour", async () => {
      vi.stubEnv("NO_COLOR", "");
      vi.stubEnv("CLICOLOR_FORCE", "1");
      terminal.answers = [`${shares[0]};${shares[1]}\r`, `${TEST_DATE}\r`];
      await combine({ mode: "seedshift" });
      const plain = seen.notices.map((line) => line.replace(STYLE_CODES, ""));
      expect(plain).toContain(
        `✓ Encoded fingerprint (of the masked phrase) ${masterFingerprint(masked)}`,
      );
      expect(plain).toContain("Fingerprint uses an empty BIP39 passphrase.");
    });

    it("finds a forgotten digit of a date with the wallet asked for after the dates", async () => {
      terminal.answers = [`${shares[0]};${shares[2]}\r`, "23-09-202?\r", `${TEST_FINGERPRINT}\r`];
      terminal.choices = ["fingerprint"];
      await combine({ mode: "seedshift" });
      expect(promptsShown()).toEqual([
        SHARES_PROMPT,
        "Dates (up to 4, DD-MM-YYYY, ? for what is forgotten, separated by spaces):",
        "Original fingerprint of the wallet, such as 73c5da0a (not the encoded one):",
      ]);
      expect(
        seen.notices.some((line) => line.startsWith("The search tries 10 date combinations:")),
      ).toBe(true);
      expect(seen.out).toContain(`Original seed phrase, the wallet's (dates ${TEST_DATE}):`);
      expect(seen.out).toContain(TEST_PHRASE);
    });
  });
});

describe("shares on the private screen", () => {
  describe("with Seedshift", () => {
    splitSharesBeforeEach();

    it("asks for a date search beyond --max-candidates, and starts one within it", async () => {
      terminal.answers = [`${shares[0]};${shares[2]}\r`, "23-09-202?\r"];
      terminal.choices = ["no"];
      // The answers of the menu's wallet question are given as options: only the search is asked.
      expect(
        await combine({
          mode: "seedshift",
          "master-fingerprint": TEST_FINGERPRINT,
          "max-candidates": "9",
        }),
      ).toBe(CANCELLED);
      expect(terminal.questions[0]).toMatch(/^Search 10 date combinations, /u);
      terminal.questions = [];
      terminal.answers = [`${shares[0]};${shares[2]}\r`, "23-09-202?\r"];
      await combine({
        mode: "seedshift",
        "master-fingerprint": TEST_FINGERPRINT,
        "max-candidates": "10",
      });
      expect(terminal.questions).toEqual([]);
      expect(seen.out).toContain(TEST_PHRASE);
    });

    it("searches the dates after the marked elements, and says how much both take", async () => {
      // One unreadable colour of the second share, which the shares settle together.
      const marked = markUnits(shares[1]!, "colors", [5]);
      terminal.answers = [`${shares[0]};${marked}\r`, "?3-09-2026\r", `${TEST_FINGERPRINT}\r`];
      terminal.choices = ["fingerprint"];
      await combine({ mode: "seedshift" });
      expect(
        seen.notices.some((line) =>
          line.startsWith(
            "The search tries 1 share combination, then 3 date combinations for each phrase found:",
          ),
        ),
      ).toBe(true);
      expect(
        seen.notices.some((line) => /^Share 2: element 6 is #[0-9A-F]{6}\.$/u.test(line)),
      ).toBe(true);
      expect(seen.out).toContain(TEST_PHRASE);
    });

    it("asks for a date again that cannot be read, keeping the shares", async () => {
      terminal.answers = [`${shares[0]};${shares[1]}\r`, "23-09-2O26\r", `${TEST_DATE}\r`];
      await combine({ mode: "seedshift" });
      expect(seen.notices).toContain(
        "Date 1: use DD-MM-YYYY with a four-digit year, for example 23-09-2026.",
      );
      expect(promptsShown().filter((prompt) => prompt === SHARES_PROMPT)).toHaveLength(1);
      expect(seen.out).toContain(TEST_PHRASE);
    });

    it("asks what to change when no date gives the wallet", async () => {
      terminal.answers = [
        `${shares[1]};${shares[2]}\r`,
        "24-09-202?\r",
        `${TEST_FINGERPRINT}\r`,
        "23-09-202?\r",
      ];
      terminal.choices = ["fingerprint", "dates"];
      await combine({ mode: "seedshift" });
      expect(seen.notices).toContain("None of the 10 date combinations gives the wallet given.");
      expect(terminal.labels[1]).toEqual([
        "Change the dates",
        "Change the wallet",
        "Change a share",
        "It was not masked with Seedshift",
        "Stop",
      ]);
      expect(seen.out).toContain(TEST_PHRASE);
    });
  });
});

describe("shares on the private screen", () => {
  describe("with Seedshift", () => {
    splitSharesBeforeEach();

    it("says why the dates are asked again when they are more than the phrase takes", async () => {
      const typed = "24-09-2026 25-09-2026 26-09-2026 27-09-2026 28-09-2026";
      terminal.answers = [`${shares[0]};${shares[1]}\r`, `${typed}\r`, `${TEST_DATE}\r`];
      await combine({ mode: "seedshift" });
      expect(seen.notices.some((line) => /at most 4 dates/u.test(line))).toBe(true);
      expect(promptsShown()).toEqual([SHARES_PROMPT, DATES_PROMPT, DATES_PROMPT]);
      expect(seen.out).toContain(TEST_PHRASE);
    });

    it("takes Seedshift when the wallet shows that the phrase was masked with it", async () => {
      terminal.answers = [`${shares[0]};${shares[1]}\r`, `${TEST_DATE}\r`];
      terminal.choices = ["mode"];
      await combine({ "master-fingerprint": TEST_FINGERPRINT });
      expect(seen.notices).toContain(
        "The phrase that these shares restore does not match the wallet given.",
      );
      expect(terminal.labels[0]).toEqual([
        "Change the wallet",
        "Change a share",
        "It was masked with Seedshift",
        "Stop",
      ]);
      expect(promptsShown()).toEqual([SHARES_PROMPT, DATES_PROMPT]);
      // Shown once the phrase is taken as masked, before its dates.
      expect(seen.notices).toContain(encodedLine());
      expect(seen.out).toContain(TEST_PHRASE);
    });

    it("leaves Seedshift when the wallet shows that the phrase was not masked", async () => {
      const plain = await splitSskrMnemonic(TEST_PHRASE, 2, 3);
      terminal.answers = [`${plain[0]};${plain[2]}\r`, `${TEST_DATE}\r`];
      terminal.choices = ["mode"];
      await combine({ mode: "seedshift", "master-fingerprint": TEST_FINGERPRINT });
      expect(terminal.labels[0]).toEqual([
        "Change the dates",
        "Change the wallet",
        "Change a share",
        "It was not masked with Seedshift",
        "Stop",
      ]);
      expect(promptsShown()).toEqual([SHARES_PROMPT, DATES_PROMPT]);
      expect(seen.out).toContain(TEST_PHRASE);
    });

    it("refuses dates from the command line beside --ask-secrets (AUD-010-SEC001)", async () => {
      await expect(combine({ mode: "seedshift", date: TEST_DATE })).rejects.toThrow(
        "--ask-secrets cannot be combined with --dates.",
      );
      expect(promptsShown()).toEqual([]);
    });
  });
});
