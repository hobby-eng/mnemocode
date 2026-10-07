// Lays out the help of MnemoCode in the shared style of the bip_tools command-line tools
// (`mhfe --help` is the model): cyan headings and options, grey values and notes, two columns
// of a command and what it does. The text itself is in help-pages.ts.

import { cardTemplates } from "../export/templates.js";
import { MNEMOCODE_VERSION } from "../version.js";
import { type CommandName, isCommandName } from "./command-options.js";
import {
  commandHelp,
  TEST_PHRASE,
  TEST_PHRASE_VARIABLE,
  topicHelp,
  type HelpOption,
  type HelpRow,
  type TopicHelp,
} from "./help-pages.js";
import { STYLE, terminalPaint, wrapText } from "./terminal.js";

/** Width of the help texts, as in `mhfe --help`: an 80-column terminal, also in a wider one. */
const HELP_WIDTH = 80;
/** Widest first column of a two-column section; a longer one stands on its own line. */
const COLUMN_LIMIT = 32;
/** Indent of the explanation below a command in a stacked section. */
const STACKED_INDENT = 6;
/** Indent of the continuation lines of a long command, after the two of the section. */
const CONTINUATION_INDENT = "  ";
/** Indent of an option in `--help`. */
const OPTION_INDENT = 2;
/** Width of a short form and its comma, "-h, ". */
const SHORT_FORM_WIDTH = 4;
/** Indent of the explanation of an option in `--help`, as clap prints it. */
const OPTION_TEXT_INDENT = 10;

const paint = (code: string, text: string): string => terminalPaint("stdout", code, text);
const heading = (text: string): string => paint(STYLE.heading, text);

/**
 * "    --mode <MODE>": the option in the accent colour and its value in grey. An option without a
 * short form is moved right by the width of "-h, ", so that the long forms line up, as in clap.
 */
function optionLabel(option: HelpOption): string {
  const value = option.value === undefined ? "" : ` ${paint(STYLE.muted, `<${option.value}>`)}`;
  return `${shortFormGap(option)}${paint(STYLE.accent, option.flag)}${value}`;
}

function optionWidth(option: HelpOption): number {
  const value = option.value === undefined ? 0 : option.value.length + 3;
  return shortFormGap(option).length + option.flag.length + value;
}

function shortFormGap(option: HelpOption): string {
  return option.flag.startsWith("--") ? " ".repeat(SHORT_FORM_WIDTH) : "";
}

/**
 * Two columns: `left` in the accent colour, `right` wrapped beside it. When one first column is
 * longer than COLUMN_LIMIT, such as a full example command, every row is stacked instead: the
 * command on its own lines, its explanation indented below it, and a blank line between rows.
 */
function columns(rows: readonly HelpRow[]): string[] {
  if (rows.every(([left]) => left.length <= COLUMN_LIMIT))
    return labelledColumns(
      rows.map(([left, right]) => [paint(STYLE.accent, left), left.length, right]),
    );
  return rows.flatMap(([left, right], index) => [
    ...(index > 0 ? [""] : []),
    ...commandLines(left).map((line) => `  ${paint(STYLE.accent, line)}`),
    ...wrapText(right, HELP_WIDTH - STACKED_INDENT).map(
      (line) => `${" ".repeat(STACKED_INDENT)}${line}`,
    ),
  ]);
}

/**
 * A command broken into lines that end with a backslash, so that it can still be copied into a
 * shell. It breaks only before an option, so an option stays with its values; a long quoted
 * value can make a line longer than the help width.
 */
