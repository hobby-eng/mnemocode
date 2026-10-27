//! The lints, tests and manifests parts: lint attributes (RUST-05, RUST-07, CORE-09, CORE-46),
//! test names and fakes (CORE-32, CORE-34), and the crates' manifests (RUST-01, RUST-07, RUST-12).

use std::collections::BTreeSet;
use std::path::Path;

use serde_json::Value;

use super::layers::names;
use super::{OWN_CRATES, Problems, Source};
use crate::Failure;
use crate::repository::read;

/// The lints of clippy's disallowed std items, which only the CLI's I/O modules and test code may
/// expect, under their old names too, which rustc applies to the new lints.
const IO_LINTS: [&str; 4] = [
    "clippy::disallowed_methods",
    "clippy::disallowed_types",
    "clippy::disallowed_method",
    "clippy::disallowed_type",
];
/// Lint groups: allowing one would silence the gated lints in it.
const LINT_GROUPS: [&str; 11] = [
    "warnings",
    "clippy::all",
    "clippy::style",
    "clippy::complexity",
    "clippy::correctness",
    "clippy::perf",
    "clippy::suspicious",
    "clippy::pedantic",
    "clippy::restriction",
    "clippy::nursery",
    "clippy::cargo",
];
/// The only traits a test may fake (CORE-32).
const FAKEABLE: [&str; 2] = ["Random", "Probes"];
/// CORE-34: words in a test's name.
const MIN_TEST_WORDS: usize = 3;
/// The release profile of RUST-12, value by key.
const RELEASE_PROFILE: [(&str, &str); 3] = [
    ("panic", "\"abort\""),
    ("lto", "true"),
    ("codegen-units", "1"),
];

/// Whether `inside` (a path under its crate) lies in a file or folder of `allowed`.
fn in_allowed(inside: &str, allowed: &[String]) -> bool {
    allowed.iter().any(|entry| {
        if entry.ends_with('/') {
            inside.starts_with(entry.as_str())
        } else {
            inside == entry
        }
    })
}

/// The part for one source; `test_file` for a file that is test code as a whole.
pub(super) fn check(problems: &mut Problems, source: &Source, map: &Value, test_file: bool) {
    let entry = &map["crates"][source.crate_name];
    let inside = source
        .path
        .get(source.crate_dir.len() + 1..)
        .unwrap_or_default();
    let is_root = inside == "src/lib.rs" || inside == "src/main.rs";
    let file = &source.file;
    // clippy sees rand_core's OsRng only as a type or in a `use`, not named as a value (CORE-46).
    for &line in &file.os_rng {
        problems.report(&source.path, line, "CORE-46", "OsRng: take the Random port");
    }
    let allowed_unsafe = names(
        entry
            .get("unsafe")
            .and_then(|unsafe_| unsafe_.get("allowedIn")),
    );
    let io_modules = names(entry.get("ioModules"));
    for &line in &file.built_attributes {
        problems.report(
            &source.path,
            line,
            "RUST-05",
            "a lint attribute built from a macro's parameters, or given to a macro, hides the lints it sets",
        );
    }
    for attribute in &file.attributes {
        for levels in &attribute.levels {
            let level = levels.level.as_str();
            if level == "deny" || level == "forbid" {
                continue;
            }
            for lint in &levels.lints {
                let lint = lint.as_str();
                if LINT_GROUPS.contains(&lint) {
                    let message =
                        format!("{level}({lint}) would silence the gated lints of its group");
                    problems.report(&source.path, attribute.line, "RUST-05", &message);
                }
                if lint == "renamed_and_removed_lints" {
                    let message = format!(
                        "{level}({lint}) would let an old lint name silence its gated lint"
                    );
                    problems.report(&source.path, attribute.line, "RUST-05", &message);
                }
                if lint == "unsafe_code" && !in_allowed(inside, &allowed_unsafe) {
                    let message =
                        format!("{level}(unsafe_code) only where module-map.json allows it");
                    problems.report(&source.path, attribute.line, "RUST-07", &message);
                }
                if IO_LINTS.contains(&lint) {
                    let in_test = test_file || file.in_test(attribute.line);
                    let test_expect = in_test && level == "expect";
                    let io_expect = !is_root
                        && in_allowed(inside, &io_modules)
                        && attribute.at_top
                        && level == "expect";
                    if !test_expect && !io_expect {
                        let message = format!(
                            "{lint} is expected only at the top of the CLI's I/O modules (module-map.json ioModules)"
                        );
                        problems.report(&source.path, attribute.line, "CORE-09", &message);
                    }
                }
            }
        }
    }
}

