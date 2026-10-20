// Saves the candidates of a recovery as a candidate list (docs/CANDIDATES.md): record N is
// candidate N on the screen. The Discovery Scanner of the multi-chain wallet tools imports it and
// checks every candidate online. The list holds real seed phrases, and when the recovery is right,
// the wallet's own, so it is encrypted: to the Scanner's one-time key, or under a passphrase.
// Without either only on explicit request. The list, its limit, its protection and the passphrase
// rule are the core's (core/candidate-list.ts, core/candidate-encryption.ts); this module reads the
// options and files, asks on the private screen, writes the file and says what happened.

import {
  MIN_LIST_PASSPHRASE_LENGTH,
  assertCandidateEncryptionReady,
  NoProtection,
  parseListPassphrase,
  PassphraseProtection,
  ScannerKeyProtection,
  type OwnedListProtection,
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
import { CANCELLED, type Cancelled } from "./terminal-keys.js";
import { wipeAll } from "../core/bits.js";
import { readBoundedTextFile } from "./text-file.js";
import { RenamedOutputs, preflightFileDestination } from "./output-paths.js";
import { onPrivateScreen } from "./private-screen.js";
import {
  printableText,
  terminalLastingWarning,
  terminalNotice,
  terminalSaved,
} from "./terminal.js";
import { saveOutput } from "./output-saving.js";
import { counted } from "../core/search-plan.js";
import { ErrorCatalog } from "../core/error-catalog.js";

const ERRORS = new ErrorCatalog("cli.candidates-file", {
  wiped: () => "This candidate-list output has been wiped.",
  "choose-one-protection-candidates-scanner-s-key-passphrase": () =>
    "Choose one protection for the candidates: the Scanner's key, a passphrase, or none.",
  "protect-candidates-candidates-key-scanner-s-age1-key": () =>
    "Protect the candidates with --candidates-key (the Scanner's age1 key), --candidates-key-file or --candidates-passphrase-file; --plaintext-candidates writes them without encryption.",
  "give-candidates-file-save-candidates": () => "Give --candidates-file to save candidates.",
  "give-passphrase-candidates-candidates-passphrase-file": () =>
    "Give the passphrase for the candidates with --candidates-passphrase-file.",
});

/**
 * The protection chosen with the options; none when, on the private screen, a passphrase is asked
 * later.
 */
async function protectionOf(args: ParsedArguments): Promise<OwnedListProtection | undefined> {
  const key = value(args, "candidates-key");
  const keyFile = value(args, "candidates-key-file");
  const passphraseFile = value(args, "candidates-passphrase-file");
  const plaintext = args["plaintext-candidates"] === true;
  const given = [key, keyFile, passphraseFile].filter((item) => item !== undefined).length;
  if (given + (plaintext ? 1 : 0) > 1)
    throw ERRORS.create("choose-one-protection-candidates-scanner-s-key-passphrase", []);
  if (key !== undefined) {
    await assertCandidateEncryptionReady("key");
    return new ScannerKeyProtection(key);
  }
  if (keyFile !== undefined) {
    await assertCandidateEncryptionReady("key");
    return new ScannerKeyProtection(readBoundedTextFile(keyFile, "The Scanner's key file"));
  }
  if (passphraseFile !== undefined) {
    await assertCandidateEncryptionReady("passphrase");
    return new PassphraseProtection(readBoundedTextFile(passphraseFile, "The passphrase file"));
  }
  if (plaintext) return new NoProtection();
  if (args["ask-secrets"] === true) return undefined;
  throw ERRORS.create("protect-candidates-candidates-key-scanner-s-age1-key", []);
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
  #protection: OwnedListProtection | undefined;
  #writer: CandidateListWriter | undefined;
  #wiped = false;

  private constructor(
    args: ParsedArguments,
    path: string,
    protection: OwnedListProtection | undefined,
  ) {
    this.#args = args;
    this.#path = path;
    this.#protection = protection;
  }

  /** The candidates file given, and its protection, checked before any secret is asked. */
  static async of(args: ParsedArguments): Promise<CandidatesFile | undefined> {
    const path = value(args, "candidates-file");
    if (path === undefined) {
      for (const key of CANDIDATE_PROTECTION_OPTIONS)
        if (args[key] !== undefined)
          throw ERRORS.create("give-candidates-file-save-candidates", []);
      return undefined;
    }
    await preflightFileDestination(path, false);
    return new CandidatesFile(args, path, await protectionOf(args));
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
   * finished search; only Ctrl+C leaves, which gives CANCELLED.
   */
  async prepare(bip39Passphrase: string): Promise<CandidateListWriter | Cancelled> {
    if (this.#wiped) throw ERRORS.create("wiped", []);
    if (this.#writer?.usesPassphrase(bip39Passphrase) === true) return this.#writer;
    assertListPassphrase(bip39Passphrase);
    const protection = this.#protection ?? (await askListPassphrase());
    if (protection === CANCELLED) return CANCELLED;
    if (this.#wiped) {
      protection.wipe();
      throw ERRORS.create("wiped", []);
    }
    this.#protection = protection;
    const writer = new CandidateListWriter(protection, bip39Passphrase);
    this.#writer?.wipe();
    this.#writer = writer;
    return writer;
  }

  /** Releases this output's own writer/protection; callers finish asynchronous saves first. */
  wipe(): void {
    this.#wiped = true;
    this.#writer?.wipe();
    this.#protection?.wipe();
    this.#writer = undefined;
    this.#protection = undefined;
  }

  /** Ends the command's candidate-output scope on success, failure and cancellation. */
  [Symbol.dispose](): void {
    this.wipe();
  }

  /**
   * For a list that is not saved after all, such as one of more candidates than a list holds: says
   * so, and the numbered name it was given is not reported.
   */
  discard(): void {
    RenamedOutputs.discard(this.#path);
    terminalLastingWarning("No list was saved; no file was written.");
  }

  /**
   * Saves `phrases`, English BIP39 phrases in their order, with `bip39Passphrase` for all;
   * CANCELLED at Ctrl+C.
   */
  async savePhrases(
    phrases: readonly string[],
    bip39Passphrase = "",
  ): Promise<Cancelled | undefined> {
    const writer = await this.prepare(bip39Passphrase);
    if (writer === CANCELLED) return CANCELLED;
    return this.#save(writer.writePhrases(phrases));
  }

  /**
   * Saves the BIP39 `entropies` of the candidates; they are wiped once the list is made, or at once
   * when the person cancels (CANCELLED).
   */
  async saveEntropies(
    entropies: Uint8Array[],
    bip39Passphrase = "",
  ): Promise<Cancelled | undefined> {
    try {
      const writer = await this.prepare(bip39Passphrase);
      if (writer === CANCELLED) return CANCELLED;
      return await this.#save(writer.write(entropies));
    } finally {
      wipeAll(entropies);
    }
  }

  async #save(made: Promise<ListOutcome>): Promise<Cancelled | undefined> {
    const outcome = await made;
    if (outcome.kind === "empty") {
      RenamedOutputs.discard(this.#path);
      terminalLastingWarning(NO_CANDIDATE_TO_SAVE);
      return undefined;
    }
    // The searches refuse a list before this; here only a fault of MnemoCode would be refused.
    if (outcome.kind === "full") throw new TooManyForListError(NARROW_ANY_SEARCH);
    const { list } = outcome;
    // A save that fails on the private screen is offered again, under another name, or skipped,
    // and the candidates stay on the screen (save-retry.ts).
    let saved: string | undefined | Cancelled;
    try {
      saved = await saveOutput(
        this.#args,
        "candidates-file",
        { what: "The candidate list" },
        (path) => publishNewPrivateFile(path, list.bytes),
      );
    } finally {
      // A list without encryption holds every candidate's entropy in the open; it is wiped once
      // written, skipped or refused (CandidateListFile.bytes).
      list.bytes.fill(0);
    }
    if (saved === undefined || saved === CANCELLED) return saved;
    terminalSaved(
      `Saved ${counted(list.records, "candidate phrase")}, ${list.description}: ${printableText(saved)} (record N is candidate N).`,
    );
    terminalLastingWarning(
      list.encrypted
        ? "Delete the file once the wallet is found."
        : "This file holds real seed phrases in the open: keep it offline, and delete it once the wallet is found.",
    );
    return undefined;
  }
}

const LIST_PASSPHRASE_ROLE = "candidate list encryption passphrase (not the BIP39 passphrase)";

/** The passphrase for a list, asked twice on the private screen until both agree. */
async function askListPassphrase(): Promise<OwnedListProtection | Cancelled> {
  if (!onPrivateScreen())
    throw ERRORS.create("give-passphrase-candidates-candidates-passphrase-file", []);
  await assertCandidateEncryptionReady("passphrase");
  for (;;) {
    const first = await askSecretUntil(`Enter the ${LIST_PASSPHRASE_ROLE}:`, parseListPassphrase, {
      what: `a passphrase of at least ${MIN_LIST_PASSPHRASE_LENGTH} characters`,
    });
    if (first === CANCELLED) return CANCELLED;
    const again = await askSecretUntil(`Repeat the ${LIST_PASSPHRASE_ROLE}:`, (answer) => answer, {
      what: "the same passphrase again",
    });
    if (again === CANCELLED) return CANCELLED;
    if (again === first) return new PassphraseProtection(first);
    // Either of the two may be the mistyped one, so both are asked again.
    terminalNotice("The two passphrases differ: type both again.", "warning");
  }
}

/** How any search is narrowed when its candidates are more than a list holds. */
const NARROW_ANY_SEARCH = "narrow the search, or give the wallet's fingerprint";
