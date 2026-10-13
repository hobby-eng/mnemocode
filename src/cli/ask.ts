// Questions that are asked again until their answer can be used, on the private screen of a command
// (private-screen.ts). Nowhere may a command end abruptly and lose what the person typed: a wrong
// or unusable answer is explained in one warning line, which never repeats what was typed (a
// position such as "date 2" or "place 11" is fine), and the same question is asked again, while the
// caller keeps every earlier answer. Only the person leaves: Ctrl+C (InputCancelled, exit code
// CANCELLED_EXIT_CODE), or the last choice of askAfterFailure. Inside a secret question Escape does
// nothing, so that a slip of the finger loses nothing. Every question first drops what was typed
// before it showed (dropTypedAhead), so that only keys pressed for it answer it.
//
// The API for the commands:
// - askSecretUntil(prompt, parse, { what, pastedLineBreak, hints }): a secret, asked until
//   `parse` returns. An Error from `parse` is its one warning line; `hints` shows the words of a
//   list below the words being typed. An empty answer or Ctrl+D asks again
//   with "Type <what>, or press Ctrl+C to stop."; a real end of the input cancels.
// - askValueUntil(prompt, parse, { what, fallback }): the same for a visible value that is no
//   secret, such as a fingerprint or a file name; Escape goes back (undefined), and Enter alone
//   takes the `fallback` where there is one.
// - askAfterFailure(question, choices, { label, escape }): "What now?" after a failure that is no
//   answer error, such as no result or a file that could not be saved; Escape picks the last
//   choice, which must be the one that stops or changes nothing.
// - askWalletEvidence({ optional, explanation, place }): the wallet's master fingerprint, or one
//   of its first receiving addresses, of Bitcoin or another coin, each checked at once as
//   core/wallet-evidence.ts checks it, or "It cannot" where the mode can list candidates without
//   the wallet. How many addresses it is compared with is asked after it (Enter: 20), unless
//   --scan-gap said it. `place` is walletPlaceOf(the evidence given with the options,
//   --scan-gap): another wallet is looked for on its network and at its place. Without such
//   evidence, assertWalletPlaceUsed(args, evidence) refuses --network, --account, --branch,
//   --index and --bitcoin-profile before the first question, since the question would not use
//   them.
// - droppedPath(answer): a typed file name as the file system knows it, when the file was dragged
//   into the terminal, which adds quotes or backslashes, or starts with ~.

import { homedir } from "node:os";
import { join } from "node:path";
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
import { FIRST_RECEIVING, type WalletPlace } from "./bitcoin-options.js";
import { onPrivateScreen } from "./private-screen.js";
import { terminalNotice } from "./terminal.js";
import {
  choose,
  writePrompt,
  type Choice,
  type Explanation,
  enteredAnswer,
  typeHint,
} from "./terminal-choice.js";
import {
  dropRestOfPaste,
  dropTypedAhead,
  InputCancelled,
  readLine,
  terminalAvailable,
  UnusableAnswer,
  withRawTerminal,
  type NextByte,
  refusal,
  type PastedLineBreak,
  NOT_UTF8,
  terminalTooDumb,
  dumbTerminalReason,
  SECRET_SOURCE_ADVICE,
} from "./terminal-input.js";
import { displayWidth } from "./terminal-geometry.js";
import { trimWhiteSpace } from "../core/white-space.js";
import { isFirstReceiving } from "../core/wallet-evidence.js";
import { validCharacters } from "./utf8.js";
import type { WordHints } from "../core/word-hints.js";

/** How a question is asked again. */
export interface AskOptions {
  /** What to type, for the line after an empty answer: "Type <what>, or press Ctrl+C to stop." */
  readonly what?: string;
}

/** How a question for a visible value is asked again, and what Enter alone gives. */
export interface ValueAskOptions extends AskOptions {
  /** The answer that Enter alone gives, which the prompt names, such as "(Enter: 20)". */
  readonly fallback?: string;
}

/** How a secret question is asked again. */
export interface SecretAskOptions extends AskOptions {
  /**
   * The hints below the words being typed on the private screen, and Tab's completion
   * (core/word-hints.ts): where the answer is words of a list, such as a seed phrase.
   */
  readonly hints?: WordHints;
  /**
   * What a line break inside a paste of several lines becomes (readLine): a space by default, so
   * that words, codes or dates pasted one per line are one answer; ";" between shares.
   */
  readonly pastedLineBreak?: PastedLineBreak;
}

