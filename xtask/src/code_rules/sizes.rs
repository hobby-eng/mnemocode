//! The size part (CORE-15: at most 800 lines of code per file, comments and blank lines left out,
//! a Rust file's unit-test modules too) and the tooling part (TOOL-01: the repository's tools are
//! Rust, with no Node.js or other script language; TOOL-02: a shell wrapper stops on its first
//! error and quotes its expansions).

use std::collections::BTreeSet;
use std::path::Path;

use super::{Problems, Source};
use crate::Failure;
use crate::repository::read;
use crate::rust_source::code_lines;

/// CORE-15: lines of code per file.
const MAX_FILE_LINES: usize = 800;
/// Script languages that a Rust repository does not write (TOOL-01).
const OTHER_SCRIPTS: [&str; 9] = [
    ".mjs", ".js", ".cjs", ".ts", ".py", ".ps1", ".rb", ".pl", ".bat",
];
/// The files of Node.js and its package managers, which a Rust repository has none of (TOOL-01).
const NODE_FILES: [&str; 7] = [
    "package.json",
    "pnpm-lock.yaml",
    "package-lock.json",
    "npm-shrinkwrap.json",
    "yarn.lock",
    "bun.lockb",
    ".node-version",
];
/// The shells whose scripts TOOL-02 reads; a script for another interpreter breaks TOOL-01.
const SHELLS: [&str; 4] = ["sh", "bash", "dash", "zsh"];

/// The lines of code of a file whose comments are whole lines that start with "#" (shell, TOML,
/// YAML, text): every line that is neither blank nor such a comment.
fn hash_comment_lines(text: &str) -> BTreeSet<usize> {
    text.lines()
        .enumerate()
        .filter(|(_, line)| {
            let trimmed = line.trim();
            !trimmed.is_empty() && !trimmed.starts_with('#')
        })
        .map(|(index, _)| index + 1)
        .collect()
}

/// The part over every file but the vendored engine, the vectors, the documents and data.
pub(super) fn check(
    problems: &mut Problems,
    root: &Path,
    files: &[String],
    sources: &[Source],
) -> Result<(), Failure> {
    for path in files {
        let skipped = ["vendor/", "vectors/", "docs/"]
            .iter()
            .any(|folder| path.starts_with(folder))
            || [".md", ".json", ".lock", ".yaml"]
                .iter()
                .any(|ending| path.ends_with(ending));
        if skipped {
            continue;
        }
        let lines = if path.ends_with(".rs") {
            let Some(source) = sources.iter().find(|source| &source.path == path) else {
                continue;
            };
            code_lines(&source.text, &source.file.test_ranges)
                .map_err(|error| Failure(format!("{path}: {error}")))?
        } else if [".sh", ".toml", ".yml", ".txt"]
            .iter()
            .any(|ending| path.ends_with(ending))
        {
            hash_comment_lines(&read(root, path)?)
        } else {
            continue;
        };
        if lines.len() > MAX_FILE_LINES {
            let line = lines.iter().nth(MAX_FILE_LINES).copied().unwrap_or(1);
            let message = format!("{} lines of code, more than {MAX_FILE_LINES}", lines.len());
            problems.report(path, line, "CORE-15", &message);
        }
    }
    Ok(())
}

/// The interpreter a script's first line names: `#!/bin/sh` gives sh, `#!/usr/bin/env bash`
/// bash; none without one. `#![` opens a Rust inner attribute, as rustc reads it, not a script.
fn interpreter(bytes: &[u8]) -> Option<String> {
    if bytes.starts_with(b"#![") {
        return None;
    }
    let line = bytes
        .strip_prefix(b"#!")?
        .split(|byte| *byte == b'\n')
        .next()?;
    let line = String::from_utf8_lossy(line);
    let mut words = line.split_whitespace();
    let program = words.next()?.rsplit('/').next()?.to_owned();
    if program == "env" {
        return words.find(|word| !word.starts_with('-')).map(str::to_owned);
    }
    Some(program)
}

/// The tooling part.
pub(super) fn check_tooling(
    problems: &mut Problems,
    root: &Path,
    files: &[String],
) -> Result<(), Failure> {
    for path in files {
        if path.starts_with("vendor/") || path.starts_with("vectors/") {
            continue;
        }
        let name = path.rsplit('/').next().unwrap_or_default();
        if OTHER_SCRIPTS.iter().any(|ending| path.ends_with(ending)) || NODE_FILES.contains(&name) {
            problems.report(
                path,
                1,
                "TOOL-01",
                "a Rust repository writes its tools in Rust, as xtask tasks, with no Node.js",
            );
            continue;
        }
        if path.ends_with(".rs") {
            continue;
        }
        let shell = match std::fs::read(root.join(path))
            .ok()
            .as_deref()
            .and_then(interpreter)
        {
            Some(program) if SHELLS.contains(&program.as_str()) => true,
            Some(program) => {
                problems.report(
                    path,
                    1,
                    "TOOL-01",
                    &format!("a script for {program}: a Rust repository writes its tools in Rust"),
                );
                false
            }
            None => path.ends_with(".sh"),
        };
        if shell {
            check_shell(problems, path, &read(root, path)?);
        }
    }
    Ok(())
}

