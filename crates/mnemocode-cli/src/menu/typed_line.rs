//! A command line as a person would type it in the shell of the system (MnemoCode TS 0.1.0's
//! `cli/shell-command.ts`): each argument quoted only where a shell would read it, so that the line
//! the menu shows runs as it is.

/// Indent of the typed command under "The same as:".
const COMMAND_INDENT: &str = "  ";
/// What cmd.exe or PowerShell still reads inside double quotes: " and its typographic forms, which
/// PowerShell takes as quotes too, $ and ` (PowerShell), % ! and ^ (cmd.exe), and a line break.
const SPECIAL_IN_DOUBLE_QUOTES: &[char] = &[
    '"', '\u{201c}', '\u{201d}', '\u{201e}', '$', '`', '%', '!', '^', '\r', '\n',
];
/// The characters that end a PowerShell single-quoted string.
const POWERSHELL_SINGLE_QUOTES: &[char] = &['\'', '\u{2018}', '\u{2019}', '\u{201a}', '\u{201b}'];

/// Whether `character` reads as it is in sh, bash, zsh, cmd.exe and PowerShell. % (cmd.exe
/// variables) and , (PowerShell arrays) are not among them.
fn plain_character(character: char) -> bool {
    character.is_ascii_alphanumeric() || "_./:@+=-".contains(character)
}

/// Whether PowerShell may read `argument` as a number and pass it on as it writes that number: 4E00
/// as 4, 0x10 as 16, 1kb as 1024, 007 as 7, also after a sign or a point. Only a plain decimal
/// without a leading zero is passed on as it was typed.
fn reads_as_number(argument: &str) -> bool {
    let unsigned = argument.strip_prefix(['+', '-']).unwrap_or(argument);
    let digits = unsigned.strip_prefix('.').unwrap_or(unsigned);
    let number_start = digits.starts_with(|character: char| character.is_ascii_digit());
    let plain_decimal = argument == "0"
        || (!argument.starts_with('0')
            && !argument.is_empty()
            && argument.bytes().all(|byte| byte.is_ascii_digit()));
    number_start && !plain_decimal
}

/// Whether `argument` reads the same in every shell of the system without quotes. A first = or @
/// is still read: zsh expands =name to the path of a program, and PowerShell reads @name as
/// splatting.
fn is_plain(argument: &str, windows: bool) -> bool {
    !argument.is_empty()
        && argument.chars().all(plain_character)
        && !argument.starts_with(['=', '@'])
        && !(windows && reads_as_number(argument))
}

/// An argument in single quotes, where a POSIX shell expands nothing; a ' inside ends them.
fn posix_quoted(argument: &str) -> String {
    format!("'{}'", argument.replace('\'', "'\\''"))
}

/// An argument quoted for both shells of Windows: double quotes, which read the same in both while
/// the argument holds nothing they still read, which leaves paths with spaces and backslashes in
/// them. Anything else gets PowerShell's single quotes, each of its quote characters doubled; a
/// backslash at the end would escape a closing double quote.
fn windows_quoted(argument: &str) -> String {
    if argument.contains(SPECIAL_IN_DOUBLE_QUOTES) || argument.ends_with('\\') {
        let mut quoted = String::from("'");
        for character in argument.chars() {
            if POWERSHELL_SINGLE_QUOTES.contains(&character) {
                quoted.push(character);
            }
            quoted.push(character);
        }
        quoted.push('\'');
        return quoted;
    }
    format!("\"{argument}\"")
}

/// The command of MnemoCode with the arguments `run`, as it would be typed.
fn typed_command(run: &[String], windows: bool) -> String {
    let quoted = run.iter().map(|argument| {
        if is_plain(argument, windows) {
            argument.clone()
        } else if windows {
            windows_quoted(argument)
        } else {
            posix_quoted(argument)
        }
    });
    let mut words = vec!["mnemocode".to_owned()];
    words.extend(quoted);
    words.join(" ")
}

/// The command as the menu shows it. Prose wrapping would change quoted arguments: the terminal
/// wraps the literal command.
pub(super) fn command_display(run: &[String]) -> String {
    format!("{COMMAND_INDENT}{}", typed_command(run, cfg!(windows)))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn typed(arguments: &[&str], windows: bool) -> String {
        let run: Vec<String> = arguments.iter().map(|&text| text.to_owned()).collect();
        typed_command(&run, windows)
    }

    #[test]
    fn a_line_quotes_what_a_shell_would_read() {
        assert_eq!(
            typed(&["encode", "--pdf", "cards.pdf"], false),
            "mnemocode encode --pdf cards.pdf"
        );
        assert_eq!(
            typed(&["--pdf", "my cards.pdf"], false),
            "mnemocode --pdf 'my cards.pdf'"
        );
        assert_eq!(typed(&["it's"], false), "mnemocode 'it'\\''s'");
        assert_eq!(
            typed(&["=name", "@name"], false),
            "mnemocode '=name' '@name'"
        );
        assert_eq!(typed(&[""], false), "mnemocode ''");
    }

    #[test]
    fn windows_keeps_paths_and_numbers_whole() {
        assert_eq!(
            typed(&["C:\\my cards\\a.pdf"], true),
            "mnemocode \"C:\\my cards\\a.pdf\""
        );
        assert_eq!(typed(&["a$b"], true), "mnemocode 'a$b'");
        assert_eq!(typed(&["it's $"], true), "mnemocode 'it''s $'");
        assert_eq!(typed(&["folder\\"], true), "mnemocode 'folder\\'");
        assert_eq!(
            typed(&["4E00", "007", "42", "0"], true),
            "mnemocode \"4E00\" \"007\" 42 0"
        );
    }
}
