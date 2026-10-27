//! Gate `action-pins` of the coding guide for this repository: every GitHub Action its workflows
//! use is pinned to the commit and version of the table in the workspace's ci.instructions.md
//! (CI-01), and every workflow declares `permissions:` (CI-02) and `concurrency:` (CI-03). A copy
//! of the workspace's .github/scripts/verify-action-pins.mjs for this Rust repository (CORE-10's
//! exception for copies across projects: a change goes to both). The table is the workspace's, so
//! the gate runs where the repository sits in the workspace; CI has no workspace beside it.

use std::collections::BTreeMap;
use std::path::Path;

use crate::{Failure, report};

/// The pins of the table, by `owner/name`: (version, commit).
fn pin_table(text: &str) -> BTreeMap<String, (String, String)> {
    let mut pins = BTreeMap::new();
    for line in text.lines() {
        let cells: Vec<&str> = line.split('|').map(str::trim).collect();
        let [_, action, version, commit, ..] = cells.as_slice() else {
            continue;
        };
        let action = action.trim_matches('`');
        let commit = commit.trim_matches('`');
        let pinned = version.starts_with('v')
            && commit.len() == 40
            && commit.bytes().all(|byte| byte.is_ascii_hexdigit());
        if pinned && action.contains('/') {
            pins.insert(
                action.to_owned(),
                ((*version).to_owned(), commit.to_owned()),
            );
        }
    }
    pins
}

/// The YAML files under `folder`, recursively.
fn yaml_files(folder: &Path) -> Vec<std::path::PathBuf> {
    let Ok(entries) = std::fs::read_dir(folder) else {
        return Vec::new();
    };
    let mut files = Vec::new();
    for entry in entries.flatten() {
        let path = entry.path();
        if path.is_dir() {
            files.extend(yaml_files(&path));
        } else if path
            .extension()
            .is_some_and(|ending| ending == "yml" || ending == "yaml")
        {
            files.push(path);
        }
    }
    files.sort();
    files
}

/// Every `uses:` line of `text` against the pins.
fn check_pins(
    where_: &str,
    text: &str,
    pins: &BTreeMap<String, (String, String)>,
    problems: &mut Vec<String>,
) {
    for (index, line) in text.lines().enumerate() {
        let trimmed = line.trim_start().trim_start_matches("- ").trim_start();
        let Some(step) = trimmed.strip_prefix("uses:") else {
            continue;
        };
        let (reference, comment) = step
            .split_once('#')
            .map_or((step.trim(), None), |(left, right)| {
                (left.trim(), Some(right.trim()))
            });
        let Some((path, commit)) = reference.split_once('@') else {
            continue;
        };
        if path.starts_with("./") || path.starts_with("docker://") {
            continue;
        }
        // A sub-action such as `owner/name/init` is pinned as its repository `owner/name`.
        let action: String = path.split('/').take(2).collect::<Vec<_>>().join("/");
        let version = comment.and_then(|comment| comment.split_whitespace().next());
        match pins.get(&action) {
            None => problems.push(format!(
                "{where_}:{}: CI-01 {action} is not in the pin table",
                index + 1
            )),
            Some((pinned_version, pinned_commit)) => {
                if commit != pinned_commit || version != Some(pinned_version.as_str()) {
                    problems.push(format!(
                        "{where_}:{}: CI-01 {action}@{commit} # {} should be @{pinned_commit} # {pinned_version}",
                        index + 1,
                        version.unwrap_or("(no version)")
                    ));
                }
            }
        }
    }
}

/// The gate; said, not failed, where the workspace's table is not beside the repository.
pub(crate) fn run(root: &Path) -> Result<(), Failure> {
    let table = root
        .parent()
        .unwrap_or(root)
        .join(".github/instructions/ci.instructions.md");
    let Ok(text) = std::fs::read_to_string(&table) else {
        return report(
            &[],
            "",
            "action-pins: the workspace's pin table is not beside this repository; not run here.",
        );
    };
    let pins = pin_table(&text);
    if pins.is_empty() {
        return Err(Failure(format!(
            "no pin table found in {}",
            table.display()
        )));
    }
    let mut problems = Vec::new();
    let workflows = yaml_files(&root.join(".github/workflows"));
    let actions = yaml_files(&root.join(".github/actions"));
    for file in workflows.iter().chain(&actions) {
        let where_ = file
            .strip_prefix(root)
            .unwrap_or(file)
            .display()
            .to_string();
        check_pins(
            &where_,
            &std::fs::read_to_string(file)?,
            &pins,
            &mut problems,
        );
    }
    for file in &workflows {
        let text = std::fs::read_to_string(file)?;
        let where_ = file
            .strip_prefix(root)
            .unwrap_or(file)
            .display()
            .to_string();
        if !text.lines().any(|line| line.starts_with("permissions:")) {
            problems.push(format!("{where_}: CI-02 no top-level permissions"));
        }
        if !text
            .lines()
            .any(|line| line.trim_start().starts_with("concurrency:"))
        {
            problems.push(format!("{where_}: CI-03 no concurrency group"));
        }
    }
    report(
        &problems,
        &format!("action-pins: {} problem(s)", problems.len()),
        &format!(
            "action-pins: every action matches the table of {} pins",
            pins.len()
        ),
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_step_off_its_pin_is_refused() {
        let pins = pin_table(&format!(
            "| `actions/checkout` | v7.0.1 | `{}` |\n",
            "a".repeat(40)
        ));
        let mut problems = Vec::new();
        let good = format!(
            "      - uses: actions/checkout@{} # v7.0.1\n",
            "a".repeat(40)
        );
        check_pins("ci.yml", &good, &pins, &mut problems);
        assert!(problems.is_empty());
        check_pins(
            "ci.yml",
            "      - uses: actions/checkout@v7 # v7\n",
            &pins,
            &mut problems,
        );
        assert_eq!(problems.len(), 1);
    }
}
