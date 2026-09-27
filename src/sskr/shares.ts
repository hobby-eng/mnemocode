import { entropyToMnemonic, mnemonicToEntropy } from '@scure/bip39';
import { wordlist } from '@scure/bip39/wordlists/english.js';
import { representMnemonic } from '../core.js';
import { secureSeed, sskrEngine } from './runtime.js';
import { normalizeShare, validateShareSet } from './transport.js';
import { assertSskrSelfTest } from './self-test.js';

export function validateThreshold(threshold: number, count: number): void {
  if (
    !Number.isSafeInteger(threshold) ||
    !Number.isSafeInteger(count) ||
    threshold < 2 ||
    count < threshold ||
    count > 16
  )
    throw new Error('SSKR requires 2 <= threshold <= shares <= 16.');
}

export async function splitSskrMnemonic(
  mnemonic: string,
  threshold: number,
  count: number,
): Promise<string[]> {
  validateThreshold(threshold, count);
  await assertSskrSelfTest();
  const normalized = representMnemonic(mnemonic).sourceMnemonic;
  const engine = await sskrEngine();
  const entropy = mnemonicToEntropy(normalized, wordlist);
  let random: Uint8Array | undefined;
  try {
    random = secureSeed();
    const records = engine
      .create_sskr_shares(entropy, 1, Uint8Array.of(threshold, count), random)
      .trim()
      .split('\n');
    if (records.length !== count)
      throw new Error('SSKR engine returned an unexpected share count.');
    const validated = validateShareSet(records);
    const restored = engine.recover_sskr_shares(validated.slice(0, threshold).join('\n'));
    try {
      if (
        restored.length !== entropy.length ||
        restored.some((byte, index) => byte !== entropy[index])
      )
        throw new Error('SSKR generated shares did not reconstruct the source entropy.');
    } finally {
      restored.fill(0);
    }
    return validated;
  } finally {
    entropy.fill(0);
    random?.fill(0);
  }
}

export async function combineSskrShares(records: readonly string[]): Promise<string> {
  await assertSskrSelfTest();
  const normalized = validateShareSet(records);
  const engine = await sskrEngine();
  const entropy = engine.recover_sskr_shares(normalized.join('\n'));
  try {
    if (![16, 20, 24, 28, 32].includes(entropy.length))
      throw new Error('Recovered SSKR secret is not BIP39 entropy.');
    return entropyToMnemonic(entropy, wordlist);
  } finally {
    entropy.fill(0);
  }
}

export { normalizeShare };
