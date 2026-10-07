// What the coin families of this folder share: a coin, which reads its single-key receiving
// addresses, and an address so read, reduced to what identifies it, with the paths where wallets
// put it and its comparison with a public key. Each family module writes its coins' addresses in
// its own way on top of the Coin class; core/coins.ts lists the coins.
//
// Every coin uses secp256k1 keys on BIP44-style paths m/purpose'/coin'/account'/branch/index, or,
// for Dash Platform, on DIP17 paths m/9'/coin'/17'/account'/key_class'/index; they differ only in
// how a public key becomes an address.
//
// Host-neutral: it imports only address-types.ts and core/white-space.ts
// (test/portable-modules.test.ts).

import { ADDRESS_PURPOSES, commitmentOf, type AddressType } from "./address-types.js";
import { trimWhiteSpace } from "../white-space.js";

/** The identifier of each coin, as a host names it, such as "bitcoin-cash". */
export type CoinId =
  | "bitcoin"
  | "bitcoin-cash"
  | "cosmos"
  | "dash"
  | "dogecoin"
  | "ethereum"
  | "ethereum-classic"
  | "injective"
  | "litecoin"
  | "tron"
  | "xrp"
  | "zcash";

/** Where in a wallet an address sits: the account, the branch (DIP17's key class) and the index. */
export interface AddressLocation {
  readonly account: number;
  readonly branch: number;
  readonly index: number;
}

/** What a person and a host know a coin by. */
export interface CoinDescription {
  readonly id: CoinId;
  /** The name a person knows it by, such as "Bitcoin Cash". */
  readonly name: string;
  /** How its supported addresses begin, such as "1…, 3…, bc1q… or bc1p…". */
  readonly addressForms: string;
  /**
   * The SLIP-44 coin types of its main network's paths. A coin that forked from another, such as
   * Bitcoin Cash from Bitcoin, has its own first and the other's second: its wallets use either.
   */
  readonly coinTypes: readonly number[];
}

/** SLIP-44: every test network uses coin type 1. */
const TESTNET_COIN_TYPE = 1;
/** DIP17: the DIP9 feature number of Dash Platform payment keys. */
const DIP17_FEATURE = 17;
/** BIP32: indexes from 2^31 up are hardened, and a path step names one below that. */
const HARDENED_OFFSET = 0x80000000;

/** Why an address is refused, as the reasons below say it. */
export function invalidAddress(reason: string): Error {
  return new Error(`The address cannot be used for the check: ${reason}.`);
}

/** The reasons that several families give. */
export const DAMAGED = "its checksum or format is wrong";
export const WRONG_LENGTH = "it has the wrong length";

/**
 * A coin whose single-key receiving addresses can be compared with a phrase's keys. A class
 * because a coin owns what describes it and the reading of its addresses; each family adds only
 * how its addresses are written.
 */
export abstract class Coin implements CoinDescription {
  readonly id: CoinId;
  readonly name: string;
  readonly addressForms: string;
  readonly coinTypes: readonly number[];

  constructor(description: CoinDescription) {
    this.id = description.id;
    this.name = description.name;
    this.addressForms = description.addressForms;
    this.coinTypes = Object.freeze([...description.coinTypes]);
  }

  /**
   * `text` as a single-key receiving address of this coin; refused, naming why, when it belongs
   * to another coin, to a script or to several keys, is damaged, or is out of reach (shielded).
   * A host checks an answer with it at once: no secret is needed.
   */
  parse(text: string): CoinAddress {
    return this.read(trimWhiteSpace(text));
  }

  /** What a person calls an address of `type`, where the coin has several kinds; none here. */
  describe(_type: AddressType, _testnet: boolean): string | undefined {
    return undefined;
  }

  /** Reads the trimmed `text`, as the family writes its addresses. */
  protected abstract read(text: string): CoinAddress;

  /** The address of this coin that `text`, its standard form, names. */
  protected address(
    type: AddressType,
    commitment: Uint8Array,
    text: string,
    testnet = false,
  ): CoinAddress {
    return new CoinAddress(this, type, commitment, text, testnet);
  }

