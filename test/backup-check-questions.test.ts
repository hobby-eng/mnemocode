// The backup check with --ask-secrets on the private screen, with the terminal replaced
// (test/helpers/question-terminal.ts), after encode and on its own.

import { describe, expect, it, vi } from "vitest";
import { formatEncoded, parseDate, representMnemonic } from "../src/core.js";
import { backupCheckAnswer, offerEncodedCheck, offerShareCheck } from "../src/cli/backup-check.js";
import { EncodedBackup } from "../src/core/encoded-backup.js";
import { runEncode } from "../src/cli/encode-command.js";
import { CANCELLED } from "../src/cli/terminal-keys.js";
import { errorCode } from "../src/core/refusal.js";
import { MINIMAL_BYTEWORDS } from "../src/sskr/bytewords-list.js";
import { nodeSharePlatform } from "../src/sskr/share-platform-node.js";
import { splitSskrMnemonic } from "../src/sskr/shares.js";
import { ShareSplit } from "../src/sskr/split.js";
import { CTRL_C } from "./helpers/keys.js";
import { matching } from "./helpers/matchers.js";
import { ORIGINAL, promptsShown } from "./helpers/phrase-questions.js";
import {
  keptAbove,
  questionsOnPrivateScreen,
  seen,
  terminal,
} from "./helpers/question-terminal.js";
import { wrongValue } from "./helpers/shares.js";
import {
  DATE,
  MASKED,
  MASKED_WORDS,
  replacedAt,
  TEST_PHRASE,
  WRONG_DATE,
} from "./helpers/test-phrase.js";
import { BACKUP_CHECK_QUESTION, DATES_AGAIN_ANSWER } from "./helpers/prompts.js";

const harness = await vi.hoisted(async () => import("./helpers/question-terminal.js"));
vi.mock("node:tty", async (importOriginal) => harness.replacedTty(await importOriginal()));
vi.mock("../src/cli/terminal-input.js", async (importOriginal) =>
  harness.replacedTerminalInput(await importOriginal()),
);

/** The start of a share as a UR, before its minimal bytewords. */
const SSKR_UR_PREFIX = "ur:sskr/";

questionsOnPrivateScreen();

