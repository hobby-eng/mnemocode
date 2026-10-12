import { terminalResultHeader } from "./terminal.js";
import { mappingRow, wordTableRow, wordTableText } from "../core/words.js";
import { WORD_NUMBER_RANGE } from "../core/bip39-sizes.js";
import { integerOption, type ParsedArguments, value } from "./arguments.js";

function printRow(row: ReturnType<typeof mappingRow>): void {
  terminalResultHeader("Word mapping", []);
  console.log(`index:       ${row.index}`);
  console.log(`english:     ${row.english}`);
  console.log(`unicode hex: ${row.unicodeHex}`);
}

export function runTable(arguments_: ParsedArguments): void {
  if (arguments_.all === true) {
    process.stdout.write(wordTableText());
    return;
  }
  const indexValue = value(arguments_, "index");
  const word = value(arguments_, "word");
  const unicode = value(arguments_, "unicode");
  if ([indexValue, word, unicode].filter((item) => item !== undefined).length !== 1) {
    throw new Error(
      "Choose exactly one lookup value: a word index, a BIP39 word, or a Unicode value. Request the full table instead when no lookup is needed.",
    );
  }
  // A number is read as every whole-number option is (arguments.ts); the row from the table.
  if (indexValue !== undefined)
    return printRow(mappingRow(integerOption(arguments_, "index", WORD_NUMBER_RANGE)));
  printRow(word !== undefined ? wordTableRow("word", word) : wordTableRow("unicode", unicode!));
}
