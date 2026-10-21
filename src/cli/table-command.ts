import { printableText, terminalResultHeader, terminalSaved } from "./terminal.js";
import { WordTable, WORD_TABLE_FORMATS, type WordTableFormat } from "../core/word-table.js";
import { WORD_NUMBER_RANGE } from "../core/bip39-sizes.js";
import { choiceOption, integerOption, type ParsedArguments, value } from "./arguments.js";
import { defined } from "../core/defined.js";
import { ErrorCatalog } from "../core/error-catalog.js";
import {
  privateChildPath,
  publishNewPrivateFile,
  writeNewPrivateFile,
} from "../export/private-file.js";
import { writeSaved } from "./save-retry.js";
import { readBundledFile } from "../bundled-files.js";
import { MANUAL_RECOVERY_FILE } from "../bundled-file-paths.js";
import { claimOutputFolder } from "./output-saving.js";

const ERRORS = new ErrorCatalog("cli.table-command", {
  "choose-exactly-one-lookup-value-word-index-bip39": () =>
    "Choose exactly one lookup value: a word index, a BIP39 word, or a Unicode value. Request the full table or the recovery guide instead when no lookup is needed.",
  "export-needs-all": () =>
    "--table-format requires --all; --output requires --all or --recovery-guide.",
});

/** One row of the table: grey labels under the result's heading, or plain lines for a script. */
function printRow(row: ReturnType<typeof WordTable.row>): void {
  const facts: [string, string][] = [
    ["Index", `${row.index}`],
    ["English", row.english],
    ["Unicode hex", row.unicodeHex],
  ];
  if (terminalResultHeader("Word mapping", facts)) return;
  console.log(`index:       ${row.index}`);
  console.log(`english:     ${row.english}`);
  console.log(`unicode hex: ${row.unicodeHex}`);
}

/**
 * The heading of the whole table of `format` on a terminal (CORE-36), with its rows and the
 * columns that the table names. A file or a pipe gets the plain table alone: terminalResultHeader
 * prints nothing there.
 */
function wordTableHeading(format: WordTableFormat | undefined): void {
  terminalResultHeader("Word table", [
    ["Rows", `${WordTable.rows().length}`],
    ["Columns", WordTable.columns(format).join(", ")],
  ]);
}

/** Publishes all public dictionaries and the canonical guide together, never over an old set. */
async function saveFullSet(directory: string): Promise<void> {
  const guide = await readBundledFile(MANUAL_RECOVERY_FILE);
  await writeSaved(async () => {
    const folder = await claimOutputFolder("word-lists-dir", directory);
    await folder.publish("mnemocode-word-lists-", async (staging) => {
      for (const format of WORD_TABLE_FORMATS)
        await writeNewPrivateFile(
          privateChildPath(staging, `bip39-${format}.txt`),
          Buffer.from(WordTable.text(format), "utf8"),
        );
      await writeNewPrivateFile(privateChildPath(staging, "manual-recovery.md"), guide);
    });
  });
  terminalSaved(`Saved full word-list and recovery set: ${printableText(directory)}`);
}

export async function runTable(arguments_: ParsedArguments): Promise<void> {
  const indexValue = value(arguments_, "index");
  const word = value(arguments_, "word");
  const unicode = value(arguments_, "unicode");
  const guide = arguments_["recovery-guide"] === true;
  const directory = value(arguments_, "word-lists-dir");
  const selections = [
    indexValue,
    word,
    unicode,
    arguments_.all === true ? true : undefined,
    guide ? true : undefined,
    directory,
  ];
  if (selections.filter((item) => item !== undefined).length !== 1) {
    throw ERRORS.create("choose-exactly-one-lookup-value-word-index-bip39", []);
  }
  const output = value(arguments_, "output");
  const format = choiceOption(arguments_, "table-format", WORD_TABLE_FORMATS);
  if (
    (arguments_.all !== true && format !== undefined) ||
    (arguments_.all !== true && !guide && output !== undefined)
  )
    throw ERRORS.create("export-needs-all", []);
  if (directory !== undefined) return saveFullSet(directory);
  if (arguments_.all === true || guide) {
    const text = guide
      ? new TextDecoder().decode(await readBundledFile(MANUAL_RECOVERY_FILE))
      : WordTable.text(format);
    if (output === undefined) {
      // The recovery guide is a document with a heading of its own.
      if (!guide) wordTableHeading(format);
      process.stdout.write(text);
    } else {
      await writeSaved(() => publishNewPrivateFile(output, Buffer.from(text, "utf8")));
      terminalSaved(
        `Saved ${guide ? "manual recovery instructions" : "numbered BIP39 word list"}: ${printableText(output)}`,
      );
    }
    return;
  }
  // A number is read as every whole-number option is (arguments.ts); the row from the table.
  if (indexValue !== undefined)
    return printRow(WordTable.row(integerOption(arguments_, "index", WORD_NUMBER_RANGE)));
  printRow(
    word !== undefined
      ? WordTable.lookup("word", word)
      : WordTable.lookup("unicode", defined(unicode)),
  );
}
