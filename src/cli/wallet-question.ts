// The question how MnemoCode can recognise a wallet, asked on the private screen of a command and
// in the menu, each value asked again until it can be used (askValueUntil of ask.ts).
//
// The API for the commands:
// - askWalletEvidence({ optional, explanation, place }): the wallet's master fingerprint, or one
//   of its first receiving addresses, of any coin, chosen from one list as mhfe asks it, each
//   checked at once as core/wallet-evidence.ts checks it, or "It cannot" where the mode can list
//   candidates without the wallet. How many addresses it is compared with is asked after it
//   (Enter: 20), unless --scan-gap said it. `place` is walletPlaceOf(the evidence given with the
//   options, --scan-gap): another wallet is looked for on its network and at its place. Without
//   such evidence, assertWalletPlaceUsed(args, evidence) refuses --network, --account, --branch,
//   --index and --bitcoin-profile before the first question, since the question would not use
//   them.
// - changeWalletAnswer(value), checkWalletAnswer(value, note): the answers of a question after a
//   result that ask for another wallet, or for the wallet to check candidates against.

import {
  type AddressLocation,
  type Coin,
  COINS,
  type DerivationLocation,
  isScannedEvidence,
  parseBitcoinAddress,
  parseCoinAddress,
  parseMasterFingerprint,
  type WalletEvidence,
} from "../bitcoin-evidence.js";
import { parseAddressCount, defaultAddressCount } from "../core/address-scan.js";
import { isFirstReceiving, isTestNetwork } from "../core/wallet-evidence.js";
import { askValueUntil } from "./ask.js";
import { FIRST_RECEIVING, type WalletPlace } from "./bitcoin-options.js";
import { FINGERPRINT_DISCLOSURE } from "./terminal.js";
import { choose, type Choice, type Explanation } from "./terminal-choice.js";
import { CANCELLED, type Cancelled } from "./terminal-keys.js";

/** The answer that asks for another wallet in place of one given, with `value`. */
export function changeWalletAnswer<T>(value: T): Choice<T> {
  return { label: "Change the wallet", note: "the fingerprint or the address", value };
}

/** The answer that asks for the wallet to check candidates against, `note` saying what follows. */
export function checkWalletAnswer<T>(value: T, note = "only those that match"): Choice<T> {
  return { label: "Check them against the wallet", note, value };
}

/** What askWalletEvidence asks. */
export interface WalletQuestion {
  /**
   * Offers "It cannot": the mode's checksum alone sorts out most candidates, such as the original
   * Seedshift's, so that they can be listed without the wallet.
   */
  readonly optional: boolean;
  /** Text shown with the question, such as why the wallet is needed. */
  readonly explanation?: Explanation;
  /**
   * Where the wallet is looked for (walletPlaceOf); by default among its first receiving addresses
   * on mainnet.
   */
  readonly place?: WalletPlace;
}

/** The wallet as askWalletEvidence was told it. */
export type WalletAnswer =
  | { readonly kind: "wallet"; readonly evidence: WalletEvidence }
  /** "It cannot": every checksum-valid candidate is listed. */
  | { readonly kind: "none" }
  /** Escape at the first question. */
  | { readonly kind: "back" };

/** Where an address is looked for, in the words of the questions. */
interface AddressWords {
  /** For the list of ways, such as "one of its first 20 receiving addresses". */
  readonly note: string;
  /** For the address prompt, such as "one of the first 20 receiving ones". */
  readonly prompt: string;
  /** For the line after an empty answer, such as "a receiving address of the wallet". */
  readonly what: string;
}

/**
 * The place of an address as the questions name it, from the account on: "m/.../0/3" among the
 * first receiving addresses, with the account where it is another, "m/.../2'/0/3".
 */
function placePath(location: AddressLocation): string {
  const account = isFirstReceiving(location) ? "" : `${location.account}'/`;
  return `m/.../${account}${location.branch}/${location.index}`;
}

/**
 * The words for an address at `location`, or among `addresses` of them from there; without a
 * count, which is asked after the address, among the first receiving ones.
 */
function addressWords(location: AddressLocation, addresses: number | undefined): AddressWords {
  const first = isFirstReceiving(location);
  const path = placePath(location);
  if (addresses === 1)
    return {
      note: first ? `its first receiving address, ${path}` : `its address at ${path}`,
      prompt: first ? "the first receiving one" : path,
      what: first ? "the wallet's first receiving address" : `the wallet's address at ${path}`,
    };
  const count = addresses === undefined ? "" : `${addresses} `;
  if (first)
    return {
      note: `one of its first ${count}receiving addresses`,
      prompt: `one of the first ${count}receiving ones`,
      what: "a receiving address of the wallet",
    };
  return {
    note: `one of its ${count}addresses from ${path}`,
    prompt: `one of the ${count}addresses from ${path}`,
    what: `an address of the wallet from ${path}`,
  };
}

