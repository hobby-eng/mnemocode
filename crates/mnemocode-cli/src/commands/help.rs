//! Lays out the help of MnemoCode in the shared style of the bip_tools command-line tools
//! (MnemoCode TS 0.1.0's `cli/usage.ts`; `mhfe --help` is the model): cyan headings and options,
//! grey values and notes, two columns of a command and what it does. The text itself is in
//! `help/pages`.

mod pages;

use mnemocode_cards::templates::CARD_TEMPLATES;
use pages::{COMMAND_HELP, TOPIC_HELP};

use crate::terminal::{Channel, paint, result_line, style, wrap_text};

/// The public BIP39 test phrase of the examples, and the variable that holds it.
const TEST_PHRASE: &str =
    "abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about";
const TEST_PHRASE_VARIABLE: &str = "\"$TEST_PHRASE\"";
/// The flags that ask for help and for the version, as the help names them.
const HELP_FLAGS: &str = "-h, --help";
const VERSION_FLAGS: &str = "-V, --version";
/// Width of the help texts, as in `mhfe --help`: an 80-column terminal, also in a wider one.
const HELP_WIDTH: usize = 80;
/// Widest first column of a two-column section; a longer one stands on its own line.
const COLUMN_LIMIT: usize = 32;
/// Indent of the explanation below a command in a stacked section.
const STACKED_INDENT: usize = 6;
/// Indent of the continuation lines of a long command, after the two of the section.
const CONTINUATION_INDENT: &str = "  ";
/// Indent of an option in `--help`.
const OPTION_INDENT: usize = 2;
/// Width of a short form and its comma, "-h, ".
const SHORT_FORM_WIDTH: usize = 4;
/// Indent of the explanation of an option in `--help`, as clap prints it.
const OPTION_TEXT_INDENT: usize = 10;
/// The closing message of every page.
const RECOVERY_SAFETY: &str = "Recovery material: a record, with its dates if it has any, restores the wallet; it is not encryption.";

/// An option of a page.
#[derive(Clone, Copy, Debug)]
pub(crate) struct HelpOption {
    /// The option as typed, such as "--mode".
    flag: &'static str,
    /// Its value, such as "MODE"; none for an on-or-off option.
    value: Option<&'static str>,
    /// One line for `-h`; also the first paragraph of `--help`.
    summary: &'static str,
    /// Further paragraphs for `--help`.
    details: &'static [&'static str],
}

/// A group of options under its heading.
#[derive(Clone, Copy, Debug)]
pub(crate) struct HelpGroup {
    heading: &'static str,
    /// The options, in runs that several pages share.
    options: &'static [&'static [&'static HelpOption]],
}

/// A row of two columns.
type HelpRow = (&'static str, &'static str);

/// A command's page.
#[derive(Clone, Copy, Debug)]
pub(crate) struct CommandHelp {
    summary: &'static str,
    /// Paragraphs under the summary in `--help`.
    about: &'static [&'static str],
    /// What follows "mnemocode <command> " in the usage line.
    usage: &'static str,
    groups: &'static [HelpGroup],
    /// What the prompts of --ask-secrets ask for, in `--help`.
    asks: Option<&'static [HelpRow]>,
    examples: &'static [HelpRow],
    /// Closing paragraphs of `--help`.
    notes: Option<&'static [&'static str]>,
}

/// A section of a topic.
#[derive(Clone, Copy, Debug)]
pub(crate) struct TopicSection {
    heading: &'static str,
    paragraphs: Option<&'static [&'static str]>,
    rows: Option<&'static [HelpRow]>,
}

/// A topic's page.
#[derive(Clone, Copy, Debug)]
pub(crate) struct TopicHelp {
    summary: &'static str,
    sections: &'static [TopicSection],
    examples: Option<&'static [HelpRow]>,
    /// Closing paragraphs, grey after the examples, as a command's notes are.
    notes: Option<&'static [&'static str]>,
}

/// Text in the style `code`, on standard output.
fn painted(code: &str, text: &str) -> String {
    paint(Channel::Output, code, text)
}

/// A heading.
fn heading(text: &str) -> String {
    painted(style::HEADING, text)
}

/// One closing safety message and warning style for overview, command and topic help.
fn closing_safety() -> String {
    let lines: Vec<String> = wrap_text(RECOVERY_SAFETY, HELP_WIDTH)
        .iter()
        .map(|line| painted(style::WARNING, line))
        .collect();
    lines.join("\n")
}

