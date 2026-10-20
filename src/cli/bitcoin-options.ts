import {
  type BitcoinNetworkName,
  type BitcoinProfile,
  bitcoinProfiles,
  checkedBitcoinProfiles,
  coinById,
  defaultAddressCount,
  type DerivationLocation,
  isBitcoinNetwork,
  isPlacedKind,
  isScannedKind,
  type WalletEvidence,
  assertWalletEvidence,
} from "../bitcoin-evidence.js";
import { NORMAL_INDEX_RANGE } from "../core/bip32-limits.js";
import { integerOption, type ParsedArguments, value } from "./arguments.js";
import { readBoundedTextFile } from "./text-file.js";
import { ADDRESS_COUNT_RANGE } from "../core/address-scan.js";
import {
  BITCOIN_NETWORKS,
  BITCOIN_NETWORKS_TEXT,
  FIRST_RECEIVING_LOCATION,
  isScannedEvidence,
} from "../core/wallet-evidence.js";
import { withoutByteOrderMark } from "../core/white-space.js";
import { defined } from "../core/defined.js";
import { ErrorCatalog } from "../core/error-catalog.js";

const ERRORS = new ErrorCatalog("cli.bitcoin-options", {
  "bitcoin-address-profile-auto-comma-separated-list": (value0: string) =>
    `The Bitcoin address profile must be auto or a comma-separated list of: ${value0}.`,
  "bitcoin-network": (value0: string) => `The Bitcoin network must be ${value0}.`,
  "wif-given-file-never-on-command-line": () =>
    "A WIF is given in a file, never on a command line.",
  "coin-names-coin-coin-address": () => "--coin names the coin of --coin-address.",
  "select-exactly-one-recovery-evidence-option": () =>
    "Select exactly one recovery-evidence option.",
  "scan-gap-applies-address-compressed-public-key-wif": () =>
    "--scan-gap applies to an address, a compressed public key or a WIF, one of several in a row.",
  "coin-address-coin-such-as-coin-ethereum": () =>
    "--coin-address needs --coin, such as --coin ethereum.",
  "bitcoin-evidence-coin-s-address-tells-own": (value0: string) =>
    `--${value0} is for Bitcoin evidence; the coin's address tells its own.`,
  "places-address-key-wif-master-key-no-place": (value0: string) =>
    `--${value0} places an address, a key or a WIF; a master key has no place.`,
  "scan-gap-applies-address-given-option-asked-on": () =>
    "--scan-gap applies to an address given with an option, or asked on the screen with --ask-secrets.",
  "applies-wallet-given-as-option-such-as-bitcoin": (value0: string, value1: string) =>
    `--${value0} applies to a wallet given as an option, such as --bitcoin-address${value1}.`,
});

/** The option that gives each kind of evidence; a WIF is read from the file it names. */
const EVIDENCE_OPTIONS = Object.freeze({
  address: "bitcoin-address",
  "coin-address": "coin-address",
  "master-xpub": "master-xpub",
  "account-xpub": "account-xpub",
  "compressed-public-key": "compressed-public-key",
  "master-fingerprint": "master-fingerprint",
  wif: "wif-file",
} as const) satisfies Readonly<Record<WalletEvidence["kind"], string>>;

/**
 * The options that place a wallet in its account: what a master key, which has no place, refuses.
 */
const ACCOUNT_PLACE_OPTIONS = ["account", "branch", "index", "bitcoin-profile"] as const;

/** The options that say where a wallet given with an option is looked for. */
const WALLET_PLACE_OPTIONS = ["network", ...ACCOUNT_PLACE_OPTIONS] as const;

/** The options that only Bitcoin evidence takes: the address of another coin tells its own. */
const BITCOIN_ONLY_OPTIONS = ["network", "bitcoin-profile"] as const;

/**
 * The options that name a wallet's evidence and where in the wallet it sits, with the BIP39
 * passphrase: what every command that checks a wallet takes, and what decode takes only on the
 * private screen.
 */
export const WALLET_EVIDENCE_OPTIONS = [
  ...Object.values(EVIDENCE_OPTIONS),
  "coin",
  ...WALLET_PLACE_OPTIONS,
  "scan-gap",
  "bip39-passphrase-file",
] as const;

function bitcoinProfilesFrom(arguments_: ParsedArguments): readonly BitcoinProfile[] {
  const requested = value(arguments_, "bitcoin-profile") ?? "auto";
  if (requested === "auto") return bitcoinProfiles;
  // The list is checked by the evidence's own rule; the refusal names the option's syntax.
  try {
    return checkedBitcoinProfiles(requested.split(",").map((item) => item.trim()));
  } catch {
    throw ERRORS.create("bitcoin-address-profile-auto-comma-separated-list", [
      `${bitcoinProfiles.join(", ")}`,
    ]);
  }
}

