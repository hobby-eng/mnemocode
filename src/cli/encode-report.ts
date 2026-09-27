import { masterFingerprint } from '../bitcoin-evidence.js';
import { terminalColor, terminalPaint, terminalResultHeader, terminalStatus } from './terminal.js';
import { encodedOutputLabel } from './input.js';
import type { EncodeOutcome } from './encode-command.js';

/** Reporting is separate from transformation and file side effects. */
export function printEncodeResult(outcome: EncodeOutcome): void {
  const {
    mode,
    recordMode,
    format,
    encoded,
    result,
    baseResult,
    legacyAlternative,
    legacyChanged,
    useLegacyValid,
  } = outcome;
  const displayedLabel = encodedOutputLabel(format, mode);
  if (
    !terminalResultHeader('ENCODED RESULT', [
      ['Mode', recordMode],
      ['Format', format],
      ['Content', displayedLabel],
    ])
  ) {
    console.log(`${displayedLabel}:`);
  }
  console.log(encoded);
  if (terminalColor('stderr')) {
    console.error('');
    terminalStatus('✓', 'Original fingerprint', masterFingerprint(result.sourceMnemonic));
    if (mode === 'seedshift-legacy' && !useLegacyValid) {
      terminalStatus(
        '!',
        'Encoded fingerprint',
        'unavailable: legacy output may have an invalid checksum',
        '33',
      );
    } else {
      terminalStatus(
        '✓',
        'Encoded fingerprint',
        masterFingerprint(result.shiftedEnglish.join(' ')),
      );
    }
    console.error(
      terminalPaint('stderr', '2', '  BIP32 fingerprints above use an empty BIP39 passphrase.'),
    );
  } else {
    console.error(
      `Original BIP32 master fingerprint (empty BIP39 passphrase): ${masterFingerprint(result.sourceMnemonic)}`,
    );
    if (mode === 'seedshift-legacy' && !useLegacyValid) {
      console.error(
        'Encoded BIP32 master fingerprint: unavailable because legacy Seedshift output may have an invalid BIP39 checksum.',
      );
    } else {
      console.error(
        `Encoded BIP32 master fingerprint (empty BIP39 passphrase): ${masterFingerprint(result.shiftedEnglish.join(' '))}`,
      );
    }
  }

  if (mode === 'seedshift-legacy') {
    if (!legacyChanged) {
      console.error(
        'Legacy shifted phrase already has a valid BIP39 checksum; no final-word replacement is needed.',
      );
    } else if (!useLegacyValid) {
      console.error(
        `Optional checksum-valid final word: ${legacyAlternative!.shiftedEnglish.at(-1)}`,
      );
      console.error(
        `Optional checksum-valid legacy phrase: ${legacyAlternative!.shiftedEnglish.join(' ')}`,
      );
      console.error(
        'Using that replacement discards the original shifted final word. Run the command again with --legacy-valid-last-word to record this replacement for recovery. Decoding that record lists possible original phrases.',
      );
    } else {
      console.error(
        `Replaced legacy final word ${baseResult.shiftedEnglish.at(-1)} with checksum-valid word ${result.shiftedEnglish.at(-1)}.`,
      );
      console.error(
        'The original shifted final word is not stored. Recovery must enumerate candidates and use a fingerprint or other wallet evidence to select the original.',
      );
    }
  }
}
