//! Gate `code-rules` (docs/design/architect/GATES.md): the coding rules that no compiler lint
//! checks, read from module-map.json: layers, lints, manifests, dependencies, file size, tests,
//! refusal codes and tooling. Each part's module says what it checks.

mod cases;
pub(crate) mod deps;
mod layers;
mod lints;
mod refusals;
mod sizes;

use std::collections::BTreeSet;
use std::path::Path;

use serde_json::Value;

use crate::repository::{read, tracked_or_new};
use crate::rust_source::{self, RustFile};
use crate::{Failure, report};

/// The crates whose Rust files the parts read, by folder: the workspace's own.
pub(crate) const OWN_CRATES: [(&str, &str); 7] = [
    ("crates/mnemocode", "mnemocode"),
    ("crates/mnemocode-cards", "mnemocode-cards"),
    ("crates/mnemocode-embroidery", "mnemocode-embroidery"),
    ("crates/mnemocode-cli", "mnemocode-cli"),
    ("crates/mnemocode-wasm", "mnemocode-wasm"),
    ("shims/bc-crypto", "bc-crypto"),
    ("xtask", "xtask"),
];

/// The problems a run found, each as `path:line: RULE: message`.
#[derive(Debug, Default)]
pub(crate) struct Problems(pub(crate) Vec<String>);

impl Problems {
    pub(crate) fn report(&mut self, path: &str, line: usize, rule: &str, message: &str) {
        self.0.push(format!("{path}:{line}: {rule}: {message}"));
    }
}

/// One Rust source of an own crate, read: its path, its crate and its folder, and what it holds.
pub(crate) struct Source {
    pub(crate) path: String,
    pub(crate) crate_name: &'static str,
    pub(crate) crate_dir: &'static str,
    pub(crate) text: String,
    pub(crate) file: RustFile,
}

/// The module path of a file under a crate's `src/`: [] for lib.rs and main.rs, ["text", "words"]
/// for text/words.rs; integration tests and other files outside `src/` are roots of their own.
pub(crate) fn module_path_of(inside: &str) -> Vec<String> {
    let Some(under_src) = inside.strip_prefix("src/") else {
        return Vec::new();
    };
    let parts: Vec<String> = under_src
        .trim_end_matches(".rs")
        .split('/')
        .map(str::to_owned)
        .collect();
    if parts.len() == 1 && matches!(parts[0].as_str(), "lib" | "main") {
        Vec::new()
    } else {
        parts
    }
}

/// Reads every Rust file of `sources` (path, text) that lies in an own crate; one that does not
/// parse is a problem.
pub(crate) fn read_sources(sources: Vec<(String, String)>, problems: &mut Problems) -> Vec<Source> {
    sources
        .into_iter()
        .filter_map(|(path, text)| {
            let (crate_dir, crate_name) = OWN_CRATES
                .iter()
                .find(|(dir, _)| path.starts_with(&format!("{dir}/")))?;
            if !path.ends_with(".rs") {
                return None;
            }
            let inside = path.get(crate_dir.len() + 1..).unwrap_or_default();
            match rust_source::read(&text, &module_path_of(inside)) {
                Ok(file) => Some(Source {
                    path,
                    crate_name,
                    crate_dir,
                    text,
                    file,
                }),
                Err(message) => {
                    problems.report(&path, 1, "RUST-01", &format!("not read as Rust: {message}"));
                    None
                }
            }
        })
        .collect()
}

/// The Rust files that `#[cfg(test)] mod name;` declarations make test files.
fn test_files(sources: &[Source]) -> BTreeSet<String> {
    let paths: Vec<&str> = sources.iter().map(|source| source.path.as_str()).collect();
    let mut tests = BTreeSet::new();
    for source in sources {
        let folder = if source.path.ends_with("/lib.rs") || source.path.ends_with("/main.rs") {
            source
                .path
                .rsplit_once('/')
                .map_or("", |(folder, _)| folder)
                .to_owned()
        } else {
            source.path.trim_end_matches(".rs").to_owned()
        };
        for module in &source.file.test_module_files {
            let file = format!("{folder}/{module}.rs");
            let directory = format!("{folder}/{module}/");
            for path in &paths {
                if *path == file || path.starts_with(&directory) {
                    tests.insert((*path).to_owned());
                }
            }
        }
    }
    tests
}

/// The parts that read only source text, over `sources`: what the self-test runs too.
pub(crate) fn check_sources(problems: &mut Problems, sources: &[Source], map: &Value) {
    layers::check(problems, sources, map);
    let tests = test_files(sources);
    for source in sources {
        let test_file = tests.contains(&source.path)
            || source
                .path
                .strip_prefix(source.crate_dir)
                .is_some_and(|inside| inside.starts_with("/tests/"));
        lints::check(problems, source, map, test_file);
    }
    lints::check_tests(problems, sources, &tests);
    refusals::check(problems, sources, map);
}

/// The gate.
pub(crate) fn run(root: &Path) -> Result<(), Failure> {
    let map = crate::repository::json(root, "module-map.json")?;
    let files = tracked_or_new(root)?;
    let mut problems = Problems::default();
    let rust: Vec<(String, String)> = files
        .iter()
        .filter(|path| path.ends_with(".rs") && !path.starts_with("vendor/"))
        .map(|path| Ok((path.clone(), read(root, path)?)))
        .collect::<Result<_, Failure>>()?;
    let sources = read_sources(rust, &mut problems);
    check_sources(&mut problems, &sources, &map);
    deps::check(&mut problems, root, &files, &map)?;
    lints::check_manifests(&mut problems, root, &files, &map)?;
    sizes::check(&mut problems, root, &files, &sources)?;
    sizes::check_tooling(&mut problems, root, &files)?;
    report(
        &problems.0,
        &format!(
            "code-rules: {} problems with the coding guide's rules",
            problems.0.len()
        ),
        &format!("code-rules: {} files checked", files.len()),
    )
}

/// The parts against the cases each must catch, and those they must pass (CORE-28).
pub(crate) fn self_test(root: &Path) -> Result<(), Failure> {
    let map = crate::repository::json(root, "module-map.json")?;
    let mut failed = Vec::new();
    let all = cases::cases();
    for case in &all {
        let mut problems = Problems::default();
        match &case.input {
            cases::Input::Sources(files) => {
                let sources = read_sources(
                    files
                        .iter()
                        .map(|(path, text)| ((*path).to_owned(), (*text).to_owned()))
                        .collect(),
                    &mut problems,
                );
                check_sources(&mut problems, &sources, &map);
            }
            cases::Input::Manifest(manifest) => {
                lints::check_release_profile(&mut problems, manifest)
            }
        }
        let caught = case
            .expect
            .is_some_and(|expect| problems.0.iter().any(|line| line.contains(expect)));
        let wrong = match case.expect {
            None => !problems.0.is_empty(),
            Some(_) => !caught,
        };
        if wrong {
            let found = if problems.0.is_empty() {
                "nothing caught".to_owned()
            } else {
                problems.0.join(" | ")
            };
            failed.push(format!("{}: {found}", case.name));
        }
    }
    report(
        &failed,
        "code-rules: the self-test failed",
        &format!("code-rules: the self-test catches all {} cases.", all.len()),
    )
}