  /** The refusal of an address that is not this coin's. */
  protected notOurs(): Error {
    return invalidAddress(`it is not an address of ${this.name} (${this.addressForms})`);
  }
}

/**
 * A receiving address reduced to what identifies it: its coin, whether it is a test network
 * address, its type, and the 20-byte hash or 32-byte Taproot key it commits to, which stays inside.
 * Made by a coin's parse, which refuses everything else, so it always names a real single-key
 * address.
 */
export class CoinAddress {
  readonly coin: Coin;
  readonly type: AddressType;
  /** A Bitcoin testnet or signet address, or a Dash Platform testnet one: coin type 1. */
  readonly testnet: boolean;
  /** The address in its standard form, such as lower case for Bech32 and EIP-55 for Ethereum. */
  readonly text: string;
  readonly #commitment: Uint8Array;

  constructor(
    coin: Coin,
    type: AddressType,
    commitment: Uint8Array,
    text: string,
    testnet: boolean,
  ) {
    this.coin = coin;
    this.type = type;
    this.#commitment = Uint8Array.from(commitment);
    this.text = text;
    this.testnet = testnet;
  }

  /**
   * Its type, for a person, where its coin has several: "nested SegWit (BIP49)", "testnet,
   * Taproot (BIP86)", "Platform payment (DIP17)" or, for Zcash, "transparent".
   */
  get description(): string | undefined {
    return this.coin.describe(this.type, this.testnet);
  }

  /**
   * The paths where wallets put it at `location`: one for each coin type of its coin, or coin
   * type 1 on a test network. Every step down to the account is hardened, and on DIP17 the key
   * class too.
   */
  pathsAt(location: AddressLocation): string[] {
    return this.branchPathsAt(location).map((path) => `${path}/${location.index}`);
  }

  /**
   * The paths of the branch that holds the address at `location`, as pathsAt gives them without
   * the last step: the index, which is never hardened, so that the addresses that follow it are
   * derived from the branch's key one step each.
   */
  branchPathsAt(location: AddressLocation): string[] {
    assertAddressLocation(location);
    const { account, branch } = location;
    const purpose = ADDRESS_PURPOSES[this.type];
    const coinTypes = this.testnet ? [TESTNET_COIN_TYPE] : this.coin.coinTypes;
    return coinTypes.map((coinType) =>
      this.type === "dash-platform"
        ? `m/${purpose}'/${coinType}'/${DIP17_FEATURE}'/${account}'/${branch}'`
        : `m/${purpose}'/${coinType}'/${account}'/${branch}`,
    );
  }

  /** Whether `publicKey`, a compressed secp256k1 key, is the key of this address. */
  isAddressOf(publicKey: Uint8Array): boolean {
    const derived = commitmentOf(this.type, publicKey);
    return (
      derived.length === this.#commitment.length &&
      derived.every((byte, position) => byte === this.#commitment[position])
    );
  }
}

/**
 * Refuses a location that names no BIP32 path: each of its numbers is an index below 2^31, which
 * the path hardens itself where it must.
 */
export function assertAddressLocation(location: AddressLocation): void {
  for (const name of ["account", "branch", "index"] as const) {
    const value = location[name];
    if (!Number.isSafeInteger(value) || value < 0 || value >= HARDENED_OFFSET)
      throw new Error(`${name} must be an integer from 0 through 2147483647.`);
  }
}

// The trimming of every wallet check, kept here under its old name for the coin families.
export { trimWhiteSpace } from "../white-space.js";

/** ASCII case only, as the address formats define it; other letters stay as they are. */
export function asciiLowercase(text: string): string {
  return text.replace(/[A-Z]+/gu, (letters) => letters.toLowerCase());
}

export function asciiUppercase(text: string): string {
  return text.replace(/[a-z]+/gu, (letters) => letters.toUpperCase());
}

/** Whether `text` starts with one of `prefixes`, in either case. */
export function startsWithAny(text: string, prefixes: readonly string[]): boolean {
  const lowercase = asciiLowercase(text);
  return prefixes.some((prefix) => lowercase.startsWith(prefix));
}
