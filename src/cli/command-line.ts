import { assertAllowedArguments, parseArguments } from "./arguments.js";
import { runDecode } from "./decode-command.js";
import { runEncode } from "./encode-command.js";
import { runReEncode } from "./re-encode-command.js";
import { runRecoverDate } from "./recover-date-command.js";
import { runRecoverWord } from "./recover-word-command.js";
import { assertCoreSelfTest, runSelfTest } from "./self-test.js";
import { runTable } from "./table-command.js";
import { showProtection, withPrivateScreen } from "./private-screen.js";
import { assertProtected, dropUnneeded } from "./protection.js";
import { swapWarning } from "./swap-check.js";
import { warnOfCloudCopies } from "./cloud-folders.js";
import { terminalMore, terminalNotice } from "./terminal.js";
import { type ParsedArguments } from "./arguments.js";
import { runPreview } from "./preview-command.js";
import { helpNames, printCommandHelp, printNamedHelp, printUsage } from "./usage.js";
import {
  COMMAND_FACTS,
  commandOptions,
  HELP_FLAGS,
  isCommandName,
  isFlagOf,
  PRIVATE_SCREEN_COMMANDS,
  VERSION_FLAGS,
  type CommandName,
} from "./command-options.js";
import { MNEMOCODE_VERSION } from "../version.js";
import { runSskrSplit, runSskrCombine, runSskrExport } from "./sskr-command.js";
import { reportRenamedOutputs, settleOutputPaths } from "./output-paths.js";
import { CANCELLED, type Cancelled } from "./terminal-keys.js";
import { ErrorCatalog } from "../core/error-catalog.js";

const ERRORS = new ErrorCatalog("cli.command-line", {
  "help-command-takes-one-command-topic-name": () =>
    "The help command takes one command or topic name.",
  "there-no-command-topic-choose-one": (names: string) =>
    `There is no such command or topic. Choose one of: ${names}.`,
  "version-command-does-not-accept-additional-arguments": () =>
    "The version command does not accept additional arguments.",
  "there-no-command-run-mnemocode-help-see-commands": () =>
    "There is no such command. Run mnemocode --help to see the commands.",
});

// Here too for the modules that take it with the command line (menu-runner.ts, menu.ts).
export { PRIVATE_SCREEN_COMMANDS };

/** How a command ended: CANCELLED when the person cancelled it with Ctrl+C. */
export type CommandEnd = Cancelled | undefined;

/**
 * What runs each command, with its options; a command without one does not compile. A command that
 * asks nothing returns nothing.
 */
const HANDLERS: Readonly<
  Record<CommandName, (args: ParsedArguments) => void | Promise<void> | Promise<CommandEnd>>
> = {
  encode: runEncode,
  decode: runDecode,
  "re-encode": runReEncode,
  "recover-date": runRecoverDate,
  "recover-word": runRecoverWord,
  "sskr-split": (args) => runSskrSplit(args),
  "sskr-combine": (args) => runSskrCombine(args),
  "sskr-export": runSskrExport,
  preview: runPreview,
  table: runTable,
  "self-test": () => runSelfTest(),
};

/**
 * Runs one command line, the arguments after `mnemocode`. A command that shows a seed phrase, an
 * encoded record or shares runs on the private screen at a terminal (private-screen.ts).
 * CANCELLED when the person cancelled the command.
 */
export async function runCommandLine(argv: readonly string[]): Promise<CommandEnd> {
  const [command, ...rest] = argv;
  if (command === undefined || isFlagOf(HELP_FLAGS, command)) {
    printUsage();
    return undefined;
  }
  if (command === "help") {
    if (rest.length > 1) throw ERRORS.create("help-command-takes-one-command-topic-name", []);
    if (rest[0] === undefined) printUsage();
    else if (!printNamedHelp(rest[0]))
      throw ERRORS.create("there-no-command-topic-choose-one", [`${helpNames()}`]);
    return undefined;
  }
  if (isFlagOf(VERSION_FLAGS, command) || command === "version") {
    if (rest.length > 0)
      throw ERRORS.create("version-command-does-not-accept-additional-arguments", []);
    console.log(`mnemocode ${MNEMOCODE_VERSION}`);
    return undefined;
  }
  if (!isCommandName(command))
    throw ERRORS.create("there-no-command-run-mnemocode-help-see-commands", []);
  // A help request wins over every other option, so that it works on a half-typed command.
  if (rest.some((argument) => isFlagOf(HELP_FLAGS, argument))) {
    printCommandHelp(command, rest.includes(HELP_FLAGS.long));
    return undefined;
  }
  // parseArguments refuses a value given to an on-or-off option.
  const arguments_ = parseArguments(rest);
  const facts = COMMAND_FACTS[command];
  // Before anything is read: what this command does not need is given up for good.
  dropUnneeded(facts.alwaysWrites, arguments_, facts.asksOutputs?.(arguments_) === true);
  assertAllowedArguments(arguments_, command, commandOptions[command]);
  if (facts.coreSelfTest) assertCoreSelfTest();
  const run = async (): Promise<CommandEnd> => (await HANDLERS[command](arguments_)) ?? undefined;
  return facts.secret ? withSecrets(arguments_, run, command) : withOutputs(arguments_, run);
}

/**
 * Runs a command with the outputs that its options name: a taken name numbered first
 * (settleOutputPaths), and each numbered one reported after it ran, unless it was cancelled.
 */
async function withOutputs(
  args: ParsedArguments,
  run: () => Promise<CommandEnd>,
): Promise<CommandEnd> {
  await settleOutputPaths(args);
  if ((await run()) === CANCELLED) return CANCELLED;
  reportRenamedOutputs();
  return undefined;
}

/**
 * Runs a command that takes or shows a secret: only under the full protection, on the private
 * screen, which first shows that protection and every warning about where the secret could leak.
 */
async function withSecrets(
  args: ParsedArguments,
  run: () => Promise<CommandEnd>,
  command: CommandName,
): Promise<CommandEnd> {
  assertProtected();
  return withPrivateScreen<undefined>(async () => {
    showProtection();
    const swap = swapWarning();
    if (swap !== undefined) {
      terminalNotice(swap, "warning");
      terminalMore("unencrypted-swap");
    }
    // The outputs are settled before the warnings about where files go, which then name the files
    // as they will be saved; a command reports its own renamed names, and any left are reported
    // still on the private screen.
    return withOutputs(args, async () => {
      warnOfCloudCopies(args);
      return run();
    });
  }, command);
}
