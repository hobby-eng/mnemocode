// Saves the candidates of a recovery as a candidate list (docs/CANDIDATES.md): record N is
// candidate N on the screen. The Discovery Scanner of the multi-chain wallet tools imports it and
// checks every candidate online. The list holds real seed phrases, and when the recovery is right,
// the wallet's own, so it is encrypted: to the Scanner's one-time key, or under a passphrase.
// Without either only on explicit request. The list, its limit, its protection and the passphrase
// rule are the core's (core/candidate-list.ts, core/candidate-encryption.ts); this module reads the
// options and files, asks on the private screen, writes the file and says what happened.

import {
  MIN_LIST_PASSPHRASE_LENGTH,
  NoProtection,
  parseListPassphrase,
  PassphraseProtection,
  ScannerKeyProtection,
  type ListProtection,
} from "../core/candidate-encryption.js";
import { assertListPassphrase, TooManyForListError } from "../core/candidate-list.js";
import {
  CandidateListWriter,
  NO_CANDIDATE_TO_SAVE,
  type ListOutcome,
} from "../core/candidate-list-writer.js";
import { publishNewPrivateFile } from "../export/private-file.js";
import { value, type ParsedArguments } from "./arguments.js";
import { askSecretUntil } from "./ask.js";
import { readBoundedTextFile } from "./text-file.js";
import { discardRenamedOutput, preflightFileDestination } from "./output-paths.js";
import { onPrivateScreen } from "./private-screen.js";
import { terminalNotice } from "./terminal.js";
import { saveOutput } from "./output-saving.js";
import { counted } from "../core/search-plan.js";

/**
 * The protection chosen with the options; none when, on the private screen, a passphrase is asked
 * later.
 */
function protectionOf(args: ParsedArguments): ListProtection | undefined {
  const key = value(args, "candidates-key");
  const keyFile = value(args, "candidates-key-file");
  const passphraseFile = value(args, "candidates-passphrase-file");
  const plaintext = args["plaintext-candidates"] === true;
  const given = [key, keyFile, passphraseFile].filter((item) => item !== undefined).length;
  if (given + (plaintext ? 1 : 0) > 1)
    throw new Error(
      "Choose one protection for the candidates: the Scanner's key, a passphrase, or none.",
    );
  if (key !== undefined) return new ScannerKeyProtection(key);
  if (keyFile !== undefined)
    return new ScannerKeyProtection(readBoundedTextFile(keyFile, "The Scanner's key file"));
  if (passphraseFile !== undefined)
    return new PassphraseProtection(readBoundedTextFile(passphraseFile, "The passphrase file"));
  if (plaintext) return new NoProtection();
  if (args["ask-secrets"] === true) return undefined;
  throw new Error(
    "Protect the candidates with --candidates-key (the Scanner's age1 key), --candidates-key-file or --candidates-passphrase-file; --plaintext-candidates writes them without encryption.",
  );
}

/** How a candidate list is protected; each needs --candidates-file. */
const CANDIDATE_PROTECTION_OPTIONS = [
  "candidates-key",
  "candidates-key-file",
  "candidates-passphrase-file",
  "plaintext-candidates",
] as const;

/** A candidate list for the Discovery Scanner, and its protection. */
export const CANDIDATE_LIST_OPTIONS = ["candidates-file", ...CANDIDATE_PROTECTION_OPTIONS] as const;

/**
 * The candidate list to save: where it goes and how it is protected, settled before any secret is
 * asked, and written once a search found its phrases. A class, because the protection may be
 * asked later, once, on the private screen, and every save then uses the same writer
 * (CandidateListWriter), which owns the list itself.
 */
export class CandidatesFile {
  /** The options of the command, whose other outputs another name is checked against. */
  readonly #args: ParsedArguments;
  readonly #path: string;
  #protection: ListProtection | undefined;
  #writer: { readonly passphrase: string; readonly writer: CandidateListWriter } | undefined;

  private constructor(args: ParsedArguments, path: string, protection: ListProtection | undefined) {
    this.#args = args;
    this.#path = path;
    this.#protection = protection;
  }

  /** The candidates file given, and its protection, checked before any secret is asked. */
  static async of(args: ParsedArguments): Promise<CandidatesFile | undefined> {
    const path = value(args, "candidates-file");
    if (path === undefined) {
      for (const key of CANDIDATE_PROTECTION_OPTIONS)
        if (args[key] !== undefined) throw new Error("Give --candidates-file to save candidates.");
      return undefined;
    }
    await preflightFileDestination(path, false);
    return new CandidatesFile(args, path, protectionOf(args));
  }

