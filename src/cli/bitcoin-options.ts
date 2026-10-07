import {
  bitcoinProfiles,
  coinById,
  defaultAddressCount,
  MAX_ADDRESS_COUNT,
  type BitcoinNetworkName,
  type BitcoinProfile,
  type DerivationLocation,
  type WalletEvidence,
} from "../bitcoin-evidence.js";
import { integerOption, type ParsedArguments, value } from "./arguments.js";
import { readBoundedTextFile } from "./input.js";

function bitcoinProfilesFrom(arguments_: ParsedArguments): readonly BitcoinProfile[] {
  const requested = value(arguments_, "bitcoin-profile") ?? "auto";
  if (requested === "auto") return bitcoinProfiles;
  const profiles = requested.split(",").map((item) => item.trim()) as BitcoinProfile[];
  if (profiles.length === 0 || profiles.some((profile) => !bitcoinProfiles.includes(profile))) {
    throw new Error(
      `The Bitcoin address profile must be auto or a comma-separated list of: ${bitcoinProfiles.join(", ")}.`,
    );
  }
  return profiles;
}

function bitcoinNetwork(arguments_: ParsedArguments): BitcoinNetworkName {
  const network = value(arguments_, "network") ?? "mainnet";
  if (network !== "mainnet" && network !== "testnet")
    throw new Error("The Bitcoin network must be mainnet or testnet.");
  return network;
}

/** The account, branch and index of an address or a key, by --account, --branch and --index. */
function placeOf(arguments_: ParsedArguments): Omit<DerivationLocation, "network"> {
  const bip32Index = (name: string) =>
    integerOption(arguments_, name, { defaultValue: 0, min: 0, max: 0x7fffffff });
  return {
    account: bip32Index("account"),
    branch: bip32Index("branch"),
    index: bip32Index("index"),
  };
}

/**
 * How many addresses an address, a public key or a WIF is compared with, from --index on, as
 * --scan-gap says; undefined without it.
 */
export function addressCount(arguments_: ParsedArguments): number | undefined {
  if (value(arguments_, "scan-gap") === undefined) return undefined;
  return integerOption(arguments_, "scan-gap", { min: 1, max: MAX_ADDRESS_COUNT });
}

/** The evidence kinds that name one key among several addresses in a row. */
const COUNTED_KINDS: ReadonlySet<WalletEvidence["kind"]> = new Set([
  "address",
  "coin-address",
  "compressed-public-key",
  "wif",
]);

/**
 * The wallet evidence that the options give: one of the Bitcoin kinds, or an address of another
 * coin (--coin-address with --coin); none without one. The coin's own address tells its network
 * and type, so --network and --bitcoin-profile are refused beside it. An address, a public key or
 * a WIF is compared with the first 20 addresses from --index on, or as many as --scan-gap says.
 */
export function walletEvidence(arguments_: ParsedArguments): WalletEvidence | undefined {
  const items: readonly [WalletEvidence["kind"], string | undefined][] = [
    ["address", value(arguments_, "bitcoin-address")],
    ["coin-address", value(arguments_, "coin-address")],
    ["master-xpub", value(arguments_, "master-xpub")],
    ["account-xpub", value(arguments_, "account-xpub")],
    ["compressed-public-key", value(arguments_, "compressed-public-key")],
    ["master-fingerprint", value(arguments_, "master-fingerprint")],
    ["wif", value(arguments_, "wif-file")],
  ];
  const supplied = items.filter(([, item]) => item !== undefined);
  const coin = value(arguments_, "coin");
  if (coin !== undefined && value(arguments_, "coin-address") === undefined)
    throw new Error("--coin names the coin of --coin-address.");
  if (supplied.length === 0) return undefined;
  if (supplied.length !== 1) throw new Error("Select exactly one recovery-evidence option.");
  const [kind, rawValue] = supplied[0]!;
  const counted = addressCount(arguments_);
  if (counted !== undefined && !COUNTED_KINDS.has(kind))
    throw new Error(
      "--scan-gap applies to an address, a compressed public key or a WIF, one of several in a row.",
    );
  const place = placeOf(arguments_);
  const addresses = counted ?? defaultAddressCount(place.index);
  if (kind === "coin-address") {
    if (coin === undefined)
      throw new Error("--coin-address needs --coin, such as --coin ethereum.");
    for (const bitcoinOnly of ["network", "bitcoin-profile"])
      if (value(arguments_, bitcoinOnly) !== undefined)
        throw new Error(
          `--${bitcoinOnly} is for Bitcoin evidence; the coin's address tells its own.`,
        );
    return {
      kind,
      coin: coinById(coin).id,
      value: rawValue!.trim(),
      location: place,
      addresses,
    };
  }
  const value_ =
    kind === "wif" ? readBoundedTextFile(rawValue!, "The WIF file").trim() : rawValue!.trim();
  const network = bitcoinNetwork(arguments_);
  if (kind === "master-xpub" || kind === "master-fingerprint") {
    // The master key has no place in an account: these would be ignored, so they are refused.
    const placing = ["account", "branch", "index", "bitcoin-profile"].find(
      (key) => value(arguments_, key) !== undefined,
    );
    if (placing !== undefined)
      throw new Error(`--${placing} places an address, a key or a WIF; a master key has no place.`);
    return { kind, value: value_, network };
  }
  const location: DerivationLocation = { network, ...place };
  return {
    kind,
    value: value_,
    profiles: bitcoinProfilesFrom(arguments_),
    location,
    ...(kind === "account-xpub" ? {} : { addresses }),
  } as WalletEvidence;
}

export function bip39Passphrase(arguments_: ParsedArguments): string {
  const path = value(arguments_, "bip39-passphrase-file");
  return path === undefined
    ? ""
    : readBoundedTextFile(path, "The BIP39 passphrase file").replace(/\r?\n$/, "");
}