/** A way of recognising a wallet, as the wallet question offers it. */
export type WalletWay = "fingerprint" | "address" | "none";

/** What a value is asked with: its prompt, and what to type, said after an empty answer. */
export interface AskedValue {
  readonly prompt: string;
  readonly what: string;
}

/**
 * The words of the question how a wallet at a place can be recognised, and of the value that each
 * way asks for. The menu asks it for the options of a command, the questions of a command for the
 * evidence itself; each presents the same words in its way.
 */
class WalletQuestionWords {
  static readonly QUESTION = "How can MnemoCode recognise the wallet?";
  // As mhfe asks it (src/bin/mhfe/check.rs), every coin in the same list (owner, 2026-10-13).
  static readonly COIN_QUESTION = "Which coin is the address for?";
  static readonly FINGERPRINT: AskedValue = Object.freeze({
    prompt: `Original fingerprint of the wallet, such as 73c5da0a (not the encoded one; ${FINGERPRINT_DISCLOSURE})`,
    what: "the eight characters of the fingerprint",
  });

  readonly #location: DerivationLocation;
  readonly #words: AddressWords;

  /** The words about the wallet at `place`: its first receiving addresses by default. */
  constructor(place: Pick<WalletPlace, "location" | "addresses"> = FIRST_RECEIVING) {
    this.#location = place.location;
    this.#words = addressWords(place.location, place.addresses);
  }