  /**
   * Refuses, before any question, a BIP39 passphrase (--bip39-passphrase-file) that a list could
   * not hold: otherwise this would show only after the secrets were typed.
   */
  assertListable(bip39Passphrase: string): void {
    assertListPassphrase(bip39Passphrase);
  }

  /**
   * Settles what the list needs before a search can take long: the passphrase, asked twice on the
   * private screen when no file gave it, and the BIP39 passphrase that the list would hold. A short
   * passphrase, or two that differ, is asked again without a limit, so that it does not lose a
   * finished search; only Ctrl+C leaves.
   */
  async prepare(bip39Passphrase: string): Promise<CandidateListWriter> {
    if (this.#writer?.passphrase === bip39Passphrase) return this.#writer.writer;
    assertListPassphrase(bip39Passphrase);
    this.#protection ??= await askListPassphrase();
    const writer = new CandidateListWriter(this.#protection, bip39Passphrase);
    this.#writer = { passphrase: bip39Passphrase, writer };
    return writer;
  }

  /**
   * For a list that is not saved after all, such as one of more candidates than a list holds: says
   * so, and the numbered name it was given is not reported.
   */
  discard(): void {
    discardRenamedOutput(this.#path);
    terminalNotice("No list was saved; no file was written.", "warning");
  }

  /** Saves `phrases`, English BIP39 phrases in their order, with `bip39Passphrase` for all. */
  async savePhrases(phrases: readonly string[], bip39Passphrase = ""): Promise<void> {
    await this.#save((await this.prepare(bip39Passphrase)).writePhrases(phrases));
  }

  /** Saves the BIP39 `entropies` of the candidates; they are wiped once the list is made. */
  async saveEntropies(entropies: Uint8Array[], bip39Passphrase = ""): Promise<void> {
    await this.#save((await this.prepare(bip39Passphrase)).write(entropies));
  }

  async #save(made: Promise<ListOutcome>): Promise<void> {
    const outcome = await made;
    if (outcome.kind === "empty") {
      discardRenamedOutput(this.#path);
      terminalNotice(NO_CANDIDATE_TO_SAVE, "warning");
      return;
    }
    // The searches refuse a list before this; here only a fault of MnemoCode would be refused.
    if (outcome.kind === "full") throw new TooManyForListError(NARROW_ANY_SEARCH);
    const { list } = outcome;
    // A save that fails on the private screen is offered again, under another name, or skipped,
    // and the candidates stay on the screen (save-retry.ts).
    let saved: string | undefined;
    try {
      saved = await saveOutput(this.#args, "candidates-file", "The candidate list", (path) =>
        publishNewPrivateFile(path, list.bytes),
      );
    } finally {
      // A list without encryption holds every candidate's entropy in the open; it is wiped once
      // written, skipped or refused (CandidateListFile.bytes).
      list.bytes.fill(0);
    }
    if (saved === undefined) return;
    terminalNotice(
      `Saved ${counted(list.records, "candidate phrase")}, ${list.description}: ${saved} (record N is candidate N).`,
      "success",
    );
    terminalNotice(
      list.encrypted
        ? "Delete the file once the wallet is found."
        : "This file holds real seed phrases in the open: keep it offline, and delete it once the wallet is found.",
      "warning",
    );
  }
}

/** The passphrase for a list, asked twice on the private screen until both agree. */
async function askListPassphrase(): Promise<ListProtection> {
  if (!onPrivateScreen())
    throw new Error("Give the passphrase for the candidates with --candidates-passphrase-file.");
  for (;;) {
    const first = await askSecretUntil("Passphrase for the candidates list:", parseListPassphrase, {
      what: `a passphrase of at least ${MIN_LIST_PASSPHRASE_LENGTH} characters`,
    });
    const again = await askSecretUntil("The same passphrase again:", (answer) => answer, {
      what: "the same passphrase again",
    });
    if (again === first) return new PassphraseProtection(first);
    // Either of the two may be the mistyped one, so both are asked again.
    terminalNotice("The two passphrases differ: type both again.", "warning");
  }
}

/** How any search is narrowed when its candidates are more than a list holds. */
const NARROW_ANY_SEARCH = "narrow the search, or give the wallet's fingerprint";