/** Checks an answer: returns what it means, or throws an Error whose message is the warning. */
export type AnswerParser<T> = (answer: string) => T | Promise<T>;

/** What one reading of a question gave. */
type Reading =
  | { readonly kind: "answer"; readonly text: string }
  /** Nothing typed but Enter, or Ctrl+D on an empty line. */
  | { readonly kind: "empty" }
  /** Escape, where it goes back. */
  | { readonly kind: "back" }
  /** An answer longer than any valid one, or not UTF-8: the reason, without the answer. */
  | { readonly kind: "unusable"; readonly reason: string }
  /** The input ended (standard input closed): nothing more can be asked. */
  | { readonly kind: "ended" };

/** Refuses a question without a terminal, before the terminal is touched. */
function assertTerminal(): void {
  if (terminalAvailable()) return;
  // A terminal of the type "dumb", as in some editors, cannot draw the private screen.
  if (terminalTooDumb())
    throw new Error(
      `${dumbTerminalReason("--ask-secrets")} Run the command in another terminal, set TERM (such as TERM=xterm-256color), or ${SECRET_SOURCE_ADVICE}.`,
    );
  throw new Error(
    `--ask-secrets needs a terminal on standard input and standard error. Run the command in a terminal, or ${SECRET_SOURCE_ADVICE}.`,
  );
}

/**
 * Asks `prompt` once and reads the answer with readLine, after dropping what was typed ahead. On
 * the private screen, which is cleared afterwards, the answer shows as it is typed (`echo`).
 */
async function readAnswer(
  prompt: string,
  how: {
    readonly echo: boolean;
    readonly back: boolean;
    readonly pastedLineBreak?: PastedLineBreak;
    readonly hints?: WordHints | undefined;
  },
): Promise<Reading> {
  return withRawTerminal(async (next, moreWithin) => {
    await dropTypedAhead();
    // The end of the input is told from Ctrl+D by the reader: readLine returns nothing for both.
    let ended = false;
    let wentBack = false;
    // Only valid UTF-8 is shown and read, as in the menu's questions (validCharacters).
    const valid = validCharacters(next);
    const reader: NextByte = async () => {
      const byte = await valid.next();
      if (byte === undefined) ended = true;
      return byte;
    };
    writePrompt(`${prompt} `);
    try {
      const text = await readLine(reader, {
        echo: how.echo,
        moreWithin,
        promptWidth: displayWidth(`${prompt} `),
        escapeGoesBack: how.back,
        onBack: () => {
          wentBack = true;
        },
        ...(how.pastedLineBreak === undefined ? {} : { pastedLineBreak: how.pastedLineBreak }),
        ...(how.hints === undefined ? {} : { hints: how.hints }),
      });
      // An answer given with Enter that held a byte of no character is refused; Escape still goes
      // back.
      if (text !== undefined && valid.leftOut()) return { kind: "unusable", reason: NOT_UTF8 };
      const trimmed = trimWhiteSpace(text ?? "");
      if (trimmed !== "") return { kind: "answer", text: trimmed };
      if (ended) return { kind: "ended" };
      return { kind: wentBack ? "back" : "empty" };
    } catch (error) {
      if (!(error instanceof UnusableAnswer)) throw error;
      // The rest of a paste would otherwise answer the question when it is asked again.
      await dropRestOfPaste(next, moreWithin);
      return { kind: "unusable", reason: error.message };
    } finally {
      // The terminal did not show the Enter key either.
      process.stderr.write("\n");
    }
  });
}

/**
 * Asks for a secret until `parse` accepts the answer, as described at the top, and returns what
 * `parse` made of it. The answer is trimmed. On the private screen it shows as it is typed.
 */
export async function askSecretUntil<T>(
  prompt: string,
  parse: AnswerParser<T>,
  options: SecretAskOptions = {},
): Promise<T> {
  const answer = await askUntil(parse, async () => {
    const reading = await readAnswer(prompt, {
      echo: onPrivateScreen(),
      back: false,
      pastedLineBreak: options.pastedLineBreak ?? " ",
      hints: options.hints,
    });
    return turnOfReading(reading, { ...options, leave: "stop" });
  });
  // A secret is never left with Escape: Ctrl+C stops instead.
  return answer as T;
}

