// Public dictionaries and a standalone manual: no secret input, PDFs or image rendering.
import { execFileSync } from "node:child_process";
import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { entropyToMnemonic } from "@scure/bip39";
import { wordlist } from "@scure/bip39/wordlists/english.js";
import { wordlist as chinese } from "@scure/bip39/wordlists/traditional-chinese.js";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { wordTableText, WORD_TABLE_FORMATS } from "../src/core/words.js";
import { encodeMnemonic, encodeMnemonicLegacy } from "../src/core/seedshift.js";
import { parseDate } from "../src/core/dates.js";
import { checkWordTableStartup } from "../src/core/word-table-self-test.js";
import { runTable } from "../src/cli/table-command.js";
import { parseArguments } from "../src/cli/arguments.js";
import { TEST_TIME_LIMIT_MS } from "./helpers/limits.js";

let directory: string;
beforeEach(async () => {
  directory = await mkdtemp(join(tmpdir(), "mnemocode-word-table-"));
});
afterEach(async () => {
  await rm(directory, { recursive: true, force: true });
});

describe("numbered BIP39 exports", () => {
  it("publishes the full set as five complete files and never overwrites a previous set", async () => {
    const path = join(directory, "recovery-pack");
    const args = parseArguments(["--word-lists-dir", path]);
    await runTable(args);
    expect((await readdir(path)).sort()).toEqual([
      "bip39-chinese.txt",
      "bip39-english.txt",
      "bip39-mapping.txt",
      "bip39-unicode.txt",
      "manual-recovery.md",
    ]);
    for (const format of WORD_TABLE_FORMATS)
      expect(await readFile(join(path, `bip39-${format}.txt`), "utf8")).toBe(wordTableText(format));
    expect(await readFile(join(path, "manual-recovery.md"), "utf8")).toBe(
      await readFile("docs/MANUAL_RECOVERY.md", "utf8"),
    );
    await expect(runTable(args)).rejects.toThrow("Choose a new folder");
    expect(await readdir(path)).toHaveLength(5);
  });
  it("keeps every English/Traditional Chinese/code correspondence in published word-list order", () => {
    const rows = wordTableText("mapping").trimEnd().split("\n");
    expect(rows.shift()).toBe("index  english   unicode_hex  chinese");
    expect(rows).toHaveLength(2048);
    for (const [index, line] of rows.entries()) {
      const point = chinese[index]!;
      expect(line.trim().split(/ +/u)).toEqual([
        String(index + 1),
        wordlist[index],
        point.codePointAt(0)!.toString(16).toUpperCase(),
        point,
      ]);
      // Every column starts where its header does, the longest English words included.
      expect([line.indexOf(wordlist[index]!), line.lastIndexOf(point)]).toEqual([7, 30]);
    }
    expect(wordTableText()).toMatch(/^index\tenglish\tunicode_hex\n1\tabandon\t7684\n/u);
    expect(() => checkWordTableStartup()).not.toThrow();
  });

  it.each(WORD_TABLE_FORMATS)(
    "saves all 2048 numbered %s rows through the common file writer",
    async (format) => {
      const path = join(directory, `${format}.txt`);
      const args = parseArguments(["--all", "--table-format", format, "--output", path]);
      await runTable(args);
      const saved = await readFile(path, "utf8");
      expect(saved).toBe(wordTableText(format));
      expect(saved.trimEnd().split("\n")).toHaveLength(2049);
      await expect(runTable(args)).rejects.toMatchObject({ code: "EEXIST" });
      expect(await readFile(path, "utf8")).toBe(saved);
    },
  );

  it.each(["", "unknown", "constructor", "__proto__"])(
    "refuses unsupported export format %j",
    (format) => {
      // A format that the word list does not have, given on purpose as a JavaScript host could.
      expect(() => wordTableText(format as never)).toThrow("Word list format must be");
    },
  );

  it("refuses file/format options on a single lookup and conflicting whole-table selectors", async () => {
    const needsAll = "cli.table-command.export-needs-all";
    const oneLookup = "cli.table-command.choose-exactly-one-lookup-value-word-index-bip39";
    for (const [options, code] of [
      [["--word", "abandon", "--output", join(directory, "unused.txt")], needsAll],
      [["--index", "1", "--table-format", "english"], needsAll],
      [["--all", "--recovery-guide"], oneLookup],
      [["--recovery-guide", "--table-format", "mapping"], needsAll],
      [["--word-lists-dir", join(directory, "pack"), "--all"], oneLookup],
      [
        ["--word-lists-dir", join(directory, "pack"), "--output", join(directory, "unused.txt")],
        needsAll,
      ],
    ] as const)
      await expect(runTable(parseArguments(options)), options.join(" ")).rejects.toMatchObject({
        code,
      });
  });

  it("exports the complete canonical recovery guide as a standalone UTF-8 document", async () => {
    const path = join(directory, "guide.md");
    await runTable(parseArguments(["--recovery-guide", "--output", path]));
    expect(await readFile(path, "utf8")).toBe(await readFile("docs/MANUAL_RECOVERY.md", "utf8"));
  });
});