function bitcoinNetwork(arguments_: ParsedArguments): BitcoinNetworkName {
  const network = value(arguments_, "network") ?? BITCOIN_NETWORKS[0];
  if (!isBitcoinNetwork(network))
    throw ERRORS.create("bitcoin-network", [`${BITCOIN_NETWORKS_TEXT}`]);
  return network;
}

/** The account, branch and index of an address or a key, by --account, --branch and --index. */
function placeOf(arguments_: ParsedArguments): Omit<DerivationLocation, "network"> {
  // Named for the wallet: the table command takes --index for a word.
  const bip32Index = (name: "account" | "branch" | "index", label: string) =>
    integerOption(arguments_, name, {
      defaultValue: FIRST_RECEIVING_LOCATION[name],
      ...NORMAL_INDEX_RANGE,
      label,
    });
  return {
    account: bip32Index("account", "--account address account"),
    branch: bip32Index("branch", "--branch address branch"),
    index: bip32Index("index", "--index first address index"),
  };
}

/**
 * How many addresses an address, a public key or a WIF is compared with, from --index on, as
 * --scan-gap says; undefined without it.
 */
export function scanGapOf(arguments_: ParsedArguments): number | undefined {
  if (value(arguments_, "scan-gap") === undefined) return undefined;
  return integerOption(arguments_, "scan-gap", ADDRESS_COUNT_RANGE);
}

/**
 * The options that give `evidence`, as walletEvidence reads them back: what a question asked on
 * the screen becomes on a command line. A place, a network or profiles are given only where they
 * differ from the defaults. A WIF has no such options: it is read from a file.
 */
export function walletEvidenceArguments(evidence: WalletEvidence): string[] {
  if (evidence.kind === "wif") throw ERRORS.create("wif-given-file-never-on-command-line", []);
  const coin = evidence.kind === "coin-address" ? ["--coin", evidence.coin] : [];
  const options = [...coin, `--${EVIDENCE_OPTIONS[evidence.kind]}`, evidence.value];
  if ("network" in evidence && evidence.network !== FIRST_RECEIVING_LOCATION.network)
    options.push("--network", evidence.network);
  if ("location" in evidence) {
    const { location } = evidence;
    if ("network" in location && location.network !== FIRST_RECEIVING_LOCATION.network)
      options.push("--network", location.network);
    for (const name of ["account", "branch", "index"] as const)
      if (location[name] !== FIRST_RECEIVING_LOCATION[name])
        options.push(`--${name}`, String(location[name]));
  }
  if ("profiles" in evidence && evidence.profiles.length !== bitcoinProfiles.length)
    options.push("--bitcoin-profile", evidence.profiles.join(","));
  if ("addresses" in evidence && evidence.addresses !== undefined)
    options.push("--scan-gap", String(evidence.addresses));
  return options;
}

/**
 * The wallet evidence that the options give: one of the Bitcoin kinds, or an address of another
 * coin (--coin-address with --coin); none without one. The coin's own address tells its network
 * and type, so --network and --bitcoin-profile are refused beside it. An address, a public key or
 * a WIF is compared with the first 20 addresses from --index on, or as many as --scan-gap says.
 */
export function walletEvidence(arguments_: ParsedArguments): WalletEvidence | undefined {
  const items = (Object.keys(EVIDENCE_OPTIONS) as WalletEvidence["kind"][]).map(
    (kind) => [kind, value(arguments_, EVIDENCE_OPTIONS[kind])] as const,
  );
  const supplied = items.filter(([, item]) => item !== undefined);
  const coin = value(arguments_, "coin");
  if (coin !== undefined && value(arguments_, "coin-address") === undefined)
    throw ERRORS.create("coin-names-coin-coin-address", []);
  if (supplied.length === 0) return undefined;
  if (supplied.length !== 1) throw ERRORS.create("select-exactly-one-recovery-evidence-option", []);
  const [kind, rawValue] = defined(supplied[0]);
  const counted = scanGapOf(arguments_);
  if (counted !== undefined && !isScannedKind(kind))
    throw ERRORS.create("scan-gap-applies-address-compressed-public-key-wif", []);
  const place = placeOf(arguments_);
  const addresses = counted ?? defaultAddressCount(place.index);
  if (kind === "coin-address") {
    if (coin === undefined) throw ERRORS.create("coin-address-coin-such-as-coin-ethereum", []);
    for (const bitcoinOnly of BITCOIN_ONLY_OPTIONS)
      if (value(arguments_, bitcoinOnly) !== undefined)
        throw ERRORS.create("bitcoin-evidence-coin-s-address-tells-own", [`${bitcoinOnly}`]);
    return {
      kind,
      coin: coinById(coin).id,
      // Read as the coin reads it, white space at its ends left out (trimWhiteSpace).
      value: defined(rawValue),
      location: place,
      addresses,
    };
  }
  // The evidence leaves out white space at the ends as every wallet check does (trimWhiteSpace);
  // a file may begin with a byte order mark besides.
  const value_ =
    kind === "wif"
      ? withoutByteOrderMark(readBoundedTextFile(defined(rawValue), "The WIF file"))
      : defined(rawValue);
  const network = bitcoinNetwork(arguments_);
  if (!isPlacedKind(kind)) {
    // The master key has no place in an account: these would be ignored, so they are refused.
    const placing = ACCOUNT_PLACE_OPTIONS.find((key) => value(arguments_, key) !== undefined);
    if (placing !== undefined)
      throw ERRORS.create("places-address-key-wif-master-key-no-place", [`${placing}`]);
    return { kind, value: value_, network };
  }
  const location: DerivationLocation = { network, ...place };
  const profiles = bitcoinProfilesFrom(arguments_);
  if (isScannedKind(kind)) return { kind, value: value_, profiles, location, addresses };
  return { kind, value: value_, profiles, location };
}

