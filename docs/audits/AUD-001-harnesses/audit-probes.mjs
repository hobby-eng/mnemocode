import { readFile, writeFile, mkdir } from 'node:fs/promises';
import assert from 'node:assert/strict';
import * as core from './dist/core.js';
import { serializeRecord, parseRecord } from './dist/record.js';
import { entropyToMnemonic } from '@scure/bip39';
import { wordlist } from '@scure/bip39/wordlists/english.js';
import { splitSskrMnemonic, combineSskrShares, validateThreshold } from './dist/sskr/shares.js';
import { sskrEngine } from './dist/sskr/runtime.js';
import { shareToColors, colorsToShare } from './dist/sskr/transport.js';
import { cardTemplates } from './dist/export/templates.js';
import { PDFDocument } from 'pdf-lib';
const log = (name, result) => console.log(JSON.stringify({ name, result }));
const mnemonic = `${'abandon '.repeat(11)}about`;
const result = core.representMnemonic(mnemonic);
for (const [name, fn] of [
  ['unknown parseInput format', () => core.parseInput('public input', 'not-a-format')],
  ['unknown formatEncoded format', () => core.formatEncoded(result, 'not-a-format')],
  ['unknown record mode', () => serializeRecord('mistyped', 'english', mnemonic)],
  ['unknown record format', () => serializeRecord('direct', 'mistyped', mnemonic)],
  ['invalid maximumDates word count', () => core.maximumDates(13)],
  ['invalid deriveShifts word count', () => core.deriveShifts([core.parseDate('01-01-2000')], 13)],
]) {
  try {
    const value = fn();
    log(name, { accepted: true, value: value ?? '<undefined>' });
  } catch (error) {
    log(name, { accepted: false, error: error.message });
  }
}
let thresholds = 0,
  quorums = 0;
for (let total = 2; total <= 16; total++)
  for (let threshold = 2; threshold <= total; threshold++) {
    const shares = await splitSskrMnemonic(mnemonic, threshold, total);
    for (const subset of [shares.slice(0, threshold), shares.slice(-threshold)]) {
      assert.equal(await combineSskrShares(subset), mnemonic);
      quorums++;
    }
    await assert.rejects(combineSskrShares(shares.slice(0, threshold - 1)));
    thresholds++;
  }
log('SSKR supported threshold matrix', {
  settings: thresholds,
  validQuorums: quorums,
  insufficientQuorums: thresholds,
});
let invalid = 0;
for (const pair of [
  [1, 3],
  [0, 3],
  [-1, 3],
  [2, 1],
  [2, 17],
  [2.5, 3],
  [2, 3.5],
  [NaN, 3],
  [2, Infinity],
  [2, '3'],
]) {
  assert.throws(() => validateThreshold(...pair));
  invalid++;
}
log('SSKR invalid threshold/count', invalid);
const engine = await sskrEngine();
let rngInvalid = 0;
for (const count of [0, 1, 31, 33, 64]) {
  assert.throws(() =>
    engine.create_sskr_shares(new Uint8Array(16), 1, Uint8Array.of(2, 3), new Uint8Array(count)),
  );
  rngInvalid++;
}
log('WASM wrong RNG seed lengths rejected', rngInvalid);
let roundTrips = 0;
for (const length of [16, 20, 24, 28, 32])
  for (const pattern of [0, 255, 170, 85]) {
    const phrase = entropyToMnemonic(new Uint8Array(length).fill(pattern), wordlist);
    const dates = ['01-01-0001', '31-12-9999', '29-02-2000'].map(core.parseDate);
    for (const mode of ['direct', 'seedshift', 'legacy']) {
      const encoded =
        mode === 'direct'
          ? core.representMnemonic(phrase)
          : mode === 'legacy'
            ? core.encodeMnemonicLegacy(phrase, dates)
            : core.encodeMnemonic(phrase, dates);
      for (const format of ['english', 'indexes', 'unicode', 'colors', 'colors-unicode']) {
        const payload = core.formatEncoded(encoded, format);
        const decoded =
          mode === 'direct'
            ? core.decodeInputDirect(payload, format)
            : mode === 'legacy'
              ? core.decodeInputLegacy(payload, format, dates)
              : core.decodeInput(payload, format, dates);
        assert.equal(decoded.recoveredMnemonic, phrase);
        roundTrips++;
      }
    }
  }
log('all-zero/all-high/alternating entropy', roundTrips);
