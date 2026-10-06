import { businessOptionNames } from "./business-options.js";
import { imageOptionNames } from "./image-options.js";
import { sskrExportOptions, sskrInputOptions } from "./sskr-command.js";

// The options each command accepts, by their parser keys ("--dates" is stored as "date" and
// "--events" as "event"). The command line refuses any other option, and the help of a command
// documents exactly these; a test keeps the two in step.

const bitcoinEvidenceOptions = [
  "bitcoin-address",
  "master-xpub",
  "account-xpub",
  "compressed-public-key",
  "master-fingerprint",
  "wif-file",
  "network",
  "bitcoin-profile",
  "account",
  "branch",
  "index",
  "bip39-passphrase-file",
] as const;

/** A candidate list for the Discovery Scanner, and its protection (candidates-file.ts). */
const candidateListOptions = [
  "candidates-file",
  "candidates-key",
  "candidates-key-file",
  "candidates-passphrase-file",
  "plaintext-candidates",
] as const;

export const commandOptions = {
  encode: [
    "mode",
    "mnemonic",
    "mnemonic-file",
    "ask-secrets",
    "legacy-valid-last-word",
    "date",
    "format",
    "output",
    "cards",
    "qr",
    "pdf",
    "heir-sheet",
    "heir-sheet-size",
    "cards-dir",
    "sskr",
    "threshold",
    "shares",
    "share-format",
    "card-layout",
    "template",
    "title",
    "event",
    ...imageOptionNames,
    ...businessOptionNames,
  ],
  decode: ["mode", "input", "input-file", "qr-file", "ask-secrets", "date", "format"],
  "recover-date": [
    "mode",
    "input",
    "input-file",
    "qr-file",
    "ask-secrets",
    "date",
    "format",
    ...bitcoinEvidenceOptions,
    "max-results",
    "max-candidates",
    "progress-every",
    ...candidateListOptions,
  ],
  "recover-word": [
    "mnemonic",
    "mnemonic-file",
    "ask-secrets",
    "legacy-valid-last-word",
    "missing-word",
    ...candidateListOptions,
    ...bitcoinEvidenceOptions,
  ],
  "sskr-combine": [
    "mode",
    "date",
    ...sskrInputOptions,
    "max-tries",
    ...candidateListOptions,
    ...bitcoinEvidenceOptions,
  ],
  "sskr-export": [
    "mode",
    "date",
    "max-tries",
    ...bitcoinEvidenceOptions,
    "format",
    "output",
    "pdf",
    ...imageOptionNames,
    ...sskrInputOptions,
    ...sskrExportOptions,
  ],
  "sskr-split": [
    "mode",
    "mnemonic",
    "mnemonic-file",
    "ask-secrets",
    "date",
    "threshold",
    "shares",
    "format",
    "output",
    "pdf",
    ...imageOptionNames,
    ...sskrExportOptions,
  ],
  preview: [
    "list",
    "all",
    "pdf",
    "cards-dir",
    "template",
    "title",
    "words",
    ...imageOptionNames,
    ...businessOptionNames,
  ],
  table: ["index", "word", "unicode", "all"],
  "self-test": [],
} as const satisfies Record<string, readonly string[]>;

export type CommandName = keyof typeof commandOptions;

export function isCommandName(name: string): name is CommandName {
  return Object.hasOwn(commandOptions, name);
}
