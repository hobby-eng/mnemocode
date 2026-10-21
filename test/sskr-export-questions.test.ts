// sskr-export and sskr-split on the private screen, with the terminal replaced
// (test/helpers/question-terminal.ts). A save may be made to fail first (`terminal.saveFailures`).
// Public test data only: the "abandon … about" phrase, its fingerprint, and vectors/sskr-v1.json.

import { existsSync, readdirSync, readFileSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { runSskrExport } from "../src/cli/sskr-export-command.js";
import { runSskrSplit } from "../src/cli/sskr-split-command.js";
import { CANCELLED, type Cancelled } from "../src/cli/terminal-keys.js";
import { writeShare } from "../src/sskr/transport.js";
import { ESCAPE } from "./helpers/keys.js";
import { questionsOnPrivateScreen, seen, terminal } from "./helpers/question-terminal.js";
import { OTHER_SET_SHARE, promptsShown, SHARES, SHARES_PROMPT } from "./helpers/share-questions.js";
import { TEST_FINGERPRINT, TEST_PHRASE } from "./helpers/test-phrase.js";
import { SECOND_SHARE_PROMPT } from "./helpers/prompts.js";

const harness = await vi.hoisted(async () => import("./helpers/question-terminal.js"));
vi.mock("node:tty", async (importOriginal) => harness.replacedTty(await importOriginal()));
vi.mock("../src/cli/terminal-input.js", async (importOriginal) =>
  harness.replacedTerminalInput(await importOriginal()),
);
vi.mock("node:fs/promises", async (importOriginal) =>
  harness.replacedFiles(await importOriginal()),
);

/** The first share as word numbers, with the words at 5, 9 and 13 unreadable: 4 shares fit. */
function ambiguous(): string {
  const words = writeShare(SHARES[0], "indexes").split(" ");
  for (const place of [5, 9, 13]) words[place] = "?";
  return words.join(" ");
}

questionsOnPrivateScreen();

describe("shares on the private screen", () => {
  describe("exporting", () => {
    it("goes on without the wallet check when too few shares were typed for it", async () => {
      terminal.answers = [`${SHARES[0]}\r`];
      terminal.choices = ["Go on without the wallet check"];
      await runSskrExport({
        "ask-secrets": true,
        "master-fingerprint": TEST_FINGERPRINT,
        format: "indexes",
      });
      expect(seen.notices).toContain(
        "The wallet can be checked only with as many shares as the threshold.",
      );
      expect(terminal.labels[0]).toEqual([
        "Add more shares",
        "Go on without the wallet check",
        "Stop",
      ]);
      expect(seen.out).toContain(writeShare(SHARES[0], "indexes"));
    });

    it("keeps the wallet check at Escape, which stops before anything is written", async () => {
      terminal.answers = [`${SHARES[0]}\r`];
      // Escape at "What now?".
      terminal.choices = [undefined];
      expect(
        await runSskrExport({
          "ask-secrets": true,
          "master-fingerprint": TEST_FINGERPRINT,
          format: "indexes",
        }),
      ).toBe(CANCELLED);
      expect(terminal.questions).toEqual(["What now?"]);
      expect(seen.out).toEqual([]);
    });

    it("shows the variants of a share that fits several ways, and lets it be typed again", async () => {
      terminal.answers = [`${ambiguous()}\r`, `${writeShare(SHARES[0], "indexes")}\r`];
      terminal.choices = ["Type share 1 again"];
      await runSskrExport({ "ask-secrets": true, format: "indexes" });
      expect(seen.notices).toContain(
        "Share 1 fits 4 ways, so nothing is saved: use another copy of it, or more shares.",
      );
      expect(terminal.labels[0]).toEqual(["Type share 1 again", "Add more shares", "Done"]);
      expect(promptsShown()).toEqual([SHARES_PROMPT, "Share 1 again, or its text file path:"]);
      // The four variants, then the share typed again.
      expect(seen.out).toHaveLength(5);
      expect(seen.out.at(-1)).toBe(writeShare(SHARES[0], "indexes"));
    });

    // Several sets that fit a repair are not reached here: typed shares give a second set only
    // where a wrong combination of their marked units passes the 32-bit digest by chance, about
    // once in 2^32 combinations, which no test can search for. What a repair decides for such sets
    // is tested on the steps that take the sets as data: the library's
    // (share-repair-warning.test.ts) and the command's (sskr-several-sets.test.ts).
  });
});

describe("shares on the private screen", () => {
  describe("exporting", () => {
    it("saves nothing when the variants are left as they are", async () => {
      terminal.answers = [`${ambiguous()}\r`];
      terminal.choices = ["Done"];
      await runSskrExport({ "ask-secrets": true });
      expect(seen.out).toHaveLength(4);
    });

    it("asks which form cards show for shares written in different forms", async () => {
      const folder = await mkdtemp(join(tmpdir(), "mnemocode-sskr-forms-"));
      try {
        const pdf = join(folder, "shares.pdf");
        terminal.answers = [`${SHARES[0]};${writeShare(SHARES[2], "colors")}\r`];
        terminal.choices = ["Stop"];
        expect(await runSskrExport({ "ask-secrets": true, pdf })).toBe(CANCELLED);
        expect(terminal.questions).toEqual([
          "The shares are written in different forms. Which form should the cards show?",
        ]);
        expect(terminal.labels[0]).toEqual([
          "Compact UR",
          "RGB hexadecimal codes (ordered)",
          "Stop",
        ]);
        expect(existsSync(pdf)).toBe(false);
      } finally {
        await rm(folder, { recursive: true, force: true });
      }
    });

    it("names shares of different sets before writing anything", async () => {
      terminal.answers = [`${SHARES[0]};${OTHER_SET_SHARE}\r`, `${SHARES[2]}\r`];
      terminal.choices = ["Type one share again", "Share 2"];
      await runSskrExport({ "ask-secrets": true, format: "indexes" });
      expect(seen.notices).toContain(
        "Shares 1 and 2 are of different sets, and nothing tells which is right.",
      );
      expect(promptsShown()).toEqual([SHARES_PROMPT, SECOND_SHARE_PROMPT]);
      expect(seen.out).toEqual([
        writeShare(SHARES[0], "indexes"),
        writeShare(SHARES[2], "indexes"),
      ]);
    });
  });
});

describe("shares on the private screen", () => {
  describe("saving the shares of a split", () => {
    let folder: string;
    beforeEach(async () => {
      folder = await mkdtemp(join(tmpdir(), "mnemocode-sskr-save-"));
    });
    afterEach(async () => {
      await rm(folder, { recursive: true, force: true });
    });

    /** Splits the test phrase into 2 of 3 shares saved at `output`; the backup check is skipped. */
    function split(output: string): Promise<Cancelled | undefined> {
      return runSskrSplit({ mnemonic: TEST_PHRASE, threshold: "2", shares: "3", output });
    }

    it("tries a failed save again and shows the shares", async () => {
      const output = join(folder, "shares.txt");
      terminal.saveFailures = 1;
      terminal.choices = ["Try again"];
      await split(output);
      expect(seen.notices).toContain(
        `The file of the shares could not be saved as ${output}: the disk is full.`,
      );
      expect(terminal.labels[0]).toEqual(["Try again", "Another file name", "Skip"]);
      const saved = readFileSync(output, "utf8").trim().split("\n");
      expect(saved).toHaveLength(3);
      for (const share of saved) expect(seen.out).toContain(share);
    });

    it("saves under another name", async () => {
      const output = join(folder, "shares.txt");
      const other = join(folder, "other.txt");
      terminal.saveFailures = 1;
      terminal.choices = ["Another file name"];
      terminal.answers = [`${other}\r`];
      await split(output);
      expect(existsSync(output)).toBe(false);
      expect(readFileSync(other, "utf8").trim().split("\n")).toHaveLength(3);
      expect(seen.notices.some((line) => line.startsWith(`Saved SSKR records: ${other} `))).toBe(
        true,
      );
    });

    it("goes back to the choice, writing nothing, when no new name is given", async () => {
      const output = join(folder, "shares.txt");
      terminal.saveFailures = 1;
      terminal.choices = ["Another file name", "Skip"];
      // Escape at the new name.
      terminal.answers = [ESCAPE];
      await split(output);
      expect(seen.screen).toContain("New name for the file of the shares:");
      expect(seen.notices).toContain(
        `The file of the shares could not be saved as ${output}: the disk is full.`,
      );
      expect(terminal.labels.slice(0, 2)).toEqual([
        ["Try again", "Another file name", "Skip"],
        ["Try again", "Another file name", "Skip"],
      ]);
      // Nothing was written after the failure, under the name or any other.
      expect(readdirSync(folder)).toEqual([]);
      expect(seen.out.filter((line) => line.startsWith("ur:sskr/"))).toHaveLength(3);
    });

    it("offers the sheet for heirs again too, and still shows the shares", async () => {
      const sheet = join(folder, "heirs.pdf");
      terminal.saveFailures = 1;
      terminal.choices = ["Skip"];
      await runSskrSplit({
        mnemonic: TEST_PHRASE,
        threshold: "2",
        shares: "3",
        "heir-sheet": sheet,
      });
      expect(seen.notices).toContain(
        `The sheet for heirs could not be saved as ${sheet}: the disk is full.`,
      );
      expect(seen.notices).toContain("The sheet for heirs was not saved.");
      expect(existsSync(sheet)).toBe(false);
      expect(seen.out.filter((line) => line.startsWith("ur:sskr/"))).toHaveLength(3);
    });

    it("shows the shares when the save is skipped", async () => {
      const output = join(folder, "shares.txt");
      terminal.saveFailures = 1;
      terminal.choices = ["Skip"];
      await split(output);
      expect(existsSync(output)).toBe(false);
      expect(seen.notices).toContain("The file of the shares was not saved.");
      expect(seen.out.filter((line) => line.startsWith("ur:sskr/"))).toHaveLength(3);
    });
  });
});
