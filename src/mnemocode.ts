#!/usr/bin/env node
import { assertAllowedArguments, assertFlag, parseArguments } from "./cli/arguments.js";
import { runDecode } from "./cli/decode-command.js";
import { runEncode } from "./cli/encode-command.js";
import { runRecoverDate } from "./cli/recover-date-command.js";
import { runRecoverWord } from "./cli/recover-word-command.js";
import { assertCoreSelfTest, runSelfTest } from "./cli/self-test.js";
import { runTable } from "./cli/table-command.js";
import { terminalFailure } from "./cli/terminal.js";
import { runPreview } from "./cli/preview-command.js";
import { helpNames, printCommandHelp, printNamedHelp, printUsage } from "./cli/usage.js";
import { commandOptions, isCommandName } from "./cli/command-options.js";
import { MNEMOCODE_VERSION } from "./version.js";
import { runSskrSplit, runSskrCombine, runSskrExport } from "./cli/sskr-command.js";

async function main(): Promise<void> {
  const [command, ...rest] = process.argv.slice(2);
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
      return runSskrSplit(arguments_);
    case "sskr-combine":
      assertAllowedArguments(arguments_, command, commandOptions[command]);
      assertFlag(arguments_, "ask-secrets");
      assertCoreSelfTest();
      return runSskrCombine(arguments_);
    case "sskr-export":
      assertAllowedArguments(arguments_, command, commandOptions[command]);
      assertFlag(arguments_, "ask-secrets");
      assertCoreSelfTest();
      return runSskrExport(arguments_);
    case "encode":
      assertAllowedArguments(arguments_, command, commandOptions[command]);
      assertFlag(arguments_, "sskr");
      assertFlag(arguments_, "cards");
      assertFlag(arguments_, "ask-secrets");
      assertFlag(arguments_, "legacy-valid-last-word");
      assertCoreSelfTest();
      return runEncode(arguments_);
    case "decode":
      assertAllowedArguments(arguments_, command, commandOptions[command]);
      assertFlag(arguments_, "ask-secrets");
      assertCoreSelfTest();
      return runDecode(arguments_);
    case "recover-date":
      assertAllowedArguments(arguments_, command, commandOptions[command]);
      assertFlag(arguments_, "ask-secrets");
      assertCoreSelfTest();
      return runRecoverDate(arguments_);
    case "recover-word":
      assertAllowedArguments(arguments_, command, commandOptions[command]);
      assertFlag(arguments_, "ask-secrets");
      assertFlag(arguments_, "legacy-valid-last-word");
      assertCoreSelfTest();
      return runRecoverWord(arguments_);
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

void main().catch((error: unknown) => {
  terminalFailure(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
