import { assertAllowedArguments, assertFlag, parseArguments } from "./arguments.js";
import { runDecode } from "./decode-command.js";
import { runEncode } from "./encode-command.js";
import { runRecoverDate } from "./recover-date-command.js";
import { runRecoverWord } from "./recover-word-command.js";
import { assertCoreSelfTest, runSelfTest } from "./self-test.js";
import { runTable } from "./table-command.js";
import { onPrivateScreen, withPrivateScreen } from "./private-screen.js";
import { assertProtected, dropUnneeded, protectionSummary } from "./protection.js";
import { unencryptedSwap } from "./swap-check.js";
import { cloudServiceOf } from "./cloud-folders.js";
import { STYLE, terminalNotice, terminalPaint } from "./terminal.js";
import { value, type ParsedArguments } from "./arguments.js";
import { runPreview } from "./preview-command.js";
import { helpNames, printCommandHelp, printNamedHelp, printUsage } from "./usage.js";
import { commandOptions, isCommandName } from "./command-options.js";
import { MNEMOCODE_VERSION } from "../version.js";
import { runSskrSplit, runSskrCombine, runSskrExport } from "./sskr-command.js";

/** The commands that take a secret or show one; at a terminal they run on the private screen. */
export const PRIVATE_SCREEN_COMMANDS: ReadonlySet<string> = new Set([
  "encode",
  "decode",
  "recover-date",
  "recover-word",
  "sskr-split",
  "sskr-combine",
  "sskr-export",
]);

/**
 * Runs one command line, the arguments after `mnemocode`. A command that shows a seed phrase, an
 * encoded record or shares runs on the private screen at a terminal (private-screen.ts).
 */
export async function runCommandLine(argv: readonly string[]): Promise<void> {
  const [command, ...rest] = argv;
  if (command === undefined || command === "--help" || command === "-h") {
    printUsage();
    return;
  }
  if (command === "help") {
    if (rest.length > 1) throw new Error("The help command takes one command or topic name.");
    if (rest[0] === undefined) printUsage();
    else if (!printNamedHelp(rest[0]))
      throw new Error(`There is no command or topic “${rest[0]}”. Choose one of: ${helpNames()}.`);
    return;
  }
  if (command === "--version" || command === "-V" || command === "version") {
    if (rest.length > 0)
      throw new Error("The version command does not accept additional arguments.");
    console.log(`mnemocode ${MNEMOCODE_VERSION}`);
    return;
  }
  if (!isCommandName(command))
    throw new Error(`There is no command “${command}”. Run mnemocode --help to see the commands.`);
  // A help request wins over every other option, so that it works on a half-typed command.
  if (rest.includes("--help") || rest.includes("-h")) {
    printCommandHelp(command, rest.includes("--help"));
    return;
  }
  const arguments_ = parseArguments(rest);
  assertFlag(arguments_, "card-qr");
  // Before anything is read: what this command does not need is given up for good.
  dropUnneeded(command, arguments_);
  switch (command) {
    case "sskr-split":
      assertAllowedArguments(arguments_, command, commandOptions[command]);
      assertFlag(arguments_, "ask-secrets");
      assertCoreSelfTest();
      return withSecrets(arguments_, () => runSskrSplit(arguments_));
    case "sskr-combine":
      assertAllowedArguments(arguments_, command, commandOptions[command]);
      assertFlag(arguments_, "ask-secrets");
      assertCoreSelfTest();
      return withSecrets(arguments_, () => runSskrCombine(arguments_));
    case "sskr-export":
      assertAllowedArguments(arguments_, command, commandOptions[command]);
      assertFlag(arguments_, "ask-secrets");
      assertCoreSelfTest();
      return withSecrets(arguments_, () => runSskrExport(arguments_));
    case "encode":
      assertAllowedArguments(arguments_, command, commandOptions[command]);
      assertFlag(arguments_, "sskr");
      assertFlag(arguments_, "cards");
      assertFlag(arguments_, "ask-secrets");
      assertFlag(arguments_, "legacy-valid-last-word");
      assertCoreSelfTest();
      return withSecrets(arguments_, () => runEncode(arguments_));
    case "decode":
      assertAllowedArguments(arguments_, command, commandOptions[command]);
      assertFlag(arguments_, "ask-secrets");
      assertCoreSelfTest();
      return withSecrets(arguments_, () => runDecode(arguments_));
    case "recover-date":
      assertAllowedArguments(arguments_, command, commandOptions[command]);
      assertFlag(arguments_, "ask-secrets");
      assertCoreSelfTest();
      return withSecrets(arguments_, () => runRecoverDate(arguments_));
    case "recover-word":
      assertAllowedArguments(arguments_, command, commandOptions[command]);
      assertFlag(arguments_, "ask-secrets");
      assertFlag(arguments_, "legacy-valid-last-word");
      assertCoreSelfTest();
      return withSecrets(arguments_, () => runRecoverWord(arguments_));
    case "preview":
      assertAllowedArguments(arguments_, command, commandOptions[command]);
      assertFlag(arguments_, "list");
      assertFlag(arguments_, "all");
      assertCoreSelfTest();
      return runPreview(arguments_);
    case "table":
      assertAllowedArguments(arguments_, command, commandOptions[command]);
      assertFlag(arguments_, "all");
      assertCoreSelfTest();
      return runTable(arguments_);
    case "self-test":
      assertAllowedArguments(arguments_, command, commandOptions[command]);
      return runSelfTest();
  }
}

/** Options that name a file or a folder to save. */
const SAVED_OPTIONS = ["output", "qr", "pdf", "cards-dir", "images-dir"] as const;

/**
 * Runs a command that takes or shows a secret: only under the full protection, on the private
 * screen, which first shows that protection and every warning about where the secret could leak.
 */
async function withSecrets(args: ParsedArguments, run: () => Promise<void>): Promise<void> {
  assertProtected();
  return withPrivateScreen(async () => {
    if (onPrivateScreen())
      console.error(
        `  ${terminalPaint("stderr", STYLE.muted, "Protection".padEnd(11))} ${protectionSummary()}\n`,
      );
    const swap = unencryptedSwap();
    if (swap.length > 0)
      terminalNotice(
        `Swap is not encrypted, or MnemoCode cannot tell (${swap.join(", ")}): the memory of this program, the seed phrase included, may be written to the disk and stay there. Use encrypted swap or none, best a live USB system.`,
        "warning",
      );
    for (const key of SAVED_OPTIONS) {
      const path = value(args, key);
      const service = path === undefined ? undefined : cloudServiceOf(path);
      if (service !== undefined)
        terminalNotice(
          `${path} is in a folder that ${service} synchronises: the file is copied to its servers and kept there. Save it to a local folder instead.`,
          "warning",
        );
    }
    return run();
  });
}
