//! Gate `markdown` (DOC-01): GitHub renders a Markdown list "loose", as separate paragraphs with
//! wider spacing than every other list, when a blank line separates two of its items or two blocks
//! of one item; every list in the repository's documents stays tight. The files the formatter
//! leaves alone (frozen audit records, the vectors) are left out here too. A copy of the check of
//! MnemoCode TS and the multi-chain wallet tools (CORE-10's exception for copies across projects:
//! a change goes to every copy).

use std::path::Path;

use crate::repository::{read, tracked_or_new};
use crate::{Failure, report};

/// The folders the formatter leaves alone, whose Markdown this check leaves alone too.
const LEFT_ALONE: [&str; 4] = ["vendor/", "vectors/", "docs/audits/", "dist/"];

fn is_list_item(line: &str) -> bool {
    let trimmed = line.trim_start();
    let marker =
        trimmed.starts_with("- ") || trimmed.starts_with("* ") || trimmed.starts_with("+ ");
    let digits = trimmed.bytes().take_while(u8::is_ascii_digit).count();
    let numbered = digits > 0
        && matches!(trimmed.as_bytes().get(digits), Some(b'.' | b')'))
        && matches!(trimmed.as_bytes().get(digits + 1), Some(b' ' | b'\t'));
    marker || numbered
}

fn is_fence(line: &str) -> bool {
    let trimmed = line.trim_start();
    trimmed.starts_with("```") || trimmed.starts_with("~~~")
}

/// The 1-based numbers of the blank lines that make a list loose.
fn loose_list_lines(text: &str) -> Vec<usize> {
    let mut found = Vec::new();
    let (mut in_fence, mut in_list, mut blank_in_list) = (false, false, false);
    // The 0-based index of a line is the 1-based number of the blank line just above it.
    for (index, line) in text.lines().enumerate() {
        if is_fence(line) {
            let indented = line.starts_with(char::is_whitespace);
            if !in_fence && blank_in_list && indented {
                found.push(index);
            }
            if !in_fence && !indented {
                in_list = false;
            }
            in_fence = !in_fence;
            blank_in_list = false;
            continue;
        }
        if in_fence {
            continue;
        }
        if line.trim().is_empty() {
            if in_list {
                blank_in_list = true;
            }
            continue;
        }
        let indented_text = line.starts_with("  ") && !line.trim().is_empty();
        if is_list_item(line) || (blank_in_list && indented_text) {
            if blank_in_list {
                found.push(index);
            }
            in_list = true;
            blank_in_list = false;
            continue;
        }
        if blank_in_list || line.starts_with('#') {
            in_list = false;
        }
        blank_in_list = false;
    }
    found
}

/// The gate.
pub(crate) fn run(root: &Path) -> Result<(), Failure> {
    let files: Vec<String> = tracked_or_new(root)?
        .into_iter()
        .filter(|path| {
            path.ends_with(".md") && !LEFT_ALONE.iter().any(|folder| path.starts_with(folder))
        })
        .collect();
    let mut problems = Vec::new();
    for path in &files {
        for line in loose_list_lines(&read(root, path)?) {
            problems.push(format!(
                "{path}:{line} has a blank line inside a list, so GitHub renders it with wider spacing."
            ));
        }
    }
    report(
        &problems,
        &format!(
            "{} blank line(s) inside Markdown lists; remove them to keep lists tight.",
            problems.len()
        ),
        &format!("Markdown lists are tight in {} files.", files.len()),
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_blank_line_between_items_makes_a_list_loose() {
        assert_eq!(loose_list_lines("- a\n\n- b\n"), vec![2]);
        assert_eq!(loose_list_lines("- a\n- b\n\nText.\n"), Vec::<usize>::new());
        assert_eq!(loose_list_lines("1. a\n\n   more\n"), vec![2]);
        assert_eq!(
            loose_list_lines("```\n- a\n\n- b\n```\n"),
            Vec::<usize>::new()
        );
    }
}
