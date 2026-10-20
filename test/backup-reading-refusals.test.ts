// Why BackupReading (src/core/backup-reading.ts) refuses codes that fit no form, each condition by
// its own code, so that a host can word it (CORE-23): complete codes as the form that their
// characters most likely are refuses them, with that refusal's code, and marked codes by a code of
// their own; codes whose leading codes another form reads, yet that no form takes, by a code of
// their own too. Public test codes only.
import { describe, expect, it } from "vitest";
import { BackupReading } from "../src/core/backup-reading.js";
import { FIT_NO_FORM } from "../src/core/encoded-backup.js";
import { JOINED_MARKS_HINT } from "../src/core/code-text.js";

const RULES = { seedshiftOnly: false, shareReader: "Shares" };

/** The forms of complete codes `text`, as a host reads them. */
function formatsOf(text: string): unknown {
  using reading = BackupReading.of(text, RULES);
  return reading.formats();
}

/** The forms of marked codes `text`, as a host reads them. */
function markedFormatsOf(text: string): unknown {
  using reading = BackupReading.of(text, RULES);
  return reading.markedFormats();
}

/** A refusal with `code` that says `message`, word for word. */
function refusal(code: string, message: string): unknown {
  return expect.objectContaining({ code, message });
}

const COUNT = "core.encoded-backup.encoded-seed-phrase";
const NUMBERING = "core.words.indexes-use-seedshift-compatible-numbering-from";
const WORDS = "core.words.enter-english-bip39-words";
const MARKED = "core.backup-reading.marked-codes-fit-no-form";
const MARK_EACH = `${FIT_NO_FORM}: mark each code that cannot be read with ?, in its place.`;

describe("codes that fit no form", () => {
  it("are refused as the form they most likely are refuses them, by that refusal's own code", () => {
    const numbers = Array.from({ length: 13 }, (_, index) => `${index + 1}`);
    for (const [text, code, message] of [
      [
        "1 2 3",
        COUNT,
        "These are 3 word numbers; an encoded seed phrase has 12, 15, 18, 21 or 24.",
      ],
      [
        "1 2 3 4 5 6 7 8 9 10 11 2049",
        NUMBERING,
        "Indexes use Seedshift-compatible numbering from 1 through 2048.",
      ],
      ["abandon abandon", WORDS, "Enter 12, 15, 18, 21 or 24 English BIP39 words."],
      // Final review CC-02: word numbers or Unicode codes apart by ; or , are not taken for words;
      // these Unicode codes have a letter, which no word number has.
      [
        numbers.join(";"),
        COUNT,
        "These are 13 word numbers; an encoded seed phrase has 12, 15, 18, 21 or 24.",
      ],
      [
        numbers.join(","),
        COUNT,
        "These are 13 word numbers; an encoded seed phrase has 12, 15, 18, 21 or 24.",
      ],
      [
        `${"8F44;".repeat(10)}5011`,
        COUNT,
        "These are 11 codes; an encoded seed phrase has 12, 15, 18, 21 or 24.",
      ],
    ] as const)
      expect(() => formatsOf(text), text).toThrow(refusal(code, message));
  });

  it("are refused by a code of their own where the leading codes read, yet no form takes the codes", () => {
    // Twelve codes of four digits run together, then a decoy with letters: the text looks like
    // Unicode codes, whose first twelve are word numbers 1 to 12, which no word's Unicode code is;
    // as word numbers they are one run, which no reader of word numbers splits.
    const numbers = Array.from({ length: 12 }, (_, index) => `${index + 1}`.padStart(4, "0"));
    using reading = BackupReading.of(`${numbers.join("")}ABCD`, { ...RULES, words: 12 });
    expect(() => reading.formats()).toThrow(
      refusal("core.backup-reading.codes-fit-no-form", `${FIT_NO_FORM}.`),
    );
  });

  it("are refused when marked by a code of their own, with the hint where they run together", () => {
    expect(() => markedFormatsOf("abandon ? about")).toThrow(refusal(MARKED, MARK_EACH));
    expect(() => markedFormatsOf("7684?684")).toThrow(
      refusal(MARKED, `${MARK_EACH} ${JOINED_MARKS_HINT}`),
    );
  });
});
