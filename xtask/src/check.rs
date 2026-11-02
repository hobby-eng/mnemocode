//! `cargo xtask check`: the fast gates of CORE-43 (docs/design/architect/GATES.md, "check"), run
//! before every commit and by CI on every push, in this order: the formatters (rustfmt; dprint for
//! Markdown, JSON, TOML and YAML), Clippy for every crate and target on this system, for the
//! release targets of the other systems, whose own code compiles only there (RUST-02), and for the
//! binding's wasm32 build with every module and each alone (CORE-04, RUST-15), rustdoc, the tests,
//! code-rules and copies with their self-tests, the Markdown lists, the notices, the action pins,
//! every page's WebAssembly file built and checked, and the RustSec audit where its database is at
//! hand (CI's audit job fetches it).

use std::path::Path;
use std::process::Command;

use crate::{Failure, action_pins, code_rules, copies, markdown, notices, run_tool, wasm};

/// Clippy with `arguments`, warnings refused; a clippy.toml path that does not resolve, which
/// -D warnings lets pass, refused too.
pub(crate) fn clippy(root: &Path, arguments: &[&str]) -> Result<(), Failure> {
    let mut all = vec!["clippy", "--locked"];
    all.extend_from_slice(arguments);
    all.extend_from_slice(&["--", "-D", "warnings"]);
    let output = Command::new("cargo")
        .args(&all)
        .current_dir(root)
        .output()?;
    let text = String::from_utf8_lossy(&output.stderr);
    eprint!("{text}");
    if !output.status.success() {
        return Err(Failure(format!("cargo {} failed", all.join(" "))));
    }
    if text.contains("does not refer to a") {
        return Err(Failure(
            "clippy.toml names a path that does not resolve; fix it, or mark a platform-only one allow-invalid".to_owned(),
        ));
    }
    Ok(())
}

/// The gates, each stopping the run at its first failure.
pub(crate) fn run(root: &Path) -> Result<(), Failure> {
    run_tool(root, "cargo", &["fmt", "--all", "--check"])?;
    run_tool(root, "dprint", &["check"])?;
    clippy(root, &["--workspace", "--all-targets"])?;
    clippy(
        root,
        &[
            "--workspace",
            "--all-targets",
            "--target",
            "x86_64-pc-windows-gnu",
        ],
    )?;
    clippy(
        root,
        &[
            "--workspace",
            "--all-targets",
            "--target",
            "aarch64-apple-darwin",
        ],
    )?;
    clippy(
        root,
        &[
            "-p",
            "mnemocode-wasm",
            "--lib",
            "--target",
            "wasm32-unknown-unknown",
            "--all-features",
        ],
    )?;
    for module in wasm::binding_modules(root)? {
        clippy(
            root,
            &[
                "-p",
                "mnemocode-wasm",
                "--lib",
                "--target",
                "wasm32-unknown-unknown",
                "--no-default-features",
                "--features",
                &module,
            ],
        )?;
    }
    let status = Command::new("cargo")
        .args(["doc", "--locked", "--no-deps"])
        .env("RUSTDOCFLAGS", "-D warnings")
        .current_dir(root)
        .status()?;
    if !status.success() {
        return Err(Failure("cargo doc failed".to_owned()));
    }
    run_tool(root, "cargo", &["test", "--locked", "--workspace"])?;
    // The binding's modules are features off by default: their tests run with every one.
    run_tool(
        root,
        "cargo",
        &["test", "--locked", "-p", "mnemocode-wasm", "--all-features"],
    )?;
    code_rules::self_test(root)?;
    code_rules::run(root)?;
    copies::run(root, &["--self-test"])?;
    copies::run(root, &[])?;
    markdown::run(root)?;
    notices::run(root, true)?;
    action_pins::run(root)?;
    wasm::build_all(root)?;
    wasm::verify(root)?;
    audit(root, false)?;
    println!("All checks passed.");
    Ok(())
}

/// Cargo.lock against the RustSec advisories. With `fetch` the database is fetched first; without,
/// the local copy is used, and its absence is said, not failed: CI's audit job always fetches it.
pub(crate) fn audit(root: &Path, fetch: bool) -> Result<(), Failure> {
    if fetch {
        return run_tool(root, "cargo", &["audit", "--deny", "warnings"]);
    }
    let home = std::env::var_os("CARGO_HOME").map(std::path::PathBuf::from);
    let database = home.map(|home| home.join("advisory-db"));
    if !database.is_some_and(|database| database.is_dir()) {
        println!("audit: no local RustSec database (cargo xtask audit fetches it); not run here.");
        return Ok(());
    }
    run_tool(
        root,
        "cargo",
        &["audit", "--no-fetch", "--stale", "--deny", "warnings"],
    )
}
