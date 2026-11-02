//! The tools of the MnemoCode repository (TOOL-01), run from anywhere in it as `cargo xtask
//! <task>`; each prints what it checked and exits 0, or what it refused and exits 1:
//!
//! - `check`: the fast gates of CORE-43 (docs/design/architect/GATES.md), every one below, with
//!   rustfmt, Clippy for every crate and target, rustdoc, the tests, the binding's tests in
//!   WebAssembly and the RustSec audit where its database is at hand. CI runs it on every push.
//! - `code-rules [--self-test]`: the rules of the coding guide that the compiler and Clippy cannot
//!   see, read from module-map.json; with `--self-test`, against the cases each part must catch.
//! - `copies [--tokens N | --self-test]`: code copied from one place to another (CORE-10).
//! - `markdown`: every Markdown list tight (DOC-01).
//! - `notices [--check]`: the Rust crates part of THIRD_PARTY_NOTICES.md, written or checked.
//! - `wasm build [<edition>/<page>]` and `wasm verify`: every page's WebAssembly file, built from
//!   wasm-profiles.json and checked (ADR 0007).
//! - `windows-imports <file.exe> [--check]`: the DLLs a Windows executable imports, each a
//!   KnownDLL or an API set with `--check` (W-DLL-SEARCH).
//! - `knowndlls`: on Windows, the \\KnownDlls object directory against xtask/knowndlls.json.
//! - `action-pins`: the workflows' actions against the workspace's pin table (CI-01 to CI-03).
//! - `audit`: Cargo.lock against the RustSec advisories (cargo-audit).
//! - `release build <target>`, `release pages`: the files of a release, in dist/release/.
//! - `verify-executable <file>`: a built executable run on its own, on public test data.
//! - `reproducible`: the canonical files rebuilt in the pinned container and compared.
//! - `features`: each unit of the libraries built alone, and the slow tests.
//! - `sign <tag> [--publish]`: a draft release checked and signed on the owner's computer.

#![deny(unsafe_code)]
#![expect(
    clippy::print_stdout,
    clippy::print_stderr,
    reason = "a tool of the repository reports to the terminal that runs it"
)]

mod action_pins;
mod check;
mod code_rules;
mod copies;
mod knowndlls;
mod markdown;
mod notices;
mod release;
mod repository;
mod rust_source;
mod wasm;
mod windows;

use std::fmt;
use std::path::{Path, PathBuf};
use std::process::{Command, ExitCode};

/// Why a task failed, as the message printed before exit code 1: a gate's refusals, a tool that
/// could not run, or a wrong argument (RUST-04's exception for a program's own messages).
#[derive(Debug)]
pub(crate) struct Failure(pub(crate) String);

impl fmt::Display for Failure {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(&self.0)
    }
}

impl std::error::Error for Failure {}

impl From<std::io::Error> for Failure {
    fn from(error: std::io::Error) -> Self {
        Self(error.to_string())
    }
}

const USAGE: &str = "usage: cargo xtask <check | code-rules [--self-test] | copies [--tokens N | \
                     --self-test] | markdown | notices [--check] | wasm build [<edition>/<page>] \
                     | wasm verify | windows-imports <file.exe> [--check] | action-pins | knowndlls | release build <target> | release pages | verify-executable <file> | reproducible | features | sign <tag> [--publish] | audit>";

/// The repository's root: the folder above this crate's.
pub(crate) fn root() -> PathBuf {
    let manifest = Path::new(env!("CARGO_MANIFEST_DIR"));
    manifest.parent().unwrap_or(manifest).to_path_buf()
}

/// Runs `program` with `arguments` in `folder`, its output passed through; refused when it fails.
pub(crate) fn run_tool(folder: &Path, program: &str, arguments: &[&str]) -> Result<(), Failure> {
    let status = Command::new(program)
        .args(arguments)
        .current_dir(folder)
        .status()
        .map_err(|error| Failure(format!("{program} could not run: {error}")))?;
    if status.success() {
        Ok(())
    } else {
        Err(Failure(format!(
            "{program} {} failed ({status})",
            arguments.join(" ")
        )))
    }
}

/// What `program` with `arguments` writes to standard output in `folder`; refused when it fails.
pub(crate) fn output_of(
    folder: &Path,
    program: &str,
    arguments: &[&str],
) -> Result<String, Failure> {
    let output = Command::new(program)
        .args(arguments)
        .current_dir(folder)
        .output()
        .map_err(|error| Failure(format!("{program} could not run: {error}")))?;
    if !output.status.success() {
        return Err(Failure(format!(
            "{program} {} failed: {}",
            arguments.join(" "),
            String::from_utf8_lossy(&output.stderr)
        )));
    }
    String::from_utf8(output.stdout).map_err(|_| Failure(format!("{program} wrote no UTF-8")))
}

/// Prints `problems` and fails with `summary`, or says `passed`.
pub(crate) fn report(problems: &[String], summary: &str, passed: &str) -> Result<(), Failure> {
    if problems.is_empty() {
        println!("{passed}");
        return Ok(());
    }
    for problem in problems {
        eprintln!("{problem}");
    }
    Err(Failure(summary.to_owned()))
}

/// Runs `task` with its arguments.
fn run(task: &str, arguments: &[String]) -> Result<(), Failure> {
    let root = root();
    let words: Vec<&str> = arguments.iter().map(String::as_str).collect();
    match (task, words.as_slice()) {
        ("check", []) => check::run(&root),
        ("code-rules", []) => code_rules::run(&root),
        ("code-rules", ["--self-test"]) => code_rules::self_test(&root),
        ("copies", words) => copies::run(&root, words),
        ("markdown", []) => markdown::run(&root),
        ("notices", []) => notices::run(&root, false),
        ("notices", ["--check"]) => notices::run(&root, true),
        ("wasm", ["build"]) => wasm::build_all(&root),
        ("wasm", ["build", profile]) => wasm::build(&root, profile),
        ("wasm", ["verify"]) => wasm::verify(&root),
        ("windows-imports", [file]) => windows::run(&root, Path::new(file), false),
        ("windows-imports", [file, "--check"]) => windows::run(&root, Path::new(file), true),
        ("audit", []) => check::audit(&root, true),
        ("action-pins", []) => action_pins::run(&root),
        ("knowndlls", []) => knowndlls::run(&root),
        ("release", ["build", target]) => release::build(&root, target),
        ("release", ["pages"]) => release::pack_pages(&root),
        ("verify-executable", [file]) => release::verify_executable(&root, Path::new(file)),
        ("reproducible", []) => release::reproducible(&root),
        ("features", []) => release::features(&root),
        ("sign", [tag]) => release::sign(&root, tag, false),
        ("sign", [tag, "--publish"]) => release::sign(&root, tag, true),
        _ => Err(Failure(USAGE.to_owned())),
    }
}

fn main() -> ExitCode {
    let arguments: Vec<String> = std::env::args().skip(1).collect();
    let Some((task, rest)) = arguments.split_first() else {
        eprintln!("{USAGE}");
        return ExitCode::FAILURE;
    };
    match run(task, rest) {
        Ok(()) => ExitCode::SUCCESS,
        Err(failure) => {
            eprintln!("{failure}");
            ExitCode::FAILURE
        }
    }
}
