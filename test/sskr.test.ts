import { describe, expect, it } from 'vitest';
import { entropyToMnemonic } from '@scure/bip39';
import { wordlist } from '@scure/bip39/wordlists/english.js';
import { splitSskrMnemonic, combineSskrShares } from '../src/sskr/shares.js';
import {
  colorsToShare,
  normalizeShare,
  shareToColors,
  validateShareSet,
} from '../src/sskr/transport.js';
import { sskrVector } from '../src/sskr/self-test.js';
import { encodeMnemonic, decodeInput, parseDate } from '../src/core.js';

describe('Standalone SSKR', () => {
  it.each([16, 20, 24, 28, 32])(
    'recovers every pair of a 2-of-3 set for %i-byte entropy',
    async (length) => {
      const source = entropyToMnemonic(new Uint8Array(length), wordlist);
      const shares = await splitSskrMnemonic(source, 2, 3);
      for (const [a, b] of [
        [0, 1],
        [0, 2],
        [1, 2],
      ]) {
        expect(await combineSskrShares([shares[a]!, shares[b]!])).toBe(source);
      }
      for (const share of shares) {
        await expect(combineSskrShares([share])).rejects.toThrow(/threshold/u);
        const colors = shareToColors(share);
        expect(colorsToShare(colors.join(' '))).toBe(share);
        expect(colorsToShare(colors.join(''))).toBe(share);
        expect(colorsToShare(colors.map((code) => code.slice(1)).join(''))).toBe(share);
      }
    },
  );

  it('recovers the independent official grouped vector', async () => {
    const expected = entropyToMnemonic(
      Uint8Array.from(sskrVector.entropy.match(/../gu)!, (byte) => parseInt(byte, 16)),
      wordlist,
    );
    expect(await combineSskrShares(sskrVector.shares)).toBe(expected);
    expect(
      normalizeShare(
        'tuna next keep gyro gear runs body acid able film nail barn cost aqua epic veto quad fern jump buzz epic slot frog apex taxi grim fern twin leaf',
      ),
    ).toBe(sskrVector.shares[0]);
  });

  it('rejects duplicate, mixed, corrupted, truncated and reordered records', async () => {
    const source = entropyToMnemonic(new Uint8Array(16), wordlist);
    const a = await splitSskrMnemonic(source, 2, 3);
    const b = await splitSskrMnemonic(source, 2, 3);
    await expect(combineSskrShares([a[0]!, a[0]!])).rejects.toThrow(/more than once/u);
    await expect(combineSskrShares([a[0]!, b[1]!])).rejects.toThrow();
    const colors = shareToColors(a[0]!);
    expect(() => colorsToShare(colors.slice(1).join(' '))).toThrow();
    expect(() => colorsToShare([...colors].reverse().join(' '))).toThrow();
    const changed = [...colors];
    changed[2] = changed[2] === '#FFFFFF' ? '#000000' : '#FFFFFF';
    expect(() => colorsToShare(changed.join(' '))).toThrow();
    expect(() => validateShareSet(a.slice(0, 1), false)).not.toThrow();
  });

  it.each([
    [1, 3],
    [3, 2],
    [2, 17],
    [2.5, 3],
    [NaN, 3],
  ])('rejects threshold %s / count %s', async (threshold, count) => {
    await expect(
      splitSskrMnemonic('abandon '.repeat(11) + 'about', threshold, count),
    ).rejects.toThrow();
  });

  it('rejects an invalid BIP39 source and restores a date-shifted source in two stages', async () => {
    await expect(splitSskrMnemonic('abandon '.repeat(12), 2, 3)).rejects.toThrow(/checksum/u);
    const source = 'abandon '.repeat(11) + 'about';
    const dates = [parseDate('23-09-2026')];
    const shifted = encodeMnemonic(source, dates).shiftedEnglish.join(' ');
    const shares = await splitSskrMnemonic(shifted, 2, 3);
    const restored = await combineSskrShares(shares.slice(0, 2));
    expect(decodeInput(restored, 'english', dates).recoveredMnemonic).toBe(source);
  });
});
