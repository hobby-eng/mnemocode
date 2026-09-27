import { recoverLegacyValidLastWords, recoverMissingWord } from '../core.js';
import { matchBitcoinEvidence } from '../bitcoin-evidence.js';
import { type ParsedArguments, value } from './arguments.js';
import { bip39Passphrase, bitcoinEvidence } from './bitcoin-options.js';
import { askSecret, textInput } from './input.js';
import { terminalNotice, terminalResultHeader } from './terminal.js';

export function runRecoverWord(arguments_: ParsedArguments): void {
  const recoverLegacyReplacement = arguments_['legacy-valid-last-word'] === true;
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
    mnemonic = askSecret(
      recoverLegacyReplacement
        ? 'Exact legacy Seedshift phrase with its old final word:'
        : 'BIP39 mnemonic with ? for the forgotten word:',
    );
  } else {
    mnemonic = textInput(arguments_, 'mnemonic');
  }

  const candidates = recoverLegacyReplacement
    ? recoverLegacyValidLastWords(mnemonic)
    : recoverMissingWord(mnemonic);
  if (candidates.length === 0) {
    terminalResultHeader('MISSING WORD RECOVERY', [['Checksum-valid candidates', '0']]);
    terminalNotice(
      'No checksum-valid BIP39 phrase matches the supplied known words. Check the other words, their order, and the placeholder position.',
      'warning',
    );
    return;
  }
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
  if (recoverLegacyReplacement) {
    headerRows.unshift(['Mode', 'Legacy final-word replacement']);
    headerRows.push([
      'Entropy-preserving replacement',
      candidates.find((candidate) => candidate.preservesLegacyEntropy)?.word ?? 'unavailable',
    ]);
  }
  if (evidence !== undefined) headerRows.push(['Evidence matches', String(matched)]);
  terminalResultHeader('MISSING WORD RECOVERY', headerRows);
  console.log(
    [
      'candidate',
      'word',
      'word-index',
      'checksum-bits',
      ...(recoverLegacyReplacement ? ['legacy-tail'] : []),
      ...(evidence === undefined ? [] : ['evidence']),
      'mnemonic',
    ].join('\t'),
  );
  for (const [index, { candidate, match }] of results.entries()) {
    const fields = [
      String(index + 1),
      candidate.word,
      String(candidate.wordIndex),
      candidate.checksumBits,
    ];
    if (recoverLegacyReplacement) {
      fields.push(candidate.preservesLegacyEntropy ? 'preserved' : 'alternative');
    }
    if (match !== undefined) {
      fields.push(
        match.matched ? `matched at ${match.path ?? 'requested evidence'}` : 'not matched',
      );
    }
    fields.push(candidate.mnemonic);
    console.log(fields.join('\t'));
  }

  terminalNotice(
    recoverLegacyReplacement
      ? `Displayed every checksum-valid final-word replacement for the exact legacy phrase. The row marked preserved retains the entropy-bearing bits of the supplied old final word.`
      : `Displayed every checksum-valid replacement after checking all 2048 English BIP39 words. The checksum column contains the mnemonic's BIP39 checksum bits.`,
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
  if (recoverLegacyReplacement && evidence !== undefined) {
    terminalNotice(
      'Evidence was compared with the checksum-valid replacement containers, not with original phrases recovered after reversing legacy Seedshift.',
      'warning',
    );
  }
}
