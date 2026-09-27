import { terminalNotice, terminalResultHeader } from './terminal.js';
import {
  decodeIndexes,
  decodeIndexesLegacy,
  decodeIndexesLegacyValid,
  expandDatePattern,
  formatDate,
  parseDate,
  parseDatePattern,
  parseInput,
  type DateShiftDate,
} from '../core.js';
import { matchBitcoinEvidence } from '../bitcoin-evidence.js';
import { parseRecord } from '../record.js';
import { type ParsedArguments, value, values } from './arguments.js';
import { bip39Passphrase, bitcoinEvidence } from './bitcoin-options.js';
import {
  encodedInput,
  promptedRecoveryInputs,
  recordedInputFormat,
  transformMode,
} from './input.js';

export async function runRecoverDate(arguments_: ParsedArguments): Promise<void> {
  const maxResults = Number(value(arguments_, 'max-results') ?? '100');
  const progressEvery = Number(value(arguments_, 'progress-every') ?? '1000');
  if (!Number.isSafeInteger(maxResults) || maxResults < 1)
    throw new Error('--max-results must be a positive integer.');
  if (!Number.isSafeInteger(progressEvery) || progressEvery < 1)
    throw new Error('--progress-every must be a positive integer.');
  const prompted = promptedRecoveryInputs(arguments_);
  const rawEncoded = prompted?.encoded ?? (await encodedInput(arguments_));
  const record = parseRecord(rawEncoded);
  if (record?.mode === 'direct') throw new Error('recover-date requires a Seedshift record.');
  const recoveryMode = transformMode(arguments_, record?.mode);
  if (recoveryMode === 'direct') throw new Error('recover-date requires a Seedshift mode.');
  const encoded = record?.payload ?? rawEncoded;
  const format = await recordedInputFormat(arguments_, encoded, record);
  const encryptedIndexes = parseInput(encoded, format);
  const dateValues = prompted?.dateValues ?? values(arguments_, 'date');
  if (dateValues.length === 0)
    throw new Error('Provide dates, including exactly one pattern with ? characters.');
  const patterns = dateValues.filter((item) => item.includes('?'));
  if (patterns.length !== 1)
    throw new Error(
      'Provide exactly one date with a missing day, month, or year, such as ??-07-1963.',
    );
  const candidates = expandDatePattern(parseDatePattern(patterns[0]!));
  const knownDates = dateValues.filter((item) => !item.includes('?')).map(parseDate);
  const evidence = bitcoinEvidence(arguments_);
  if (
    (recoveryMode === 'seedshift' || recoveryMode === 'seedshift-legacy-valid') &&
    evidence === undefined
  ) {
    throw new Error(
      'This recovery mode can produce checksum-valid candidates for every date. Supply --master-fingerprint, an address, a public key, an xpub, or a WIF to identify the intended wallet.',
    );
  }
  const passphrase = bip39Passphrase(arguments_);

  const found: { readonly date: string; readonly mnemonic: string; readonly evidence?: string }[] =
    [];
  for (let index = 0; index < candidates.length; index += 1) {
    const date = candidates[index]!;
    const results = recoverCandidates(encryptedIndexes, [...knownDates, date], recoveryMode);
    for (const result of results) {
      if (result.checksumValid) {
        const match =
          evidence === undefined
            ? undefined
            : matchBitcoinEvidence(result.recoveredMnemonic, evidence, passphrase);
        if (match === undefined || match.matched) {
          found.push({
            date: formatDate(date),
            mnemonic: result.recoveredMnemonic,
            evidence: match?.path,
          });
        }
      }
    }
    if ((index + 1) % progressEvery === 0 || index + 1 === candidates.length) {
      terminalNotice(
        `Checked ${index + 1}/${candidates.length} candidate dates; found ${found.length} matches.`,
      );
    }
  }
  terminalResultHeader('DATE RECOVERY', [
    ['Mode', recoveryMode],
    ['Matches', String(found.length)],
  ]);
  if (found.length === 0) {
    console.log('No candidate with a valid BIP39 checksum was found.');
    return;
  }
  for (const candidate of found.slice(0, maxResults)) {
    console.log(
      `${candidate.date}\t${candidate.mnemonic}${candidate.evidence === undefined ? '' : `\tmatched at ${candidate.evidence}`}`,
    );
  }
  if (found.length > maxResults)
    terminalNotice(`Displayed ${maxResults} of ${found.length} checksum-valid candidates.`);
  if (evidence === undefined)
    terminalNotice(
      'A checksum-valid candidate is not proof that its date is correct. Confirm it against independent wallet evidence.',
    );
  else terminalNotice(`Each displayed candidate matched the requested ${evidence.kind} locally.`);
}

function recoverCandidates(
  indexes: readonly number[],
  dates: readonly DateShiftDate[],
  mode: string,
) {
  if (mode === 'seedshift-legacy-valid') return decodeIndexesLegacyValid(indexes, dates);
  if (mode === 'seedshift-legacy') return [decodeIndexesLegacy(indexes, dates)];
  return [decodeIndexes(indexes, dates)];
}