/// The spaces before an option without a short form, so that the long forms line up, as in clap.
fn short_form_gap(option: &HelpOption) -> String {
    if option.flag.starts_with("--") {
        " ".repeat(SHORT_FORM_WIDTH)
    } else {
        String::new()
    }
}

/// "    --mode <MODE>": the option in the accent colour and its value in grey.
fn flag_label(option: &HelpOption) -> String {
    let value = option.value.map_or_else(String::new, |value| {
        format!(" {}", painted(style::MUTED, &format!("<{value}>")))
    });
    format!(
        "{}{}{value}",
        short_form_gap(option),
        painted(style::ACCENT, option.flag)
    )
}

/// The columns that the label of `option` takes: its text without its colours.
fn option_width(option: &HelpOption) -> usize {
    let value = option.value.map_or(0, |value| value.chars().count() + 3);
    short_form_gap(option).len() + option.flag.chars().count() + value
}

/// A command split into words, as the pattern `(?:"[^"]*"|'[^']*'|\S)+` splits it: a quote that
/// closes holds spaces.
fn command_words(command: &str) -> Vec<String> {
    let characters: Vec<char> = command.chars().collect();
    let mut words = Vec::new();
    let mut word = String::new();
    let mut at = 0;
    while at < characters.len() {
        let character = characters[at];
        let closing = matches!(character, '"' | '\'')
            .then(|| {
                characters[at + 1..]
                    .iter()
                    .position(|next| *next == character)
            })
            .flatten();
        if let Some(length) = closing {
            word.extend(&characters[at..=at + 1 + length]);
            at += length + 2;
        } else if character.is_whitespace() {
            if !word.is_empty() {
                words.push(std::mem::take(&mut word));
            }
            at += 1;
        } else {
            word.push(character);
            at += 1;
        }
    }
    if !word.is_empty() {
        words.push(word);
    }
    words
}

/// A command broken into lines that end with a backslash, so that it can still be copied into a
/// shell. It breaks only before an option, so an option stays with its values; a long quoted value
/// can make a line longer than the help width.
fn command_lines(command: &str) -> Vec<String> {
    let mut parts: Vec<String> = Vec::new();
    for word in command_words(command) {
        match parts.last_mut() {
            Some(last) if !word.starts_with('-') => {
                last.push(' ');
                last.push_str(&word);
            }
            _ => parts.push(word),
        }
    }
    let mut lines = Vec::new();
    let mut line = String::new();
    let indent_of = |lines: &Vec<String>| {
        if lines.is_empty() {
            ""
        } else {
            CONTINUATION_INDENT
        }
    };
    for part in parts {
        let indent = indent_of(&lines);
        // The two columns of the section's indent and the two of " \" at the end.
        let width = 2 + indent.len() + line.chars().count() + 1 + part.chars().count() + 2;
        if !line.is_empty() && width > HELP_WIDTH {
            lines.push(format!("{indent}{line} \\"));
            line.clear();
        }
        if line.is_empty() {
            line = part;
        } else {
            line.push(' ');
            line.push_str(&part);
        }
    }
    if !line.is_empty() {
        lines.push(format!("{}{line}", indent_of(&lines)));
    }
    lines
}

/// Two columns whose left side is already painted, with its visible width. A first column longer
/// than COLUMN_LIMIT, such as a long option, stands on its own line, and its explanation continues
/// in the second column below it.
fn labelled_columns(rows: &[(String, usize, &str)]) -> Vec<String> {
    let left_width = rows
        .iter()
        .map(|(_, width, _)| *width)
        .filter(|width| *width <= COLUMN_LIMIT)
        .max()
        .unwrap_or(0);
    // Two spaces of indent and two between the columns.
    let right_width = HELP_WIDTH.saturating_sub(left_width + 4).max(20);
    let mut lines = Vec::new();
    for (left, width, right) in rows {
        let own = *width > COLUMN_LIMIT;
        if own {
            lines.push(format!("  {left}"));
        }
        for (index, line) in wrap_text(right, right_width).iter().enumerate() {
            let label = if index == 0 && !own {
                format!("{left}{}", " ".repeat(left_width - width))
            } else {
                " ".repeat(left_width)
            };
            lines.push(format!("  {label}  {line}"));
        }
    }
    lines
}