function commandLines(command: string): string[] {
  const words = command.match(/(?:"[^"]*"|'[^']*'|\S)+/gu) ?? [];
  const parts: string[] = [];
  for (const word of words) {
    if (word.startsWith("-") || parts.length === 0) parts.push(word);
    else parts[parts.length - 1] += ` ${word}`;
  }
  const lines: string[] = [];
  let line = "";
  for (const part of parts) {
    const indent = lines.length === 0 ? "" : CONTINUATION_INDENT;
    // The two columns of the section's indent and the two of " \" at the end.
    if (line !== "" && 2 + indent.length + line.length + 1 + part.length + 2 > HELP_WIDTH) {
      lines.push(`${indent}${line} \\`);
      line = "";
    }
    line = line === "" ? part : `${line} ${part}`;
  }
  if (line !== "") lines.push(`${lines.length === 0 ? "" : CONTINUATION_INDENT}${line}`);
  return lines;
}

/** The examples, after the line that sets the public test phrase when they use it. */
function examples(rows: readonly HelpRow[]): string {
  const lines = columns(rows);
  if (rows.some(([command]) => command.includes(TEST_PHRASE_VARIABLE)))
    lines.unshift(
      `  ${paint(STYLE.muted, "# The public BIP39 test phrase of the examples:")}`,
      `  ${paint(STYLE.accent, `TEST_PHRASE='${TEST_PHRASE}'`)}`,
      "",
    );
  return section("Examples:", lines);
}

/**
 * Two columns whose left side is already painted; `width` is its visible width. A first column
 * longer than COLUMN_LIMIT, such as a long option, stands on its own line, and its explanation
 * continues in the second column below it.
 */
function labelledColumns(rows: readonly (readonly [string, number, string])[]): string[] {
  const leftWidth = Math.max(
    0,
    ...rows.map(([, width]) => width).filter((width) => width <= COLUMN_LIMIT),
  );
  // Two spaces of indent and two between the columns.
  const rightWidth = Math.max(20, HELP_WIDTH - leftWidth - 4);
  const lines: string[] = [];
  for (const [left, width, right] of rows) {
    const own = width > COLUMN_LIMIT;
    if (own) lines.push(`  ${left}`);
    wrapText(right, rightWidth).forEach((line, index) => {
      const label =
        index === 0 && !own ? left + " ".repeat(leftWidth - width) : " ".repeat(leftWidth);
      lines.push(`  ${label}  ${line}`);
    });
  }
  return lines;
}

function section(title: string, lines: readonly string[]): string {
  return [heading(title), ...lines].join("\n");
}

function paragraphs(texts: readonly string[], width: number = HELP_WIDTH): string {
  return texts.map((text) => wrapText(text, width).join("\n")).join("\n\n");
}

function notes(texts: readonly string[]): string {
  return texts
    .map((text) =>
      wrapText(text, HELP_WIDTH)
        .map((line) => paint(STYLE.muted, line))
        .join("\n"),
    )
    .join("\n\n");
}

/**
 * "Usage: mnemocode decode [OPTIONS] ...", the command in the accent colour and the rest in grey,
 * as clap writes it, wrapped below "Usage: " when it is longer than the help width.
 */
function usageLine(command: string, rest: string = ""): string {
  const label = "Usage: ";
  const lines = wrapText(`${command} ${rest}`.trim(), HELP_WIDTH - label.length);
  return lines
    .map((line, index) => {
      if (index > 0) return `${" ".repeat(label.length)}${paint(STYLE.muted, line)}`;
      const tail = line.slice(command.length);
      return `${heading(label.trim())} ${paint(STYLE.accent, command)}${paint(STYLE.muted, tail)}`;
    })
    .join("\n");
}

const SHORT_HELP_OPTION: HelpOption = {
  flag: "-h, --help",
  summary: "Print help (see more with '--help')",
};
const LONG_HELP_OPTION: HelpOption = {
  flag: "-h, --help",
  summary: "Print help (see a summary with '-h')",
};

/** `mnemocode`, `mnemocode --help` and `mnemocode help`. */
export function printUsage(): void {
  const commands: HelpRow[] = (Object.keys(commandHelp) as CommandName[])
    .filter((name) => name !== "sskr-split")
    .map((name) => [name, commandHelp[name].summary]);
  commands.push(
    ["version", "Print the version"],
    ["help", "Print this help, or that of a command"],
  );
  const topics: HelpRow[] = Object.entries(topicHelp).map(([name, topic]) => [
    `help ${name}`,
    topic.summary,
  ]);
  const mainExamples: HelpRow[] = [
    ["mnemocode encode --ask-secrets --format 5", "Write a real phrase as colors; dates asked for"],
    [
      "mnemocode decode --input-file shifted.txt --dates 23-09-2026",
      "Turn a record back into the phrase",
    ],
    ["mnemocode recover-word --ask-secrets", "Find forgotten words"],
    [
      "mnemocode encode --sskr --ask-secrets --threshold 2 --shares 3",
      "Split a phrase into 3 shares, any 2 restore it",
    ],
    ["mnemocode sskr-combine --ask-secrets", "Restore a phrase from its shares"],
    ["mnemocode preview --all --pdf all-previews.pdf", "Every card design in one PDF"],
    ["mnemocode self-test", "Check a new installation"],
    ["mnemocode encode --help", "Every option of a command, with examples"],
  ];
  const blocks = [
    `${heading(`MnemoCode ${MNEMOCODE_VERSION}`)}\nOffline reversible representations for English BIP39 mnemonics`,
    paragraphs([
      "Writes a BIP39 recovery phrase as numbers, Unicode codes or colors, masks it with dates, splits it into Shamir shares and prints it as cards, all offline. Every form converts back to the exact original words.",
    ]),
    usageLine("mnemocode", "<COMMAND> [OPTIONS]"),
    section("Commands:", columns(commands)),
    section("Topics:", columns(topics)),
    section(
      "Options:",
      columns([
        ["-h, --help", "Print help; after a command, its help"],
        ["-V, --version", "Print the version"],
      ]),
    ),
    examples(mainExamples),
    notes([
      "Started without a command in a terminal, mnemocode shows a menu that asks step by step, asks again after an answer that cannot be used, and shows the command it runs. Use --ask-secrets for a real phrase: text typed in a command can stay in the shell history. Work on a trusted computer without a network connection. -h gives a short summary of a command, --help the full explanation.",
    ]),
    // The safety line wraps like every other text of the help, so that it stays whole.
    wrapText(
      "Recovery material: a record, with its dates if it has any, restores the wallet; it is not encryption.",
      HELP_WIDTH,
    )
      .map((line) => paint(STYLE.warning, line))
      .join("\n"),
  ];
  console.log(blocks.join("\n\n"));
}

/** `mnemocode <command> -h` (`detailed` false) and `--help` or `help <command>` (true). */
export function printCommandHelp(name: CommandName, detailed: boolean): void {
  const page = commandHelp[name];
  const blocks: string[] = [page.summary];
  if (detailed && page.about.length > 0) blocks.push(paragraphs(page.about));
  blocks.push(usageLine(`mnemocode ${name}`, page.usage));
  // -h and --help close the last group of options, as in clap.
  const groups = page.groups.length > 0 ? page.groups : [{ heading: "Options:", options: [] }];
  groups.forEach((group, index) => {
    const help = detailed ? LONG_HELP_OPTION : SHORT_HELP_OPTION;
    const options = index === groups.length - 1 ? [...group.options, help] : group.options;
    blocks.push(section(group.heading, optionLines(options, detailed)));
  });
  if (detailed && page.asks !== undefined)
    blocks.push(section("What --ask-secrets asks for:", columns(page.asks)));
  if (detailed && name === "preview") blocks.push(section("Designs:", templateRows()));
  blocks.push(examples(page.examples));
  if (detailed && page.notes !== undefined) blocks.push(notes(page.notes));
  console.log(blocks.join("\n\n"));
}

function optionLines(options: readonly HelpOption[], detailed: boolean): string[] {
  if (!detailed)
    return labelledColumns(
      options.map((option) => [optionLabel(option), optionWidth(option), option.summary]),
    );
  // As clap prints `--help`: the option on its own line, then its paragraphs indented below it.
  const lines: string[] = [];
  options.forEach((option, index) => {
    if (index > 0) lines.push("");
    lines.push(`${" ".repeat(OPTION_INDENT)}${optionLabel(option)}`);
    // A sentence of its own here; the -h line keeps clap's form, which ends in a parenthesis.
    const summary = option.summary.endsWith(")") ? option.summary : `${option.summary}.`;
    const texts = [summary, ...(option.details ?? [])];
    texts.forEach((text, paragraph) => {
      if (paragraph > 0) lines.push("");
      for (const line of wrapText(text, HELP_WIDTH - OPTION_TEXT_INDENT))
        lines.push(`${" ".repeat(OPTION_TEXT_INDENT)}${line}`);
    });
  });
  return lines;
}

function templateRows(): string[] {
  return cardTemplates.map(
    (template, index) =>
      `  ${paint(STYLE.accent, String(index + 1).padStart(2))}  ${template.id.padEnd(24)} ${paint(STYLE.muted, template.name)}`,
  );
}

/** `mnemocode help <topic>`. */
export function printTopicHelp(name: string): void {
  const topic: TopicHelp = topicHelp[name]!;
  const blocks: string[] = [topic.summary];
  for (const part of topic.sections) {
    const lines: string[] = [];
    if (part.rows !== undefined) lines.push(...columns(part.rows));
    if (part.paragraphs !== undefined) lines.push(paragraphs(part.paragraphs));
    blocks.push(section(part.heading, lines));
  }
  if (topic.examples !== undefined) blocks.push(examples(topic.examples));
  console.log(blocks.join("\n\n"));
}

/**
 * Prints the help that `name` asks for, as in `mnemocode help <name>`. Returns false when there
 * is no command or topic of that name.
 */
export function printNamedHelp(name: string): boolean {
  if (isCommandName(name)) {
    printCommandHelp(name, true);
    return true;
  }
  if (Object.hasOwn(topicHelp, name)) {
    printTopicHelp(name);
    return true;
  }
  return false;
}

/** The commands and topics, for an error about an unknown one. */
export function helpNames(): string {
  return [...Object.keys(commandHelp), ...Object.keys(topicHelp)].join(", ");
}