/** One answer to a question that asks until it can be used: its text, back, or a warning. */
type Turn = { readonly text: string } | { readonly warning: string } | "back";

/** How a typed question treats an answer not given, and how it is left (enteredAnswer). */
type TurnRules = Parameters<typeof enteredAnswer>[1];

/** The turn of a typed answer, trimmed, by the rule of every typed question (enteredAnswer). */
function turnOf(typed: string, rules: TurnRules): Turn {
  const entered = enteredAnswer(typed, rules);
  // No question of ask.ts may be left out: its answer is always a text or the hint.
  return entered.kind === "text"
    ? { text: entered.text }
    : { warning: entered.kind === "refused" ? entered.reason : typeHint(rules.what, rules.leave) };
}

/**
 * The turn of one reading of a question, for a secret and a visible value alike: the end of the
 * input stops, an unusable answer is its warning, and Escape goes back only where `rules.leave`
 * says so. Where it does not, as in a secret, an answer not given is empty.
 */
function turnOfReading(reading: Reading, rules: TurnRules): Turn {
  if (reading.kind === "ended") throw new InputCancelled();
  if (reading.kind === "unusable") return { warning: reading.reason };
  if (reading.kind === "back" && rules.leave === "back") return "back";
  return turnOf(reading.kind === "answer" ? reading.text : "", rules);
}

/**
 * Asks, by `turn`, until `parse` accepts an answer, each warning shown before the question comes
 * again: why the answer was refused, or why it was empty. Undefined when the person went back.
 * The questions for a secret and for a visible value ask through it.
 */
async function askUntil<T>(
  parse: AnswerParser<T>,
  turn: () => Promise<Turn>,
): Promise<T | undefined> {
  assertTerminal();
  for (let warning: string | undefined; ;) {
    if (warning !== undefined) terminalNotice(warning, "warning");
    const answer = await turn();
    if (answer === "back") return undefined;
    if ("warning" in answer) warning = answer.warning;
    else
      try {
        return await parse(answer.text);
      } catch (error) {
        warning = refusal(error);
      }
  }
}

/**
 * Asks for a visible value that is no secret, such as a fingerprint or a file name, until `parse`
 * accepts it; undefined when the person goes back with Escape. Enter alone answers the
 * `fallback` where there is one, which the prompt names.
 */
export async function askValueUntil<T>(
  prompt: string,
  parse: AnswerParser<T>,
  options: ValueAskOptions = {},
): Promise<T | undefined> {
  return askUntil(parse, async () => {
    const reading = await readAnswer(prompt, { echo: true, back: true });
    return turnOfReading(reading, { ...options, leave: "back" });
  });
}

/**
 * Asks what to do after a failure that no answer caused and that no new answer to the same
 * question mends: no result, a wallet that matched nothing, a file that could not be saved. The
 * choices are listed with the arrow keys and digits (choose); Escape, q and the end of the input
 * pick the last one, which must therefore stop or change nothing ("Stop", "Done", "Skip").
 * `escape` says what Escape does in the key hint ("stops" by default).
 */
export async function askAfterFailure<T>(
  question: string,
  choices: readonly Choice<T>[],
  options: { readonly label?: string; readonly escape?: string } = {},
): Promise<T> {
  const last = choices.at(-1);
  if (last === undefined) throw new Error("A question after a failure needs a choice.");
  assertTerminal();
  const chosen = await choose(question, choices, {
    label: options.label ?? "Next",
    quit: options.escape ?? "stops",
  });
  return chosen === undefined ? last.value : chosen;
}

/** The question after a failure, where nothing more particular is asked; others end with it. */
export const WHAT_NOW = "What now?";

/** The value of the Stop that askOrCancel adds, which no other answer of its question may have. */
const STOPPED = "stop";

/**
 * Asks what to do after a failure (askAfterFailure), with a Stop of its own as the last choice,
 * which cancels the command (InputCancelled): so Escape, q and the end of the input stop. With
 * `back`, for a question reached from another, Escape goes back instead and gives undefined.
 */
