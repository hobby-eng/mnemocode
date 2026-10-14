// The backup check with --ask-secrets on the private screen, with the terminal replaced
// (test/helpers/question-terminal.ts), after encode and on its own.

import { describe, expect, it, vi } from "vitest";
import { formatEncoded, parseDate, representMnemonic } from "../src/core.js";
import { backupCheckAnswer, offerEncodedCheck, offerShareCheck } from "../src/cli/backup-check.js";
import { InputCancelledError } from "../src/cli/terminal-input.js";
import { MINIMAL_BYTEWORDS } from "../src/sskr/bytewords-list.js";
import { splitSskrMnemonic } from "../src/sskr/shares.js";
import { matching } from "./helpers/matchers.js";
import { DATE, MASKED, masked, original, promptsShown } from "./helpers/phrase-questions.js";
import { questionsOnPrivateScreen, seen, terminal } from "./helpers/question-terminal.js";
import { TEST_PHRASE } from "./helpers/test-phrase.js";

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

/** The start of a share as a UR, before its minimal bytewords. */
const SSKR_UR_PREFIX = "ur:sskr/";

questionsOnPrivateScreen();

describe("encode, decode and the backup check on the private screen", () => {
  describe("the backup check", () => {
    it("names the codes and the date that differ, and asks only that part again", async () => {
      const codes = MASKED.split(" ");
      codes[2] = "25";
      terminal.answers = [
        "\r",
        "1 2 3\r",
        `${codes.join(" ")}\r`,
        `${MASKED}\r`,
        "24-09-2026\r",
        `${DATE}\r`,
      ];
      terminal.choices = [true, "again", "again"];
      await offerEncodedCheck(original, () => undefined, undefined);
      expect(seen.notices).toEqual([
        "",
        "Type the codes you wrote down, or press Ctrl+C to stop.",
        "These are 3 word numbers; an encoded seed phrase has 12, 15, 18, 21 or 24.",
        "The code at place 3 differs from the result.",
        "Date 1 is not one of the dates of this backup.",
        "The backup restores this seed phrase.",
      ]);
      expect(terminal.labels[1]).toEqual([
        "Type the codes again",
        "Show the result again",
        "Stop checking",
      ]);
      expect(terminal.labels[2]![0]).toBe("Type the dates again");
      // The codes that fitted were not asked again with the dates.
      expect(promptsShown("Your backup, as written down:")).toHaveLength(4);
    });

    it("names the dates in the offer only where the backup has them, and Escape skips it", async () => {
      await offerEncodedCheck(original, () => undefined, undefined);
      const direct = representMnemonic(TEST_PHRASE).shiftedIndexes;
      await offerEncodedCheck(
        { mnemonic: TEST_PHRASE, format: "indexes", mode: "direct", codes: direct, dates: [] },
        () => undefined,
        undefined,
      );
      await offerShareCheck(TEST_PHRASE, "direct", 2, () => undefined, undefined);
      await offerShareCheck(TEST_PHRASE, "seedshift", 2, () => undefined, undefined);
      expect(terminal.notes.map((notes) => notes[0])).toEqual([
        "type the codes from what you wrote down, and the dates",
        "type the codes from what you wrote down",
        "type 2 shares from what you wrote down",
        "type 2 shares from what you wrote down, and the dates",
      ]);
      // Nothing came before the offer: Escape answers No.
      expect(terminal.escapes).toEqual(Array.from({ length: 4 }, () => "skips the check"));
      expect(promptsShown("Your backup, as written down:", "shares as written down")).toEqual([]);
    });

    it("takes the answer of --backup-check: no leaves the check out, yes starts it at once", async () => {
      await offerEncodedCheck(original, () => undefined, "no");
      await offerShareCheck(TEST_PHRASE, "direct", 2, () => undefined, "no");
      expect(terminal.notes).toEqual([]);
      terminal.answers = [`${MASKED}\r`, `${DATE}\r`];
      await offerEncodedCheck(original, () => undefined, "yes");
      expect(seen.notices).toContain("The backup restores this seed phrase.");
      // Only the first offer was answered; none was asked.
      expect(terminal.notes).toEqual([]);
      expect(() => backupCheckAnswer({ "backup-check": "maybe" })).toThrow(
        "--backup-check must be yes or no.",
      );
      // It answers a question of the private screen, which a record with a new last word lacks.
      expect(() => backupCheckAnswer({ "backup-check": "yes" })).toThrow(
        "--backup-check answers a question of --ask-secrets",
      );
      expect(() =>
        backupCheckAnswer({
          "backup-check": "no",
          "ask-secrets": true,
          "legacy-valid-last-word": true,
        }),
      ).toThrow("a record with a replaced last word cannot be checked");
    });
  });
});

