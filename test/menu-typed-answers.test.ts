// The start menu's typed answers, which are checked at once and asked again, its question about
// Seedshift and the typed command, with the questions answered by a script
// (test/helpers/menu-script.ts). Public test data only.

import { spawnSync } from "node:child_process";
import { truncate, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { SHARE_SEEDSHIFT_QUESTION } from "../src/cli/seedshift-choices.js";
import { commandDisplay, typedCommand } from "../src/cli/shell-command.js";
import { MENU_ENTRY_NAMES as ENTRY } from "../src/cli/menu-entries.js";
import {
  answeredByScript,
  DATE_WALLET,
  files,
  POSIX_SHELLS,
  runOf,
  warningsAt,
} from "./helpers/menu-paths.js";
import { script } from "./helpers/menu-script.js";

const harness = await vi.hoisted(async () => import("./helpers/menu-script.js"));
vi.mock("../src/cli/terminal-choice.js", async (importOriginal) =>
  harness.replacedTerminalChoice(await importOriginal()),
);
vi.mock("../src/cli/terminal-input.js", async (importOriginal) =>
  harness.replacedTerminalInput(await importOriginal()),
);
vi.mock("../src/export/image-export.js", async (importOriginal) =>
  harness.replacedImageExport(await importOriginal()),
);
vi.mock("../src/cli/cards-fit.js", async (importOriginal) =>
  harness.replacedCardsFit(await importOriginal()),
);

answeredByScript();

describe("start menu", () => {
  it("exports the full dictionary and guide set into one new folder", async () => {
    expect(await runOf(ENTRY.table, [4, 5])).toEqual([
      "table",
      "--word-lists-dir",
      "mnemocode-recovery-pack",
    ]);
  });
  it.each(["english", "chinese", "unicode", "mapping", "guide"])(
    "exports the complete %s text from the word lookup entry",
    async (format) => {
      const choice = ["english", "chinese", "unicode", "mapping", "guide"].indexOf(format);
      const run = await runOf(ENTRY.table, [4, choice]);
      expect(run).toEqual([
        "table",
        ...(format === "guide" ? ["--recovery-guide"] : ["--all", "--table-format", format]),
        "--output",
        format === "guide" ? "mnemocode-manual-recovery.md" : `bip39-${format}.txt`,
      ]);
    },
  );

  it("asks whether shares were masked as the Restore entry and the commands of shares ask it", async () => {
    // The Find entry, a code of a share, the wallet's fingerprint, then the share question: Yes.
    const run = await runOf(ENTRY.recover, [3, 0, 1]);
    const questions = script.asked.map((asked) => asked.question);
    expect(questions).toContain(SHARE_SEEDSHIFT_QUESTION);
    expect(run).toEqual(expect.arrayContaining(["sskr-export", "--mode", "seedshift"]));
    await runOf(ENTRY.restore, [1]);
    expect(script.asked.map((asked) => asked.question)).toEqual([SHARE_SEEDSHIFT_QUESTION]);
  });

  describe("typed answers are checked at once and asked again", () => {
    it("asks the fingerprint and the address again until a wallet can have them", async () => {
      const fingerprint = await runOf(ENTRY.recover, [...DATE_WALLET, 0], {
        "Original fingerprint of the wallet, such as 73c5da0a (not the encoded one; They do not reveal the phrase.)":
          ["", "73c5da0", "73C5DA0A"],
      });
      expect(fingerprint).toEqual(expect.arrayContaining(["--master-fingerprint", "73c5da0a"]));
      expect(script.labels).toContain("Fingerprint");
      expect(
        warningsAt(
          "Original fingerprint of the wallet, such as 73c5da0a (not the encoded one; They do not reveal the phrase.)",
        ),
      ).toEqual([
        undefined,
        "Type the eight characters of the fingerprint.",
        "A master fingerprint must be eight hexadecimal characters.",
      ]);
      const address = "Bitcoin address (one of the first receiving ones)";
      // BIP173's testnet example, then the public phrase's first native SegWit address.
      await runOf(ENTRY.recover, [...DATE_WALLET, 1], {
        [address]: [
          "tb1qw508d6qejxtdg4y5r3zarvary0c5xw7kxpjzsx",
          "bc1qcr8te4kr609gcawutmrza0j4xv80jy8z306fyu",
        ],
      });
      expect(warningsAt(address)).toEqual([
        undefined,
        "The address is not valid for Bitcoin mainnet; it is a testnet address.",
      ]);
    });

    it("asks the Scanner's key, the lookups and the numbers of shares again", async () => {
      await runOf(ENTRY.recover, [0, 0, 1, 0], {
        "Scanner key": ["age1", "age12d86zp9uj65df2snvl656uewdl82zrdfya8a2zgxu5rauaw7fsaqrr6w3x"],
      });
      expect(warningsAt("Scanner key")[1]).toContain("62 characters");
      expect(await runOf(ENTRY.table, [0], { Word: ["Abandonn", "Abandon"] })).toEqual([
        "table",
        "--word",
        "abandon",
      ]);
      expect(await runOf(ENTRY.table, [1], { "Word number": ["2049", "0", "007"] })).toEqual([
        "table",
        "--index",
        "7",
      ]);
      expect(await runOf(ENTRY.table, [2], { "Unicode code": ["FFFF", "5bf6"] })).toEqual([
        "table",
        "--unicode",
        "5BF6",
      ]);
      // Other: only the refused number is asked again; a good first number stays.
      const count = "How many shares in all? (2 to 16)";
      const threshold = "How many of them restore the seed phrase?";
      expect(
        await runOf(ENTRY.encode, [2, 1, 7, 0, 0, 0], {
          [count]: ["1", "17", "3"],
          [threshold]: ["4", "3"],
        }),
      ).toEqual(expect.arrayContaining(["--threshold", "3", "--shares", "3"]));
      expect(warningsAt(count)).toEqual([
        undefined,
        "Choose 2 to 16 shares.",
        "Choose 2 to 16 shares.",
      ]);
      expect(warningsAt(threshold)).toEqual([
        undefined,
        "Type a number from 2 to 3, the number of shares.",
      ]);
    });
  });
});

describe("start menu", () => {
  describe("typed answers are checked at once and asked again", () => {
    it("refuses file names that the command could not use", async () => {
      const name = "QR code file name";
      // Encode: word numbers, MnemoCode Seedshift, no shares, a QR code image.
      const qr = [1, 0, 0, 2];
      const folder = join(files, "folder");
      const refused: [string, string][] = [
        ["-", "- is no file name here; type the name of a file."],
        ["-h", "A name that starts with - would be read as an option; type ./ before it."],
        [
          folder,
          "A folder has this name; give the file another name, or a name inside that folder.",
        ],
        [
          join(files, "no such folder", "qr.png"),
          "The folder containing the output file must already exist and be writable.",
        ],
        [
          join(files, "record.txt", "qr.png"),
          "The folder containing the output file is not a directory.",
        ],
      ];
      // A file dropped into the terminal arrives in quotes; a taken name is numbered later.
      const run = await runOf(ENTRY.encode, [...qr, 0], {
        [name]: [...refused.map(([answer]) => answer), `'${join(files, "record.txt")}'`],
      });
      expect(run).toEqual(expect.arrayContaining(["--qr", join(files, "record.txt")]));
      expect(warningsAt(name)).toEqual([undefined, ...refused.map(([, warning]) => warning)]);
    });

    it("refuses a second file of the same task in the place of the first", async () => {
      // Encode: word numbers, MnemoCode Seedshift, no shares, a record file, and heirs on A5.
      const record = join(files, "backup.txt");
      const heirs = "PDF file name";
      const run = await runOf(ENTRY.encode, [1, 0, 0, 1, 0, 1], {
        "Record file name": [record],
        [heirs]: [record, join(files, "heirs.pdf")],
      });
      expect(run).toEqual(expect.arrayContaining(["--heir-sheet", join(files, "heirs.pdf")]));
      expect(warningsAt(heirs)).toEqual([
        undefined,
        "Another file of this task has this name or this folder; choose another one.",
      ]);
      // The next task starts afresh: the same name may be used again.
      await runOf(ENTRY.encode, [1, 0, 0, 1, 0], { "Record file name": [record] });
      expect(warningsAt("Record file name")).toEqual([undefined, undefined]);
      // A new folder for cards may not hold a file of the same task either.
      script.lines = [];
      const cards = join(files, "cards");
      await runOf(ENTRY.encode, [4, 1, 0, 3, 0, 3, 0, 0, 1], {
        "Name of the new folder": [cards],
        [heirs]: [join(cards, "heirs.pdf"), join(files, "heirs.pdf")],
      });
      expect(warningsAt(heirs)[1]).toBe(
        "Another file of this task has this name or this folder; choose another one.",
      );
    });

    it("reads no file but checks that the one to read is there and small enough", async () => {
      const name = "Record file name";
      const large = join(files, "large.txt");
      // A sparse file one byte larger than the 1 MiB that the command reads.
      await writeFile(large, "");
      await truncate(large, 1024 * 1024 + 1);
      const run = await runOf(ENTRY.decode, [1], {
        [name]: [
          join(files, "missing.txt"),
          join(files, "folder"),
          large,
          "-",
          `"${join(files, "record.txt")}"`,
        ],
      });
      expect(run).toEqual(["decode", "--ask-secrets", "--input-file", join(files, "record.txt")]);
      expect(warningsAt(name)).toEqual([
        undefined,
        "There is no such file; check its name and its folder.",
        "That is a folder; type the name of a file in it.",
        "That file is larger than 1 MiB; it cannot be the one.",
        "- is no file name here; type the name of a file.",
      ]);
    });
  });
});

describe("start menu", () => {
  describe("typed answers are checked at once and asked again", () => {
    it("takes a new folder where the nearest folder that exists may be written", async () => {
      // Printing sample cards has no folder; Encode's separate cards do. Missing folders are made
      // by the command.
      const deep = join(files, "a", "b", "cards");
      const run = await runOf(ENTRY.encode, [4, 1, 0, 3, 0, 3, 0, 0], {
        "Name of the new folder": [
          join(files, "record.txt", "cards"),
          "''",
          '" "',
          join(files, "cards.pdf"),
          deep,
        ],
      });
      expect(run).toEqual(expect.arrayContaining(["--cards-dir", deep]));
      // A quoted name of spaces leaves a blank one, which the command would refuse at its start.
      const blank = "That name is blank; type a name, or press Enter alone for the one shown.";
      expect(warningsAt("Name of the new folder")).toEqual([
        undefined,
        "A file stands where a folder of this name should be; choose another name.",
        blank,
        blank,
        // A folder named like a PDF would stand in the way of a PDF of that name later.
        "A new folder needs a name without .pdf, which is the ending of a file; choose another name.",
      ]);
    });
  });

  it("passes the answer about Seedshift to decode, No as --mode direct", async () => {
    // Typed, then No: --mode direct, so that decode does not ask again for codes that name no
    // mode; a typed record that names another mode is questioned by decode itself.
    expect(await runOf(ENTRY.decode, [0, 0, 0])).toEqual([
      "decode",
      "--ask-secrets",
      "--mode",
      "direct",
    ]);
    const question = script.asked.find((asked) => asked.question.startsWith("Was Seedshift"))!;
    expect(question.labels).toEqual(["No", "MnemoCode Seedshift", "Original Seedshift"]);
    expect(await runOf(ENTRY.decode, [0, 0, 1])).toEqual([
      "decode",
      "--ask-secrets",
      "--mode",
      "seedshift",
    ]);
    expect(await runOf(ENTRY.decode, [0, 0, 2])).toEqual([
      "decode",
      "--ask-secrets",
      "--mode",
      "seedshift-legacy",
    ]);
    // Codes typed from printed cards: the number of words, which leaves out their decoys.
    expect(await runOf(ENTRY.decode, [0, 5, 0])).toEqual([
      "decode",
      "--ask-secrets",
      "--words",
      "24",
      "--mode",
      "direct",
    ]);
    // A QR code image the same.
    expect(await runOf(ENTRY.decode, [2, 0])).toEqual([
      "decode",
      "--ask-secrets",
      "--qr-file",
      join(files, "qr.png"),
      "--mode",
      "direct",
    ]);
    // A record file names its own mode: nothing is asked about it.
    expect(await runOf(ENTRY.decode, [1])).toEqual([
      "decode",
      "--ask-secrets",
      "--input-file",
      join(files, "record.txt"),
    ]);
    expect(script.asked.map((asked) => asked.question)).not.toContain(
      "Was Seedshift used when it was encoded?",
    );
  });
});

describe("start menu", () => {
  it("shows the typed command with quotes only where a shell needs them", () => {
    const posix = (argument: string) => typedCommand(["preview", "--pdf", argument], "linux");
    const windows = (argument: string) => typedCommand(["preview", "--pdf", argument], "win32");
    expect(
      typedCommand(["decode", "--ask-secrets", "--input-file", "my record.txt"], "linux"),
    ).toBe("mnemocode decode --ask-secrets --input-file 'my record.txt'");
    expect(typedCommand(["table", "--word", "abandon"])).toBe("mnemocode table --word abandon");
    expect(posix("output/cards-2.pdf")).toBe("mnemocode preview --pdf output/cards-2.pdf");
    // = first is a program's path in zsh, @ first splatting in PowerShell; inside they are plain.
    for (const name of ["=cards.pdf", "@cards.pdf"]) {
      expect(posix(name)).toBe(`mnemocode preview --pdf '${name}'`);
      expect(windows(name)).toBe(`mnemocode preview --pdf "${name}"`);
    }
    expect(posix("a=b@c.pdf")).toBe("mnemocode preview --pdf a=b@c.pdf");
    // % is a variable in cmd.exe and , an array in PowerShell.
    expect(posix("100%,2.pdf")).toBe("mnemocode preview --pdf '100%,2.pdf'");

    // Windows: double quotes, which cmd.exe and PowerShell read alike, around paths with spaces
    // and backslashes; ' is plain inside them.
    expect(windows("C:\\Users\\Ann Lee\\My Cards\\cards.pdf")).toBe(
      'mnemocode preview --pdf "C:\\Users\\Ann Lee\\My Cards\\cards.pdf"',
    );
    expect(windows("it's.pdf")).toBe(`mnemocode preview --pdf "it's.pdf"`);
    expect(windows("it\u2019s.pdf")).toBe(`mnemocode preview --pdf "it\u2019s.pdf"`);
    // What either shell still reads inside double quotes gets PowerShell's single quotes, in which
    // ' and its four typographic forms are doubled.
    for (const special of ['"', "\u201C", "\u201D", "\u201E", "$", "`", "%", "!", "^", "\n"])
      expect(windows(`a${special}b.pdf`)).toBe(`mnemocode preview --pdf 'a${special}b.pdf'`);
    expect(windows("C:\\Backups\\")).toBe("mnemocode preview --pdf 'C:\\Backups\\'");
    expect(windows("say \u201Chi\u201D, it's 100%")).toBe(
      "mnemocode preview --pdf 'say \u201Chi\u201D, it''s 100%'",
    );
    expect(windows("'\u2018\u2019\u201A\u201B$")).toBe(
      "mnemocode preview --pdf '''\u2018\u2018\u2019\u2019\u201A\u201A\u201B\u201B$'",
    );

    // PowerShell would pass on 4E00 as 4, 0x10 as 16, 1kb as 1024 and 007 as 7.
    for (const number of ["4E00", "4E5D", "0x10", "1kb", "007", "1.5", ".5", "+5", "-1"]) {
      expect(typedCommand(["table", "--unicode", number], "win32")).toBe(
        `mnemocode table --unicode "${number}"`,
      );
      expect(typedCommand(["table", "--unicode", number], "linux")).toBe(
        `mnemocode table --unicode ${number}`,
      );
    }
    expect(
      typedCommand(
        ["encode", "--sskr", "--threshold", "2", "--shares", "16", "--format", "0"],
        "win32",
      ),
    ).toBe("mnemocode encode --sskr --threshold 2 --shares 16 --format 0");
    expect(typedCommand(["table", "--unicode", "BF6A"], "win32")).toBe(
      "mnemocode table --unicode BF6A",
    );
  });

  // Windows has no POSIX shell to paste into; its quoting is checked above.
  it.skipIf(process.platform === "win32").each(POSIX_SHELLS)(
    "keeps every file name byte for byte when the command is pasted into %s",
    (shell) => {
      const names = [
        "output/a$(printf b).pdf",
        "a `date` b.pdf",
        "back\\slash \\n.pdf",
        "say \"hi\" and 'bye'.pdf",
        "say \u201Chi\u201D and \u2018bye\u2019.pdf",
        "carte d'identité ✓ 日本.pdf",
        "$HOME/*.pdf",
        "output/a  b.pdf",
        "=sh",
        "@cards.pdf",
        "~/cards.pdf",
        "100%,2.pdf",
        "a=b@c.pdf",
        "4E00",
        `output/${"a".repeat(45)} ${"b".repeat(45)}.pdf`,
      ];
      for (const name of names) {
        // The shown command is run in a real POSIX shell, with mnemocode as a function that prints
        // its arguments one per NUL.
        const script = `mnemocode() { printf '%s\\0' "$@"; }; ${commandDisplay(["preview", "--pdf", name])}`;
        const printed = spawnSync(shell, ["-c", script], { encoding: "utf8" }).stdout.split("\0");
        expect(printed.slice(0, 3)).toEqual(["preview", "--pdf", name]);
      }
    },
  );
});
