import { WALLET_EVIDENCE_OPTIONS } from "./bitcoin-options.js";
import { businessOptionNames } from "./business-options.js";
import { ENCODE_OPTIONS } from "./encode-option-groups.js";
import { CANDIDATE_LIST_OPTIONS } from "./candidates-file.js";
import { DRAWING_OPTIONS } from "./output-options.js";
import { sskrExportOptions, sskrInputOptions } from "./sskr-command.js";
import { asksNewBackup, RE_ENCODE_OPTIONS } from "./re-encode-options.js";
import type { ParsedArguments } from "./arguments.js";

// The options each command accepts, by their parser keys ("--dates" is stored as "date"). The
// command line refuses any other option, and the help of a command documents exactly these; a test
// keeps the two in step.

/** The flags that ask for help: the short one for a summary, the long one for everything. */
export const HELP_FLAGS = Object.freeze({ short: "-h", long: "--help" } as const);
/** The flags that ask for the version. */
export const VERSION_FLAGS = Object.freeze({ short: "-V", long: "--version" } as const);

/** "-h, --help": both flags as the help names them. */
export function flagPair(flags: { readonly short: string; readonly long: string }): string {
  return `${flags.short}, ${flags.long}`;
}

/** Whether `argument` is one of `flags`. */
export function isFlagOf(
  flags: { readonly short: string; readonly long: string },
  argument: string | undefined,
): boolean {
  return argument === flags.short || argument === flags.long;
}

export const commandOptions = {
  encode: [...ENCODE_OPTIONS],
  decode: [
    "mode",
    "input",
    "input-file",
    "qr-file",
    "ask-secrets",
    "date",
    "format",
    "words",
    "input-kind",
    "encoded-fingerprint",
    ...WALLET_EVIDENCE_OPTIONS,
    "list-candidates",
    "max-results",
    "max-candidates",
    "max-tries",
  ],
  "re-encode": RE_ENCODE_OPTIONS,
  "recover-date": [
    "mode",
    "input",
    "input-file",
    "qr-file",
    "ask-secrets",
    "date",
    "format",
    "words",
    ...WALLET_EVIDENCE_OPTIONS,
    "max-results",
    "max-candidates",
    "progress-every",
    ...CANDIDATE_LIST_OPTIONS,
  ],
  "recover-word": [
    "mnemonic",
    "mnemonic-file",
    "ask-secrets",
    "legacy-valid-last-word",
    "missing-word",
    ...CANDIDATE_LIST_OPTIONS,
    ...WALLET_EVIDENCE_OPTIONS,
  ],
  "sskr-combine": [
    "mode",
    "date",
    ...sskrInputOptions,
    "max-tries",
    "max-candidates",
    ...CANDIDATE_LIST_OPTIONS,
    ...WALLET_EVIDENCE_OPTIONS,
  ],
  "sskr-export": [
    "mode",
    "date",
    "max-tries",
    "max-candidates",
    ...WALLET_EVIDENCE_OPTIONS,
    "format",
    "output",
    "pdf",
    ...DRAWING_OPTIONS,
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
    "heir-sheet",
    "heir-sheet-size",
    "backup-check",
    ...DRAWING_OPTIONS,
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
    ...DRAWING_OPTIONS,
    ...businessOptionNames,
  ],
  table: [
    "index",
    "word",
    "unicode",
    "all",
    "table-format",
    "output",
    "recovery-guide",
    "word-lists-dir",
  ],
  "self-test": [],
} as const satisfies Record<string, readonly string[]>;

export type CommandName = keyof typeof commandOptions;

/** What the command line must know of a command before it runs it. */
export interface CommandFacts {
  /** It takes or shows a secret: it runs under the full protection, on the private screen. */
  readonly secret: boolean;
  /** It writes files whatever its options say, as the self-test writes its cards. */
  readonly alwaysWrites: boolean;
  /** It runs after the quick self-test of the core; the self-test is that test itself. */
  readonly coreSelfTest: boolean;
  /** It is listed in the overview of the commands; sskr-split is an older name of encode --sskr. */
  readonly listed: boolean;
  /**
   * Whether it asks on its private screen where its results go, so that what it gives up before
   * its first question (dropUnneeded) must leave what any answer may need, as re-encode does
   * without options of its new backup.
   */
  readonly asksOutputs?: (args: ParsedArguments) => boolean;
}

/** A command that takes or shows a secret, as most do. */
const SECRET: CommandFacts = Object.freeze({
  secret: true,
  alwaysWrites: false,
  coreSelfTest: true,
  listed: true,
});
/** A command that shows no secret. */
const PUBLIC: CommandFacts = Object.freeze({ ...SECRET, secret: false });

/** The facts of every command; a command without its facts does not compile. */
export const COMMAND_FACTS: Readonly<Record<CommandName, CommandFacts>> = Object.freeze({
  encode: SECRET,
  decode: SECRET,
  "re-encode": Object.freeze({ ...SECRET, asksOutputs: asksNewBackup }),
  "recover-date": SECRET,
  "recover-word": SECRET,
  "sskr-combine": SECRET,
  "sskr-export": SECRET,
  "sskr-split": Object.freeze({ ...SECRET, listed: false }),
  preview: PUBLIC,
  table: PUBLIC,
  "self-test": Object.freeze({ ...PUBLIC, alwaysWrites: true, coreSelfTest: false }),
});

/** The commands that take a secret or show one; at a terminal they run on the private screen. */
export const PRIVATE_SCREEN_COMMANDS: ReadonlySet<string> = new Set(
  (Object.keys(COMMAND_FACTS) as CommandName[]).filter((name) => COMMAND_FACTS[name].secret),
);

export function isCommandName(name: string): name is CommandName {
  return Object.hasOwn(commandOptions, name);
}