/// Two columns: the left in the accent colour, the right wrapped beside it. When one first column
/// is longer than COLUMN_LIMIT, such as a full example command, every row is stacked instead: the
/// command on its own lines, its explanation indented below it, and a blank line between rows.
fn columns(rows: &[HelpRow]) -> Vec<String> {
    if rows
        .iter()
        .all(|(left, _)| left.chars().count() <= COLUMN_LIMIT)
    {
        let labelled: Vec<(String, usize, &str)> = rows
            .iter()
            .map(|(left, right)| (painted(style::ACCENT, left), left.chars().count(), *right))
            .collect();
        return labelled_columns(&labelled);
    }
    let mut lines = Vec::new();
    for (index, (left, right)) in rows.iter().enumerate() {
        if index > 0 {
            lines.push(String::new());
        }
        for line in command_lines(left) {
            lines.push(format!("  {}", painted(style::ACCENT, &line)));
        }
        for line in wrap_text(right, HELP_WIDTH - STACKED_INDENT) {
            lines.push(format!("{}{line}", " ".repeat(STACKED_INDENT)));
        }
    }
    lines
}

/// A section under its heading.
fn section(title: &str, lines: &[String]) -> String {
    let mut all: Vec<String> = wrap_text(title, HELP_WIDTH)
        .iter()
        .map(|line| heading(line))
        .collect();
    all.extend_from_slice(lines);
    all.join("\n")
}

/// The examples, after the line that sets the public test phrase when they use it.
fn examples(rows: &[HelpRow]) -> String {
    let mut lines = columns(rows);
    if rows
        .iter()
        .any(|(command, _)| command.contains(TEST_PHRASE_VARIABLE))
    {
        lines.splice(
            0..0,
            [
                format!(
                    "  {}",
                    painted(
                        style::MUTED,
                        "# The public BIP39 test phrase of the examples:"
                    )
                ),
                format!(
                    "  {}",
                    painted(style::ACCENT, &format!("TEST_PHRASE='{TEST_PHRASE}'"))
                ),
                String::new(),
            ],
        );
    }
    section("Examples:", &lines)
}

/// Paragraphs wrapped to the help width.
fn paragraphs(texts: &[&str]) -> String {
    let blocks: Vec<String> = texts
        .iter()
        .map(|text| wrap_text(text, HELP_WIDTH).join("\n"))
        .collect();
    blocks.join("\n\n")
}

/// Grey closing paragraphs.
fn notes(texts: &[&str]) -> String {
    let blocks: Vec<String> = texts
        .iter()
        .map(|text| {
            let lines: Vec<String> = wrap_text(text, HELP_WIDTH)
                .iter()
                .map(|line| painted(style::MUTED, line))
                .collect();
            lines.join("\n")
        })
        .collect();
    blocks.join("\n\n")
}

/// "Usage: mnemocode decode [OPTIONS] ...", the command in the accent colour and the rest in grey,
/// as clap writes it, wrapped below "Usage: " when it is longer than the help width.
fn usage_line(command: &str, rest: &str) -> String {
    const LABEL: &str = "Usage: ";
    let text = format!("{command} {rest}");
    let lines: Vec<String> = wrap_text(text.trim(), HELP_WIDTH - LABEL.len())
        .iter()
        .enumerate()
        .map(|(index, line)| {
            if index > 0 {
                return format!("{}{}", " ".repeat(LABEL.len()), painted(style::MUTED, line));
            }
            let tail = line.get(command.len()..).unwrap_or_default();
            format!(
                "{} {}{}",
                heading(LABEL.trim()),
                painted(style::ACCENT, command),
                painted(style::MUTED, tail)
            )
        })
        .collect();
    lines.join("\n")
}

