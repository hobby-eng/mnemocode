//! Gate `action-pins`: every GitHub Action the workflows use is pinned to the commit of the
//! workspace's table in ci.instructions.md (CI-01), and every workflow declares `permissions:` and
//! `concurrency:` (CI-02, CI-03). A copy of the workspace's verify-action-pins.mjs: a change goes
//! to both. CI-01 needs the workspace beside the repository, which CI does not have: there it is
//! skipped with a warning, and everywhere else its absence fails (AUD-007-BLD004).

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

/// The gate. Without the workspace's table beside the repository CI-01 is not checked: that fails
/// where `table_required`, and is otherwise said, as a warning in GitHub's CI.
pub(crate) fn run(root: &Path, table_required: bool) -> Result<(), Failure> {
    let table = root
        .parent()
        .unwrap_or(root)
        .join(".github/instructions/ci.instructions.md");
    let mut problems = Vec::new();
    let pins = match std::fs::read_to_string(&table) {
        Ok(text) => Some(pin_table(&text)),
        Err(_) if table_required => {
            problems.push(format!(
                "CI-01 not checked: no pin table at {}; run this inside the workspace",
                table.display()
            ));
            None
        }
        Err(_) => {
            let note = "CI-01 not checked: the workspace's pin table is not beside this repository";
            if std::env::var_os("GITHUB_ACTIONS").is_some() {
                println!("::warning title=action-pins::{note}");
            }
            println!("action-pins: {note}.");
            None
        }
    };
    if pins.as_ref().is_some_and(BTreeMap::is_empty) {
        return Err(Failure(format!(
            "no pin table found in {}",
            table.display()
        )));
    }
    let workflows = yaml_files(&root.join(".github/workflows"));
    let actions = yaml_files(&root.join(".github/actions"));
    for file in workflows.iter().chain(&actions) {
        let where_ = file
            .strip_prefix(root)
            .unwrap_or(file)
            .display()
            .to_string();
        if let Some(pins) = &pins {
            check_pins(
                &where_,
                &std::fs::read_to_string(file)?,
                pins,
                &mut problems,
            );
        }
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
        &pins.map_or_else(
            || "action-pins: every workflow declares permissions and concurrency".to_owned(),
            |pins| {
                format!(
                    "action-pins: every action matches the table of {} pins",
                    pins.len()
                )
            },
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

    /// A repository with one workflow and no workspace around it.
    fn standalone(name: &str, workflow: &str) -> std::path::PathBuf {
        let root = std::env::temp_dir()
            .join(format!("xtask-pins-{}-{name}", std::process::id()))
            .join("repository");
        std::fs::create_dir_all(root.join(".github/workflows")).unwrap();
        std::fs::write(root.join(".github/workflows/ci.yml"), workflow).unwrap();
        root
    }

    // AUD-007-BLD004: a checkout without the workspace's table never passes as checked.
    #[test]
    fn a_missing_pin_table_fails_where_required_and_other_rules_still_run() {
        let declared = "permissions: {}\nconcurrency: x\n";
        let root = standalone("declared", declared);
        assert!(run(&root, true).is_err());
        assert!(run(&root, false).is_ok());
        let bare = standalone("bare", "on: push\n");
        assert!(run(&bare, false).is_err());
        for folder in [&root, &bare] {
            std::fs::remove_dir_all(folder.parent().unwrap()).unwrap();
        }
    }
}
