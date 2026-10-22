import { WALLET_EVIDENCE_OPTIONS } from "./bitcoin-options.js";
import { BUSINESS_OPTION_NAMES } from "./business-options.js";
import { ENCODE_OPTIONS } from "./encode-option-groups.js";
import { CANDIDATE_LIST_OPTIONS } from "./candidates-file.js";
import { DRAWING_OPTIONS } from "./output-options.js";
import { SSKR_EXPORT_OPTIONS } from "./sskr-output.js";
import { SSKR_INPUT_OPTIONS } from "./sskr-restore-command.js";
import { asksNewBackup, RE_ENCODE_OPTIONS } from "./re-encode-options.js";
import type { ParsedArguments } from "./arguments.js";

// Recognized parser keys, including legacy material keys that the argv policy refuses first.
// Help names those refused forms explicitly, and a test keeps every recognized option documented.

/** A flag in its short and its long form. */
interface FlagPair {
  /** The short form, such as "-h". */
  readonly short: string;
  /** The long form, such as "--help". */
  readonly long: string;
}

/** The flags that ask for help: the short one for a summary, the long one for everything. */
export const HELP_FLAGS = Object.freeze({ short: "-h", long: "--help" } as const);
/** The flags that ask for the version. */
export const VERSION_FLAGS = Object.freeze({ short: "-V", long: "--version" } as const);

/** "-h, --help": both flags as the help names them. */
export function flagPair(flags: FlagPair): string {
  return `${flags.short}, ${flags.long}`;
}

/** Whether `argument` is one of `flags`. */
export function isFlagOf(flags: FlagPair, argument: string | undefined): boolean {
  return argument === flags.short || argument === flags.long;
}

export const COMMAND_OPTIONS = {
  encode: [...ENCODE_OPTIONS],
  decode: [
    "mode",
    "input",
    "input-file",
    "qr-file",
    "ask-secrets",
    "date",
    "dates-file",
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
    "dates-file",
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
    "dates-file",
    ...SSKR_INPUT_OPTIONS,
    "max-tries",
    "max-candidates",
    ...CANDIDATE_LIST_OPTIONS,
    ...WALLET_EVIDENCE_OPTIONS,
  ],
  "sskr-export": [
    "mode",
    "date",
    "dates-file",
    "max-tries",
    "max-candidates",
    ...WALLET_EVIDENCE_OPTIONS,
    "format",
    "output",
    "qr-dir",
    "pdf",
    ...DRAWING_OPTIONS,
    ...SSKR_INPUT_OPTIONS,
    ...SSKR_EXPORT_OPTIONS,
  ],
  "sskr-split": [
    "mode",
    "mnemonic",
    "mnemonic-file",
    "ask-secrets",
    "date",
    "dates-file",
    "threshold",
    "shares",
    "format",
    "output",
    "qr-dir",
    "pdf",
    "heir-sheet",
    "heir-sheet-size",
    "backup-check",
    ...DRAWING_OPTIONS,
    ...SSKR_EXPORT_OPTIONS,
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
    ...BUSINESS_OPTION_NAMES,
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

export type CommandName = keyof typeof COMMAND_OPTIONS;

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
   * its first question (ProcessProtection.dropUnneeded) must leave what any answer may need, as
   * re-encode does without options of its new backup.
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
  Object.entries(COMMAND_FACTS)
    .filter(([, facts]) => facts.secret)
    .map(([name]) => name),
);

export function isCommandName(name: string): name is CommandName {
  return Object.hasOwn(COMMAND_OPTIONS, name);
}