/// The word that ends a here-document opened at `rest`, the text after its `<<`, and whether
/// leading tabs are taken off the line it stands on (`<<-`): a word of letters, digits, `_`, `.`
/// and `-`, quoted or after a backslash.
fn here_document(rest: &str) -> Option<(String, bool)> {
    let tabs = rest.starts_with('-');
    let rest = rest.strip_prefix('-').unwrap_or(rest).trim_start();
    let rest = rest.trim_start_matches(['\'', '"', '\\']);
    let word: String = rest
        .chars()
        .take_while(|character| character.is_alphanumeric() || matches!(character, '_' | '.' | '-'))
        .collect();
    (!word.is_empty()).then_some((word, tabs))
}

/// TOOL-02: the first line of code is `set -euo pipefail`, and no expansion stands outside quotes,
/// the quotes followed from line to line, a backslash outside single quotes escaping the character
/// after it, and the bodies of here-documents left out: text, not code.
fn check_shell(problems: &mut Problems, path: &str, text: &str) {
    let first = text.lines().enumerate().find(|(_, line)| {
        let trimmed = line.trim();
        !trimmed.is_empty() && !trimmed.starts_with('#')
    });
    let starts = first.is_some_and(|(_, line)| {
        line.trim().split('#').next().unwrap_or_default().trim() == "set -euo pipefail"
    });
    if !starts {
        let line = first.map_or(1, |(index, _)| index + 1);
        problems.report(
            path,
            line,
            "TOOL-02",
            "a shell script starts with `set -euo pipefail`",
        );
    }
    let (mut single, mut double) = (false, false);
    let mut here: Option<(String, bool)> = None;
    for (index, line) in text.lines().enumerate() {
        if let Some((word, tabs)) = &here {
            let end = if *tabs {
                line.trim_start_matches('\t')
            } else {
                line
            };
            if end == word {
                here = None;
            }
            continue;
        }
        // Inside `(( … ))`, `<<` is a shift, not a here-document. An arithmetic command ends on its
        // line: a `((` whose `))` the scan never reaches, after a reported `$` or in nested
        // subshells such as `((cd a) || b)`, is not carried further.
        let mut arithmetic = 0_usize;
        if !single && !double && line.trim_start().starts_with('#') {
            continue;
        }
        let mut previous = ' ';
        let mut characters = line.char_indices();
        while let Some((at, character)) = characters.next() {
            match character {
                '\\' if !single => {
                    characters.next();
                }
                '<' if !single && !double && line[at..].starts_with("<<<") => {
                    // A here-string: its word is the rest of the line, read as code.
                    characters.next();
                    characters.next();
                }
                '(' if !single && !double && line[at..].starts_with("((") => {
                    arithmetic += 1;
                    characters.next();
                }
                ')' if !single && !double && arithmetic > 0 && line[at..].starts_with("))") => {
                    arithmetic -= 1;
                    characters.next();
                }
                '<' if !single
                    && !double
                    && arithmetic == 0
                    && here.is_none()
                    && line[at..].starts_with("<<") =>
                {
                    here = here_document(&line[at + 2..]);
                    characters.next();
                }
                '\'' if !double => single = !single,
                '"' if !single => double = !double,
                '#' if !single && !double && previous.is_whitespace() => break,
                '$' if !single && !double => {
                    problems.report(
                        path,
                        index + 1,
                        "TOOL-02",
                        "an expansion outside quotes: write \"$name\"",
                    );
                    break;
                }
                _ => {}
            }
            previous = character;
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn shell_problems(text: &str) -> Vec<String> {
        let mut problems = Problems(Vec::new());
        check_shell(&mut problems, "scripts/release", text);
        problems.0
    }

    #[test]
    fn a_script_is_known_by_its_first_line() {
        assert_eq!(
            interpreter(b"#!/usr/bin/env bash\nset -e\n").as_deref(),
            Some("bash")
        );
        assert_eq!(interpreter(b"#!/bin/sh\n").as_deref(), Some("sh"));
        assert_eq!(
            interpreter(b"#!/usr/bin/env -S node --flag\n").as_deref(),
            Some("node")
        );
        assert_eq!(interpreter(b"fn main() {}\n"), None);
    }

    #[test]
    fn expansions_are_read_through_escapes_and_lines() {
        let good = "set -euo pipefail\necho \"a\nb $x\"\necho 'it''s' \\$HOME\n";
        assert!(
            shell_problems(good).is_empty(),
            "{:?}",
            shell_problems(good)
        );
        assert_eq!(
            shell_problems("set -euo pipefail\necho don\\'t $x\n").len(),
            1
        );
        assert_eq!(shell_problems("rm -rf \"$dir\"\n").len(), 1);
        let here = "set -euo pipefail\ncat <<EOF\nit's slow, $HOME\nEOF\nrm -rf $dir\n";
        assert_eq!(shell_problems(here).len(), 1);
        assert_eq!(interpreter(b"#![cfg(test)]\n"), None);
        assert_eq!(
            shell_problems("set -euo pipefail\n(( x = 1 << 2 ))\nrm -rf $dir\n").len(),
            1
        );
        for opening in [
            "tr a-z A-Z <<< \"abc\"\nabc\n",
            "cat <<EOF-NOTE\nit's\nEOF-NOTE\n",
            "cat <<\\EOF\nit's\nEOF\n",
            // A `((` never closed on its line: the here-document after it is still one.
            "((cd a) || true)\ncat <<EOF\nit's\nEOF\n",
        ] {
            let script = format!("set -euo pipefail\n{opening}rm -rf $dir\n");
            assert_eq!(shell_problems(&script).len(), 1, "{opening}");
        }
    }
}
