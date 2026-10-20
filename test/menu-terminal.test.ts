// The start menu at a terminal: its record of answers, going back from an entry and on a short
// terminal, and what it does when a command cannot run or stops. The questions run as they do at
// a terminal, with their keys typed by the tests (test/helpers/keyed-terminal.ts) on a screen that
// understands what they write (test/helpers/terminal-screen.ts).

import { writeFile } from "node:fs/promises";
import { MENU_ENTRY_NAMES } from "../src/cli/menu-entries.js";
import { join } from "node:path";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { MENU_ENTRIES, runMenu } from "../src/cli/menu.js";
import { askLine, choose, waitForEnter } from "../src/cli/terminal-choice.js";
import { ErrorCatalog } from "../src/core/error-catalog.js";
import { COIN_ADDRESS_ANSWERS } from "./helpers/coin-addresses.js";
import { terminal, type Question } from "./helpers/keyed-terminal.js";
import { ENCODE_FORM_LABELS } from "./helpers/encode-form-cases.js";
import {
  answer,
  answerLine,
  BEFORE,
  CTRL_D,
  DOWN,
  ENTER,
  ESCAPE,
  expectScreen,
  folder,
  keyedQuestions,
  LEFT,
  screenOf,
  stopWatching,
  watchScreen,
} from "./helpers/terminal-screen.js";

const harness = await vi.hoisted(async () => import("./helpers/keyed-terminal.js"));
vi.mock("../src/cli/terminal-input.js", async (importOriginal) =>
  harness.replacedTerminalInput(await importOriginal()),
);
vi.mock("node:child_process", async (importOriginal) =>
  harness.replacedChildProcess(await importOriginal()),
);
vi.mock("../src/cli/terminal-choice.js", async (importOriginal) =>
  harness.replacedTerminalChoice(await importOriginal()),
);
vi.mock("../src/cli/protection.js", async (importOriginal) =>
  harness.replacedProtection(await importOriginal()),
);
vi.mock("../src/cli/self-test.js", async (importOriginal) =>
  harness.replacedSelfTest(await importOriginal()),
);
vi.mock("../src/export/image-export.js", async (importOriginal) =>
  harness.replacedImageExport(await importOriginal()),
);

keyedQuestions();
afterEach(() => vi.unstubAllEnvs());