describe("encode, decode and the backup check on the private screen", () => {
  describe("the backup check", () => {
    it("shows the result again on request and then offers the check once more", async () => {
      const direct = formatEncoded(representMnemonic(TEST_PHRASE), "indexes");
      const wrong = direct.replace(/^\d+/u, "2");
      const show = vi.fn();
      terminal.answers = [`${wrong}\r`, `${direct}\r`];
      terminal.choices = [true, "show", true];
      await offerEncodedCheck(
        {
          mnemonic: TEST_PHRASE,
          format: "indexes",
          mode: "direct",
          codes: representMnemonic(TEST_PHRASE).shiftedIndexes,
          dates: [],
        },
        show,
        undefined,
      );
      expect(show).toHaveBeenCalledTimes(1);
      expect(terminal.questions).toEqual([
        "Check the backup now?",
        "What now?",
        "Check the backup now?",
      ]);
      expect(seen.notices).toContain("The backup restores this seed phrase.");
    });

    it("types an unreadable share again alone, and keeps the others", async () => {
      const shares = await splitSskrMnemonic(masked.shiftedEnglish.join(" "), 2, 3);
      terminal.answers = [
        `${shares[0]}\r`,
        `${shares[0]};not a share\r`,
        "still none\r",
        `${shares[2]}\r`,
        "24-09-2026\r",
        `${DATE}\r`,
      ];
      terminal.choices = [true, "again"];
      await offerShareCheck(TEST_PHRASE, "seedshift", 2, () => undefined, undefined, [
        parseDate(DATE),
      ]);
      expect(seen.notices.filter((line) => line !== "")).toEqual([
        "This is one share; type 2, separated by ;.",
        matching(/^Share 2 cannot be read: /u),
        matching(/^Share 2 cannot be read: /u),
        "Date 1 is not one of the dates of this backup.",
        "The backup restores this seed phrase.",
      ]);
      expect(promptsShown("Share 2 as written down:")).toHaveLength(2);
    });

    it("keeps an abbreviation at the start of a share's problem", async () => {
      const shares = await splitSskrMnemonic(masked.shiftedEnglish.join(" "), 2, 3);
      // One byte of share 2 changed to another, a valid minimal byteword (its first and last
      // letters): the share reads, but its checksum does not match.
      const body = shares[1]!.slice(SSKR_UR_PREFIX.length);
      const at = 2 * 6;
      const pair = body.slice(at, at + 2);
      const other = MINIMAL_BYTEWORDS.find((word) => word !== pair)!;
      const changed = `${SSKR_UR_PREFIX}${body.slice(0, at)}${other}${body.slice(at + 2)}`;
      terminal.answers = [`${shares[0]};${changed}\r`, `${shares[1]}\r`, `${DATE}\r`];
      terminal.choices = [true];
      await offerShareCheck(TEST_PHRASE, "seedshift", 2, () => undefined, undefined, [
        parseDate(DATE),
      ]);
      expect(seen.notices.filter((line) => line !== "")).toEqual([
        "Share 2 cannot be read: SSKR transport checksum does not match.",
        "The backup restores this seed phrase.",
      ]);
    });

    it("tells shares of another phrase from wrong dates without the dates of the result", async () => {
      const shares = await splitSskrMnemonic(masked.shiftedEnglish.join(" "), 2, 3);
      terminal.answers = [`${shares[0]};${shares[1]}\r`, "24-09-2026\r", `${DATE}\r`];
      terminal.choices = [true, "again"];
      await offerShareCheck(TEST_PHRASE, "seedshift", 2, () => undefined, undefined);
      expect(seen.notices.filter((line) => line !== "")).toEqual([
        "The shares with these dates give another seed phrase: check the dates and the shares.",
        "The backup restores this seed phrase.",
      ]);

      const others = await splitSskrMnemonic(TEST_PHRASE, 2, 3);
      seen.notices = [];
      terminal.answers = [`${others[0]};${others[1]}\r`];
      terminal.choices = [true];
      await offerShareCheck(TEST_PHRASE, "seedshift", 2, () => undefined, undefined, [
        parseDate(DATE),
      ]);
      expect(seen.notices).toContain(
        "These shares restore another seed phrase: they are not of this backup.",
      );
    });
  });
});

describe("encode, decode and the backup check on the private screen", () => {
  describe("the backup check", () => {
    it("stops at Ctrl+C inside the check", async () => {
      terminal.answers = ["12\x03"];
      terminal.choices = [true];
      await expect(offerEncodedCheck(original, () => undefined, undefined)).rejects.toBeInstanceOf(
        InputCancelledError,
      );
    });
  });
});
