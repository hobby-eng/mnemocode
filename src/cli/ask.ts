// Questions that are asked again until their answer can be used, on the private screen of a
// command (private-screen.ts). Nowhere may a command end abruptly and lose what the person typed:
// a wrong or unusable answer is explained in one warning line, which never repeats what was typed
// (a position such as "date 2" or "place 11" is fine), and the same question is asked again, while
// the caller keeps every earlier answer. Only the person leaves: Ctrl+C (InputCancelled, exit code
// 130), or the last choice of askAfterFailure. Inside a secret question Escape does nothing, so
// that a slip of the finger loses nothing. Every question first drops what was typed before it
// showed (dropTypedAhead), so that only keys pressed for it answer it.
//
// The API for the commands:
// - askSecretUntil(prompt, parse, { what, pastedLineBreak }): a secret, asked until `parse`
//   returns. An Error from `parse` is its one warning line. An empty answer or Ctrl+D asks again
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
  bitcoinProfiles,
  COINS,
  DEFAULT_ADDRESS_COUNT,
  MAX_ADDRESS_COUNT,
  parseBitcoinAddress,
  parseCoinAddress,
  parseMasterFingerprint,
  type AddressLocation,
  type BitcoinProfile,
  type DerivationLocation,
  type WalletEvidence,
} from "../bitcoin-evidence.js";
import type { ParsedArguments } from "./arguments.js";
import { addressCount } from "./bitcoin-options.js";
import { onPrivateScreen } from "./private-screen.js";
import { terminalNotice } from "./terminal.js";
import { choose, writePrompt, type Choice, type Explanation } from "./terminal-choice.js";
import {
  displayWidth,
  dropRestOfPaste,
  dropTypedAhead,
  InputCancelled,
  readLine,
  terminalAvailable,
  UnusableAnswer,
  withRawTerminal,
  type NextByte,
} from "./terminal-input.js";

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
   * What a line break inside a paste of several lines becomes (readLine): a space by default, so
   * that words, codes or dates pasted one per line are one answer; ";" between shares.
   */
  readonly pastedLineBreak?: " " | ";";
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
  if (!terminalAvailable())
    throw new Error(
      "--ask-secrets needs a terminal on standard input and standard error. Run the command in a terminal, or read the secret from a protected local file (--mnemonic-file, --input-file or --share-file) or from standard input (-).",
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
    readonly pastedLineBreak?: " " | ";";
  },
): Promise<Reading> {
  return withRawTerminal(async (next, moreWithin) => {
    await dropTypedAhead();
    // The end of the input is told from Ctrl+D by the reader: readLine returns nothing for both.
    let ended = false;
    let wentBack = false;
    const reader: NextByte = async () => {
      const byte = await next();
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
      });
      const trimmed = text?.trim() ?? "";
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

/** The warning for an answer that `parse` refused; InputCancelled and other throws pass through. */
function refusal(error: unknown): string {
  if (error instanceof InputCancelled || !(error instanceof Error)) throw error;
  return error.message;
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
  assertTerminal();
  const what = options.what ?? "an answer";
  for (let warning: string | undefined; ;) {
    if (warning !== undefined) terminalNotice(warning, "warning");
    const reading = await readAnswer(prompt, {
      echo: onPrivateScreen(),
      back: false,
      pastedLineBreak: options.pastedLineBreak ?? " ",
    });
    if (reading.kind === "ended") throw new InputCancelled();
    if (reading.kind === "unusable") warning = reading.reason;
    else if (reading.kind !== "answer") warning = `Type ${what}, or press Ctrl+C to stop.`;
    else
      try {
        return await parse(reading.text);
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
  assertTerminal();
  const what = options.what ?? "an answer";
  for (let warning: string | undefined; ;) {
    if (warning !== undefined) terminalNotice(warning, "warning");
    const reading = await readAnswer(prompt, { echo: true, back: true });
    if (reading.kind === "ended") throw new InputCancelled();
    if (reading.kind === "back") return undefined;
    const answer = reading.kind === "empty" ? options.fallback : undefined;
    if (reading.kind === "unusable") warning = reading.reason;
    else if (reading.kind === "empty" && answer === undefined)
      warning = `Type ${what}, or press Esc to go back.`;
    else
      try {
        return await parse(reading.kind === "answer" ? reading.text : answer!);
      } catch (error) {
        warning = refusal(error);
      }
  }
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
  await dropTypedAhead();
  const chosen = await choose(question, choices, {
    label: options.label ?? "Next",
    quit: options.escape ?? "stops",
  });
  return chosen === undefined ? last.value : chosen;
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
 * four profiles, as bitcoinEvidence (bitcoin-options.ts) takes --bitcoin-address without
 * --network, --account, --branch, --index and --bitcoin-profile.
 */
const FIRST_RECEIVING: WalletPlace = {
  location: { network: "mainnet", account: 0, branch: 0, index: 0 },
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
  const addresses = addressCount(args);
  if (addresses !== undefined && given === undefined && args["ask-secrets"] !== true)
    throw new Error(
      "--scan-gap applies to an address given with an option, or asked on the screen with --ask-secrets.",
    );
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
      { ...FIRST_RECEIVING, location: { network: "mainnet", ...given.location } },
      given.addresses,
    );
  const place = { location: given.location, profiles: given.profiles };
  return given.kind === "account-xpub" ? place : counted(place, given.addresses);
}

/** The options that say where a wallet given with an option is looked for (bitcoin-options.ts). */
const WALLET_PLACE_OPTIONS = ["network", "account", "branch", "index", "bitcoin-profile"] as const;

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
  throw new Error(
    `--${placing} applies to a wallet given as an option, such as --bitcoin-address${asked}.`,
  );
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
interface AddressRange {
  /** For the list of ways, such as "one of its first 20 receiving addresses". */
  readonly note: string;
  /** For the address prompt, such as "one of the first 20 receiving ones". */
  readonly prompt: string;
  /** For the line after an empty answer, such as "a receiving address of the wallet". */
  readonly what: string;
}

/**
 * The words for an address at `location`, or among `addresses` of them from there; without a
 * count, which is asked after the address, among the first receiving ones.
 */
function addressRange(location: AddressLocation, addresses: number | undefined): AddressRange {
  const first = location.account === 0 && location.branch === 0 && location.index === 0;
  const path = `m/.../${first ? "" : `${location.account}'/`}${location.branch}/${location.index}`;
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
    prompt: `one of the ${count}from ${path}`,
    what: `an address of the wallet from ${path}`,
  };
}

/** How a Bitcoin address on `network` may begin. */
function bitcoinAddressForms(network: DerivationLocation["network"]): string {
  return network === "mainnet"
    ? "1..., 3..., bc1q... or bc1p..."
    : "m..., n..., 2..., tb1q... or tb1p...";
}

/**
 * Asks among how many addresses from `location` the address typed is, Enter for the first 20;
 * undefined when the person goes back with Escape.
 */
async function askAddressCount(location: AddressLocation): Promise<number | undefined> {
  const first = location.account === 0 && location.branch === 0 && location.index === 0;
  const from = first
    ? "the first"
    : `m/.../${location.account}'/${location.branch}/${location.index}`;
  return askValueUntil(
    `Compare with how many addresses from ${from} (Enter: ${DEFAULT_ADDRESS_COUNT}):`,
    parseAddressCount,
    { what: "how many addresses", fallback: String(DEFAULT_ADDRESS_COUNT) },
  );
}

/** An answer to the count of addresses, as typed: a whole number from 1 through the most. */
export function parseAddressCount(answer: string): number {
  const count = /^[1-9][0-9]{0,5}$/u.test(answer) ? Number(answer) : Number.NaN;
  if (!(count <= MAX_ADDRESS_COUNT))
    throw new Error(`Type a number from 1 through ${MAX_ADDRESS_COUNT}.`);
  return count;
}

/**
 * `evidence`, an address of a wallet, compared with as many addresses as `place` says, or as the
 * person says after it; undefined when they go back from that question.
 */
async function withAddressCount(
  evidence: WalletEvidence | undefined,
  place: WalletPlace,
): Promise<WalletEvidence | undefined> {
  if (evidence === undefined || (evidence.kind !== "address" && evidence.kind !== "coin-address"))
    return evidence;
  const addresses = place.addresses ?? (await askAddressCount(place.location));
  return addresses === undefined ? undefined : { ...evidence, addresses };
}

/**
 * Asks how the wallet can be recognised: by its BIP32 master fingerprint, by the first receiving
 * address of its Bitcoin account (or the address at `place`), or, when `optional`, not at all. A
 * value that no wallet can have is refused at once and asked again; Escape at a value goes back
 * to the list.
 */
export async function askWalletEvidence(question: WalletQuestion): Promise<WalletAnswer> {
  const place = question.place ?? FIRST_RECEIVING;
  const { location, profiles } = place;
  const range = addressRange(location, place.addresses);
  for (;;) {
    await dropTypedAhead();
    const kind = await choose(
      "How can MnemoCode recognise the wallet?",
      [
        {
          label: "Fingerprint",
          // The phrase of the wallet: with Seedshift the one before the shift, which Encode calls Original.
          note: "Encode's Original, not the Encoded",
          value: "fingerprint",
        },
        {
          label: "Bitcoin address",
          note: range.note,
          example: bitcoinAddressForms(location.network),
          value: "address",
        },
        { label: "Address of another coin", note: OTHER_COINS_NOTE, value: "coin" },
        ...(question.optional
          ? [{ label: "It cannot", note: "list every candidate instead", value: "none" }]
          : []),
      ] as const,
      {
        label: "Wallet",
        ...(question.explanation === undefined ? {} : { explanation: question.explanation }),
      },
    );
    if (kind === undefined) return { kind: "back" };
    if (kind === "none") return { kind: "none" };
    const typed =
      kind === "fingerprint"
        ? await askValueUntil(
            "Original fingerprint of the wallet, such as 73c5da0a (not the encoded one):",
            (answer): WalletEvidence => ({
              kind: "master-fingerprint",
              value: parseMasterFingerprint(answer),
              network: location.network,
            }),
            { what: "the eight characters of the fingerprint" },
          )
        : kind === "coin"
          ? await askCoinAddress(location, range)
          : await askValueUntil(
              `Bitcoin address (${range.prompt}):`,
              (answer): WalletEvidence => ({
                kind: "address",
                value: parseBitcoinAddress(answer, location.network),
                profiles,
                location,
              }),
              { what: range.what },
            );
    const evidence = await withAddressCount(typed, place);
    if (evidence !== undefined) return { kind: "wallet", evidence };
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
  range: AddressRange,
): Promise<WalletEvidence | undefined> {
  await dropTypedAhead();
  const coin = await choose(
    "Which coin?",
    OTHER_COINS.map((each) => ({ label: each.name, note: each.addressForms, value: each })),
    { label: "Coin", quit: "goes back" },
  );
  if (coin === undefined) return undefined;
  const { account, branch, index } = location;
  return askValueUntil(
    `Address (${coin.name}, ${range.prompt}):`,
    (answer): WalletEvidence => ({
      kind: "coin-address",
      coin: coin.id,
      value: parseCoinAddress(coin.id, answer),
      location: { account, branch, index },
    }),
    { what: `the wallet's address of ${coin.name}` },
  );
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