describe("a typed answer leaves only its line in the record of answers", () => {
  it("shows no byte of an answer that is not UTF-8, and says why above the question", async () => {
    const screen = watchScreen(80);
    screen.write(BEFORE);
    // Everything written, decoded: a byte that is no UTF-8 would show as U+FFFD.
    const written: string[] = [];
    const toScreen = process.stderr.write.bind(process.stderr);
    process.stderr.write = (chunk: string | Uint8Array) => {
      written.push(typeof chunk === "string" ? chunk : Buffer.from(chunk).toString("utf8"));
      return toScreen(chunk);
    };
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
    ["q, Q and Ctrl+D, then Enter", `qQ${CTRL_D}word${ENTER}`, {}, "escape"],
    ["q, Q and Ctrl+D, then Enter", `qQ${CTRL_D}word${ENTER}`, { onlyEscapeLeaves: true }, "enter"],
    ["a word, then Escape", `query${ESCAPE}`, { onlyEscapeLeaves: true }, "escape"],
    // A function key whose sequence ends in a letter that alone would leave.
    ["F2 (ESC O Q), then Enter", `\x1bOQ${ENTER}`, { onlyEscapeLeaves: true }, "enter"],
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

const MENU_QUESTION = "What do you want to do?";
// Narrower than TEXT_WIDTH, so that lists, prompts and lines of the record wrap.
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

/** The typed answers to the questions without a fallback, as public test data. */
const TYPED: Readonly<Record<string, string>> = {
  "How many of them restore the seed phrase?": "4",
  Word: "abandon",
  "Word number": "1",
  "Unicode code": "4E00",
  // The public test phrase's fingerprint and its first native SegWit address.
  "Original fingerprint of the wallet, such as 73c5da0a (not the encoded one; They do not reveal the phrase.)":
    "73c5da0a",
  "Bitcoin address (one of the first receiving ones)": "bc1qcr8te4kr609gcawutmrza0j4xv80jy8z306fyu",
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
  "Add a QR code with the codes of the backup, without the extra cards?",
  "Which coin is the address for?",
  "How should the sheets be turned?",
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

describe("going back from an entry of the start menu", () => {
  // The files that the menu reads must be there.
  beforeAll(async () => {
    for (const fallback of ["mnemocode-record.txt", "mnemocode-qr.png"])
      await writeFile(longFileName(fallback), "");
  });

  it.each([40, 80])(
    "keeps the fingerprint explanation beside its value in a %i-column answer record",
    async (columns) => {
      vi.stubEnv("CLICOLOR_FORCE", "1");
      vi.stubEnv("NO_COLOR", undefined);
      const screen = watchScreen(columns);
      const written: string[] = [];
      const write = process.stderr.write.bind(process.stderr);
      vi.spyOn(process.stderr, "write").mockImplementation((chunk: string | Uint8Array) => {
        written.push(typeof chunk === "string" ? chunk : Buffer.from(chunk).toString("utf8"));
        return write(chunk);
      });
      const keys = [
        String(MENU_ENTRY_NAMES.recover.digit),
        `${DOWN.repeat(2)}${ENTER}`,
        ENTER,
        ENTER,
        ENTER,
        ENTER,
        `73c5da0a${ENTER}`,
        ESCAPE,
      ];
      let recorded: string[] = [];
      terminal.keysFor = () => {
        const next = keys.shift();
        if (next === undefined) throw new Error("The menu asked more than was answered.");
        return next;
      };
      terminal.exit = async () => {
        recorded = screen.lines();
        return 130;
      };
      await runMenu();
      const expected = screenOf(
        columns,
        answerLine("Fingerprint", "73c5da0a · They do not reveal the phrase."),
      ).lines;
      expect(recorded).toEqual(expect.arrayContaining(expected.filter((line) => line !== "")));
      expect(written.join("")).toContain(
        "\x1b[36m73c5da0a · \x1b[90mThey do not reveal the phrase.\x1b[0m",
      );
      expect(keys).toEqual([]);
    },
  );

  // Encode's complete product exceeds one hosted test's limit. Cover Escape before its first
  // answer separately, then every later question under each of the five first-form answers.
  const entries = MENU_ENTRIES.filter(
    (entry) =>
      entry.digit !== null && entry.digit >= 1 && entry.digit <= MENU_ENTRY_NAMES.table.digit,
  );
  const walks = entries.flatMap((entry) =>
    entry.digit === MENU_ENTRY_NAMES.encode.digit
      ? [
          { label: `${entry.label}: before choosing a form`, entry, prefix: [], firstOnly: true },
          ...ENCODE_FORM_LABELS.map((form, index) => ({
            label: `${entry.label}: ${form}`,
            entry,
            prefix: [index],
            firstOnly: false,
          })),
        ]
      : [{ label: entry.label, entry, prefix: [], firstOnly: false }],
  );
  it.each(walks)(
    "$label: Escape at any question shows the menu under the same record",
    async ({ entry, prefix, firstOnly }) => {
      firstPath.clear();
      const quit = await runEntry(undefined, []);
      expect(quit.above).toHaveLength(1);
      const pending: number[][] = [[...prefix]];
      let backs = 0;
      while (pending.length > 0) {
        const answers = pending.pop()!;
        const run = await runEntry(entry.digit ?? undefined, answers);
        if (entry.digit === MENU_ENTRY_NAMES.encode.digit)
          expect(run.askings[0]?.question.labels).toEqual(ENCODE_FORM_LABELS);
        // The entry built its command line before a question for Escape came: nothing to check.
        if (run.askings.length <= answers.length) continue;
        backs += 1;
        const path = run.askings.map((asking) => asking.question.question).join(" / ");
        // No line of the task or of its answers is left above the menu, nor below it at the end.
        expect(run.above, path).toEqual([quit.above[0], quit.above[0]]);
        expect(run.screen, path).toEqual(quit.screen);
        if (firstOnly) continue;
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
    // Encode: colors, no Seedshift, no shares, printable cards as a PDF of A6 sheets turned as
    // first offered, under its usual name, in the first design, a QR code, and own details, each
    // left random; then Escape at the question about heirs, under 23 lines of answers.
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
      ENTER,
      `${DOWN}${ENTER}`,
      ...Array<string>(11).fill(ENTER),
      ESCAPE,
      ESCAPE,
    ]);
    expect(deep).toEqual(quit);
  });
});

it("omits an unsafe command preview without refusing the actual filename or running twice", async () => {
  const path = join(folder, "public-\u202e-word-list.txt");
  const keys = [
    String(MENU_ENTRY_NAMES.table.digit),
    `${DOWN.repeat(4)}${ENTER}`,
    ENTER,
    `${path}${ENTER}`,
    ESCAPE,
  ];
  watchScreen(80);
  const messages: string[] = [];
  const originalError = console.error.bind(console);
  vi.spyOn(console, "error").mockImplementation((...values: unknown[]) => {
    messages.push(values.map(String).join(" "));
    originalError(...values);
  });
  let commands = 0;
  let preview = "";
  terminal.exit = async () => {
    commands += 1;
    preview = messages.at(-1) ?? "";
    return 130;
  };
  terminal.keysFor = () => {
    const next = keys.shift();
    if (next === undefined) throw new Error("The menu asked more than was answered.");
    return next;
  };
  await runMenu();
  stopWatching();
  expect(commands).toBe(1);
  expect(preview).toContain("Command preview omitted: an argument contains display controls.");
  expect(preview).not.toContain("\u202e");
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

  // The word table, a word, abandon: a command without a private screen.
  const LOOK_UP = [String(MENU_ENTRY_NAMES.table.digit), ENTER, `abandon${ENTER}`];

  it.each([
    ["word", 0, "Word", "abandon", "about"],
    ["number", 1, "Word number", "55", "56"],
    ["Unicode code", 2, "Unicode code", "591A", "7684"],
  ] as const)(
    "Enter repeats a %s lookup and Escape returns to the main menu",
    async (_, choice, question, first, second) => {
      let commands = 0;
      terminal.exit = async () => {
        commands++;
        return 0;
      };
      const { asked } = await menuWith([
        String(MENU_ENTRY_NAMES.table.digit),
        `${DOWN.repeat(choice)}${ENTER}`,
        first + ENTER,
        ENTER,
        second + ENTER,
        ESCAPE,
        ESCAPE,
      ]);
      expect(commands).toBe(2);
      expect(asked.map((entry) => entry.question)).toEqual([
        "What do you want to do?",
        "What do you want to look up?",
        question,
        question,
        "What do you want to do?",
      ]);
    },
  );

  it("Escape while entering a repeated lookup returns to the main menu", async () => {
    terminal.exit = async () => 0;
    const { asked } = await menuWith([...LOOK_UP, ENTER, ESCAPE, ESCAPE]);
    expect(asked.map((entry) => entry.question)).toEqual([
      "What do you want to do?",
      "What do you want to look up?",
      "Word",
      "Word",
      "What do you want to do?",
    ]);
  });

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
    await menuWith([...LOOK_UP, ESCAPE, ESCAPE]);
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

  it("shows the default message of a coded library refusal when a command cannot start", async () => {
    const errors = new ErrorCatalog("fixture", { failed: () => "The reader could not start." });
    terminal.exit = async () => {
      throw errors.create("failed", []);
    };
    const { asked } = await menuWith([...LOOK_UP, `${DOWN}${ENTER}`, ESCAPE]);
    expect(asked[3]).toMatchObject({
      question: "What now?",
      warning: "The command could not be started (The reader could not start.).",
    });
  });

  it("offers only the self-test, the help and Quit when the self-test fails, and says so", async () => {
    terminal.selfTestFails = true;
    const { asked, shown } = await menuWith([ESCAPE]);
    const unchecked = [
      MENU_ENTRY_NAMES.selfTest.label,
      MENU_ENTRY_NAMES.help.label,
      MENU_ENTRY_NAMES.quit.label,
    ];
    expect(asked[0]!.labels).toEqual(unchecked);
    // The heading's lines as one text: a notice wraps at the width of running text.
    const heading = shown[0]!.join(" ").replace(/\s+/gu, " ");
    expect(heading).toContain("CRITICAL: MnemoCode core self-test failed.");
    expect(heading).toContain("the other entries stay closed after a failed self-test.");
    // The self-test's entry failing has the same effect for the rest of the session.
    terminal.selfTestFails = false;
    terminal.exit = async () => 1;
    const after = await menuWith([String(MENU_ENTRY_NAMES.selfTest.digit), ENTER, ESCAPE]);
    expect(after.asked[0]!.labels).toHaveLength(MENU_ENTRIES.length);
    expect(after.asked[1]!.labels).toEqual(unchecked);
    expect(after.shown[1]!.join("\n")).toContain("The self-test failed.");
  });

  it("offers every entry but those that ask for a secret when only the protection fails", async () => {
    terminal.protectionFails = true;
    const { asked, shown } = await menuWith([ESCAPE]);
    expect(asked[0]!.labels).toEqual(
      MENU_ENTRIES.filter((entry) => entry.asksSecrets !== true).map((entry) => entry.label),
    );
    expect(asked[0]!.labels).toContain(MENU_ENTRY_NAMES.preview.label);
    expect(asked[0]!.labels).toContain(MENU_ENTRY_NAMES.table.label);
    const heading = shown[0]!.join(" ").replace(/\s+/gu, " ");
    expect(heading).toContain("Core dumps could not be switched off.");
    expect(heading).toContain("The entries that ask for a seed phrase or a share are not offered.");
  });
});