/// The option lines of a group: as clap prints `--help`, the option on its own line, then its
/// paragraphs indented below it; `-h` as two columns.
fn option_lines(options: &[&HelpOption], detailed: bool) -> Vec<String> {
    if !detailed {
        let rows: Vec<(String, usize, &str)> = options
            .iter()
            .map(|option| (flag_label(option), option_width(option), option.summary))
            .collect();
        return labelled_columns(&rows);
    }
    let mut lines = Vec::new();
    for (index, option) in options.iter().enumerate() {
        if index > 0 {
            lines.push(String::new());
        }
        lines.push(format!(
            "{}{}",
            " ".repeat(OPTION_INDENT),
            flag_label(option)
        ));
        // A sentence of its own here; the -h line keeps clap's form, which ends in a parenthesis.
        let summary = if option.summary.ends_with(')') {
            option.summary.to_owned()
        } else {
            format!("{}.", option.summary)
        };
        let mut texts = vec![summary.as_str()];
        texts.extend_from_slice(option.details);
        for (paragraph, text) in texts.iter().enumerate() {
            if paragraph > 0 {
                lines.push(String::new());
            }
            for line in wrap_text(text, HELP_WIDTH - OPTION_TEXT_INDENT) {
                lines.push(format!("{}{line}", " ".repeat(OPTION_TEXT_INDENT)));
            }
        }
    }
    lines
}

/// Writes `blocks`, apart.
fn print_blocks(blocks: &[String]) {
    // A closed standard output ends the help as it ends any output.
    result_line(&blocks.join("\n\n"));
}

/// The installed designs by the numbers that --template takes, with their ids and names.
fn template_rows() -> Vec<String> {
    let number_width = CARD_TEMPLATES.len().to_string().len();
    let id_width = CARD_TEMPLATES
        .iter()
        .map(|template| template.id.len())
        .max()
        .unwrap_or(0);
    CARD_TEMPLATES
        .iter()
        .enumerate()
        .map(|(index, template)| {
            let number = format!("{:>number_width$}", index + 1);
            format!(
                "  {}  {:<id_width$}  {}",
                paint(Channel::Output, style::ACCENT, &number),
                template.id,
                paint(Channel::Output, style::MUTED, &template.name())
            )
        })
        .collect()
}

/// `mnemocode <command> -h` (`detailed` false) and `--help` or `help <command>` (true).
pub(crate) fn print_command_help(name: &str, page: &CommandHelp, detailed: bool) {
    let mut blocks = vec![page.summary.to_owned()];
    if detailed && !page.about.is_empty() {
        blocks.push(paragraphs(page.about));
    }
    blocks.push(usage_line(&format!("mnemocode {name}"), page.usage));
    let help = HelpOption {
        flag: HELP_FLAGS,
        value: None,
        summary: if detailed {
            "Print help (see a summary with '-h')"
        } else {
            "Print help (see more with '--help')"
        },
        details: &[],
    };
    // -h and --help close the last group of options, as in clap.
    let empty = [HelpGroup {
        heading: "Options:",
        options: &[],
    }];
    let groups = if page.groups.is_empty() {
        empty.as_slice()
    } else {
        page.groups
    };
    for (index, group) in groups.iter().enumerate() {
        let mut options = group.options.concat();
        if index == groups.len() - 1 {
            options.push(&help);
        }
        blocks.push(section(group.heading, &option_lines(&options, detailed)));
    }
    if detailed && let Some(asks) = page.asks {
        blocks.push(section("What --ask-secrets asks for:", &columns(asks)));
    }
    if detailed && name == "preview" {
        blocks.push(section("Designs:", &template_rows()));
    }
    blocks.push(examples(page.examples));
    if detailed && let Some(texts) = page.notes {
        blocks.push(notes(texts));
    }
    blocks.push(closing_safety());
    print_blocks(&blocks);
}

/// `mnemocode help <topic>`.
fn print_topic_help(topic: &TopicHelp) {
    let mut blocks = vec![topic.summary.to_owned()];
    for part in topic.sections {
        let mut lines = Vec::new();
        if let Some(rows) = part.rows {
            lines.extend(columns(rows));
        }
        if let Some(texts) = part.paragraphs {
            lines.push(paragraphs(texts));
        }
        blocks.push(section(part.heading, &lines));
    }
    if let Some(rows) = topic.examples {
        blocks.push(examples(rows));
    }
    if let Some(texts) = topic.notes {
        blocks.push(notes(texts));
    }
    blocks.push(closing_safety());
    print_blocks(&blocks);
}

/// The two commands built in beside the others, with their lines of the overview and their usage.
const BUILT_INS: [(&str, &str, &str); 2] = [
    ("version", "Print the version", ""),
    (
        "help",
        "Print this help, or that of a command or topic",
        "[<COMMAND|TOPIC>]",
    ),
];

/// The page of a command.
pub(crate) fn page_of(name: &str) -> Option<&'static CommandHelp> {
    COMMAND_HELP
        .iter()
        .find(|(command, _)| *command == name)
        .map(|(_, page)| page)
}