export async function askOrCancel<T>(
  question: string,
  choices: readonly Choice<T>[],
  options?: { readonly label?: string; readonly back?: false },
): Promise<T>;
export async function askOrCancel<T>(
  question: string,
  choices: readonly Choice<T>[],
  options: { readonly label?: string; readonly back: boolean },
): Promise<T | undefined>;
export async function askOrCancel<T>(
  question: string,
  choices: readonly Choice<T>[],
  options: { readonly label?: string; readonly back?: boolean } = {},
): Promise<T | undefined> {
  if (choices.some((choice) => choice.value === STOPPED))
    throw new Error(`An answer of a question with Stop has the value "${STOPPED}".`);
  const all: Choice<T | typeof STOPPED>[] = [...choices, { label: "Stop", value: STOPPED }];
  const chosen =
    options.back === true
      ? await chooseOrBack(question, all, options.label)
      : await askAfterFailure(
          question,
          all,
          options.label === undefined ? {} : { label: options.label },
        );
  if (chosen === STOPPED) throw new InputCancelled();
  return chosen as T | undefined;
}

/**
 * The choice of a question reached from another: undefined at Escape, q or the end of the input,
 * which go back. At the end of the input the question gone back to then picks its Stop, so that
 * nothing loops.
 */
async function chooseOrBack<T>(
  question: string,
  choices: readonly Choice<T>[],
  label = "Next",
): Promise<T | undefined> {
  assertTerminal();
  return choose(question, choices, { label, quit: "goes back" });
}

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
   * Where the wallet is looked for (walletPlaceOf); by default among its first receiving addresses on
   * mainnet.
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

/** How a Bitcoin address on `network` may begin. */
function bitcoinAddressForms(network: DerivationLocation["network"]): string {
  return network === "mainnet"
    ? "1..., 3..., bc1q... or bc1p..."
    : "m..., n..., 2..., tb1q... or tb1p...";
}

