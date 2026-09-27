import { terminalResultHeader } from './terminal.js';
import { allMappingRows, mappingRow } from '../core.js';
import { integerOption, type ParsedArguments, value } from './arguments.js';

function printRow(row: ReturnType<typeof mappingRow>): void {
  terminalResultHeader('WORD MAPPING', []);
  console.log(`index:       ${row.index}`);
  console.log(`english:     ${row.english}`);
  console.log(`unicode hex: ${row.unicodeHex}`);
}

export function runTable(arguments_: ParsedArguments): void {
  if (arguments_.all === true) {
    console.log('index\tenglish\tunicode_hex');
    for (const row of allMappingRows())
      console.log(`${row.index}\t${row.english}\t${row.unicodeHex}`);
    return;
  }
  const indexValue = value(arguments_, 'index');
  const word = value(arguments_, 'word');
  const unicode = value(arguments_, 'unicode');
  if ([indexValue, word, unicode].filter((item) => item !== undefined).length !== 1) {
    throw new Error(
      'Provide exactly one of --index, --word, or --unicode; use --all for the full table.',
    );
  }
  if (indexValue !== undefined)
    return printRow(mappingRow(integerOption(arguments_, 'index', { min: 0, max: 2047 })));
  const row = allMappingRows().find(
    (item) => item.english === word || item.unicodeHex === unicode?.toUpperCase(),
  );
  if (row === undefined) throw new Error('No matching BIP39 mapping entry was found.');
  printRow(row);
}
