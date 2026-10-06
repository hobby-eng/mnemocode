// Saves the candidates of a recovery as a candidate list (docs/CANDIDATES.md): record N is candidate
// N on the screen. The Discovery Scanner of the multi-chain wallet tools imports it and checks every
// candidate online. The list holds real seed phrases, and when the recovery is right, the wallet's
// own, so it is encrypted: to the Scanner's one-time key, or under a passphrase. Without either
// only on explicit request.

import {
  encryptCandidates,
  encryptCandidatesWithPassphrase,
  parseRecipient,
} from "../core/candidate-encryption.js";
import {
  assertListPassphrase,
  encodeCandidateList,
  MAX_CANDIDATE_RECORDS,
} from "../core/candidate-list.js";
import { publishNewPrivateFile } from "../export/private-file.js";
import { value, type ParsedArguments } from "./arguments.js";
import { askSecret, readBoundedTextFile } from "./input.js";
import { discardRenamedOutput, preflightFileDestination } from "./output-paths.js";
import { onPrivateScreen } from "./private-screen.js";
import { terminalNotice } from "./terminal.js";

/** Shorter passphrases are refused: the passphrase is all that protects the seed phrases. */
const MIN_PASSPHRASE_LENGTH = 12;
/** Tries at the private screen's passphrase question before giving up. */
const PASSPHRASE_TRIES = 3;
const BYTE_ORDER_MARK = "﻿";

/** How the list is protected: the Scanner's key, a passphrase, or nothing on explicit request. */
type Protection =
  | { readonly kind: "key"; readonly recipient: string }
  | { readonly kind: "passphrase"; passphrase?: string }
  | { readonly kind: "plaintext" };

/** Where the candidates go and how they are protected, known before any secret is asked. */
export interface CandidatesTarget {
  readonly path: string;
  readonly protection: Protection;
}

/**
 * The passphrase of a list as docs/CANDIDATES.md defines it: the text as entered, without white
 * space at its ends; from a file also without a byte order mark. A short one is refused.
 */
function listPassphrase(text: string): string {
  const passphrase = text.replace(new RegExp(`^${BYTE_ORDER_MARK}`, "u"), "").trim();
  if ([...passphrase].length < MIN_PASSPHRASE_LENGTH)
    throw new Error(
      `Use at least ${MIN_PASSPHRASE_LENGTH} characters for the passphrase: it is all that protects these seed phrases.`,
    );
  return passphrase;
}

/** The protection chosen with the options; on the private screen a passphrase may be asked later. */
function protectionOf(args: ParsedArguments): Protection {
  const key = value(args, "candidates-key");
  const keyFile = value(args, "candidates-key-file");
  const passphraseFile = value(args, "candidates-passphrase-file");
  const plaintext = args["plaintext-candidates"] === true;
  const given = [key, keyFile, passphraseFile].filter((item) => item !== undefined).length;
  if (given + (plaintext ? 1 : 0) > 1)
    throw new Error(
      "Choose one protection for the candidates: the Scanner's key, a passphrase, or none.",
    );
  if (key !== undefined) return { kind: "key", recipient: parseRecipient(key) };
  if (keyFile !== undefined)
    return {
      kind: "key",
      recipient: parseRecipient(readBoundedTextFile(keyFile, "The Scanner's key file")),
    };
  if (passphraseFile !== undefined)
    return {
      kind: "passphrase",
      passphrase: listPassphrase(readBoundedTextFile(passphraseFile, "The passphrase file")),
    };
  if (plaintext) return { kind: "plaintext" };
  if (args["ask-secrets"] === true) return { kind: "passphrase" };
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
 * Settles what a list needs before a search can take long: the passphrase, asked twice on the
 * private screen when no file gave it, and the BIP39 passphrase that the list would hold. A typing
 * error is asked again, so that it does not lose a finished search.
 */
export async function prepareCandidates(
  target: CandidatesTarget | undefined,
  bip39Passphrase: string,
): Promise<void> {
  if (target === undefined) return;
  assertListPassphrase(bip39Passphrase);
  const { protection } = target;
  if (protection.kind !== "passphrase" || protection.passphrase !== undefined) return;
  if (!onPrivateScreen())
    throw new Error("Give the passphrase for the candidates with --candidates-passphrase-file.");
  for (let attempt = 1; ; attempt += 1) {
    try {
      const first = listPassphrase(await askSecret("Passphrase for the candidates list:"));
      if ((await askSecret("The same passphrase again:")).trim() !== first)
        throw new Error("The two passphrases differ.");
      protection.passphrase = first;
      return;
    } catch (error) {
      if (attempt === PASSPHRASE_TRIES) throw error;
      terminalNotice(`${(error as Error).message} Try again.`, "warning");
    }
  }
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
  if (entropies.length > MAX_CANDIDATE_RECORDS)
    throw new Error(
      `${entropies.length.toLocaleString("en-US")} candidates are more than one list holds (${MAX_CANDIDATE_RECORDS.toLocaleString("en-US")}): give more of the words, or the wallet's fingerprint.`,
    );
  await prepareCandidates(target, passphrase);
  const records = entropies.map((entropy) => ({ entropy }));
  const plain = encodeCandidateList({ ...(passphrase === "" ? {} : { passphrase }), records });
  const { protection } = target;
  try {
    const bytes =
      protection.kind === "key"
        ? await encryptCandidates(plain, protection.recipient)
        : protection.kind === "passphrase"
          ? await encryptCandidatesWithPassphrase(plain, protection.passphrase!)
          : plain;
    await publishNewPrivateFile(target.path, bytes);
  } finally {
    plain.fill(0);
  }
  const how =
    protection.kind === "key"
      ? "encrypted to the Scanner's key"
      : protection.kind === "passphrase"
        ? "encrypted with the passphrase"
        : "NOT encrypted";
  terminalNotice(
    `Saved ${entropies.length.toLocaleString("en-US")} candidate ${entropies.length === 1 ? "phrase" : "phrases"}, ${how}: ${target.path} (record N is candidate N).`,
    "success",
  );
  terminalNotice(
    protection.kind === "plaintext"
      ? "This file holds real seed phrases in the open: keep it offline, and delete it once the wallet is found."
      : "Delete the file once the wallet is found.",
    "warning",
  );
}
