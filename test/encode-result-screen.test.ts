// Real command and question code, with only the terminal input/output replaced by a screen.
import { format } from "node:util";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { runEncode } from "../src/cli/encode-command.js";
import { askValueUntil } from "../src/cli/ask.js";
import { PrivateSteps } from "../src/cli/private-steps.js";
import { CLEAR_SCREEN, terminalResultHeader, terminalWork } from "../src/cli/terminal.js";
import { ExportFileName } from "../src/export/file-name.js";
import { keyedQuestions, watchScreen } from "./helpers/terminal-screen.js";
import { terminal } from "./helpers/keyed-terminal.js";
import { DATE, MASKED } from "./helpers/phrase-questions.js";
import { TEST_PHRASE } from "./helpers/test-phrase.js";

const harness = await vi.hoisted(async () => import("./helpers/keyed-terminal.js"));
vi.mock("../src/cli/terminal-input.js", async (original) =>
  harness.replacedTerminalInput(await original()),
);
vi.mock("../src/cli/terminal-choice.js", async (original) =>
  harness.replacedTerminalChoice(await original()),
);

keyedQuestions();
beforeEach(() => {
  terminal.atTerminal = true;
  vi.stubEnv("NO_COLOR", "1");
  PrivateSteps.open(
    () => {
      process.stderr.write(CLEAR_SCREEN);
      console.error("MnemoCode · encode");
    },
    (warning) => console.error(warning),
  );
});
afterEach(() => {
  PrivateSteps.close();
  vi.unstubAllEnvs();
});

describe("Encode result visibility while the real backup question waits", () => {
  it.each([false, true])(
    "shows the Seedshift words only when requested, shares=%s",
    async (sskr) => {
      const maskedWords =
        "wool abuse actual wool abuse actual wool abuse actual wool abuse congress";
      for (const show of [false, true]) {
        const screen = watchScreen(120);
        vi.spyOn(console, "log").mockImplementation((...parts: unknown[]) => {
          screen.write(format(...parts) + "\n");
        });
        const answers = [TEST_PHRASE + "\r", DATE + "\r", "2"];
        terminal.keysFor = () => answers.shift()!;
        await runEncode({
          "ask-secrets": true,
          mode: "seedshift",
          format: "5",
          ...(sskr ? { sskr: true, threshold: "2", shares: "3", "share-format": "colors" } : {}),
          ...(show ? { "show-masked-words": true } : {}),
        });
        const visible = screen.lines().join("\n");
        expect(visible.includes(maskedWords)).toBe(show);
        expect(visible).not.toContain(TEST_PHRASE);
      }
    },
  );

  it.each(["direct", "seedshift"] as const)(
    "shows only the requested forms of the original phrase with %s shares",
    async (mode) => {
      for (const choice of ["words", "codes", "both"] as const) {
        const screen = watchScreen(120);
        vi.spyOn(console, "log").mockImplementation((...parts: unknown[]) => {
          screen.write(format(...parts) + "\n");
        });
        const answers = [TEST_PHRASE + "\r", ...(mode === "direct" ? [] : [DATE + "\r"]), "2"];
        terminal.keysFor = () => answers.shift()!;
        await runEncode({
          "ask-secrets": true,
          sskr: true,
          threshold: "2",
          shares: "3",
          "share-format": "colors",
          mode,
          "show-original": choice,
          ...(choice === "words" ? {} : { format: "2" }),
        });
        const visible = screen.lines().join("\n");
        expect(visible.includes(TEST_PHRASE), choice).toBe(choice !== "codes");
        expect(visible.includes("1 1 1 1 1 1 1 1 1 1 1 4"), choice).toBe(choice !== "words");
        expect(visible).toContain("no shares or dates are needed");
        expect(visible).toContain("SSKR share 3 of 3");
      }
    },
  );

  it("refuses an original-code copy with no selected format before asking for the phrase", async () => {
    terminal.keysFor = () => {
      throw new Error("no secret must be asked");
    };
    await expect(
      runEncode({
        "ask-secrets": true,
        sskr: true,
        threshold: "2",
        shares: "3",
        "show-original": "codes",
      }),
    ).rejects.toThrow("--format");
  });

  it("refuses invalid display choices before asking for any secret", async () => {
    terminal.keysFor = () => {
      throw new Error("no secret must be asked");
    };
    for (const [args, message] of [
      [{ sskr: true, threshold: "2", shares: "3", "show-original": "unknown" }, "--show-original"],
      [{ "show-original": "words" }, "only in SSKR mode"],
      [{ "show-masked-words": true, mode: "direct" }, "needs a Seedshift mode"],
    ] as const) {
      await expect(runEncode({ "ask-secrets": true, ...args })).rejects.toThrow(message);
    }
  });
});