describe("encode, decode and the backup check on the private screen", () => {
  describe("the backup check", () => {
    it("keeps its backup live while an asynchronous check asks to show it again, then disposes it", async () => {
      const direct = formatEncoded(representMnemonic(TEST_PHRASE), "indexes");
      const wrong = direct.replace(/^\d+/u, "2");
      const encode = vi.spyOn(EncodedBackup, "encode");
      terminal.answers = [`${TEST_PHRASE}\r`, `${wrong}\r`];
      terminal.choices = ["Yes", "Show the result again", "No"];
      await expect(
        runEncode({ "ask-secrets": true, mode: "direct", format: "indexes" }),
      ).resolves.toBeUndefined();
      expect(terminal.questions).toContain("What now?");
      const result = encode.mock.results[0]!;
      expect(result.type).toBe("return");
      if (result.type !== "return") return;
      expect(() => result.value.backup.text()).toThrow("has been wiped");
    });

    it("names the codes and the date that differ, and asks only that part again", async () => {
      const codes = replacedAt(MASKED, { 3: "25" });
      terminal.answers = [
        "\r",
        "1 2 3\r",
        `${codes}\r`,
        `${MASKED}\r`,
        `${WRONG_DATE}\r`,
        `${DATE}\r`,
      ];
      terminal.choices = ["Yes", "Type the codes again", DATES_AGAIN_ANSWER];
      await offerEncodedCheck(ORIGINAL, () => undefined, undefined);
      expect(seen.notices).toEqual([
        "",
        "Type the codes you wrote down, or press Ctrl+C to stop.",
        "These are 3 word numbers; an encoded seed phrase has 12, 15, 18, 21 or 24.",
        // Each part that differs is said, then kept above "What now?" and above that part asked
        // again, each on a screen of its own (PrivateSteps).
        ...keptAbove(["The word number at place 3 differs from the result."], 2),
        ...keptAbove(["Date 1 is not one of the dates of this backup."], 2),
        "The backup restores this seed phrase.",
      ]);
      expect(terminal.labels[1]).toEqual([
        "Type the codes again",
        "Show the result again",
        "Stop checking",
      ]);
      expect(terminal.labels[2]![0]).toBe(DATES_AGAIN_ANSWER);
      // The codes that fitted were not asked again with the dates.
      expect(promptsShown("Your backup, as written down:")).toHaveLength(4);
    });

    it("names the dates in the offer only where the backup has them, and Escape skips it", async () => {
      await offerEncodedCheck(ORIGINAL, () => undefined, undefined);
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
      await offerEncodedCheck(ORIGINAL, () => undefined, "no");
      await offerShareCheck(TEST_PHRASE, "direct", 2, () => undefined, "no");
      expect(terminal.notes).toEqual([]);
      terminal.answers = [`${MASKED}\r`, `${DATE}\r`];
      await offerEncodedCheck(ORIGINAL, () => undefined, "yes");
      expect(seen.notices).toContain("The backup restores this seed phrase.");
      // Only the first offer was answered; none was asked.
      expect(terminal.notes).toEqual([]);
      expect(() => backupCheckAnswer({ "backup-check": "maybe" })).toThrow(
        "--backup-check must be yes or no.",
      );
      // It answers a question of the private screen, which shows at this terminal with
      // --ask-secrets or without (test/backup-check-option.test.ts refuses it without a terminal),
      // and which a record with a new last word lacks.
      expect(backupCheckAnswer({ "backup-check": "yes" })).toBe("yes");
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
      terminal.choices = ["Yes", "Show the result again", "Yes"];
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
        BACKUP_CHECK_QUESTION,
        "What now?",
        BACKUP_CHECK_QUESTION,
      ]);
      expect(seen.notices).toContain("The backup restores this seed phrase.");
    });

    it("types an unreadable share again alone, and keeps the others", async () => {
      const shares = await splitSskrMnemonic(MASKED_WORDS, 2, 3);
      terminal.answers = [
        `${shares[0]}\r`,
        `${shares[0]};not a share\r`,
        "still none\r",
        `${shares[2]}\r`,
        `${WRONG_DATE}\r`,
        `${DATE}\r`,
      ];
      terminal.choices = ["Yes", DATES_AGAIN_ANSWER];
      await offerShareCheck(TEST_PHRASE, "seedshift", 2, () => undefined, undefined, [
        parseDate(DATE),
      ]);
      expect(seen.notices.filter((line) => line !== "")).toEqual([
        "This is one share; type 2, separated by ;.",
        // Said, kept above the share asked again, and said again for the share typed again.
        ...keptAbove([matching(/^Share 2 cannot be read: /u)], 1),
        matching(/^Share 2 cannot be read: /u),
        ...keptAbove(["Date 1 is not one of the dates of this backup."], 2),
        "The backup restores this seed phrase.",
      ]);
      expect(promptsShown("Share 2 as written down:")).toHaveLength(2);
    });

    it("refuses a share typed again by the code of its condition (CORE-23)", async () => {
      const shares = await splitSskrMnemonic(MASKED_WORDS, 2, 3);
      terminal.answers = [
        `${shares[0]};not a share\r`,
        "still none\r",
        `${TEST_PHRASE}\r`,
        `${shares[2]}\r`,
        `${DATE}\r`,
      ];
      terminal.choices = ["Yes"];
      await offerShareCheck(TEST_PHRASE, "seedshift", 2, () => undefined, undefined, [
        parseDate(DATE),
      ]);
      expect(seen.refusals.map(errorCode)).toEqual([
        "sskr.share-input.share-unreadable",
        "sskr.share-input.seed-phrase-in-words",
      ]);
      expect(seen.notices).toContain("The backup restores this seed phrase.");
    });

    it("keeps an abbreviation at the start of a share's problem", async () => {
      const shares = await splitSskrMnemonic(MASKED_WORDS, 2, 3);
      // One byte of share 2 changed to another, a valid minimal byteword (its first and last
      // letters): the share reads, but its checksum does not match.
      const body = shares[1]!.slice(SSKR_UR_PREFIX.length);
      const at = 2 * 6;
      const pair = body.slice(at, at + 2);
      const other = MINIMAL_BYTEWORDS.find((word) => word !== pair)!;
      const changed = `${SSKR_UR_PREFIX}${body.slice(0, at)}${other}${body.slice(at + 2)}`;
      terminal.answers = [`${shares[0]};${changed}\r`, `${shares[1]}\r`, `${DATE}\r`];
      terminal.choices = ["Yes"];
      await offerShareCheck(TEST_PHRASE, "seedshift", 2, () => undefined, undefined, [
        parseDate(DATE),
      ]);
      expect(seen.notices.filter((line) => line !== "")).toEqual([
        ...keptAbove(["Share 2 cannot be read: SSKR transport checksum does not match."], 1),
        "The backup restores this seed phrase.",
      ]);
    });

    it("tells shares of another phrase from wrong dates without the dates of the result", async () => {
      const shares = await splitSskrMnemonic(MASKED_WORDS, 2, 3);
      terminal.answers = [`${shares[0]};${shares[1]}\r`, `${WRONG_DATE}\r`, `${DATE}\r`];
      terminal.choices = ["Yes", DATES_AGAIN_ANSWER];
      await offerShareCheck(TEST_PHRASE, "seedshift", 2, () => undefined, undefined);
      expect(seen.notices.filter((line) => line !== "")).toEqual([
        ...keptAbove(
          ["The shares with these dates give another seed phrase: check the dates and the shares."],
          2,
        ),
        "The backup restores this seed phrase.",
      ]);

      const others = await splitSskrMnemonic(TEST_PHRASE, 2, 3);
      seen.notices = [];
      terminal.answers = [`${others[0]};${others[1]}\r`];
      terminal.choices = ["Yes"];
      await offerShareCheck(TEST_PHRASE, "seedshift", 2, () => undefined, undefined, [
        parseDate(DATE),
      ]);
      expect(seen.notices).toContain(
        "These shares restore another seed phrase: they are not of this backup.",
      );
    });

    it("lets a fault of the host's SSKR library through instead of asking for the shares again (AUD-037-API002)", async () => {
      const shares = await splitSskrMnemonic(MASKED_WORDS, 2, 3);
      const fault = new Error("The host's SSKR library stopped.");
      const combine = nodeSharePlatform.combineShares;
      // Fault: the host's SSKR library stops with an error of its own at the shares typed, not a
      // refusal of them, which no shares can cause; the startup check of the engine still passes.
      vi.spyOn(nodeSharePlatform, "combineShares").mockImplementation(async (records) => {
        if (records.some((record) => shares.includes(record))) throw fault;
        return combine(records);
      });
      terminal.answers = [`${shares[0]};${shares[1]}\r`, `${shares[0]};${shares[1]}\r`];
      terminal.choices = ["Yes"];
      await expect(
        offerShareCheck(TEST_PHRASE, "seedshift", 2, () => undefined, undefined, [parseDate(DATE)]),
      ).rejects.toBe(fault);
      expect(promptsShown("shares as written down")).toHaveLength(1);
    });

    it("asks for the shares again after the engine refused to combine them (AUD-037-API002)", async () => {
      // A fixed split, not a random one: a wrong value passes the engine's 32-bit digest for about
      // one split in 2^32, and the outcome of this one was seen once and stays.
      const split = new ShareSplit(nodeSharePlatform, (bytes) => bytes.fill(7));
      const shares = await split.split(MASKED_WORDS, 2, 3);
      // Share 2 with a wrong value whose checksum holds: the engine's digest refuses the pair.
      terminal.answers = [
        `${shares[0]};${wrongValue(shares[1]!)}\r`,
        `${shares[0]};${shares[2]}\r`,
        `${DATE}\r`,
      ];
      terminal.choices = ["Yes"];
      await offerShareCheck(TEST_PHRASE, "seedshift", 2, () => undefined, undefined, [
        parseDate(DATE),
      ]);
      expect(promptsShown("shares as written down")).toHaveLength(2);
      expect(seen.notices.filter((line) => line !== "")).toEqual([
        ...keptAbove(
          ["These shares do not restore a secret: check them, and that all belong to one set."],
          1,
        ),
        "The backup restores this seed phrase.",
      ]);
    });
  });
});

describe("encode, decode and the backup check on the private screen", () => {
  describe("the backup check", () => {
    it("stops at Ctrl+C inside the check", async () => {
      terminal.answers = [`12${CTRL_C}`];
      terminal.choices = ["Yes"];
      expect(await offerEncodedCheck(ORIGINAL, () => undefined, undefined)).toBe(CANCELLED);
    });
  });
});
