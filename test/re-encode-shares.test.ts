import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { entropyToMnemonic } from "@scure/bip39";
import { wordlist } from "@scure/bip39/wordlists/english.js";
import { runReEncode } from "../src/cli/re-encode-command.js";
import { CANCELLED } from "../src/cli/terminal-keys.js";
import { SSKR_LONG_VECTOR, SSKR_SET_VECTOR } from "../src/sskr/known-answers.js";
import { writeShare } from "../src/sskr/transport.js";
import { splitSskrMnemonic } from "../src/sskr/shares.js";
import { questionsOnPrivateScreen, seen, terminal } from "./helpers/question-terminal.js";
import {
  DATE,
  DATE_LAST_DIGIT_FORGOTTEN,
  MASKED_WORDS,
  TEST_PHRASE,
  TEST_FINGERPRINT,
  TEST_UNICODE,
  WRONG_DATE,
} from "./helpers/test-phrase.js";
import { BACKUP_CHECK_QUESTION, RE_ENCODE_CONFIRMATION } from "./helpers/prompts.js";
import { streamsAsTerminal } from "./helpers/terminal-streams.js";
import { markUnits, shareUnits, wrongValue } from "./helpers/shares.js";

const harness = await vi.hoisted(async () => import("./helpers/question-terminal.js"));
vi.mock("node:tty", async (importOriginal) => harness.replacedTty(await importOriginal()));
vi.mock("../src/cli/terminal-input.js", async (importOriginal) =>
  harness.replacedTerminalInput(await importOriginal()),
);

const ARGS = { "ask-secrets": true, mode: "direct", format: "3" } as const;
const SEEDSHIFT_QUESTION = "Was Seedshift used before it was split?";
let maskedShares: string[];
beforeAll(async () => {
  maskedShares = await splitSskrMnemonic(MASKED_WORDS, 2, 3);
});

questionsOnPrivateScreen();
beforeEach(() => {
  streamsAsTerminal();
  Object.defineProperty(process.stdout, "isTTY", { value: false, configurable: true });
});

describe("Re-encode restores Shamir shares before confirming the original phrase", () => {
  it.each(["ur", "words", "indexes", "unicode", "colors", "colors-unicode"] as const)(
    "accepts semicolon-separated %s shares and asks about Seedshift before confirmation",
    async (format) => {
      terminal.answers = [
        `${SSKR_SET_VECTOR.shares
          .slice(0, 2)
          .map((share) => writeShare(share, format))
          .join(";\n")}\r`,
      ];
      terminal.choices = ["No", "Yes, I recognise it"];
      expect(await runReEncode({ ...ARGS })).toBeUndefined();
      expect(seen.notices.join("\n")).toContain(
        "Shamir shares are accepted too; separate them with ;.",
      );
      expect(seen.notices.join("\n")).toContain(
        "Use ? for each missing or unreadable share code or digit.",
      );
      expect(terminal.questions).toEqual([
        SEEDSHIFT_QUESTION,
        RE_ENCODE_CONFIRMATION,
        BACKUP_CHECK_QUESTION,
      ]);
      // Independent published phrase, rather than another reconstruction as the oracle.
      expect(seen.notices.join("\n")).toContain(SSKR_SET_VECTOR.phrase);
      expect(seen.out.join("\n")).not.toContain(SSKR_SET_VECTOR.phrase);
      expect(seen.out).not.toEqual([]);
      expect(seen.refusals).toEqual([]);
    },
  );
});