/** A way of recognising a wallet, as the wallet question offers it. */
export type WalletWay = "fingerprint" | "address" | "coin" | "none";

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
  static readonly COIN_QUESTION = "Which coin?";
  static readonly FINGERPRINT: AskedValue = Object.freeze({
    prompt: "Original fingerprint of the wallet, such as 73c5da0a (not the encoded one)",
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
      {
        label: "Bitcoin address",
        note: this.#words.note,
        example: bitcoinAddressForms(this.#location.network),
        value: "address",
      },
      { label: "Address of another coin", note: OTHER_COINS_NOTE, value: "coin" },
      ...(optional
        ? [{ label: "It cannot", note: "list every candidate instead", value: "none" } as const]
        : []),
    ];
  }

  get bitcoinAddress(): AskedValue {
    return { prompt: `Bitcoin address (${this.#words.prompt})`, what: this.#words.what };
  }

  /** The coins besides Bitcoin, for "Which coin?". */
  static coins(): Choice<Coin>[] {
    return OTHER_COINS.map((coin) => ({ label: coin.name, note: coin.addressForms, value: coin }));
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
 * from there (defaultAddressCount); undefined when the person goes back with Escape.
 */
async function askAddressCount(
  place: WalletPlace,
  asker: WalletValueAsker,
): Promise<number | undefined> {
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
 * person says after it; undefined when they go back from that question.
 */
async function withAddressCount(
  evidence: WalletEvidence | undefined,
  place: WalletPlace,
  asker: WalletValueAsker,
): Promise<WalletEvidence | undefined> {
  if (evidence === undefined || !isScannedEvidence(evidence)) return evidence;
  const addresses = place.addresses ?? (await askAddressCount(place, asker));
  return addresses === undefined ? undefined : { ...evidence, addresses };
}

/** One typed value of the wallet question, as a front end asks it. */
export interface WalletValue extends AskedValue {
  /** Its line in the record of answers, where the front end keeps one. */
  readonly label: string;
  /** The answer that Enter alone gives, if any. */
  readonly fallback?: string;
}

/**
 * How a front end asks the typed values of the wallet question: on the private screen, or in the
 * menu, which records each answer and builds the command line from them.
 */
export interface WalletValueAsker {
  /** Asks `value` until `parse` takes it; undefined when the person goes back. */
  ask<T>(value: WalletValue, parse: (answer: string) => T): Promise<T | undefined>;
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
 * Asks how the wallet can be recognised: by its BIP32 master fingerprint, by the first receiving
 * address of its Bitcoin account (or the address at `place`), or, when `optional`, not at all. A
 * value that no wallet can have is refused at once and asked again; going back from a value goes
 * back to the list, or leaves the question where `asker` says so. The private screen and the menu
 * both ask it, each with its own asker.
 */
export async function askWalletEvidence(
  question: WalletQuestion,
  asker: WalletValueAsker = SCREEN_ASKER,
): Promise<WalletAnswer> {
  const place = question.place ?? FIRST_RECEIVING;
  const { location, profiles } = place;
  const words = new WalletQuestionWords(place);
  for (;;) {
    const kind = await choose(WalletQuestionWords.QUESTION, words.ways(question.optional), {
      label: "Wallet",
      ...(question.explanation === undefined ? {} : { explanation: question.explanation }),
    });
    if (kind === undefined) return { kind: "back" };
    if (kind === "none") return { kind: "none" };
    const typed =
      kind === "fingerprint"
        ? await asker.ask(
            { ...WalletQuestionWords.FINGERPRINT, label: "Fingerprint" },
            (answer): WalletEvidence => ({
              kind: "master-fingerprint",
              value: parseMasterFingerprint(answer),
              network: location.network,
            }),
          )
        : kind === "coin"
          ? await askCoinAddress(location, words, asker)
          : await asker.ask(
              { ...words.bitcoinAddress, label: "Address" },
              (answer): WalletEvidence => ({
                kind: "address",
                value: parseBitcoinAddress(answer, location.network),
                profiles,
                location,
              }),
            );
    const evidence = await withAddressCount(typed, place, asker);
    if (evidence !== undefined) return { kind: "wallet", evidence };
    if (asker.backLeaves) return { kind: "back" };
  }
}

/** The coins besides Bitcoin, which has its own entry in the wallet question. */
export const OTHER_COINS = COINS.filter((coin) => coin.id !== "bitcoin");
/** How many coins a person can pick from, below "Address of another coin" in a list of ways. */
const NAMED_COINS = 3;
/** The note of "Address of another coin": the first coins by name, and how many more. */
export const OTHER_COINS_NOTE = `${OTHER_COINS.slice(0, NAMED_COINS)
  .map((coin) => coin.name)
  .join(", ")} and ${OTHER_COINS.length - NAMED_COINS} more`;

/**
 * Asks which coin, then its address at `location` or in `range`, until it is one of that coin;
 * undefined when the person goes back (Escape), to the wallet question.
 */
async function askCoinAddress(
  location: DerivationLocation,
  words: WalletQuestionWords,
  asker: WalletValueAsker,
): Promise<WalletEvidence | undefined> {
  const coin = await choose(WalletQuestionWords.COIN_QUESTION, WalletQuestionWords.coins(), {
    label: "Coin",
    quit: "goes back",
  });
  if (coin === undefined) return undefined;
  const { account, branch, index } = location;
  return asker.ask({ ...words.coinAddress(coin), label: "Address" }, (answer): WalletEvidence => ({
    kind: "coin-address",
    coin: coin.id,
    value: parseCoinAddress(coin.id, answer),
    location: { account, branch, index },
  }));
}

/** Quotes that a terminal puts around a path dragged into it: GNOME's ', Windows Terminal's ". */
const DROPPED_QUOTES = /^(['"])(.*)\1$/su;

/**
 * A typed file name as the file system knows it. A file dragged into a terminal arrives quoted
 * (GNOME Terminal, Windows Terminal) or with a backslash before each space and other characters
 * that a shell reads (macOS Terminal); no shell undoes that here, and none expands a leading ~.
 * One pair of quotes around the whole answer is removed; otherwise, except on Windows, where the
 * backslash separates folders, each backslash escape is undone. A leading ~ is the home folder.
 */
export function droppedPath(answer: string, platform: NodeJS.Platform = process.platform): string {
  const text = answer.trim();
  const quoted = DROPPED_QUOTES.exec(text);
  const path =
    quoted !== null ? quoted[2]! : platform === "win32" ? text : text.replace(/\\(.)/gsu, "$1");
  if (path === "~") return homedir();
  return path.startsWith("~/") || (platform === "win32" && path.startsWith("~\\"))
    ? join(homedir(), path.slice(2))
    : path;
}