  /** The ways, and "It cannot" where the wallet is `optional`. */
  ways(optional = false): Choice<WalletWay>[] {
    return [
      {
        label: "Fingerprint",
        // The phrase of the wallet: with Seedshift the one before the shift, which Encode calls
        // Original.
        note: "Encode's Original, not the Encoded",
        value: "fingerprint",
      },
      { label: "Address", note: this.#words.note, example: COINS_NOTE, value: "address" },
      ...(optional
        ? [{ label: "It cannot", note: "list every candidate instead", value: "none" } as const]
        : []),
    ];
  }

  get bitcoinAddress(): AskedValue {
    return { prompt: `Bitcoin address (${this.#words.prompt})`, what: this.#words.what };
  }

  /**
   * Every coin, for the question which coin the address is for, with the forms of its addresses
   * on the network of the place.
   */
  coins(): Choice<Coin>[] {
    return COINS.map((coin) => ({
      label: coin.name,
      note: coin.addressFormsOn(isTestNetwork(this.#location.network)),
      value: coin,
    }));
  }

  coinAddress(coin: Coin): AskedValue {
    return {
      prompt: `Address (${coin.name}, ${this.#words.prompt})`,
      what: `the wallet's address of ${coin.name}`,
    };
  }

  /** How many addresses from the place the address typed is compared with. */
  get addressCount(): AskedValue {
    const from = isFirstReceiving(this.#location) ? "the first" : placePath(this.#location);
    return { prompt: `Compare with how many addresses from ${from}`, what: "how many addresses" };
  }
}

/**
 * Asks among how many addresses from `place` the address typed is, Enter for the count that fits
 * from there (defaultAddressCount); undefined when the person goes back with Escape, CANCELLED at
 * Ctrl+C.
 */
async function askAddressCount(
  place: WalletPlace,
  asker: WalletValueAsker,
): Promise<number | undefined | Cancelled> {
  const asked = new WalletQuestionWords(place).addressCount;
  const first = place.location.index;
  // Enter takes the count that fits from this index on, one at the last index (AUD-012-UI001).
  const fallback = String(defaultAddressCount(first));
  return asker.ask({ ...asked, label: "Addresses", fallback }, (answer) =>
    parseAddressCount(answer, first),
  );
}

/**
 * `evidence`, an address of a wallet, compared with as many addresses as `place` says, or as the
 * person says after it; undefined when they go back from that question, CANCELLED at Ctrl+C.
 */
async function withAddressCount(
  evidence: WalletEvidence | undefined,
  place: WalletPlace,
  asker: WalletValueAsker,
): Promise<WalletEvidence | undefined | Cancelled> {
  if (evidence === undefined || !isScannedEvidence(evidence)) return evidence;
  const addresses = place.addresses ?? (await askAddressCount(place, asker));
  if (addresses === CANCELLED) return CANCELLED;
  return addresses === undefined ? undefined : { ...evidence, addresses };
}

/** One typed value of the wallet question, as a front end asks it. */
export interface WalletValue extends AskedValue {
  /** Its line in the record of answers, where the front end keeps one. */
  readonly label: string;
  /** Explanation kept beside its accepted value in a front end's answer record. */
  readonly note?: string;
  /** The answer that Enter alone gives, if any. */
  readonly fallback?: string;
}

/**
 * How a front end asks the typed values of the wallet question: on the private screen, or in the
 * menu, which records each answer and builds the command line from them.
 */
export interface WalletValueAsker {
  /**
   * Asks `value` until `parse` takes it; undefined when the person goes back, CANCELLED at Ctrl+C.
   */
  ask<T>(value: WalletValue, parse: (answer: string) => T): Promise<T | undefined | Cancelled>;
  /** Whether going back from a value leaves the question, as in the menu, not back to its list. */
  readonly backLeaves: boolean;
}

/** The private screen's way: each value asked until it can be used; back goes to the list. */
const SCREEN_ASKER: WalletValueAsker = {
  ask: (value, parse) =>
    askValueUntil(
      value.fallback === undefined
        ? `${value.prompt}:`
        : `${value.prompt} (Enter: ${value.fallback}):`,
      parse,
      { what: value.what, ...(value.fallback === undefined ? {} : { fallback: value.fallback }) },
    ),
  backLeaves: false,
};

/**
 * Asks how the wallet can be recognised: by its BIP32 master fingerprint, by one of its first
 * receiving addresses (or the address at `place`) of any coin, which is asked next, or, when
 * `optional`, not at all. A
 * value that no wallet can have is refused at once and asked again; going back from a value goes
 * back to the list, or leaves the question where `asker` says so. CANCELLED at Ctrl+C. The private
 * screen and the menu both ask it, each with its own asker.
 */
export async function askWalletEvidence(
  question: WalletQuestion,
  asker: WalletValueAsker = SCREEN_ASKER,
): Promise<WalletAnswer | Cancelled> {
  const place = question.place ?? FIRST_RECEIVING;
  const { location } = place;
  const words = new WalletQuestionWords(place);
  for (;;) {
    const kind = await choose(WalletQuestionWords.QUESTION, words.ways(question.optional), {
      label: "Wallet",
      ...(question.explanation === undefined ? {} : { explanation: question.explanation }),
    });
    if (kind === CANCELLED) return CANCELLED;
    if (kind === undefined) return { kind: "back" };
    if (kind === "none") return { kind: "none" };
    const typed =
      kind === "fingerprint"
        ? await asker.ask(
            {
              ...WalletQuestionWords.FINGERPRINT,
              label: "Fingerprint",
              note: FINGERPRINT_DISCLOSURE,
            },
            (answer): WalletEvidence => ({
              kind: "master-fingerprint",
              value: parseMasterFingerprint(answer),
              network: location.network,
            }),
          )
        : await askAddress(place, words, asker);
    if (typed === CANCELLED) return CANCELLED;
    const evidence = await withAddressCount(typed, place, asker);
    if (evidence === CANCELLED) return CANCELLED;
    if (evidence !== undefined) return { kind: "wallet", evidence };
    if (asker.backLeaves) return { kind: "back" };
  }
}

/** How many coins the note of the way "Address" names before it counts the others. */
const NAMED_COINS = 3;
/** The coins of the way "Address": the first by name, and how many more. */
const COINS_NOTE = `${COINS.slice(0, NAMED_COINS)
  .map((coin) => coin.name)
  .join(", ")} and ${COINS.length - NAMED_COINS} more coins`;

/**
 * Asks which coin the address is for, every coin in one list, then its address at the place:
 * Bitcoin's in the profiles of the place, another coin's at its account, branch and index; each
 * asked until it is one of that coin. Undefined when the person goes back (Escape), to the wallet
 * question; CANCELLED at Ctrl+C.
 */
async function askAddress(
  place: WalletPlace,
  words: WalletQuestionWords,
  asker: WalletValueAsker,
): Promise<WalletEvidence | undefined | Cancelled> {
  const coin = await choose(WalletQuestionWords.COIN_QUESTION, words.coins(), {
    label: "Coin",
    quit: "goes back",
  });
  if (coin === undefined || coin === CANCELLED) return coin;
  const { location, profiles } = place;
  if (coin.id === "bitcoin")
    return asker.ask({ ...words.bitcoinAddress, label: "Address" }, (answer): WalletEvidence => ({
      kind: "address",
      value: parseBitcoinAddress(answer, location.network),
      profiles,
      location,
    }));
  const { account, branch, index } = location;
  return asker.ask({ ...words.coinAddress(coin), label: "Address" }, (answer): WalletEvidence => ({
    kind: "coin-address",
    coin: coin.id,
    value: parseCoinAddress(coin.id, answer),
    location: { account, branch, index },
  }));
}
