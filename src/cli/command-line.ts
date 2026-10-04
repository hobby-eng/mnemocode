import { assertAllowedArguments, assertFlag, parseArguments } from "./arguments.js";
import { runDecode } from "./decode-command.js";
import { runEncode } from "./encode-command.js";
import { runRecoverDate } from "./recover-date-command.js";
import { runRecoverWord } from "./recover-word-command.js";
import { assertCoreSelfTest, runSelfTest } from "./self-test.js";
import { runTable } from "./table-command.js";
import { withPrivateScreen } from "./private-screen.js";
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
  switch (command) {
    case "sskr-split":
      assertAllowedArguments(arguments_, command, commandOptions[command]);
      assertFlag(arguments_, "ask-secrets");
      assertCoreSelfTest();
      return withPrivateScreen(() => runSskrSplit(arguments_));
    case "sskr-combine":
      assertAllowedArguments(arguments_, command, commandOptions[command]);
      assertFlag(arguments_, "ask-secrets");
      assertCoreSelfTest();
      return withPrivateScreen(() => runSskrCombine(arguments_));
    case "sskr-export":
      assertAllowedArguments(arguments_, command, commandOptions[command]);
      assertFlag(arguments_, "ask-secrets");
      assertCoreSelfTest();
      return withPrivateScreen(() => runSskrExport(arguments_));
    case "encode":
      assertAllowedArguments(arguments_, command, commandOptions[command]);
      assertFlag(arguments_, "sskr");
      assertFlag(arguments_, "cards");
      assertFlag(arguments_, "ask-secrets");
      assertFlag(arguments_, "legacy-valid-last-word");
      assertCoreSelfTest();
      return withPrivateScreen(() => runEncode(arguments_));
    case "decode":
      assertAllowedArguments(arguments_, command, commandOptions[command]);
      assertFlag(arguments_, "ask-secrets");
      assertCoreSelfTest();
      return withPrivateScreen(() => runDecode(arguments_));
    case "recover-date":
      assertAllowedArguments(arguments_, command, commandOptions[command]);
      assertFlag(arguments_, "ask-secrets");
      assertCoreSelfTest();
      return withPrivateScreen(() => runRecoverDate(arguments_));
    case "recover-word":
      assertAllowedArguments(arguments_, command, commandOptions[command]);
      assertFlag(arguments_, "ask-secrets");
      assertFlag(arguments_, "legacy-valid-last-word");
      assertCoreSelfTest();
      return withPrivateScreen(() => runRecoverWord(arguments_));
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
