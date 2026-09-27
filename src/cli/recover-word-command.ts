import { recoverMissingWord } from '../core.js';
import { matchBitcoinEvidence } from '../bitcoin-evidence.js';
import { type ParsedArguments, value } from './arguments.js';
import { bip39Passphrase, bitcoinEvidence } from './bitcoin-options.js';
import { askSecret, textInput } from './input.js';
import { terminalNotice, terminalResultHeader } from './terminal.js';

export function runRecoverWord(arguments_: ParsedArguments): void {
  let mnemonic: string;
  if (arguments_['ask-secrets'] === true) {
    if (
      value(arguments_, 'mnemonic') !== undefined ||
      value(arguments_, 'mnemonic-file') !== undefined
    ) {
      throw new Error(
        'Hidden input cannot be combined with direct mnemonic text or a mnemonic file.',
      );
    }
    mnemonic = askSecret('BIP39 mnemonic with ? for the forgotten word:');
  } else {
    mnemonic = textInput(arguments_, 'mnemonic');
  }

  const candidates = recoverMissingWord(mnemonic);
  const evidence = bitcoinEvidence(arguments_);
  const passphrase = bip39Passphrase(arguments_);
  const results = candidates.map((candidate) => {
    const match =
      evidence === undefined
        ? undefined
        : matchBitcoinEvidence(candidate.mnemonic, evidence, passphrase);
    return { candidate, match };
  });
  const matched = results.filter(({ match }) => match?.matched === true).length;

  const headerRows: [string, string][] = [
    ['Position', String(candidates[0]!.position)],
    ['Checksum-valid candidates', String(candidates.length)],
  ];
  if (evidence !== undefined) headerRows.push(['Evidence matches', String(matched)]);
  terminalResultHeader('MISSING WORD RECOVERY', headerRows);
  console.log(
    evidence === undefined
      ? 'candidate\tword\tword-index\tchecksum-bits\tmnemonic'
      : 'candidate\tword\tword-index\tchecksum-bits\tevidence\tmnemonic',
  );
  for (const [index, { candidate, match }] of results.entries()) {
    const fields = [
      String(index + 1),
      candidate.word,
      String(candidate.wordIndex),
      candidate.checksumBits,
    ];
    if (match !== undefined) {
      fields.push(match.matched ? `matched at ${match.path ?? 'requested evidence'}` : 'not matched');
    }
    fields.push(candidate.mnemonic);
    console.log(fields.join('\t'));
  }

  terminalNotice(
    `Displayed every checksum-valid replacement after checking all 2048 English BIP39 words. The checksum column contains the mnemonic's BIP39 checksum bits.`,
  );
  if (evidence === undefined) {
    terminalNotice(
      'A valid BIP39 checksum does not identify the intended wallet. Confirm the result against independent wallet evidence.',
      'warning',
    );
  } else {
    terminalNotice(
      `Matched ${matched} of ${candidates.length} candidates against the requested ${evidence.kind} locally.`,
      matched === 0 ? 'warning' : 'success',
    );
    const warning = results.find(({ match }) => match?.warning !== undefined)?.match?.warning;
    if (warning !== undefined) terminalNotice(warning, 'warning');
  }
}
