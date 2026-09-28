import {
  bitcoinProfiles,
  type BitcoinEvidence,
  type BitcoinNetworkName,
  type BitcoinProfile,
  type DerivationLocation,
} from '../bitcoin-evidence.js';
import { integerOption, type ParsedArguments, value } from './arguments.js';
import { readBoundedTextFile } from './input.js';

function bitcoinProfilesFrom(arguments_: ParsedArguments): readonly BitcoinProfile[] {
  const requested = value(arguments_, 'bitcoin-profile') ?? 'auto';
  if (requested === 'auto') return bitcoinProfiles;
  const profiles = requested.split(',').map((item) => item.trim()) as BitcoinProfile[];
  if (profiles.length === 0 || profiles.some((profile) => !bitcoinProfiles.includes(profile))) {
    throw new Error(
      `The Bitcoin address profile must be auto or a comma-separated list of: ${bitcoinProfiles.join(', ')}.`,
    );
  }
  return profiles;
}

function bitcoinNetwork(arguments_: ParsedArguments): BitcoinNetworkName {
  const network = value(arguments_, 'network') ?? 'mainnet';
  if (network !== 'mainnet' && network !== 'testnet')
    throw new Error('The Bitcoin network must be mainnet or testnet.');
  return network;
}

export function bitcoinEvidence(arguments_: ParsedArguments): BitcoinEvidence | undefined {
  const items: readonly [BitcoinEvidence['kind'], string | undefined][] = [
    ['address', value(arguments_, 'bitcoin-address')],
    ['master-xpub', value(arguments_, 'master-xpub')],
    ['account-xpub', value(arguments_, 'account-xpub')],
    ['compressed-public-key', value(arguments_, 'compressed-public-key')],
    ['master-fingerprint', value(arguments_, 'master-fingerprint')],
    ['wif', value(arguments_, 'wif-file')],
  ];
  const supplied = items.filter(([, item]) => item !== undefined);
  if (supplied.length === 0) return undefined;
  if (supplied.length !== 1)
    throw new Error('Select exactly one Bitcoin recovery-evidence option.');
  const [kind, rawValue] = supplied[0]!;
  const value_ =
    kind === 'wif' ? readBoundedTextFile(rawValue!, 'The WIF file').trim() : rawValue!.trim();
  const network = bitcoinNetwork(arguments_);
  if (kind === 'master-xpub' || kind === 'master-fingerprint')
    return { kind, value: value_, network };
  const location: DerivationLocation = {
    network,
    account: integerOption(arguments_, 'account', {
      defaultValue: 0,
      min: 0,
      max: 0x7fffffff,
    }),
    branch: integerOption(arguments_, 'branch', {
      defaultValue: 0,
      min: 0,
      max: 0x7fffffff,
    }),
    index: integerOption(arguments_, 'index', {
      defaultValue: 0,
      min: 0,
      max: 0x7fffffff,
    }),
  };
  return {
    kind,
    value: value_,
    profiles: bitcoinProfilesFrom(arguments_),
    location,
  } as BitcoinEvidence;
}

export function bip39Passphrase(arguments_: ParsedArguments): string {
  const path = value(arguments_, 'bip39-passphrase-file');
  return path === undefined
    ? ''
    : readBoundedTextFile(path, 'The BIP39 passphrase file').replace(/\r?\n$/, '');
}