export function bip39Passphrase(arguments_: ParsedArguments): string {
  const path = value(arguments_, "bip39-passphrase-file");
  return path === undefined
    ? ""
    : readBoundedTextFile(path, "The BIP39 passphrase file").replace(/\r?\n$/, "");
}

/**
 * Where a wallet is looked for: on which network, and for an address at which place of which
 * account, in which of the four profiles, and among how many addresses from there.
 */
export interface WalletPlace {
  readonly location: DerivationLocation;
  readonly profiles: readonly BitcoinProfile[];
  /** How many addresses in a row an address is compared with; asked after it when left out. */
  readonly addresses?: number;
}

/**
 * The first receiving address of the first account on mainnet, m/…'/0'/0'/0/0, in each of the
 * four profiles, as walletEvidence takes --bitcoin-address without
 * --network, --account, --branch, --index and --bitcoin-profile.
 */
export const FIRST_RECEIVING: WalletPlace = {
  location: FIRST_RECEIVING_LOCATION,
  profiles: bitcoinProfiles,
};

/**
 * Where another wallet is looked for after `given`, the one given with the options: on its
 * network, and for an address or a key at its place, in its profiles and among as many addresses.
 * A wallet asked on the screen is compared with as many addresses as --scan-gap says, without
 * asking; without a wallet given or asked, --scan-gap is refused, since nothing would use it.
 */
export function walletPlaceOf(
  given: WalletEvidence | undefined,
  args: ParsedArguments,
): WalletPlace {
  const addresses = scanGapOf(args);
  if (addresses !== undefined && given === undefined && args["ask-secrets"] !== true)
    throw ERRORS.create("scan-gap-applies-address-given-option-asked-on", []);
  const counted = (place: WalletPlace, count: number | undefined): WalletPlace =>
    count === undefined ? place : { ...place, addresses: count };
  if (given === undefined) return counted(FIRST_RECEIVING, addresses);
  if (given.kind === "master-fingerprint" || given.kind === "master-xpub")
    return counted(
      { ...FIRST_RECEIVING, location: { ...FIRST_RECEIVING.location, network: given.network } },
      addresses,
    );
  // A coin's address tells its own network and type: its place is kept, on Bitcoin's mainnet.
  if (given.kind === "coin-address")
    return counted(
      {
        ...FIRST_RECEIVING,
        location: { network: FIRST_RECEIVING_LOCATION.network, ...given.location },
      },
      given.addresses,
    );
  const place = { location: given.location, profiles: given.profiles };
  return isScannedEvidence(given) ? counted(place, given.addresses) : place;
}

/**
 * Refuses, before the first question, an option that places a wallet when no option gives the
 * wallet: walletEvidence reads them only with one, so a wallet asked on the screen would be looked
 * for elsewhere than the person said, and without one nothing would use them.
 */
export function assertWalletPlaceUsed(
  args: ParsedArguments,
  given: WalletEvidence | undefined,
): void {
  if (given !== undefined) return;
  const placing = WALLET_PLACE_OPTIONS.find((key) => args[key] !== undefined);
  if (placing === undefined) return;
  const asked =
    args["ask-secrets"] === true
      ? "; the wallet asked on the screen is looked for on mainnet among its first receiving addresses"
      : "";
  throw ERRORS.create("applies-wallet-given-as-option-such-as-bitcoin", [`${placing}`, `${asked}`]);
}

/** The wallet that the options give, where a wallet is looked for, and its BIP39 passphrase. */
export interface GivenWallet {
  readonly evidence: WalletEvidence | undefined;
  readonly place: WalletPlace;
  readonly passphrase: string;
}

/**
 * Every option of the wallet, read and checked before any secret is asked, in one order for
 * every command that compares phrases with a wallet: the evidence, refused when no wallet can
 * match it; options that place a wallet that no option gives; where a wallet asked later is
 * looked for; and the BIP39 passphrase.
 */
export function givenWallet(arguments_: ParsedArguments): GivenWallet {
  const evidence = walletEvidence(arguments_);
  if (evidence !== undefined) assertWalletEvidence(evidence);
  assertWalletPlaceUsed(arguments_, evidence);
  return {
    evidence,
    place: walletPlaceOf(evidence, arguments_),
    passphrase: bip39Passphrase(arguments_),
  };
}