/// The tests part: names of three words or more, and fakes only of Random and Probes.
pub(super) fn check_tests(
    problems: &mut Problems,
    sources: &[Source],
    test_files: &BTreeSet<String>,
) {
    let own_traits: BTreeSet<&str> = sources
        .iter()
        .flat_map(|source| source.file.traits.iter().map(String::as_str))
        .collect();
    for source in sources {
        let whole = test_files.contains(&source.path)
            || source
                .path
                .strip_prefix(source.crate_dir)
                .is_some_and(|inside| inside.starts_with("/tests/"));
        for (name, line) in &source.file.tests {
            let words = name.split('_').filter(|word| !word.is_empty()).count();
            if words < MIN_TEST_WORDS {
                let message = format!("test {name} needs a name of {MIN_TEST_WORDS} words or more");
                problems.report(&source.path, *line, "CORE-34", &message);
            }
        }
        for (trait_name, line) in &source.file.impls {
            let in_test = whole || source.file.in_test(*line);
            if in_test
                && own_traits.contains(trait_name.as_str())
                && !FAKEABLE.contains(&trait_name.as_str())
            {
                let message =
                    format!("a test fake of {trait_name}: only Random and Probes are faked");
                problems.report(&source.path, *line, "CORE-32", &message);
            }
        }
    }
}

/// The manifests part: lints tables, forbid roots and the release profile.
pub(super) fn check_manifests(
    problems: &mut Problems,
    root: &Path,
    files: &[String],
    map: &Value,
) -> Result<(), Failure> {
    for manifest in files
        .iter()
        .filter(|path| path.ends_with("Cargo.toml") && *path != "Cargo.toml")
    {
        if manifest.starts_with("vendor/") {
            continue;
        }
        if !read(root, manifest)?.contains("\n[lints]\nworkspace = true\n") {
            problems.report(manifest, 1, "RUST-01", "needs [lints] workspace = true");
        }
    }
    for (crate_dir, crate_name) in OWN_CRATES {
        let level = map["crates"][crate_name]["unsafe"]["level"].as_str();
        if level != Some("forbid") {
            continue;
        }
        let root_file = [
            format!("{crate_dir}/src/lib.rs"),
            format!("{crate_dir}/src/main.rs"),
        ]
        .into_iter()
        .find(|path| files.contains(path));
        let forbids = match &root_file {
            Some(path) => crate::rust_source::read(&read(root, path)?, &[]).is_ok_and(|file| {
                file.attributes.iter().any(|attribute| {
                    attribute.at_top
                        && attribute.levels.iter().any(|levels| {
                            levels.level == "forbid"
                                && levels.lints.iter().any(|lint| lint == "unsafe_code")
                        })
                })
            }),
            None => false,
        };
        if !forbids {
            let place = root_file.as_deref().unwrap_or(crate_dir);
            problems.report(
                place,
                1,
                "RUST-07",
                "the crate root needs #![forbid(unsafe_code)]",
            );
        }
    }
    check_release_profile(problems, &read(root, "Cargo.toml")?);
    Ok(())
}

/// RUST-12: each key of the release profile with exactly its value, comments left out.
pub(super) fn check_release_profile(problems: &mut Problems, manifest: &str) {
    let section = manifest
        .split_once("\n[profile.release]\n")
        .or_else(|| {
            manifest
                .strip_prefix("[profile.release]\n")
                .map(|rest| ("", rest))
        })
        .map_or("", |(_, rest)| rest.split("\n[").next().unwrap_or_default());
    let values: Vec<(String, String)> = section
        .lines()
        .map(|line| line.split('#').next().unwrap_or_default().trim())
        .filter_map(|line| line.split_once('='))
        .map(|(key, value)| (key.trim().to_owned(), value.trim().to_owned()))
        .collect();
    for (key, value) in RELEASE_PROFILE {
        if !values
            .iter()
            .any(|(found, written)| found == key && written == value)
        {
            problems.report(
                "Cargo.toml",
                1,
                "RUST-12",
                &format!("the release profile needs {key} = {value}"),
            );
        }
    }
}
