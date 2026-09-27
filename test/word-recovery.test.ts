import { entropyToMnemonic } from '@scure/bip39';
import { wordlist } from '@scure/bip39/wordlists/english.js';
import { describe, expect, it } from 'vitest';
import { recoverLegacyValidLastWords, recoverMissingWord } from '../src/core.js';

const zeroMnemonic =
  'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about';

describe('forgotten BIP39 word recovery', () => {
  it.each([
    [16, 128],
    [20, 64],
    [24, 32],
    [28, 16],
    [32, 8],
  ])('returns every checksum-valid replacement for %i entropy bytes', (entropyLength, count) => {
    const mnemonic = entropyToMnemonic(new Uint8Array(entropyLength), wordlist);
    const words = mnemonic.split(' ');
    words[4] = '?';
    const candidates = recoverMissingWord(words.join(' '));

    expect(candidates).toHaveLength(count);
    expect(candidates.map((candidate) => candidate.mnemonic)).toContain(mnemonic);
    expect(candidates.every((candidate) => candidate.position === 5)).toBe(true);
    expect(
      candidates.every((candidate) => candidate.checksumBits.length === words.length / 3),
    ).toBe(true);
  });

  it('reports the word index and exact checksum bits for the public zero vector', () => {
    const candidates = recoverMissingWord(zeroMnemonic.replace(/about$/u, '?'));
    expect(candidates).toHaveLength(128);
    expect(candidates).toContainEqual({
      position: 12,
      word: 'about',
      wordIndex: 4,
      mnemonic: zeroMnemonic,
      checksumBits: '0011',
    });
  });

  it('enumerates valid legacy final-word replacements and marks the entropy-preserving one', () => {
    const legacy =
      'mosquito dust hotel maximum rich kitten hair mother salute dream flush hospital';
    const prefix = legacy.split(' ').slice(0, -1).join(' ');
    const candidates = recoverLegacyValidLastWords(legacy);
    expect(candidates).toHaveLength(128);
    expect(candidates.every((candidate) => candidate.position === 12)).toBe(true);
    expect(candidates.filter((candidate) => candidate.preservesLegacyEntropy)).toHaveLength(1);
    expect(
      candidates.every(
        (candidate) => candidate.mnemonic.split(' ').slice(0, -1).join(' ') === prefix,
      ),
    ).toBe(true);
  });

  it('requires exactly one placeholder and rejects unknown known words', () => {
    expect(() => recoverMissingWord(zeroMnemonic)).toThrow(/exactly one/u);
    expect(() => recoverMissingWord(zeroMnemonic.replaceAll('abandon', '?'))).toThrow(
      /exactly one/u,
    );
    expect(() =>
      recoverMissingWord(zeroMnemonic.replace('abandon', 'notaword').replace('about', '?')),
    ).toThrow(/position 1/u);
  });
});