describe("Re-encode repairs damaged Shamir shares before confirming the original phrase", () => {
  it.each(["ur", "words", "indexes", "unicode", "colors", "colors-unicode"] as const)(
    "repairs an unreadable element in %s shares before confirming the original",
    async (format) => {
      terminal.answers = [
        `${writeShare(SSKR_SET_VECTOR.shares[0]!, format)};${markUnits(SSKR_SET_VECTOR.shares[1]!, format, [5])}\r`,
      ];
      terminal.choices = ["No", "Yes, I recognise it"];
      expect(await runReEncode({ ...ARGS })).toBeUndefined();
      expect(terminal.questions).toContain(RE_ENCODE_CONFIRMATION);
      expect(seen.notices.join("\n")).toContain(SSKR_SET_VECTOR.phrase);
      expect(seen.out.join("\n")).not.toContain(SSKR_SET_VECTOR.phrase);
      expect(seen.out).not.toEqual([]);
      expect(seen.refusals).toEqual([]);
    },
  );

  it("repairs two spaced Color Unicode codes of a 24-word share before confirmation", async () => {
    const units = shareUnits(SSKR_LONG_VECTOR.shares[1], "colors-unicode");
    units[9] = "?";
    units[19] = "?";
    terminal.answers = [
      `${writeShare(SSKR_LONG_VECTOR.shares[0], "colors-unicode")};${units.join(" ")}\r`,
    ];
    // Independent BIP39 implementation maps the published vector's entropy to its phrase.
    const phrase = entropyToMnemonic(Buffer.from(SSKR_LONG_VECTOR.entropy, "hex"), wordlist);
    terminal.choices = [
      "No",
      async () => {
        expect(seen.notices.join("\n")).toContain(phrase);
        expect(seen.out).toEqual([]);
        return "Yes, I recognise it";
      },
    ];
    expect(await runReEncode({ ...ARGS })).toBeUndefined();
    expect(terminal.questions).toContain(RE_ENCODE_CONFIRMATION);
    expect(terminal.questions).not.toContain("Which shares to change?");
    expect(seen.out).not.toEqual([]);
  });

  it("repairs shares and a forgotten date digit using the original wallet before confirmation", async () => {
    terminal.answers = [
      `${maskedShares[0]};${markUnits(maskedShares[1]!, "colors-unicode", [5, 9])}\r`,
      `${DATE_LAST_DIGIT_FORGOTTEN}\r`,
      `${TEST_FINGERPRINT}\r`,
    ];
    terminal.choices = [
      "Yes",
      "Fingerprint",
      async () => {
        expect(seen.notices.join("\n")).toContain(TEST_PHRASE);
        expect(seen.notices.join("\n")).not.toContain(MASKED_WORDS);
        expect(seen.out).toEqual([]);
        return "Yes, I recognise it";
      },
    ];
    expect(await runReEncode({ ...ARGS })).toBeUndefined();
    expect(terminal.questions).toContain(RE_ENCODE_CONFIRMATION);
    expect(seen.out).toContain(TEST_UNICODE);
    expect(seen.refusals).toEqual([]);
  });

  it("produces no new backup when the restored original is not confirmed", async () => {
    terminal.answers = [
      `${maskedShares[0]};${markUnits(maskedShares[1]!, "colors-unicode", [5, 9])}\r`,
      `${DATE}\r`,
    ];
    terminal.choices = ["Yes", "Stop"];
    expect(await runReEncode({ ...ARGS })).toBe(CANCELLED);
    expect(terminal.questions).toContain(RE_ENCODE_CONFIRMATION);
    expect(seen.notices.join("\n")).toContain(TEST_PHRASE);
    expect(seen.out).toEqual([]);
    expect(terminal.questions).not.toContain(BACKUP_CHECK_QUESTION);
  });

  it("unmasks restored shares with the dates before showing and confirming the original", async () => {
    terminal.answers = [
      `${maskedShares
        .slice(0, 2)
        .map((share) => writeShare(share, "colors"))
        .join(";")}\r`,
      `${DATE}\r`,
    ];
    terminal.choices = ["Yes", "Yes, I recognise it"];
    expect(await runReEncode({ ...ARGS })).toBeUndefined();
    expect(terminal.questions.slice(0, 2)).toEqual([SEEDSHIFT_QUESTION, RE_ENCODE_CONFIRMATION]);
    expect(seen.notices.join("\n")).toContain(TEST_PHRASE);
    expect(seen.notices.join("\n")).not.toContain(MASKED_WORDS);
    expect(seen.out.join("\n")).not.toContain(TEST_PHRASE);
    expect(seen.out).toContain(TEST_UNICODE);
    expect(seen.screen.indexOf("Dates (")).toBeLessThan(
      seen.screen.indexOf(RE_ENCODE_CONFIRMATION),
    );
  });

  it("does not offer a phrase when an unmarked wrong element prevents share recovery", async () => {
    terminal.answers = [
      `${wrongValue(SSKR_SET_VECTOR.shares[0])};${markUnits(SSKR_SET_VECTOR.shares[1], "colors-unicode", [5])}\r`,
    ];
    terminal.choices = ["No", "Stop"];
    expect(await runReEncode({ ...ARGS })).toBe(CANCELLED);
    expect(seen.notices.join("\n")).toContain("No phrase fits these shares");
    expect(terminal.questions).toContain("Which shares to change?");
    expect(terminal.questions).not.toContain(RE_ENCODE_CONFIRMATION);
    expect(seen.out).toEqual([]);
  });

  it("cancels at confirmation without producing a new backup", async () => {
    terminal.answers = [`${SSKR_SET_VECTOR.shares.slice(0, 2).join(";")}\r`];
    terminal.choices = ["No"];
    expect(await runReEncode({ ...ARGS })).toBe(CANCELLED);
    expect(terminal.questions).toContain(RE_ENCODE_CONFIRMATION);
    expect(seen.out).toEqual([]);
  });

  it("keeps the shares while the person corrects the Seedshift dates before confirmation", async () => {
    terminal.answers = [`${maskedShares.slice(0, 2).join(";")}\r`, `${WRONG_DATE}\r`, `${DATE}\r`];
    terminal.choices = ["Yes", "Type the dates again", "Yes, I recognise it"];
    expect(await runReEncode({ ...ARGS })).toBeUndefined();
    expect(seen.out).toContain(TEST_UNICODE);
    expect(
      terminal.questions.filter((question) => question === RE_ENCODE_CONFIRMATION),
    ).toHaveLength(2);
    expect(seen.refusals).toEqual([]);
  });

  it("asks for more shares when the pasted batch does not reach the threshold", async () => {
    terminal.answers = [`${SSKR_SET_VECTOR.shares[0]}\r`, `${SSKR_SET_VECTOR.shares[1]}\r`];
    terminal.choices = ["No", "Yes, I recognise it"];
    expect(await runReEncode({ ...ARGS })).toBeUndefined();
    expect(terminal.questions).toContain(RE_ENCODE_CONFIRMATION);
    expect(seen.notices.join("\n")).toContain(SSKR_SET_VECTOR.phrase);
    expect(seen.out).not.toEqual([]);
    expect(seen.screen).toContain("More shares or text file path");
  });
});