describe("the guide's standalone Python arithmetic", () => {
  async function helper(input: string): Promise<string> {
    const guide = await readFile("docs/MANUAL_RECOVERY.md", "utf8");
    const code = /```python\n([\s\S]*?)\n```/u.exec(guide)![1]!;
    return execFileSync("python3", ["-c", code], {
      input,
      encoding: "utf8",
      timeout: TEST_TIME_LIMIT_MS,
      stdio: "pipe",
    }).replaceAll("\r\n", "\n");
  }

  it("keeps direct word numbers unchanged without dates", async () => {
    const numbers = `${"1 ".repeat(11)}4`;
    expect(await helper(`direct\ndecode\n\n${numbers}\n`)).toContain(`Word numbers: ${numbers}\n`);
  });

  it.each([
    ["seedshift-legacy-valid", "decode", "23-09-2026", `${"1 ".repeat(11)}4`, "Unknown mode"],
    ["seedshift", "decode", "", `${"1 ".repeat(11)}4`, "Seedshift takes"],
    ["direct", "decode", "23-09-2026", `${"1 ".repeat(11)}4`, "Direct takes no dates"],
    [
      "seedshift",
      "decode",
      "23-09-2026",
      `${"1 ".repeat(11)}0`,
      "word numbers from 1 through 2048",
    ],
    [
      "seedshift",
      "decode",
      "23-09-2026",
      `${"1 ".repeat(11)}2049`,
      "word numbers from 1 through 2048",
    ],
    ["seedshift", "decode", "23-09-2026", "1 4", "Give 12, 15, 18, 21 or 24"],
    ["seedshift", "decode", "23-09-2026", "1 ".repeat(12), "Input phrase fails its BIP39 checksum"],
  ])(
    "refuses invalid helper input (%s, %s, %s)",
    async (mode, operation, dates, numbers, error) => {
      await expect(helper(`${mode}\n${operation}\n${dates}\n${numbers}\n`)).rejects.toThrow(error);
    },
  );

  it.each([12, 15, 18, 21, 24])(
    "agrees in both directions for %i words in both Seedshift modes",
    async (words) => {
      const phrase = entropyToMnemonic(new Uint8Array((words * 4) / 3).fill(0x35), wordlist);
      const source = phrase
        .split(" ")
        .map((word) => wordlist.indexOf(word) + 1)
        .join(" ");
      const dates = ["23-09-2026", "07-11-1951", "07-11-1951"];
      const parsed = dates.map(parseDate);
      for (const [mode, encode] of [
        ["seedshift", encodeMnemonic],
        ["seedshift-legacy", encodeMnemonicLegacy],
      ] as const) {
        const masked = encode(phrase, parsed)
          .shiftedIndexes.map((index) => index + 1)
          .join(" ");
        for (const [operation, input, expected] of [
          ["encode", source, masked],
          ["decode", masked, source],
        ]) {
          const output = await helper(`${mode}\n${operation}\n${dates.join(",")}\n${input}\n`);
          expect(output).toContain(`Word numbers: ${expected}\n`);
          if (mode === "seedshift" || operation === "decode")
            expect(output).toContain("BIP39 checksum: valid");
        }
      }
    },
  );
});