describe("Optional phrase copies stay apart from exported shares", () => {
  it("saves only shares when both original forms and Seedshift words are shown", async () => {
    const folder = await mkdtemp(join(tmpdir(), "mnemocode-display-"));
    const path = join(folder, "shares.txt");
    const screen = watchScreen(120);
    vi.spyOn(console, "log").mockImplementation((...parts: unknown[]) => {
      screen.write(format(...parts) + "\n");
    });
    const answers = [TEST_PHRASE + "\r", DATE + "\r", "2"];
    terminal.keysFor = () => answers.shift()!;
    try {
      await runEncode({
        "ask-secrets": true,
        sskr: true,
        threshold: "2",
        shares: "3",
        mode: "seedshift",
        "show-original": "both",
        "show-masked-words": true,
        format: "5",
        output: path,
      });
      const stored = await readFile(path, "utf8");
      expect(stored.trim().split("\n")).toHaveLength(3);
      expect(
        stored
          .trim()
          .split("\n")
          .every((line) => line.startsWith("ur:sskr/")),
      ).toBe(true);
      expect(stored).not.toContain(TEST_PHRASE);
      expect(stored).not.toContain("wool abuse");
      expect(screen.lines().join("\n")).toContain(
        "#000064 #1EAB91 #3D0964 #5BB491 #7A1264 #98BD91 #B71B64 #D5C694",
      );
    } finally {
      await rm(folder, { recursive: true, force: true });
    }
  });

  it("shows English only once when both original forms were requested", async () => {
    const screen = watchScreen(120);
    vi.spyOn(console, "log").mockImplementation((...parts: unknown[]) => {
      screen.write(format(...parts) + "\n");
    });
    const answers = [TEST_PHRASE + "\r", DATE + "\r", "2"];
    terminal.keysFor = () => answers.shift()!;
    await runEncode({
      "ask-secrets": true,
      sskr: true,
      threshold: "2",
      shares: "3",
      mode: "seedshift",
      "show-original": "both",
      format: "1",
    });
    expect(screen.lines().join("\n").split(TEST_PHRASE)).toHaveLength(2);
  });
});

describe("Encode result stays on the private screen through follow-up questions", () => {
  it.each([
    { mode: "direct", shares: false },
    { mode: "seedshift", shares: false },
    { mode: "direct", shares: true },
    { mode: "seedshift", shares: true },
  ] as const)("keeps $mode output visible with shares=$shares", async ({ mode, shares }) => {
    const screen = watchScreen(120);
    vi.spyOn(console, "log").mockImplementation((...parts: unknown[]) => {
      screen.write(format(...parts) + "\n");
    });
    const answers = [TEST_PHRASE + "\r", ...(mode === "direct" ? [] : [DATE + "\r"]), "2"];
    terminal.keysFor = () => answers.shift()!;
    let atCheck: string | undefined;
    terminal.onFirstKey = () => {
      if (terminal.asked.at(-1)?.question === "Check the backup now?")
        atCheck = screen.lines().join("\n");
    };
    expect(
      await runEncode({
        "ask-secrets": true,
        mode,
        format: "2",
        ...(shares ? { sskr: true, threshold: "2", shares: "3" } : {}),
      }),
    ).toBeUndefined();
    expect(atCheck).toContain("Check the backup now?");
    expect(atCheck).toContain(mode === "direct" ? "1 1 1 1 1 1 1 1 1 1 1 4" : MASKED);
    if (shares)
      for (const number of [1, 2, 3]) expect(atCheck).toContain(`SSKR share ${number} of 3`);
    expect(screen.lines().join("\n")).toContain(
      mode === "direct" ? "1 1 1 1 1 1 1 1 1 1 1 4" : MASKED,
    );
  });

  it("clears the result only after Yes, before reading the written backup", async () => {
    const screen = watchScreen(120);
    vi.spyOn(console, "log").mockImplementation((...parts: unknown[]) => {
      screen.write(format(...parts) + "\n");
    });
    const answers = [TEST_PHRASE + "\r", DATE + "\r", "1", MASKED + "\r", DATE + "\r"];
    terminal.keysFor = () => answers.shift()!;
    let beforeReading: string | undefined;
    terminal.onFirstKey = () => {
      const visible = screen.lines().join("\n");
      if (visible.includes("Your backup, as written down:")) beforeReading = visible;
    };
    await runEncode({ "ask-secrets": true, mode: "seedshift", format: "2" });
    expect(beforeReading).toContain("Your backup, as written down:");
    expect(beforeReading).not.toContain(MASKED);
    expect(beforeReading).not.toContain("Encoded result");
    expect(screen.lines().join("\n")).toContain("The backup restores this seed phrase.");
  });

  it("shows a refused follow-up answer without erasing the displayed result", async () => {
    const screen = watchScreen(120);
    terminalResultHeader("Public result", []);
    console.error("Public retained result");
    terminalWork("Rendering the cards…");
    const answers = ["../backup\r", "backup\r"];
    terminal.keysFor = () => answers.shift()!;
    let atRetry: string | undefined;
    terminal.onFirstKey = () => {
      if (answers.length === 0) atRetry = screen.lines().join("\n");
    };
    expect(await askValueUntil("New name:", (answer) => ExportFileName.checked(answer))).toBe(
      "backup",
    );
    expect(atRetry).toContain("Public retained result");
    expect(atRetry).toContain("Rendering the cards…");
    expect(atRetry?.match(/An export file name must be one safe path component\./gu)).toHaveLength(
      1,
    );
  });
});