/// Prints the help that `name` asks for, as in `mnemocode help <name>`. Whether there is a command
/// or topic of that name.
pub(crate) fn print_named_help(name: &str) -> bool {
    if let Some((_, summary, usage)) = BUILT_INS.iter().find(|(built_in, ..)| *built_in == name) {
        print_blocks(&[
            (*summary).to_owned(),
            usage_line(&format!("mnemocode {name}"), usage),
            closing_safety(),
        ]);
        return true;
    }
    if let Some(page) = page_of(name) {
        print_command_help(name, page, true);
        return true;
    }
    if let Some((_, topic)) = TOPIC_HELP.iter().find(|(topic, _)| *topic == name) {
        print_topic_help(topic);
        return true;
    }
    false
}

/// The commands and topics, for an error about an unknown one.
pub(crate) fn help_names() -> String {
    let commands = COMMAND_HELP.iter().map(|(name, _)| *name);
    let built_ins = BUILT_INS.iter().map(|(name, ..)| *name);
    let topics = TOPIC_HELP.iter().map(|(name, _)| *name);
    let names: Vec<&str> = commands.chain(built_ins).chain(topics).collect();
    names.join(", ")
}

/// `mnemocode`, `mnemocode --help` and `mnemocode help`.
pub(crate) fn print_usage() {
    let mut commands: Vec<HelpRow> = COMMAND_HELP
        .iter()
        // sskr-split is an older name of encode --sskr.
        .filter(|(name, _)| *name != "sskr-split")
        .map(|(name, page)| (*name, page.summary))
        .collect();
    commands.extend(BUILT_INS.iter().map(|(name, summary, _)| (*name, *summary)));
    let topic_names: Vec<String> = TOPIC_HELP
        .iter()
        .map(|(name, _)| format!("help {name}"))
        .collect();
    let topics: Vec<(String, usize, &str)> = TOPIC_HELP
        .iter()
        .zip(&topic_names)
        .map(|((_, topic), name)| {
            (
                painted(style::ACCENT, name),
                name.chars().count(),
                topic.summary,
            )
        })
        .collect();
    let main_examples: [HelpRow; 8] = [
        (
            "mnemocode encode --mode seedshift --ask-secrets --format 5",
            "Write a real phrase as colors; dates asked for",
        ),
        (
            "mnemocode decode --input-file shifted.txt --dates-file dates.txt",
            "Turn a record back into the phrase",
        ),
        (
            "mnemocode recover-word --ask-secrets",
            "Find forgotten words",
        ),
        (
            "mnemocode encode --sskr --ask-secrets --threshold 2 --shares 3",
            "Split a phrase into 3 shares, any 2 restore it",
        ),
        (
            "mnemocode sskr-combine --ask-secrets",
            "Restore a phrase from its shares",
        ),
        (
            "mnemocode preview --all --pdf all-previews.pdf",
            "Every card design in one PDF",
        ),
        ("mnemocode self-test", "Check a new installation"),
        (
            "mnemocode encode --help",
            "Every option of a command, with examples",
        ),
    ];
    print_blocks(&[
        format!(
            "{}\nOffline reversible representations for English BIP39 mnemonics",
            heading(&format!("MnemoCode {}", env!("CARGO_PKG_VERSION")))
        ),
        paragraphs(&[
            "Writes a BIP39 recovery phrase as numbers, Unicode codes or colors, masks it with dates, splits it into Shamir shares and prints it as cards, all offline. Every form converts back to the exact original words.",
        ]),
        usage_line("mnemocode", "<COMMAND> [OPTIONS]"),
        section("Commands:", &columns(&commands)),
        section("Topics:", &labelled_columns(&topics)),
        section(
            "Options:",
            &columns(&[
                (HELP_FLAGS, "Print help; after a command, its help"),
                (VERSION_FLAGS, "Print the version"),
            ]),
        ),
        examples(&main_examples),
        notes(&[
            "Started without a command in a terminal, mnemocode shows a menu that asks step by step, asks again after an answer that cannot be used, and shows the command it runs. Use --ask-secrets for a real phrase: text typed in a command can stay in the shell history. Work on a trusted computer without a network connection. -h gives a short summary of a command, --help the full explanation.",
        ]),
        closing_safety(),
    ]);
}
