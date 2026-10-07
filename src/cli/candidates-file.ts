// Saves the candidates of a recovery as a candidate list (docs/CANDIDATES.md): record N is candidate
// N on the screen. The Discovery Scanner of the multi-chain wallet tools imports it and checks every
// candidate online. The list holds real seed phrases, and when the recovery is right, the wallet's
// own, so it is encrypted: to the Scanner's one-time key, or under a passphrase. Without either
// only on explicit request. The list, its limit, its protection and the passphrase rule are the
// core's (core/candidate-list.ts, core/candidate-encryption.ts); this module reads the options and
// files, asks on the private screen, writes the file and says what happened.

import {
  MIN_LIST_PASSPHRASE_LENGTH,
  NoProtection,
  parseListPassphrase,
  PassphraseProtection,
  ScannerKeyProtection,
  type ListProtection,
} from "../core/candidate-encryption.js";
import {
  assertListPassphrase,
  encodeCandidateList,
  MAX_CANDIDATE_RECORDS,
  TooManyForList,
} from "../core/candidate-list.js";
import { publishNewPrivateFile } from "../export/private-file.js";
import { value, type ParsedArguments } from "./arguments.js";
import { askSecretUntil } from "./ask.js";
import { readBoundedTextFile } from "./input.js";
import { discardRenamedOutput, preflightFileDestination } from "./output-paths.js";
import { onPrivateScreen } from "./private-screen.js";
import { saveWithRetry } from "./save-retry.js";
import { terminalNotice } from "./terminal.js";

/** Where the candidates go and how they are protected, known before any secret is asked. */
export interface CandidatesTarget {
  readonly path: string;
  /** None yet when the passphrase is to be asked on the private screen (prepareCandidates). */
  protection: ListProtection | undefined;
}

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

/** The candidates file given, and its protection, checked before any secret is asked. */
export async function candidatesTarget(
  args: ParsedArguments,
): Promise<CandidatesTarget | undefined> {
  const path = value(args, "candidates-file");
  if (path === undefined) {
    for (const key of [
      "candidates-key",
      "candidates-key-file",
      "candidates-passphrase-file",
      "plaintext-candidates",
    ])
      if (args[key] !== undefined) throw new Error("Give --candidates-file to save candidates.");
    return undefined;
  }
  await preflightFileDestination(path, false);
  return { path, protection: protectionOf(args) };
}

/**
 * Refuses, before any question, a BIP39 passphrase (--bip39-passphrase-file) that a list could not
 * hold, when a list is to be saved: otherwise this would show only after the secrets were typed.
 */
export function assertListable(
  target: CandidatesTarget | undefined,
  bip39Passphrase: string,
): void {
  if (target !== undefined) assertListPassphrase(bip39Passphrase);
}

/**
 * Settles what a list needs before a search can take long: the passphrase, asked twice on the
 * private screen when no file gave it, and the BIP39 passphrase that the list would hold. A short
 * passphrase, or two that differ, is asked again without a limit, so that it does not lose a
 * finished search; only Ctrl+C leaves.
 */
export async function prepareCandidates(
  target: CandidatesTarget | undefined,
  bip39Passphrase: string,
): Promise<void> {
  if (target === undefined) return;
  assertListPassphrase(bip39Passphrase);
  if (target.protection !== undefined) return;
  if (!onPrivateScreen())
    throw new Error("Give the passphrase for the candidates with --candidates-passphrase-file.");
  for (;;) {
    const first = await askSecretUntil("Passphrase for the candidates list:", parseListPassphrase, {
      what: `a passphrase of at least ${MIN_LIST_PASSPHRASE_LENGTH} characters`,
    });
    const again = await askSecretUntil("The same passphrase again:", (answer) => answer, {
      what: "the same passphrase again",
    });
    if (again === first) {
      target.protection = new PassphraseProtection(first);
      return;
    }
    // Either of the two may be the mistyped one, so both are asked again.
    terminalNotice("The two passphrases differ: type both again.", "warning");
  }
}

/** How any search is narrowed when its candidates are more than a list holds. */
const NARROW_ANY_SEARCH = "narrow the search, or give the wallet's fingerprint";

/** How another name for the list is checked before it is used. */
function checkedName(path: string): Promise<void> {
  return preflightFileDestination(path, false);
}

/**
 * For a list that is not saved after all, such as one of more candidates than a list holds: says
 * so, and the numbered name it was given is not reported.
 */
export function discardCandidates(target: CandidatesTarget): void {
  discardRenamedOutput(target.path);
  terminalNotice("No list was saved; no file was written.", "warning");
}

/**
 * Saves the BIP39 entropies of the candidates, in their order, as a candidate list, with
 * `passphrase`, the BIP39 passphrase of the wallet if one was given, for all of them.
 */
export async function saveCandidates(
  target: CandidatesTarget,
  entropies: readonly Uint8Array[],
  passphrase = "",
): Promise<void> {
  if (entropies.length === 0) {
    discardRenamedOutput(target.path);
    terminalNotice("No candidate to save; no file was written.", "warning");
    return;
  }
  // The searches refuse a list before this; here only a fault of MnemoCode would be refused.
  if (entropies.length > MAX_CANDIDATE_RECORDS) throw new TooManyForList(NARROW_ANY_SEARCH);
  await prepareCandidates(target, passphrase);
  // prepareCandidates has settled the protection, or refused.
  const protection = target.protection!;
  const records = entropies.map((entropy) => ({ entropy }));
  const plain = encodeCandidateList({ ...(passphrase === "" ? {} : { passphrase }), records });
  let saved: string | undefined;
  try {
    const bytes = await protection.protect(plain);
    // A save that fails on the private screen is offered again, under another name, or skipped,
    // and the candidates stay on the screen (save-retry.ts).
    saved = await saveWithRetry({
      what: "The candidate list",
      kind: "file",
      path: target.path,
      write: (path) => publishNewPrivateFile(path, bytes),
      checkName: checkedName,
    });
  } finally {
    plain.fill(0);
  }
  if (saved === undefined) return;
  terminalNotice(
    `Saved ${entropies.length.toLocaleString("en-US")} candidate ${entropies.length === 1 ? "phrase" : "phrases"}, ${protection.description}: ${saved} (record N is candidate N).`,
    "success",
  );
  terminalNotice(
    protection.encrypted
      ? "Delete the file once the wallet is found."
      : "This file holds real seed phrases in the open: keep it offline, and delete it once the wallet is found.",
    "warning",
  );
}
